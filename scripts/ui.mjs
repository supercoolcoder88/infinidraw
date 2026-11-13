#!/usr/bin/env node
// Headless, throwaway infinidraw instance driven over the Chrome DevTools Protocol.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const session = process.env.UI_SESSION;
const dir = path.join(
  os.tmpdir(),
  `infinidraw-ui${session ? `-${session}` : ''}`,
);
const stateFile = path.join(dir, 'state.json');
const [cmd, ...args] = process.argv.slice(2);
const state = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const skill = path.join(root, '.claude/skills/ui-review');
const scene = JSON.parse(
  fs.readFileSync(path.join(skill, 'scene.json'), 'utf8'),
);
const light = JSON.stringify({ ...scene, 'infinidraw:theme': 'light' });

// Each snapshot is a list of commands run from a fresh reset, at 1280x800.
const SNAPSHOTS = {
  empty: [['reset', '{"infinidraw:theme":"light"}']],
  scene: [['reset', light]],
  selected: [
    ['reset', light],
    ['click', '380,320'],
  ],
  'shape-menu': [
    ['reset', light],
    ['rightclick', '380,320'],
  ],
  'main-menu': [
    ['reset', light],
    ['click', '[aria-label=Menu]'],
  ],
  shortcuts: [
    ['reset', light],
    ['key', '?'],
  ],
  editing: [
    ['reset', light],
    ['dblclick', '890,320'],
    ['type', ' app'],
  ],
  inside: [
    ['reset', light],
    ['rightclick', '380,320'],
    ['click', 'text=Enter'],
  ],
  dark: [
    ['reset', JSON.stringify({ ...scene, 'infinidraw:theme': 'dark' })],
    ['click', '380,320'],
  ],
  'multi-selected': [
    ['reset', light],
    ['drag', '150,240', '1060,580'],
  ],
  'bound-arrow': [
    ['reset', light],
    ['key', 'a'],
    ['drag', '890,320', '300,520'],
    ['key', 'Escape'],
    ['drag', '230,520', '330,680'],
  ],
};

// Decodes both PNGs in the page and returns the changed pixel count and a diff image.
const compare = (a, b) => `(async () => {
  const load = async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const ctx = new OffscreenCanvas(img.width, img.height).getContext('2d');
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, img.width, img.height);
  };
  const [a, b] = await Promise.all([load('${a}'), load('${b}')]);
  if (a.width !== b.width || a.height !== b.height) return { changed: a.width * a.height };
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const hit = [0, 1, 2, 3].some((c) => Math.abs(a.data[i + c] - b.data[i + c]) > 16);
    changed += hit;
    b.data.set(hit ? [255, 0, 0, 255] : [b.data[i], b.data[i + 1], b.data[i + 2], 40], i);
  }
  if (!changed) return { changed };
  const out = new OffscreenCanvas(b.width, b.height);
  out.getContext('2d').putImageData(b, 0, 0);
  const blob = await out.convertToBlob();
  const url = await new Promise((r) => {
    const f = new FileReader();
    f.onload = () => r(f.result);
    f.readAsDataURL(blob);
  });
  return { changed, diff: url.split(',')[1] };
})()`;

async function connect() {
  const { port, width, height } = state();
  const targets = await (
    await fetch(`http://localhost:${port}/json/list`)
  ).json();
  const page = targets.find(
    (t) => t.type === 'page' && !t.url.startsWith('devtools://'),
  );
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    pending.get(m.id)?.(m);
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      pending.set(++id, (m) =>
        m.error ? reject(new Error(m.error.message)) : resolve(m.result),
      );
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails)
      throw new Error(
        r.exceptionDetails.exception?.description ?? r.exceptionDetails.text,
      );
    return r.result.value;
  };
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  // Headless ozone windows are 1x1 and the override is dropped on disconnect.
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  return { send, evaluate, close: () => ws.close() };
}

const find = (target) => `(() => {
  const t = ${JSON.stringify(target)};
  const all = t.startsWith('text=')
    ? [...document.querySelectorAll('body *')].filter((e) => e.innerText?.includes(t.slice(5)))
    : [...document.querySelectorAll(t)];
  const el = all.filter((e) => e.getClientRects().length).at(-1);
  if (!el) throw new Error('No visible element for ' + t);
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
})()`;

