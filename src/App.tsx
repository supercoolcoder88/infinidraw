import { useEffect, useReducer, useRef, useState } from 'react';
import {
  bounds,
  connect,
  draw,
  exportPng,
  extent,
  frame,
  handles,
  hit,
  LINE,
  sideAt,
  snap,
  textSize,
  type Box,
  type Point,
  type Shape,
  type View,
} from './shapes';
import { flushSync } from 'react-dom';
import { Breadcrumbs } from './Breadcrumbs';
import { Controls } from './Controls';
import { Icon, Menu, PANEL, PANEL_BUTTON } from './Menu';
import { ShortcutsDialog } from './ShortcutsDialog';
import { StylePanel } from './StylePanel';
import { TextEditor } from './TextEditor';
import { Toolbar, TOOLS, type Tool } from './Toolbar';

const STORAGE_KEY = 'infinidraw:shapes';
const VIEW_KEY = 'infinidraw:view';
const PATH_KEY = 'infinidraw:path';
const THEME_KEY = 'infinidraw:theme';
const NUDGE: Record<string, [number, number]> = {
  arrowleft: [-1, 0],
  arrowright: [1, 0],
  arrowup: [0, -1],
  arrowdown: [0, 1],
};
// One pointer gesture; draw and resize both pull a handle, draw falls back to select on release.
type Drag = { before: Shape[]; down: Point; last: Point } & (
  | { kind: 'pan'; moves: (Point & { t: number })[] }
  | { kind: 'area'; area: Box }
  | { kind: 'move'; ids: string[]; guides: [Point, Point][] }
  | { kind: 'draw' | 'resize'; id: string; handle: Point }
);

const zoomAt = (v: View, zoom: number, cx: number, cy: number): View => ({
  zoom,
  x: cx - ((cx - v.x) * zoom) / v.zoom,
  y: cy - ((cy - v.y) * zoom) / v.zoom,
});
const centred = (s: Box, zoom: number): View => {
  const b = bounds(s);
  return {
    zoom,
    x: innerWidth / 2 - (b.x + b.w / 2) * zoom,
    y: innerHeight / 2 - (b.y + b.h / 2) * zoom,
  };
};
// True once both borders on either axis are off-screen.
const covers = (s: Shape, v: View) => {
  const b = bounds(s);
  const x = v.x + b.x * v.zoom;
  const y = v.y + b.y * v.zoom;
  return (
    (x <= 0 && x + b.w * v.zoom >= innerWidth) ||
    (y <= 0 && y + b.h * v.zoom >= innerHeight)
  );
};
// The parent level's view that shows the same as view v inside s.
const outside = (s: Shape, v: View): View => {
  const f = frame(s);
  const zoom = v.zoom / f.k;
  return { zoom, x: v.x - f.x * zoom, y: v.y - f.y * zoom };
};
const nest = (
  level: Shape[],
  [id, ...rest]: string[],
  f: (s: Shape[]) => Shape[],
): Shape[] =>
  id
    ? level.map((s) =>
        s.id === id ? { ...s, children: nest(s.children ?? [], rest, f) } : s,
      )
    : f(level);
// Copied arrows stay bound only to shapes copied with them.
const clone = (shapes: Shape[], dx = 0, dy = 0): Shape[] => {
  const ids = new Map(shapes.map((s) => [s.id, crypto.randomUUID()]));
  return shapes.map((s) => ({
    ...s,
    id: ids.get(s.id)!,
    x: s.x + dx,
    y: s.y + dy,
    from: s.from && ids.get(s.from),
    to: s.to && ids.get(s.to),
    children: s.children && clone(s.children),
  }));
};
// Moving an arrow drops its bindings to shapes that are not moving with it.
const shift = (s: Shape, dx: number, dy: number, ids: string[]): Shape => ({
  ...s,
  x: s.x + dx,
  y: s.y + dy,
  from: ids.find((id) => id === s.from),
  to: ids.find((id) => id === s.to),
});

