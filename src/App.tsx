import { Fragment, useEffect, useReducer, useRef, useState } from 'react';
import {
  bounds,
  connect,
  draw,
  exportPng,
  extent,
  FONT,
  frame,
  handles,
  hit,
  LINE,
  textSize,
  type Box,
  type Point,
  type Shape,
  type View,
} from './shapes';
import { flushSync } from 'react-dom';
import { BUTTON, Icon, ICON, Menu } from './Menu';

const STORAGE_KEY = 'infinidraw:shapes';
const VIEW_KEY = 'infinidraw:view';
const PATH_KEY = 'infinidraw:path';
const THEME_KEY = 'infinidraw:theme';
// Mid-tones that read on both the light and dark canvas; no colour means theme ink.
const COLORS = [
  { label: 'Ink' },
  { label: 'Red', color: '#e5484d' },
  { label: 'Orange', color: '#e8890c' },
  { label: 'Green', color: '#30a46c' },
  { label: 'Blue', color: '#3b82f6' },
  { label: 'Purple', color: '#9b6ef3' },
];
const NUDGE: Record<string, [number, number]> = {
  arrowleft: [-1, 0],
  arrowright: [1, 0],
  arrowup: [0, -1],
  arrowdown: [0, 1],
};
const SHORTCUTS = [
  ['V / R / A', 'Select, rectangle, arrow'],
  ['1 – 3', 'Toolbar buttons'],
  ['Space + drag', 'Pan'],
  ['Double-click', 'Add or edit text'],
  ['Shift+click', 'Add to selection'],
  ['Drag on canvas', 'Select area'],
  ['Ctrl+C / Ctrl+V', 'Copy / paste'],
  ['Ctrl+D', 'Duplicate'],
  ['Delete', 'Delete'],
  ['Arrows', 'Nudge 1px, 10px with Shift'],
  ['Ctrl+Z', 'Undo'],
  ['Ctrl+Shift+Z', 'Redo'],
  ['Ctrl+= / Ctrl+-', 'Zoom in / out'],
  ['Ctrl+0', 'Reset zoom'],
  ['Zoom into a rectangle', 'Go inside it'],
  ['Escape', 'Deselect'],
  ['?', 'Keyboard shortcuts'],
];

const TOOLS = [
  {
    tool: 'select',
    key: 'v',
    label: 'Select',
    icon: 'M5 3l10 6-4.5 1.5L9 15z',
  },
  { tool: 'rect', key: 'r', label: 'Rectangle', icon: 'M3 5h14v10H3z' },
  { tool: 'arrow', key: 'a', label: 'Arrow', icon: 'M4 16L16 4M8 4h8v8' },
] as const;
type Tool = (typeof TOOLS)[number]['tool'];

const SURFACE = 'fixed rounded-lg border border-border bg-surface shadow-panel';
const PANEL = `${SURFACE} flex gap-1 p-1`;
const PANEL_BUTTON = `${BUTTON} relative min-w-8 p-1.5 enabled:active:bg-border aria-pressed:bg-accent-soft aria-pressed:text-accent after:absolute after:right-[3px] after:bottom-px after:text-[8px] after:text-muted after:content-[attr(data-key)]`;

type Drag = {
  before: Shape[];
  last: Point;
  pan?: boolean;
  id?: string;
  handle?: Point;
  ids?: string[];
  area?: Box;
  down: Point;
};

