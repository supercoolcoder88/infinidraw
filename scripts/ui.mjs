#!/usr/bin/env node
// Headless, throwaway infinidraw instance driven over the Chrome DevTools Protocol.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(os.tmpdir(), 'infinidraw-ui');
const stateFile = path.join(dir, 'state.json');
const [cmd, ...args] = process.argv.slice(2);
const state = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      ],
      { cwd: root, detached: true, stdio: ['ignore', log, log] },
    );
    child.unref();
    fs.writeFileSync(
      stateFile,
      JSON.stringify({ pid: child.pid, port, width, height }),
    );

    // The dev page can reload once right after first load, so wait until it settles.
    let last;
    for (let i = 0; i < 120; i++, await sleep(500)) {
      try {
        const app = await connect();
        const origin = await app.evaluate(
          `document.readyState === 'complete' && performance.timeOrigin`,
        );
        app.close();
        if (origin && origin === last)
          return console.log(`ready on port ${port}`);
        last = origin;
      } catch {}
    }
    throw new Error(`App did not come up, see ${path.join(dir, 'app.log')}`);
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

  async eval(expression) {
    console.log(
      JSON.stringify(await (await connect()).evaluate(expression), null, 2),
    );
  },

  async click(target) {
    const app = await connect();
    const at = /^\d+,\d+$/.test(target)
      ? point(target)
      : await app.evaluate(find(target));
    await mouse(app, 'mouseMoved', at);
    await mouse(app, 'mousePressed', at, { clickCount: 1 });
    await mouse(app, 'mouseReleased', at, { clickCount: 1 });
  },

  async hover(target) {
    const app = await connect();
    const at = /^\d+,\d+$/.test(target)
      ? point(target)
      : await app.evaluate(find(target));
    await mouse(app, 'mouseMoved', at, { button: 'none' });
  },

  async drag(from, to) {
    const app = await connect();
    const a = point(from);
    const b = point(to);
    await mouse(app, 'mouseMoved', a, { button: 'none' });
    await mouse(app, 'mousePressed', a, { clickCount: 1 });
    for (let i = 1; i <= 10; i++)
      await mouse(
        app,
        'mouseMoved',
        { x: a.x + ((b.x - a.x) * i) / 10, y: a.y + ((b.y - a.y) * i) / 10 },
        { buttons: 1 },
      );
    await mouse(app, 'mouseReleased', b, { clickCount: 1 });
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
    'usage: node scripts/ui.mjs start [WxH] | shot [file] | click <css|text=...|x,y> | hover <css|text=...|x,y> | drag <x,y> <x,y> | type <text> | key <[Ctrl+]Key> | eval <js> | stop',
  );
  process.exit(1);
}
await commands[cmd](...args);
process.exit(0);