export function App() {
  const [root, setRoot] = useState<Shape[]>(() =>
    JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'),
  );
  const [path, setPath] = useState<string[]>(() =>
    JSON.parse(localStorage.getItem(PATH_KEY) ?? '[]'),
  );
  const [tool, setTool] = useState<Tool>('select');
  const [dotted, setDotted] = useState(false);
  const [elbow, setElbow] = useState(false);
  const [color, setColor] = useState<string>();
  const [theme, setTheme] = useState(
    () =>
      localStorage.getItem(THEME_KEY) ??
      (matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ id: string; before: Shape[] }>();
  const [view, setView] = useState<View>(() =>
    JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{"x":0,"y":0,"zoom":1}'),
  );
  const [overlay, setOverlay] = useState<
    | { kind: 'shape' | 'canvas' | 'main'; x: number; y: number }
    | { kind: 'help' }
  >();
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag>(null);
  const past = useRef<Shape[][]>([]);
  const future = useRef<Shape[][]>([]);
  const nudged = useRef<{ ids: string; at: number }>(undefined);
  const space = useRef(false);
  const clipboard = useRef<Shape[]>([]);
  const pointer = useRef<{ clientX: number; clientY: number }>(null);
  const motion = useRef(0);

  // The rectangles we are inside, outermost first, and the shapes of the innermost.
  const trail: Shape[] = [];
  let shapes = root;
  for (const id of path) {
    const s = shapes.find((s) => s.id === id);
    if (!s) break;
    trail.push(s);
    shapes = s.children ?? [];
  }
  const ids = trail.map((s) => s.id);
  const inside = trail.at(-1);
  const setShapes = (next: Shape[] | ((s: Shape[]) => Shape[])) =>
    setRoot((r) =>
      nest(r, ids, (s) => connect(typeof next === 'function' ? next(s) : next)),
    );

  const selection = shapes.filter((s) => selectedIds.includes(s.id));
  const selected = selection.length === 1 ? selection[0] : undefined;
  const edited = shapes.find((s) => s.id === editing?.id);

  const commit = (before: Shape[], next: Shape[], merge = false) => {
    if (JSON.stringify(before) !== JSON.stringify(next)) {
      if (!merge) past.current.push(nest(root, ids, () => before));
      future.current = [];
    }
    nudged.current = undefined;
    setShapes(next);
    redraw();
  };
  const timeTravel = (from: Shape[][], to: Shape[][]) => {
    const target = from.pop();
    if (!target) return;
    nudged.current = undefined;
    to.push(root);
    setRoot(target);
  };
  const undo = () => timeTravel(past.current, future.current);
  const redo = () => timeTravel(future.current, past.current);
  const remove = () =>
    commit(
      shapes,
      shapes.filter((s) => !selection.includes(s)),
    );
  const add = (copies: Shape[]) => {
    commit(shapes, [...shapes, ...copies]);
    setSelectedIds(copies.map((s) => s.id));
  };
  const duplicate = () => add(clone(selection, 16, 16));
  // Pastes with the copied group centred on the pointer, or the window when it never moved.
  const paste = () => {
    if (!clipboard.current.length) return;
    const b = extent(clipboard.current);
    const p = toWorld(
      pointer.current ?? { clientX: innerWidth / 2, clientY: innerHeight / 2 },
    );
    add(clone(clipboard.current, p.x - b.x - b.w / 2, p.y - b.y - b.h / 2));
  };
  const reorder = (front: boolean) => {
    const rest = shapes.filter((s) => !selection.includes(s));
    commit(shapes, front ? [...rest, ...selection] : [...selection, ...rest]);
  };
  const restyle = (style: Partial<Shape>, type?: Shape['type']) =>
    commit(
      shapes,
      shapes.map((s) =>
        selection.includes(s) && (!type || s.type === type)
          ? { ...s, ...style }
          : s,
      ),
    );
  const setStroke = (d: boolean) => {
    setDotted(d);
    restyle({ dotted: d });
  };
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem(THEME_KEY, next);
  };
  const clear = () => {
    commit(shapes, []);
    setSelectedIds([]);
  };
  const save = () =>
    files.save(
      JSON.stringify({ type: 'infinidraw', version: 1, shapes: root }),
    );
  const open = async () => {
    const text = await files.open();
    if (!text) return;
    const file = JSON.parse(text);
    if (file.type !== 'infinidraw') return alert('Not an infinidraw file');
    past.current.push(root);
    future.current = [];
    setRoot(file.shapes);
    go([], { x: 0, y: 0, zoom: 1 });
  };
  const go = (to: string[], v: View) => {
    setPath(to);
    setView(v);
    setSelectedIds([]);
  };
  const enter = (s: Shape, v: View) => {
    const f = frame(s);
    go([...ids, s.id], {
      zoom: v.zoom * f.k,
      x: v.x + f.x * v.zoom,
      y: v.y + f.y * v.zoom,
    });
  };
  const fill = (s: Shape, pick: (...n: number[]) => number) =>
    pick(innerWidth / (Math.abs(s.w) || 1), innerHeight / (Math.abs(s.h) || 1));
  const leaveTo = (depth: number) => {
    const from = trail.slice(depth).reduceRight((v, s) => outside(s, v), view);
    go(ids.slice(0, depth), from);
    animate(from, centred(trail[depth], fill(trail[depth], Math.min) / 2));
  };
  const stop = () => cancelAnimationFrame(motion.current);
  // Runs step with the elapsed ms on every frame for as long as it returns true.
  const loop = (step: (ms: number) => boolean | void) => {
    stop();
    const start = performance.now();
    const tick = () => {
      if (step(performance.now() - start))
        motion.current = requestAnimationFrame(tick);
    };
    motion.current = requestAnimationFrame(tick);
  };
  const animate = (from: View, to: View, done?: () => void) =>
    loop((ms) => {
      const t = 1 - (1 - Math.min(1, ms / 200)) ** 3;
      const mix = (a: number, b: number) => a + (b - a) * t;
      setView({
        zoom: mix(from.zoom, to.zoom),
        x: mix(from.x, to.x),
        y: mix(from.y, to.y),
      });
      if (t < 1) return true;
      done?.();
    });
  const fit = (list: Shape[]) => {
    if (!list.length) return;
    const b = extent(list, 0);
    const zoom = Math.min((innerWidth - 80) / b.w, (innerHeight - 80) / b.h);
    animate(view, centred(b, Math.min(2, Math.max(0.1, zoom))));
  };
  // Zooming in until a rectangle fills the window goes inside it, zooming back out leaves.
  const zoomBy = (k: number, cx = innerWidth / 2, cy = innerHeight / 2) => {
    stop();
    const target =
      k > 1
        ? under(toWorld({ clientX: cx, clientY: cy }), 0).find(
            (s) => s.type === 'rect',
          )
        : undefined;
    const max = target ? Infinity : Math.max(8, view.zoom);
    const min = inside ? 0 : Math.min(0.1, view.zoom);
    const next = zoomAt(
      view,
      Math.min(max, Math.max(min, view.zoom * k)),
      cx,
      cy,
    );
    if (target && covers(target, next)) return enter(target, next);
    if (inside && k < 1) {
      const outer = outside(inside, next);
      if (!covers(inside, outer)) return go(ids.slice(0, -1), outer);
    }
    setView(next);
  };
  const resetZoom = () => {
    stop();
    setView(zoomAt(view, 1, innerWidth / 2, innerHeight / 2));
  };
  const toolCursor = tool === 'select' ? 'default' : 'crosshair';
  const setCursor = (c: string) => (canvas.current!.style.cursor = c);
  const handleAt = (s: Shape, p: Point) =>
    handles(s).find(
      (f) =>
        Math.hypot(s.x + f.x * s.w - p.x, s.y + f.y * s.h - p.y) <
        8 / view.zoom,
    );

  const toWorld = (e: { clientX: number; clientY: number }) => ({
    x: (e.clientX - view.x) / view.zoom,
    y: (e.clientY - view.y) / view.zoom,
  });
  // The smallest shape under the pointer wins so boxes inside boxes stay reachable.
  const under = (p: Point, tolerance: number) => {
    const area = (s: Shape) => (s.type === 'arrow' ? 0 : Math.abs(s.w * s.h));
    return shapes
      .filter((s) => hit(s, p, tolerance, shapes))
      .sort((a, b) => area(a) - area(b));
  };
  const shapeAt = (p: Point) => under(p, 6 / view.zoom)[0];
  // An arrow end binds to the shape under it, unless the other end has it, and to the rectangle side it's dropped on.
  const bind = (
    end: 'from' | 'to',
    p: Point,
    alt: boolean,
    other?: string,
  ): Partial<Shape> => {
    const t = alt
      ? undefined
      : under(p, 6 / view.zoom).find((s) => s.type !== 'arrow');
    const id = t?.id === other ? undefined : t?.id;
    const side =
      id && t?.type === 'rect' ? sideAt(t, p, 16 / view.zoom) : undefined;
    return end === 'from'
      ? { from: id, fromSide: side }
      : { to: id, toSide: side };
  };

  useEffect(
    () => localStorage.setItem(STORAGE_KEY, JSON.stringify(root)),
    [root],
  );
  useEffect(() => localStorage.setItem(PATH_KEY, JSON.stringify(path)), [path]);
  useEffect(() => localStorage.setItem(VIEW_KEY, JSON.stringify(view)), [view]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const c = canvas.current!;
    c.width = c.clientWidth * devicePixelRatio;
    c.height = c.clientHeight * devicePixelRatio;
    const css = getComputedStyle(document.documentElement);
    const color = (name: string) => css.getPropertyValue(name).trim();
    const d = drag.current;
    const colors = {
      ink: color('--ink'),
      accent: color('--accent'),
      surface: color('--surface'),
    };
    draw(
      c.getContext('2d')!,
      shapes,
      view,
      colors,
      selection,
      editing?.id,
      d?.kind === 'area' ? d.area : undefined,
      d && 'handle' in d && selected?.type === 'arrow'
        ? shapes.find(
            (s) => s.id === (d.handle.x ? selected.to : selected.from),
          )
        : undefined,
      d?.kind === 'move' ? d.guides : undefined,
    );
  });

  useEffect(() => {
    addEventListener('resize', redraw);
    document.fonts.ready.then(redraw);
    return () => removeEventListener('resize', redraw);
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement) return;
      const key = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (key === 'y' || (key === 'z' && e.shiftKey)) redo();
        else if (key === 'z') undo();
        else if (key === 'd') duplicate();
        else if (key === 's') save();
        else if (key === 'o') open();
        else if (key === 'c') {
          if (selection.length) clipboard.current = selection;
        } else if (key === 'v') paste();
        else if (key === '0') resetZoom();
        else if (key === '=' || key === '+') zoomBy(1.2);
        else if (key === '-') zoomBy(1 / 1.2);
        else return;
        return e.preventDefault();
      }
      if (key === ' ') {
        space.current = true;
        setCursor('grab');
      }
      if (key === 'escape') {
        if (!overlay) {
          setTool('select');
          setSelectedIds([]);
        }
        setOverlay(undefined);
      }
      if (key === '?') setOverlay({ kind: 'help' });
      if (e.shiftKey && (e.code === 'Digit1' || e.code === 'Digit2'))
        return fit(e.code === 'Digit1' ? shapes : selection);
      if (key === 'delete' || key === 'backspace') remove();
      const nudge = NUDGE[key];
      if (nudge && selection.length) {
        e.preventDefault();
        const k = e.shiftKey ? 10 : 1;
        const run = nudged.current;
        const sel = selectedIds.join();
        commit(
          shapes,
          shapes.map((s) =>
            selection.includes(s)
              ? shift(s, nudge[0] * k, nudge[1] * k, selectedIds)
              : s,
          ),
          run?.ids === sel && (e.repeat || Date.now() - run.at < 500),
        );
        nudged.current = { ids: sel, at: Date.now() };
      }
      const shortcut = TOOLS.find(
        (t, i) => t.key === key || `${i + 1}` === key,
      );
      if (shortcut) setTool(shortcut.tool);
    };
    const up = (e: KeyboardEvent) => {
      // A run of nudges stays one undo step until the arrows rest for 500ms.
      if (NUDGE[e.key.toLowerCase()] && nudged.current)
        nudged.current.at = Date.now();
      if (e.key !== ' ') return;
      space.current = false;
      setCursor(toolCursor);
    };
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    return () => {
      removeEventListener('keydown', down);
      removeEventListener('keyup', up);
    };
  });

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    stop();
    const p = toWorld(e);
    const last = { x: e.clientX, y: e.clientY };
    const base = { before: shapes, last, down: last };
    drag.current = null;
    if (e.button === 1 || space.current) {
      drag.current = { ...base, kind: 'pan', moves: [] };
      setCursor('grabbing');
    } else if (tool !== 'select') {
      const s: Shape = {
        id: crypto.randomUUID(),
        type: tool,
        ...p,
        w: 0,
        h: 0,
        dotted,
        text: '',
        color,
        ...(tool === 'arrow' && { elbow, ...bind('from', p, e.altKey) }),
      };
      setShapes([...shapes, s]);
      setSelectedIds([s.id]);
      drag.current = {
        ...base,
        kind: 'draw',
        id: s.id,
        handle: { x: 1, y: 1 },
      };
    } else if (!e.shiftKey && selected && handleAt(selected, p)) {
      const handle = handleAt(selected, p)!;
      drag.current = { ...base, kind: 'resize', id: selected.id, handle };
    } else {
      const s = shapeAt(p);
      let ids = e.shiftKey ? selectedIds : [];
      if (s)
        ids = !selectedIds.includes(s.id)
          ? [...ids, s.id]
          : e.shiftKey
            ? ids.filter((id) => id !== s.id)
            : selectedIds;
      setSelectedIds(ids);
      // Pressing a selected shape moves the whole selection, empty canvas starts a selection box.
      if (!s)
        drag.current = { ...base, kind: 'area', area: { ...p, w: 0, h: 0 } };
      else if (ids.includes(s.id))
        drag.current = { ...base, kind: 'move', ids, guides: [] };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    pointer.current = { clientX: e.clientX, clientY: e.clientY };
    const d = drag.current;
    if (!d) {
      const p = toWorld(e);
      const handle = selected && handleAt(selected, p);
      return setCursor(
        space.current
          ? 'grab'
          : tool !== 'select'
            ? 'crosshair'
            : handle
              ? selected?.type === 'arrow'
                ? 'crosshair'
                : handle.x === handle.y
                  ? 'nwse-resize'
                  : 'nesw-resize'
              : shapeAt(p)
                ? 'move'
                : 'default',
      );
    }
    const dx = e.clientX - d.last.x;
    const dy = e.clientY - d.last.y;
    d.last = { x: e.clientX, y: e.clientY };
    if (d.kind === 'pan') {
      d.moves.push({ ...d.last, t: performance.now() });
      return setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    }
    const p = toWorld(e);
    if (d.kind === 'area') {
      d.area = { ...d.area, w: p.x - d.area.x, h: p.y - d.area.y };
      return redraw();
    }
    if (d.kind === 'move') {
      const box = extent(
        d.before.filter((s) => d.ids.includes(s.id)),
        0,
      );
      const others = d.before.filter(
        (s) => s.type !== 'arrow' && !d.ids.includes(s.id),
      );
      const off = {
        x: (e.clientX - d.down.x) / view.zoom,
        y: (e.clientY - d.down.y) / view.zoom,
      };
      const n = e.altKey
        ? { x: 0, y: 0, guides: [] }
        : snap(
            { ...box, x: box.x + off.x, y: box.y + off.y },
            others,
            6 / view.zoom,
          );
      d.guides = n.guides;
      return setShapes(
        d.before.map((s) =>
          d.ids.includes(s.id) ? shift(s, off.x + n.x, off.y + n.y, d.ids) : s,
        ),
      );
    }
    const f = d.handle;
    setShapes((all) =>
      all.map((s) => {
        if (s.id !== d.id) return s;
        return {
          ...s,
          x: f.x ? s.x : p.x,
          y: f.y ? s.y : p.y,
          w: f.x ? p.x - s.x : s.x + s.w - p.x,
          h: f.y ? p.y - s.y : s.y + s.h - p.y,
          ...(s.type === 'arrow' &&
            bind(f.x ? 'to' : 'from', p, e.altKey, f.x ? s.from : s.to)),
        };
      }),
    );
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'pan') {
      setCursor(space.current ? 'grab' : toolCursor);
      // Keeps the pan's last ~80ms of speed (px/ms) and lets it decay.
      const recent = d.moves.filter((m) => performance.now() - m.t < 80);
      const a = recent[0];
      const b = recent[recent.length - 1];
      if (!a || b.t === a.t) return;
      const vx = (b.x - a.x) / (b.t - a.t);
      const vy = (b.y - a.y) / (b.t - a.t);
      return loop((ms) => {
        const left = Math.exp(-ms / 300);
        const glided = 300 * (1 - left);
        setView({ ...view, x: view.x + vx * glided, y: view.y + vy * glided });
        return Math.hypot(vx, vy) * left > 0.01;
      });
    }
    if (d.kind === 'area') {
      const a = bounds(d.area);
      const within = shapes.filter((s) => {
        const b = bounds(s);
        return (
          b.x >= a.x &&
          b.y >= a.y &&
          b.x + b.w <= a.x + a.w &&
          b.y + b.h <= a.y + a.h
        );
      });
      return setSelectedIds([
        ...new Set([...selectedIds, ...within.map((s) => s.id)]),
      ]);
    }
    if (d.kind === 'draw') {
      setTool('select');
      const drawn = shapes.find((s) => s.id === d.id);
      const moved = Math.hypot(d.last.x - d.down.x, d.last.y - d.down.y);
      if (!drawn || moved < 4 * view.zoom) return setShapes(d.before);
    }
    commit(d.before, shapes);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const p = toWorld(e);
    let s = shapeAt(p);
    if (s?.type === 'arrow') return;
    if (!s) {
      s = {
        id: crypto.randomUUID(),
        type: 'text',
        x: p.x,
        y: p.y - LINE / 2,
        w: 0,
        h: LINE,
        dotted: false,
        text: '',
        color,
      };
      setShapes([...shapes, s]);
    }
    setSelectedIds([s.id]);
    setEditing({ id: s.id, before: shapes });
  };

  const onWheel = (e: React.WheelEvent) => {
    stop();
    if (e.ctrlKey || e.metaKey)
      flushSync(() => zoomBy(Math.exp(-e.deltaY / 300), e.clientX, e.clientY));
    else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const s = shapeAt(toWorld(e));
    if (!s || !selectedIds.includes(s.id)) setSelectedIds(s ? [s.id] : []);
    setOverlay({ x: e.clientX, y: e.clientY, kind: s ? 'shape' : 'canvas' });
  };

  const menus = {
    shape: [
      ...(selected?.type === 'rect'
        ? [
            {
              label: 'Enter',
              run: () => {
                const to = centred(selected, fill(selected, Math.max));
                animate(view, to, () => enter(selected, to));
              },
            },
          ]
        : []),
      { label: 'Duplicate', keys: 'Ctrl+D', run: duplicate },
      { label: 'Bring to front', run: () => reorder(true) },
      { label: 'Send to back', run: () => reorder(false) },
      { label: 'Delete', keys: 'Del', run: remove, separator: true },
    ],
    canvas: [
      {
        label: 'Undo',
        keys: 'Ctrl+Z',
        run: undo,
        disabled: !past.current.length,
      },
      {
        label: 'Redo',
        keys: 'Ctrl+Shift+Z',
        run: redo,
        disabled: !future.current.length,
      },
      { label: 'Reset zoom', keys: 'Ctrl+0', run: resetZoom },
      { label: 'Zoom to fit', keys: 'Shift+1', run: () => fit(shapes) },
    ],
    main: [
      { label: 'Open', keys: 'Ctrl+O', run: open },
      { label: 'Save', keys: 'Ctrl+S', run: save },
      { label: 'Export as PNG', run: () => exportPng(shapes) },
      {
        label: theme === 'dark' ? 'Light mode' : 'Dark mode',
        run: toggleTheme,
      },
      {
        label: 'Keyboard shortcuts',
        keys: '?',
        run: () => setOverlay({ kind: 'help' }),
      },
      { label: 'Clear canvas', run: clear, separator: true },
    ],
  };

  return (
    <div onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <canvas
        ref={canvas}
        className="h-screen w-screen bg-[radial-gradient(circle,var(--dot)_1px,transparent_1px)]"
        style={{
          cursor: toolCursor,
          backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
        onPointerDown={onPointerDown}
        onContextMenu={onContextMenu}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
      />

      {!shapes.length && (
        <div className="pointer-events-none fixed inset-0 grid place-items-center text-muted opacity-70">
          R rectangle · A arrow · double-click for text
        </div>
      )}

      <Toolbar tool={tool} onTool={setTool} />

      <StylePanel
        dotted={dotted}
        elbow={elbow}
        color={color}
        selected={selection[0]}
        onStroke={setStroke}
        onElbow={(e) => {
          setElbow(e);
          restyle({ elbow: e }, 'arrow');
        }}
        onColor={(c) => {
          setColor(c);
          restyle({ color: c });
        }}
      />

      <div className={`${PANEL} top-3 left-3`}>
        <button
          className={PANEL_BUTTON}
          title="Menu"
          aria-label="Menu"
          onClick={() => setOverlay({ x: 12, y: 58, kind: 'main' })}
        >
          <Icon d="M3 5h14M3 10h14M3 15h14" />
        </button>
      </div>

      {inside && <Breadcrumbs trail={trail} onLeave={leaveTo} />}

      <Controls
        zoom={view.zoom}
        canUndo={!!past.current.length}
        canRedo={!!future.current.length}
        onZoom={(k) => zoomBy(k)}
        onResetZoom={resetZoom}
        onUndo={undo}
        onRedo={redo}
      />

      {overlay?.kind === 'help' ? (
        <ShortcutsDialog onClose={() => setOverlay(undefined)} />
      ) : (
        overlay && (
          <Menu
            x={overlay.x}
            y={overlay.y}
            items={menus[overlay.kind]}
            onClose={() => setOverlay(undefined)}
          />
        )
      )}

      {edited && (
        <TextEditor
          shape={edited}
          view={view}
          onChange={(text) =>
            setShapes(
              shapes.map((s) =>
                s === edited
                  ? { ...s, text, ...(s.type === 'text' && textSize(text)) }
                  : s,
              ),
            )
          }
          onDone={() => {
            setEditing(undefined);
            commit(
              editing!.before,
              shapes.filter((s) => s.type !== 'text' || s.text.trim()),
            );
          }}
        />
      )}
    </div>
  );
}