const zoomAt = (v: View, zoom: number, cx: number, cy: number): View => ({
  zoom,
  x: cx - ((cx - v.x) * zoom) / v.zoom,
  y: cy - ((cy - v.y) * zoom) / v.zoom,
});
const centred = (s: Shape, zoom: number): View => {
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
const name = (s: Shape) => s.text.split('\n')[0] || 'Untitled';
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
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    kind: 'shape' | 'canvas' | 'main';
  }>();
  const [help, setHelp] = useState(false);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag>(null);
  const past = useRef<Shape[][]>([]);
  const future = useRef<Shape[][]>([]);
  const space = useRef(false);
  const clipboard = useRef<Shape[]>([]);
  const pointer = useRef<{ clientX: number; clientY: number }>(null);

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

  const commit = (before: Shape[], next: Shape[]) => {
    if (JSON.stringify(before) !== JSON.stringify(next)) {
      past.current.push(nest(root, ids, () => before));
      future.current = [];
    }
    setShapes(next);
    redraw();
  };
  const timeTravel = (from: Shape[][], to: Shape[][]) => {
    const target = from.pop();
    if (!target) return;
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
  const restyle = (style: Partial<Shape>) =>
    commit(
      shapes,
      shapes.map((s) => (selection.includes(s) ? { ...s, ...style } : s)),
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
  const leaveTo = (depth: number) =>
    go(
      ids.slice(0, depth),
      centred(trail[depth], fill(trail[depth], Math.min) / 2),
    );
  // Zooming in until a rectangle fills the window goes inside it, zooming back out leaves.
  const zoomBy = (k: number, cx = innerWidth / 2, cy = innerHeight / 2) => {
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
      const f = frame(inside);
      const zoom = next.zoom / f.k;
      const outer = { zoom, x: next.x - f.x * zoom, y: next.y - f.y * zoom };
      if (!covers(inside, outer)) return go(ids.slice(0, -1), outer);
    }
    setView(next);
  };
  const resetZoom = () =>
    setView(zoomAt(view, 1, innerWidth / 2, innerHeight / 2));
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
      .filter((s) => hit(s, p, tolerance))
      .sort((a, b) => area(a) - area(b));
  };
  const shapeAt = (p: Point) => under(p, 6 / view.zoom)[0];
  const targetAt = (p: Point) =>
    under(p, 6 / view.zoom).find((s) => s.type !== 'arrow')?.id;

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
      drag.current?.area,
      shapes.find(
        (s) =>
          drag.current?.handle &&
          selected?.type === 'arrow' &&
          s.id === (drag.current.handle.x ? selected.to : selected.from),
      ),
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
        if (!menu && !help) {
          setTool('select');
          setSelectedIds([]);
        }
        setMenu(undefined);
        setHelp(false);
      }
      if (key === '?') setHelp(true);
      if (key === 'delete' || key === 'backspace') remove();
      const nudge = NUDGE[key];
      if (nudge && selection.length) {
        e.preventDefault();
        const k = e.shiftKey ? 10 : 1;
        commit(
          shapes,
          shapes.map((s) =>
            selection.includes(s)
              ? shift(s, nudge[0] * k, nudge[1] * k, selectedIds)
              : s,
          ),
        );
      }
      const shortcut = TOOLS.find(
        (t, i) => t.key === key || `${i + 1}` === key,
      );
      if (shortcut) setTool(shortcut.tool);
    };
    const up = (e: KeyboardEvent) => {
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
    const p = toWorld(e);
    const last = { x: e.clientX, y: e.clientY };
    const d: Drag = { before: shapes, last, down: last };
    if (e.button === 1 || space.current) {
      d.pan = true;
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
        from: tool === 'arrow' ? targetAt(p) : undefined,
      };
      setShapes([...shapes, s]);
      setSelectedIds([s.id]);
      d.id = s.id;
      d.handle = { x: 1, y: 1 };
    } else if (!e.shiftKey && selected && handleAt(selected, p)) {
      d.handle = handleAt(selected, p);
      d.id = selected.id;
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
      if (!s) d.area = { ...p, w: 0, h: 0 };
      else if (ids.includes(s.id)) d.ids = ids;
    }
    drag.current = d;
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
    if (d.pan) return setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    const p = toWorld(e);
    if (d.area) {
      d.area = { ...d.area, w: p.x - d.area.x, h: p.y - d.area.y };
      return redraw();
    }
    const f = d.handle;
    setShapes((all) =>
      all.map((s) => {
        if (d.ids?.includes(s.id))
          return shift(s, dx / view.zoom, dy / view.zoom, d.ids);
        if (s.id !== d.id || !f) return s;
        return {
          ...s,
          x: f.x ? s.x : p.x,
          y: f.y ? s.y : p.y,
          w: f.x ? p.x - s.x : s.x + s.w - p.x,
          h: f.y ? p.y - s.y : s.y + s.h - p.y,
          // An end binds to the shape under it unless the other end already has it.
          ...(s.type === 'arrow' && {
            [f.x ? 'to' : 'from']: [targetAt(p)].find(
              (t) => t !== (f.x ? s.from : s.to),
            ),
          }),
        };
      }),
    );
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.pan) setCursor(space.current ? 'grab' : toolCursor);
    if (!d || d.pan) return;
    if (d.area) {
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
    if (tool !== 'select') {
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

  const onWheel = (e: React.WheelEvent) =>
    e.ctrlKey || e.metaKey
      ? flushSync(() => zoomBy(Math.exp(-e.deltaY / 300), e.clientX, e.clientY))
      : setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const s = shapeAt(toWorld(e));
    if (!s || !selectedIds.includes(s.id)) setSelectedIds(s ? [s.id] : []);
    setMenu({ x: e.clientX, y: e.clientY, kind: s ? 'shape' : 'canvas' });
  };

  const menus = {
    shape: [
      ...(selected?.type === 'rect'
        ? [
            {
              label: 'Enter',
              run: () =>
                enter(selected, centred(selected, fill(selected, Math.max))),
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
    ],
    main: [
      { label: 'Export as PNG', run: () => exportPng(shapes) },
      {
        label: theme === 'dark' ? 'Light mode' : 'Dark mode',
        run: toggleTheme,
      },
      { label: 'Keyboard shortcuts', keys: '?', run: () => setHelp(true) },
      { label: 'Clear canvas', run: clear, separator: true },
    ],
  };

  const editorBox = edited && bounds(edited);

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

      <div className={`${PANEL} top-3 left-1/2 -translate-x-1/2`}>
        {TOOLS.map((t, i) => (
          <button
            key={t.tool}
            className={PANEL_BUTTON}
            data-key={i + 1}
            title={`${t.label} (${t.key.toUpperCase()} or ${i + 1})`}
            aria-label={t.label}
            aria-pressed={tool === t.tool}
            onClick={() => setTool(t.tool)}
          >
            <svg viewBox="0 0 20 20" className={ICON}>
              <path d={t.icon} />
            </svg>
          </button>
        ))}
      </div>

      <div className={`${PANEL} top-1/2 right-3 -translate-y-1/2 flex-col`}>
        {[false, true].map((d) => (
          <button
            key={String(d)}
            className={PANEL_BUTTON}
            title={d ? 'Dotted' : 'Solid'}
            aria-label={d ? 'Dotted' : 'Solid'}
            aria-pressed={(selection[0] ?? { dotted }).dotted === d}
            onClick={() => setStroke(d)}
          >
            <svg viewBox="0 0 20 20" className={ICON}>
              <path
                d="M2 10h16"
                strokeWidth={d ? 2.5 : undefined}
                strokeDasharray={d ? '0 4' : undefined}
              />
            </svg>
          </button>
        ))}
        <hr className="mx-1 my-0.5 border-border" />
        {COLORS.map((c) => (
          <button
            key={c.label}
            className={`${PANEL_BUTTON} before:m-auto before:block before:size-3.5 before:rounded-full before:bg-current`}
            style={{ color: c.color ?? 'var(--ink)' }}
            title={c.label}
            aria-label={c.label}
            aria-pressed={(selection[0] ?? { color }).color === c.color}
            onClick={() => {
              setColor(c.color);
              restyle({ color: c.color });
            }}
          />
        ))}
      </div>

      <div className={`${PANEL} top-3 left-3`}>
        <button
          className={PANEL_BUTTON}
          title="Menu"
          aria-label="Menu"
          onClick={() => setMenu({ x: 12, y: 58, kind: 'main' })}
        >
          <Icon d="M3 5h14M3 10h14M3 15h14" />
        </button>
      </div>

      {inside && (
        <nav
          className={`${PANEL} top-3 left-[62px] items-center text-muted`}
          aria-label="Breadcrumb"
        >
          {trail.map((s, i) => (
            <Fragment key={s.id}>
              <button
                className={`${PANEL_BUTTON} max-w-[20ch] truncate`}
                onClick={() => leaveTo(i)}
              >
                {i ? name(trail[i - 1]) : 'Home'}
              </button>
              /
            </Fragment>
          ))}
          <span
            className="box-content max-w-[20ch] truncate px-1.5 text-ink"
            aria-current="page"
          >
            {name(inside)}
          </span>
        </nav>
      )}

      <div className={`${PANEL} bottom-3 left-3`}>
        <button
          className={PANEL_BUTTON}
          title="Zoom out (Ctrl+-)"
          aria-label="Zoom out"
          onClick={() => zoomBy(1 / 1.2)}
        >
          <Icon d="M4 10h12" />
        </button>
        <button
          className={`${PANEL_BUTTON} min-w-13`}
          title="Reset zoom (Ctrl+0)"
          aria-label="Reset zoom"
          onClick={resetZoom}
        >
          {Math.round(view.zoom * 100)}%
        </button>
        <button
          className={PANEL_BUTTON}
          title="Zoom in (Ctrl+=)"
          aria-label="Zoom in"
          onClick={() => zoomBy(1.2)}
        >
          <Icon d="M4 10h12M10 4v12" />
        </button>
        <hr className="mx-0.5 my-1 h-auto border-t-0 border-l border-border" />
        <button
          className={PANEL_BUTTON}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
          disabled={!past.current.length}
          onClick={undo}
        >
          <Icon d="M7 4L3 8l4 4M3 8h8a5 5 0 010 9H8" />
        </button>
        <button
          className={PANEL_BUTTON}
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
          disabled={!future.current.length}
          onClick={redo}
        >
          <Icon d="M13 4l4 4-4 4M17 8H9a5 5 0 000 9h3" />
        </button>
      </div>

      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          items={menus[menu.kind]}
          onClose={() => setMenu(undefined)}
        />
      )}

      {help && (
        <>
          <div
            className="fixed inset-0 animate-[appear_160ms_ease] bg-shade"
            onPointerDown={() => setHelp(false)}
          />
          <dl
            role="dialog"
            aria-label="Keyboard shortcuts"
            className={`${SURFACE} top-1/2 left-1/2 -translate-1/2 animate-appear px-4 py-2`}
          >
            {SHORTCUTS.map(([keys, what]) => (
              <div
                key={keys}
                className="flex h-8 items-center justify-between gap-8"
              >
                <dt>{what}</dt>
                <dd className="rounded-sm bg-hover px-1.5 py-0.5 text-muted">
                  {keys}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {edited && editorBox && (
        <div
          className={`fixed box-content flex items-center ${edited.type === 'rect' ? 'justify-center text-center' : ''}`}
          style={{
            left: editorBox.x * view.zoom + view.x,
            top: editorBox.y * view.zoom + view.y,
            width: editorBox.w * view.zoom,
            height: editorBox.h * view.zoom,
            fontSize: FONT * view.zoom,
            ...(edited.children?.length && {
              alignItems: 'flex-start',
              paddingTop: 4 * view.zoom,
            }),
          }}
        >
          <textarea
            autoFocus
            className="field-sizing-content min-w-[1ch] resize-none overflow-hidden leading-tight whitespace-pre outline-none [text-align:inherit]"
            style={{ color: edited.color }}
            value={edited.text}
            onChange={(e) =>
              setShapes(
                shapes.map((s) =>
                  s === edited
                    ? {
                        ...s,
                        text: e.target.value,
                        ...(s.type === 'text' && textSize(e.target.value)),
                      }
                    : s,
                ),
              )
            }
            onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
            onBlur={() => {
              setEditing(undefined);
              commit(
                editing!.before,
                shapes.filter((s) => s.type !== 'text' || s.text.trim()),
              );
            }}
          />
        </div>
      )}
    </div>
  );
}
