import { useEffect, useReducer, useRef, useState } from 'react';
import {
  bounds,
  draw,
  exportPng,
  FONT,
  handles,
  hit,
  LINE,
  textSize,
  type Point,
  type Shape,
  type View,
} from './shapes';
import { Icon, Menu } from './Menu';

const STORAGE_KEY = 'infinidraw:shapes';
const VIEW_KEY = 'infinidraw:view';
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
  ['1 – 5', 'Toolbar buttons'],
  ['Space + drag', 'Pan'],
  ['Double-click', 'Add or edit text'],
  ['Ctrl+D', 'Duplicate'],
  ['Delete', 'Delete'],
  ['Arrows', 'Nudge 1px, 10px with Shift'],
  ['Ctrl+Z', 'Undo'],
  ['Ctrl+Shift+Z', 'Redo'],
  ['Ctrl+= / Ctrl+-', 'Zoom in / out'],
  ['Ctrl+0', 'Reset zoom'],
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

type Drag = {
  before: Shape[];
  last: Point;
  pan?: boolean;
  id?: string;
  handle?: Point;
};

export function App() {
  const [shapes, setShapes] = useState<Shape[]>(() =>
    JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'),
  );
  const [tool, setTool] = useState<Tool>('select');
  const [dotted, setDotted] = useState(false);
  const [color, setColor] = useState<string>();
  const [theme, setTheme] = useState(
    () =>
      localStorage.getItem(THEME_KEY) ??
      (matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  );
  const [selectedId, setSelectedId] = useState<string>();
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

  const selected = shapes.find((s) => s.id === selectedId);
  const edited = shapes.find((s) => s.id === editing?.id);

  const commit = (before: Shape[], next: Shape[]) => {
    if (JSON.stringify(before) !== JSON.stringify(next)) {
      past.current.push(before);
      future.current = [];
    }
    setShapes(next);
    redraw();
  };
  const timeTravel = (from: Shape[][], to: Shape[][]) => {
    const target = from.pop();
    if (!target) return;
    to.push(shapes);
    setShapes(target);
  };
  const undo = () => timeTravel(past.current, future.current);
  const redo = () => timeTravel(future.current, past.current);
  const remove = () =>
    commit(
      shapes,
      shapes.filter((s) => s.id !== selectedId),
    );
  const duplicate = () => {
    if (!selected) return;
    const copy = {
      ...selected,
      id: crypto.randomUUID(),
      x: selected.x + 16,
      y: selected.y + 16,
    };
    commit(shapes, [...shapes, copy]);
    setSelectedId(copy.id);
  };
  const reorder = (front: boolean) => {
    if (!selected) return;
    const rest = shapes.filter((s) => s !== selected);
    commit(shapes, front ? [...rest, selected] : [selected, ...rest]);
  };
  const restyle = (style: Partial<Shape>) =>
    commit(
      shapes,
      shapes.map((s) => (s === selected ? { ...s, ...style } : s)),
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
    setSelectedId(undefined);
  };
  const zoomTo = (
    f: (zoom: number) => number,
    cx = innerWidth / 2,
    cy = innerHeight / 2,
  ) =>
    setView((v) => {
      const zoom = Math.min(8, Math.max(0.1, f(v.zoom)));
      const k = zoom / v.zoom;
      return { zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  const resetZoom = () => zoomTo(() => 1);
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
  const shapeAt = (p: Point) => {
    const area = (s: Shape) => (s.type === 'arrow' ? 0 : Math.abs(s.w * s.h));
    return shapes
      .filter((s) => hit(s, p, 6 / view.zoom))
      .sort((a, b) => area(a) - area(b))[0];
  };

  useEffect(
    () => localStorage.setItem(STORAGE_KEY, JSON.stringify(shapes)),
    [shapes],
  );
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
    draw(c.getContext('2d')!, shapes, view, colors, selected, editing?.id);
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
        else if (key === '0') resetZoom();
        else if (key === '=' || key === '+') zoomTo((z) => z * 1.2);
        else if (key === '-') zoomTo((z) => z / 1.2);
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
          setSelectedId(undefined);
        }
        setMenu(undefined);
        setHelp(false);
      }
      if (key === '?') setHelp(true);
      if (key === 'delete' || key === 'backspace') remove();
      const nudge = NUDGE[key];
      if (nudge && selected) {
        e.preventDefault();
        const k = e.shiftKey ? 10 : 1;
        commit(
          shapes,
          shapes.map((s) =>
            s === selected
              ? { ...s, x: s.x + nudge[0] * k, y: s.y + nudge[1] * k }
              : s,
          ),
        );
      }
      const shortcut = TOOLS.find(
        (t, i) => t.key === key || `${i + 1}` === key,
      );
      if (shortcut) setTool(shortcut.tool);
      if (key === '4' || key === '5') setStroke(key === '5');
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
    const d: Drag = { before: shapes, last: { x: e.clientX, y: e.clientY } };
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
      };
      setShapes([...shapes, s]);
      setSelectedId(s.id);
      d.id = s.id;
      d.handle = { x: 1, y: 1 };
    } else {
      d.handle = selected && handleAt(selected, p);
      d.id = (d.handle ? selected : shapeAt(p))?.id;
      setSelectedId(d.id);
    }
    drag.current = d;
  };

  const onPointerMove = (e: React.PointerEvent) => {
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
    const f = d.handle;
    setShapes((all) =>
      all.map((s) => {
        if (s.id !== d.id) return s;
        if (!f)
          return { ...s, x: s.x + dx / view.zoom, y: s.y + dy / view.zoom };
        return {
          ...s,
          x: f.x ? s.x : p.x,
          y: f.y ? s.y : p.y,
          w: f.x ? p.x - s.x : s.x + s.w - p.x,
          h: f.y ? p.y - s.y : s.y + s.h - p.y,
        };
      }),
    );
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.pan) setCursor(space.current ? 'grab' : toolCursor);
    if (!d || d.pan) return;
    if (tool !== 'select') {
      setTool('select');
      const drawn = shapes.find((s) => s.id === d.id);
      if (!drawn || Math.hypot(drawn.w, drawn.h) < 4)
        return setShapes(d.before);
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
    setSelectedId(s.id);
    setEditing({ id: s.id, before: shapes });
  };

  const onWheel = (e: React.WheelEvent) =>
    e.ctrlKey || e.metaKey
      ? zoomTo((z) => z * Math.exp(-e.deltaY / 300), e.clientX, e.clientY)
      : setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const s = shapeAt(toWorld(e));
    setSelectedId(s?.id);
    setMenu({ x: e.clientX, y: e.clientY, kind: s ? 'shape' : 'canvas' });
  };

  const menus = {
    shape: [
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
        <div className="hint">
          R rectangle · A arrow · double-click for text
        </div>
      )}

      <div className="panel toolbar">
        {TOOLS.map((t, i) => (
          <button
            key={t.tool}
            data-key={i + 1}
            title={`${t.label} (${t.key.toUpperCase()} or ${i + 1})`}
            aria-label={t.label}
            aria-pressed={tool === t.tool}
            onClick={() => setTool(t.tool)}
          >
            <svg viewBox="0 0 20 20">
              <path d={t.icon} />
            </svg>
          </button>
        ))}
      </div>

      <div className="panel sidebar">
        {[false, true].map((d) => (
          <button
            key={String(d)}
            data-key={d ? 5 : 4}
            title={d ? 'Dotted (5)' : 'Solid (4)'}
            aria-label={d ? 'Dotted' : 'Solid'}
            aria-pressed={(selected ?? { dotted }).dotted === d}
            onClick={() => setStroke(d)}
          >
            <svg viewBox="0 0 20 20">
              <path
                d="M2 10h16"
                strokeWidth={d ? 2.5 : undefined}
                strokeDasharray={d ? '0 4' : undefined}
              />
            </svg>
          </button>
        ))}
        <hr />
        {COLORS.map((c) => (
          <button
            key={c.label}
            className="swatch"
            style={{ color: c.color ?? 'var(--ink)' }}
            title={c.label}
            aria-label={c.label}
            aria-pressed={(selected ?? { color }).color === c.color}
            onClick={() => {
              setColor(c.color);
              restyle({ color: c.color });
            }}
          />
        ))}
      </div>

      <div className="panel main-menu">
        <button
          title="Menu"
          aria-label="Menu"
          onClick={() => setMenu({ x: 12, y: 58, kind: 'main' })}
        >
          <Icon d="M3 5h14M3 10h14M3 15h14" />
        </button>
      </div>

      <div className="panel controls">
        <button
          title="Zoom out (Ctrl+-)"
          aria-label="Zoom out"
          onClick={() => zoomTo((z) => z / 1.2)}
        >
          <Icon d="M4 10h12" />
        </button>
        <button
          className="zoom"
          title="Reset zoom (Ctrl+0)"
          aria-label="Reset zoom"
          onClick={resetZoom}
        >
          {Math.round(view.zoom * 100)}%
        </button>
        <button
          title="Zoom in (Ctrl+=)"
          aria-label="Zoom in"
          onClick={() => zoomTo((z) => z * 1.2)}
        >
          <Icon d="M4 10h12M10 4v12" />
        </button>
        <hr />
        <button
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
          disabled={!past.current.length}
          onClick={undo}
        >
          <Icon d="M7 4L3 8l4 4M3 8h8a5 5 0 010 9H8" />
        </button>
        <button
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
          <div className="backdrop dim" onPointerDown={() => setHelp(false)} />
          <dl role="dialog" aria-label="Keyboard shortcuts" className="dialog">
            {SHORTCUTS.map(([keys, what]) => (
              <div key={keys}>
                <dt>{what}</dt>
                <dd>{keys}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {edited && editorBox && (
        <div
          className={`editor ${edited.type}`}
          style={{
            left: editorBox.x * view.zoom + view.x,
            top: editorBox.y * view.zoom + view.y,
            width: editorBox.w * view.zoom,
            height: editorBox.h * view.zoom,
            fontSize: FONT * view.zoom,
          }}
        >
          <textarea
            autoFocus
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