const point = (s) => {
  const [x, y] = s.split(',').map(Number);
  if (Number.isNaN(x) || Number.isNaN(y)) throw new Error(`Bad point ${s}`);
  return { x, y };
};

const mouse = (app, type, { x, y }, extra = {}) =>
  app.send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: 'left',
    ...extra,
  });

const locate = (app, target) =>
  /^\d+,\d+$/.test(target) ? point(target) : app.evaluate(find(target));

const shift = (m) => (m === 'Shift' ? 8 : 0);

async function press(target, button = 'left', clicks = 1, modifiers = 0) {
  const app = await connect();
  const at = await locate(app, target);
  await mouse(app, 'mouseMoved', at, { button: 'none' });
  for (let clickCount = 1; clickCount <= clicks; clickCount++) {
    await mouse(app, 'mousePressed', at, { button, clickCount, modifiers });
    await mouse(app, 'mouseReleased', at, { button, clickCount, modifiers });
  }
}

// Waits for the page to load and stop reloading, comparing timeOrigin across polls.
async function settle(previous) {
  let last;
  for (let i = 0; i < 120; i++, await sleep(500)) {
    try {
      const app = await connect();
      const origin = await app.evaluate(
        `document.readyState === 'complete' && performance.timeOrigin`,
      );
      app.close();
      if (origin && origin === last && origin !== previous) return;
      last = origin;
    } catch {}
  }
  throw new Error(`App did not come up, see ${path.join(dir, 'app.log')}`);
}

const commands = {
  async start() {
    if (fs.existsSync(stateFile))
      throw new Error(`Already running, run stop first (${dir})`);
    const [width, height] = (
      args.find((a) => /^\d+x\d+$/.test(a)) ?? '1280x800'
    )
      .split('x')
      .map(Number);
    fs.mkdirSync(dir, { recursive: true });

    const port = await new Promise((r) => {
      const s = net
        .createServer()
        .listen(0, () => (r(s.address().port), s.close()));
    });
    const log = fs.openSync(path.join(dir, 'app.log'), 'w');
    const child = spawn(
      'npx',
      [
        'electron-forge',
        'start',
        '--',
        '--ozone-platform=headless',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${path.join(dir, 'userdata')}`,
        '--enable-logging=stderr',
      ],
      { cwd: root, detached: true, stdio: ['ignore', log, log] },
    );
    child.unref();
    fs.writeFileSync(
      stateFile,
      JSON.stringify({ pid: child.pid, port, width, height }),
    );

    await settle();
    console.log(`ready on port ${port}`);
  },

  async reset(storage = '{}') {
    const app = await connect();
    const origin = await app.evaluate(`(() => {
      localStorage.clear();
      Object.entries(${storage}).forEach(([k, v]) =>
        localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)));
      setTimeout(() => location.reload());
      return performance.timeOrigin;
    })()`);
    await settle(origin);
  },

  async stop() {
    if (fs.existsSync(stateFile)) {
      try {
        process.kill(-state().pid, 'SIGTERM');
      } catch {}
      await sleep(1000);
    }
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('stopped');
  },

  async shot(file = path.join(dir, 'shots', `${Date.now()}.png`)) {
    const app = await connect();
    await sleep(200);
    const { data } = await app.send('Page.captureScreenshot', {
      format: 'png',
    });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(file);
  },

  async snapshots(...names) {
    const update = names.includes('--update');
    names = names.filter((n) => n !== '--update');
    const { width, height } = state();
    if (`${width}x${height}` !== '1280x800')
      throw new Error('Snapshots need a 1280x800 instance');
    for (const name of names.length ? names : Object.keys(SNAPSHOTS)) {
      for (const [c, ...a] of SNAPSHOTS[name]) await commands[c](...a);
      const app = await connect();
      await app.evaluate(
        `document.head.insertAdjacentHTML('beforeend', '<style>*{caret-color:transparent!important;animation:none!important;transition:none!important}</style>')`,
      );
      await sleep(300);
      const { data } = await app.send('Page.captureScreenshot', {
        format: 'png',
      });
      const baseline = path.join(skill, 'snapshots', `${name}.png`);
      if (update || !fs.existsSync(baseline)) {
        fs.mkdirSync(path.dirname(baseline), { recursive: true });
        fs.writeFileSync(baseline, Buffer.from(data, 'base64'));
        console.log(`${name}: saved baseline`);
        continue;
      }
      const old = fs.readFileSync(baseline).toString('base64');
      const { changed, diff } = await app.evaluate(compare(old, data));
      if (!changed) {
        console.log(`${name}: ok`);
        continue;
      }
      const out = path.join(dir, 'snapshots', name);
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(
        path.join(out, 'actual.png'),
        Buffer.from(data, 'base64'),
      );
      if (diff)
        fs.writeFileSync(
          path.join(out, 'diff.png'),
          Buffer.from(diff, 'base64'),
        );
      console.log(`${name}: ${changed} pixels changed, see ${out}`);
      process.exitCode = 1;
    }
  },

  async eval(expression) {
    console.log(
      JSON.stringify(await (await connect()).evaluate(expression), null, 2),
    );
  },

  click: (target, mod) => press(target, 'left', 1, shift(mod)),
  dblclick: (target) => press(target, 'left', 2),
  rightclick: (target) => press(target, 'right'),

  async hover(target) {
    const app = await connect();
    await mouse(app, 'mouseMoved', await locate(app, target), {
      button: 'none',
    });
  },

  // CDP wheel events are hit-tested against the real 1x1 headless window, so dispatch in the page.
  async wheel(at, delta, modifier) {
    const { x, y } = point(at);
    const [deltaX, deltaY] = delta.split(',').map(Number);
    const init = { bubbles: true, cancelable: true, clientX: x, clientY: y };
    Object.assign(init, { deltaX, deltaY, ctrlKey: modifier === 'Ctrl' });
    await (
      await connect()
    ).evaluate(
      `document.elementFromPoint(${x}, ${y}).dispatchEvent(new WheelEvent('wheel', ${JSON.stringify(init)}))`,
    );
  },

  async drag(from, to, mod) {
    const app = await connect();
    const a = point(from);
    const b = point(to);
    const modifiers = shift(mod);
    await mouse(app, 'mouseMoved', a, { button: 'none' });
    await mouse(app, 'mousePressed', a, { clickCount: 1, modifiers });
    for (let i = 1; i <= 10; i++)
      await mouse(
        app,
        'mouseMoved',
        { x: a.x + ((b.x - a.x) * i) / 10, y: a.y + ((b.y - a.y) * i) / 10 },
        { buttons: 1, modifiers },
      );
    await mouse(app, 'mouseReleased', b, { clickCount: 1, modifiers });
  },

  async type(text) {
    await (await connect()).send('Input.insertText', { text });
  },

  async key(combo) {
    const app = await connect();
    const parts = combo.split('+');
    const key = parts.pop();
    const bits = { Alt: 1, Ctrl: 2, Meta: 4, Shift: 8 };
    const modifiers = parts.reduce((m, p) => m | (bits[p] ?? 0), 0);
    const named = {
      Enter: 13,
      Escape: 27,
      Tab: 9,
      Backspace: 8,
      Delete: 46,
      ArrowLeft: 37,
      ArrowUp: 38,
      ArrowRight: 39,
      ArrowDown: 40,
    };
    const single = key.length === 1;
    const code = named[key] ?? key.toUpperCase().charCodeAt(0);
    for (const type of ['keyDown', 'keyUp'])
      await app.send('Input.dispatchKeyEvent', {
        type,
        key,
        code: single
          ? /\d/.test(key)
            ? `Digit${key}`
            : `Key${key.toUpperCase()}`
          : key,
        windowsVirtualKeyCode: code,
        modifiers,
        ...(type === 'keyDown' && !modifiers && single ? { text: key } : {}),
        ...(key === 'Enter' && type === 'keyDown' ? { text: '\r' } : {}),
      });
  },
};

if (!commands[cmd]) {
  console.error(
    'usage: node scripts/ui.mjs start [WxH] | reset [json] | shot [file] | snapshots [name...] [--update] | click|dblclick|rightclick|hover <css|text=...|x,y> | drag <x,y> <x,y> | wheel <x,y> <dx,dy> [Ctrl] | type <text> | key <[Ctrl+]Key> | eval <js> | stop',
  );
  process.exit(1);
}
await commands[cmd](...args);
process.exit();
