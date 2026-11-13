// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { route } from './shapes';

// jsdom has no canvas or font loading, so drawing is a no-op here.
HTMLCanvasElement.prototype.getContext = (() =>
  new Proxy(
    { canvas: {} },
    { get: (t, k) => Reflect.get(t, k) ?? (() => {}) },
  )) as never;
Object.defineProperty(document, 'fonts', {
  value: { ready: Promise.resolve() },
});

const canvas = () => document.querySelector('canvas')!;
const saved = () => JSON.parse(localStorage.getItem('infinidraw:shapes')!);
const at = (x: number, y: number) => ({ clientX: x, clientY: y });
const drag = (from: [number, number], to: [number, number]) => {
  fireEvent.pointerDown(canvas(), at(...from));
  fireEvent.pointerMove(canvas(), at(...to));
  fireEvent.pointerUp(canvas(), at(...to));
};
const drawRectangle = () => {
  fireEvent.click(screen.getByLabelText('Rectangle'));
  drag([100, 100], [300, 200]);
};

beforeEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.useFakeTimers({
    toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
  });
  localStorage.clear();
  render(<App />);
});

it('draws a rectangle by dragging with the rectangle tool', () => {
  drawRectangle();
  expect(saved()).toMatchObject([
    { type: 'rect', x: 100, y: 100, w: 200, h: 100, dotted: false },
  ]);
});

it('draws a dotted arrow once dotted is chosen', () => {
  fireEvent.click(screen.getByLabelText('Dotted'));
  fireEvent.keyDown(window, { key: 'a' });
  drag([50, 50], [150, 20]);
  expect(saved()).toMatchObject([
    { type: 'arrow', x: 50, y: 50, w: 100, h: -30, dotted: true },
  ]);
});

it('ignores a click that never becomes a drag', () => {
  fireEvent.click(screen.getByLabelText('Rectangle'));
  drag([100, 100], [101, 101]);
  expect(saved()).toEqual([]);
});

it('switches the selected shape between solid and dotted', () => {
  drawRectangle();
  fireEvent.click(screen.getByLabelText('Dotted'));
  expect(saved()[0].dotted).toBe(true);
  fireEvent.click(screen.getByLabelText('Solid'));
  expect(saved()[0].dotted).toBe(false);
});

it('picks toolbar buttons with the number keys, but not the stroke style', () => {
  fireEvent.keyDown(window, { key: '5' });
  fireEvent.keyDown(window, { key: '3' });
  drag([50, 50], [150, 50]);
  fireEvent.keyDown(window, { key: '2' });
  drag([200, 200], [300, 300]);
  expect(saved()).toMatchObject([
    { type: 'arrow', dotted: false },
    { type: 'rect', dotted: false },
  ]);
});

it('colours the selected shape and the shapes drawn after it', () => {
  drawRectangle();
  fireEvent.click(screen.getByLabelText('Red'));
  fireEvent.keyDown(window, { key: 'a' });
  drag([400, 400], [500, 400]);
  expect(saved()[0].color).toBe(saved()[1].color);
  fireEvent.click(screen.getByLabelText('Ink'));
  expect(saved()[1].color).toBeUndefined();
  expect(saved()[0].color).toBeDefined();
});

it('switches to dark mode from the menu and remembers it after a restart', () => {
  fireEvent.click(screen.getByLabelText('Menu'));
  fireEvent.click(screen.getByText('Dark mode'));
  expect(document.documentElement.dataset.theme).toBe('dark');

  cleanup();
  render(<App />);
  fireEvent.click(screen.getByLabelText('Menu'));
  expect(screen.getByText('Light mode')).toBeTruthy();
});

it('moves a shape by dragging it', () => {
  drawRectangle();
  drag([200, 150], [250, 170]);
  expect(saved()).toMatchObject([{ x: 150, y: 120, w: 200, h: 100 }]);
});

it('resizes the selected rectangle from a corner handle', () => {
  drawRectangle();
  drag([300, 200], [400, 260]);
  expect(saved()).toMatchObject([{ x: 100, y: 100, w: 300, h: 160 }]);
});

it('snaps a moved shape into line with the middle of another, unless Alt is held', () => {
  drawRectangle();
  fireEvent.click(screen.getByLabelText('Rectangle'));
  drag([400, 300], [500, 400]);
  drag([450, 350], [203, 350]);
  expect(saved()[1]).toMatchObject({ x: 150, y: 300 });
  fireEvent.pointerDown(canvas(), at(200, 350));
  fireEvent.pointerMove(canvas(), { ...at(206, 350), altKey: true });
  fireEvent.pointerUp(canvas(), at(206, 350));
  expect(saved()[1]).toMatchObject({ x: 156, y: 300 });
});

it('locks a connected arrow end to the middle of the facing side', () => {
  drawRectangle();
  fireEvent.keyDown(window, { key: 'a' });
  drag([280, 120], [500, 230]);
  expect(saved()[1]).toMatchObject({ x: 304, y: 150, w: 196, h: 80 });
});

it('labels a rectangle on double click and keeps it after a restart', () => {
  drawRectangle();
  fireEvent.doubleClick(canvas(), at(200, 150));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'api' } });
  fireEvent.blur(screen.getByRole('textbox'));
  expect(saved()[0].text).toBe('api');

  cleanup();
  render(<App />);
  fireEvent.doubleClick(canvas(), at(200, 150));
  expect(screen.getByRole('textbox')).toHaveProperty('value', 'api');
});

it('adds free text on double clicking the empty canvas', () => {
  fireEvent.doubleClick(canvas(), at(400, 400));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hi' } });
  fireEvent.blur(screen.getByRole('textbox'));
  expect(saved()).toMatchObject([{ type: 'text', text: 'hi', x: 400 }]);
});

it('drops free text that was left empty', () => {
  fireEvent.doubleClick(canvas(), at(400, 400));
  fireEvent.blur(screen.getByRole('textbox'));
  expect(saved()).toEqual([]);
});

it('deletes the selected shape, then undoes and redoes it', () => {
  drawRectangle();
  fireEvent.keyDown(window, { key: 'Delete' });
  expect(saved()).toEqual([]);
  fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
  expect(saved()).toHaveLength(1);
  fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
  expect(saved()).toEqual([]);
});

it('keeps shapes under the pointer when zooming and panning', () => {
  fireEvent.wheel(canvas(), { ...at(100, 100), deltaY: -300, ctrlKey: true });
  fireEvent.wheel(canvas(), { deltaX: 40, deltaY: 40 });
  drawRectangle();
  drag([200, 150], [210, 150]);
  expect(saved()).toHaveLength(1);
  expect(saved()[0].w).toBeCloseTo(200 / Math.E);
});

const ctrl = (key: string, extra = {}) =>
  fireEvent.keyDown(window, { key, ctrlKey: true, ...extra });
const choose = (name: string) =>
  fireEvent.click(
    screen.getByRole('menuitem', { name: new RegExp(`^${name}`) }),
  );
const xs = () => saved().map((s: { x: number }) => s.x);
const zoom = () => screen.getByLabelText('Reset zoom').textContent;

it('duplicates the selected shape with Ctrl+D and selects the copy', () => {
  drawRectangle();
  ctrl('d');
  expect(saved()).toMatchObject([{ x: 100 }, { x: 116, y: 116, w: 200 }]);
  fireEvent.keyDown(window, { key: 'Delete' });
  expect(saved()).toHaveLength(1);
});

it('deletes a shape from its context menu', () => {
  drawRectangle();
  fireEvent.contextMenu(canvas(), at(200, 150));
  choose('Delete');
  expect(saved()).toEqual([]);
  expect(screen.queryByRole('menu')).toBeNull();
});

it('closes the context menu with Escape', () => {
  fireEvent.contextMenu(canvas(), at(200, 150));
  expect(screen.getByRole('menu')).toBeTruthy();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
});

it('brings a shape to the front and sends it to the back', () => {
  drawRectangle();
  fireEvent.click(screen.getByLabelText('Rectangle'));
  drag([400, 400], [500, 450]);
  fireEvent.contextMenu(canvas(), at(200, 150));
  choose('Bring to front');
  expect(xs()).toEqual([400, 100]);
  fireEvent.contextMenu(canvas(), at(200, 150));
  choose('Send to back');
  expect(xs()).toEqual([100, 400]);
});

it('clears the canvas and brings it back with undo', () => {
  drawRectangle();
  fireEvent.click(screen.getByLabelText('Menu'));
  choose('Clear canvas');
  expect(saved()).toEqual([]);
  ctrl('z');
  expect(saved()).toHaveLength(1);
});

it('enables the undo button only once there is something to undo', () => {
  const undo = screen.getByLabelText('Undo') as HTMLButtonElement;
  expect(undo.disabled).toBe(true);
  drawRectangle();
  expect(undo.disabled).toBe(false);
  fireEvent.click(undo);
  expect(saved()).toEqual([]);
  expect(undo.disabled).toBe(true);
  expect((screen.getByLabelText('Redo') as HTMLButtonElement).disabled).toBe(
    false,
  );
});

it('zooms with the buttons and resets to 100%', () => {
  expect(zoom()).toBe('100%');
  fireEvent.click(screen.getByLabelText('Zoom in'));
  expect(zoom()).toBe('120%');
  ctrl('-');
  ctrl('-');
  expect(zoom()).toBe('83%');
  fireEvent.click(screen.getByLabelText('Reset zoom'));
  expect(zoom()).toBe('100%');
});

const nudge = (key = 'ArrowRight', extra = {}) =>
  fireEvent.keyDown(window, { key, ...extra });
const release = (key = 'ArrowRight') => fireEvent.keyUp(window, { key });
const box = () => saved().map((s: { x: number; y: number }) => [s.x, s.y]);

it('nudges by 1px, or 10px with Shift, and undoes a held run in one step', () => {
  drawRectangle();
  nudge();
  nudge('ArrowDown', { shiftKey: true });
  nudge('ArrowDown', { shiftKey: true, repeat: true });
  expect(box()).toEqual([[101, 120]]);
  ctrl('z');
  expect(box()).toEqual([[100, 100]]);
});

it('undoes five quick nudges in one step', () => {
  drawRectangle();
  for (let i = 0; i < 5; i++) nudge();
  expect(box()).toEqual([[105, 100]]);
  ctrl('z');
  expect(box()).toEqual([[100, 100]]);
});

it('starts a new undo step once the arrow keys rest for half a second', () => {
  vi.useFakeTimers();
  drawRectangle();
  nudge();
  release();
  vi.advanceTimersByTime(400);
  nudge();
  release();
  vi.advanceTimersByTime(600);
  nudge();
  ctrl('z');
  expect(box()).toEqual([[102, 100]]);
  ctrl('z');
  expect(box()).toEqual([[100, 100]]);
});

it('keeps nudges on either side of another change as separate undo steps', () => {
  drawRectangle();
  nudge();
  nudge();
  fireEvent.click(screen.getByLabelText('Red'));
  nudge();
  nudge();
  ctrl('z');
  expect(saved()).toMatchObject([{ x: 102, color: expect.any(String) }]);
  ctrl('z');
  expect(box()).toEqual([[102, 100]]);
  expect(saved()[0].color).toBeUndefined();
  ctrl('z');
  expect(box()).toEqual([[100, 100]]);
});

it('keeps nudges of different selections as separate undo steps', () => {
  drawRectangle();
  fireEvent.click(screen.getByLabelText('Rectangle'));
  drag([400, 400], [500, 450]);
  nudge();
  drag([90, 90], [310, 210]);
  nudge();
  expect(box()).toEqual([
    [101, 100],
    [401, 400],
  ]);
  ctrl('z');
  expect(box()).toEqual([
    [100, 100],
    [401, 400],
  ]);
  ctrl('z');
  expect(box()).toEqual([
    [100, 100],
    [400, 400],
  ]);
});

it('opens the shortcuts dialog from the menu or with ? and closes it with Escape', () => {
  fireEvent.click(screen.getByLabelText('Menu'));
  choose('Keyboard shortcuts');
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.keyDown(window, { key: '?' });
  expect(screen.getByRole('dialog')).toBeTruthy();
});

it('restores pan and zoom after a restart', () => {
  fireEvent.click(screen.getByLabelText('Zoom in'));
  fireEvent.wheel(canvas(), { deltaX: 40, deltaY: 40 });
  const view = localStorage.getItem('infinidraw:view');
  cleanup();
  render(<App />);
  expect(zoom()).toBe('120%');
  expect(localStorage.getItem('infinidraw:view')).toBe(view);
});

it('shows a hint only while the canvas is empty', () => {
  expect(screen.getByText(/double-click for text/)).toBeTruthy();
  drawRectangle();
  expect(screen.queryByText(/double-click for text/)).toBeNull();
});

const frames = (ms = 1000) => act(() => vi.advanceTimersByTime(ms));
const view = () => JSON.parse(localStorage.getItem('infinidraw:view')!);
const path = () => JSON.parse(localStorage.getItem('infinidraw:path')!);
const onScreen = (s: { x: number; y: number; w: number; h: number }) => {
  const v = view();
  const [x, y] = [v.x + s.x * v.zoom, v.y + s.y * v.zoom];
  return (
    x >= 0 && y >= 0 && x + s.w * v.zoom <= 1024 && y + s.h * v.zoom <= 768
  );
};
// key is the shifted digit on AZERTY-like layouts, a symbol on US ones.
const fit = (digit: string, key = '!') =>
  fireEvent.keyDown(window, { key, code: `Digit${digit}`, shiftKey: true });
const zoomInto = (x: number, y: number, deltaY = -900) =>
  fireEvent.wheel(canvas(), { ...at(x, y), deltaY, ctrlKey: true });
const location = () => screen.queryByLabelText('Breadcrumb')?.textContent;
const label = (text: string) => {
  fireEvent.doubleClick(canvas(), at(200, 150));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
  fireEvent.blur(screen.getByRole('textbox'));
};

it('goes inside a rectangle by zooming into it and back out by zooming out', () => {
  drawRectangle();
  label('api');
  zoomInto(200, 150);
  expect(location()).toBe('Home/api');
  expect(screen.getByText(/double-click for text/)).toBeTruthy();

  drawRectangle();
  expect(saved()).toHaveLength(1);
  expect(saved()[0].children).toHaveLength(1);
  ctrl('z');
  expect(saved()[0].children).toEqual([]);

  zoomInto(200, 150, 300);
  expect(location()).toBeUndefined();
  fireEvent.click(screen.getByLabelText('Rectangle'));
  drag([10, 10], [400, 400]);
  expect(saved()).toHaveLength(2);
});

it('stops at 800% when zooming into empty canvas', () => {
  drawRectangle();
  zoomInto(600, 600);
  expect(location()).toBeUndefined();
  expect(zoom()).toBe('800%');
});

it('enters a rectangle from its context menu and stays there after a restart', () => {
  drawRectangle();
  fireEvent.contextMenu(canvas(), at(200, 150));
  choose('Enter');
  expect(location()).toBeUndefined();
  frames(100);
  expect(location()).toBeUndefined();
  frames();
  expect(location()).toBe('Home/Untitled');
  expect(path()).toEqual([saved()[0].id]);

  cleanup();
  render(<App />);
  expect(location()).toBe('Home/Untitled');
});

it('jumps back up through nested rectangles from the breadcrumb', () => {
  drawRectangle();
  label('api');
  zoomInto(200, 150);
  drawRectangle();
  label('auth');
  zoomInto(200, 150);
  expect(location()).toBe('Home/api/auth');

  fireEvent.click(screen.getByText('api'));
  expect(location()).toBe('Home/api');
  fireEvent.click(screen.getByText('Home'));
  expect(location()).toBeUndefined();
  const start = view();
  frames(100);
  const mid = view();
  frames();
  expect(mid.zoom).not.toBe(start.zoom);
  expect(mid.zoom).not.toBe(view().zoom);
  expect(view().zoom).toBeCloseTo(Math.min(1024 / 200, 768 / 100) / 2);
  fireEvent.doubleClick(canvas(), at(512, 384));
  expect(screen.getByRole('textbox')).toHaveProperty('value', 'api');
});

it('frames every shape with Shift+1, animating there', () => {
  drawRectangle();
  fireEvent.click(screen.getByLabelText('Rectangle'));
  drag([600, 500], [700, 700]);
  fireEvent.wheel(canvas(), { deltaX: 5000, deltaY: -3000 });
  const start = view();
  fit('1');
  frames(100);
  const mid = view();
  frames();
  const end = view();
  expect(mid.x).toBeGreaterThan(Math.min(start.x, end.x));
  expect(mid.x).toBeLessThan(Math.max(start.x, end.x));
  expect(saved().every(onScreen)).toBe(true);
});

it('frames only the selection with Shift+2, and nothing without one', () => {
  drawRectangle();
  fireEvent.click(screen.getByLabelText('Rectangle'));
  drag([900, 600], [1000, 700]);
  drag([200, 150], [200, 150]);
  fit('2');
  frames();
  expect(view().zoom).toBe(2);
  expect(onScreen(saved()[0])).toBe(true);
  expect(onScreen(saved()[1])).toBe(false);
  fireEvent.keyDown(window, { key: 'Escape' });
  const before = view();
  fit('2');
  frames();
  expect(view()).toEqual(before);
});

it('leaves an empty canvas and the tool alone on Shift+1 and Shift+2', () => {
  const before = view();
  fit('1', '1');
  fit('2', '2');
  frames();
  expect(view()).toEqual(before);
  expect(screen.getByLabelText('Select').getAttribute('aria-pressed')).toBe(
    'true',
  );
});

it('stops zooming in at 200% when fitting a tiny shape', () => {
  fireEvent.click(screen.getByLabelText('Rectangle'));
  drag([100, 100], [110, 108]);
  fit('1');
  frames();
  expect(view().zoom).toBe(2);
  expect(onScreen(saved()[0])).toBe(true);
});

it('zooms to fit from the canvas context menu', () => {
  drawRectangle();
  fireEvent.wheel(canvas(), { deltaX: 5000 });
  fireEvent.contextMenu(canvas(), at(500, 500));
  choose('Zoom to fit');
  frames();
  expect(onScreen(saved()[0])).toBe(true);
});

const panFrom = (start: Partial<PointerEvent>) => {
  fireEvent.pointerDown(canvas(), { ...at(500, 400), ...start });
  for (const x of [480, 460, 440]) {
    frames(16);
    fireEvent.pointerMove(canvas(), at(x, 400));
  }
};

it('keeps gliding after letting go of a moving pan, then comes to rest', () => {
  panFrom({ button: 1 });
  fireEvent.pointerUp(canvas(), at(440, 400));
  const released = view().x;
  frames(100);
  expect(view().x).toBeLessThan(released);
  frames(5000);
  const rest = view().x;
  frames();
  expect(view().x).toBe(rest);
});

it('does not glide after a pan released while holding still', () => {
  fireEvent.keyDown(window, { key: ' ' });
  panFrom({});
  frames(200);
  fireEvent.pointerUp(canvas(), at(440, 400));
  fireEvent.keyUp(window, { key: ' ' });
  const released = view();
  frames();
  expect(view()).toEqual(released);
});

it('stops a glide or a zoom to fit when the canvas is pressed', () => {
  panFrom({ button: 1 });
  fireEvent.pointerUp(canvas(), at(440, 400));
  frames(50);
  fireEvent.pointerDown(canvas(), at(10, 10));
  fireEvent.pointerUp(canvas(), at(10, 10));
  let stopped = view();
  frames();
  expect(view()).toEqual(stopped);

  drawRectangle();
  fireEvent.wheel(canvas(), { deltaX: 5000 });
  fit('1');
  frames(50);
  fireEvent.pointerDown(canvas(), at(10, 10));
  fireEvent.pointerUp(canvas(), at(10, 10));
  stopped = view();
  frames();
  expect(view()).toEqual(stopped);
});

it('saves the drawing to a file and opens it back, undoably', async () => {
  let file = '';
  Object.assign(window, {
    files: {
      save: async (text: string) => void (file = text),
      open: async () => file,
    },
  });
  drawRectangle();
  ctrl('s');
  expect(JSON.parse(file)).toMatchObject({
    type: 'infinidraw',
    shapes: [{ type: 'rect', x: 100 }],
  });
  fireEvent.click(screen.getByLabelText('Menu'));
  choose('Clear canvas');
  fireEvent.click(screen.getByLabelText('Menu'));
  choose('Open');
  await vi.waitFor(() => expect(saved()).toMatchObject([{ x: 100 }]));
  ctrl('z');
  expect(saved()).toEqual([]);
});

it('refuses to open a file that is not an infinidraw file', async () => {
  window.alert = vi.fn();
  Object.assign(window, { files: { open: async () => '{"shapes":[]}' } });
  drawRectangle();
  ctrl('o');
  await vi.waitFor(() => expect(window.alert).toHaveBeenCalled());
  expect(saved()).toHaveLength(1);
});

const pressed = (name: string) =>
  screen.getByLabelText(name).getAttribute('aria-pressed');
const drawArrow = (from: [number, number], to: [number, number]) => {
  fireEvent.keyDown(window, { key: 'a' });
  drag(from, to);
};

it('draws elbow arrows once elbow is chosen, leaving other shapes alone', () => {
  fireEvent.click(screen.getByLabelText('Elbow'));
  drawArrow([400, 400], [500, 450]);
  drawRectangle();
  expect(saved()[0]).toMatchObject({ type: 'arrow', elbow: true });
  expect(saved()[1]).not.toHaveProperty('elbow');
});

it('switches the selected arrow between straight and elbow', () => {
  drawArrow([400, 400], [500, 450]);
  expect(pressed('Straight')).toBe('true');
  fireEvent.click(screen.getByLabelText('Elbow'));
  expect(saved()[0].elbow).toBe(true);
  expect(pressed('Elbow')).toBe('true');
  fireEvent.click(screen.getByLabelText('Straight'));
  expect(saved()[0].elbow).toBeFalsy();
  expect(pressed('Straight')).toBe('true');
});

it('makes only the arrows in a mixed selection elbowed', () => {
  drawRectangle();
  drawArrow([400, 400], [500, 450]);
  fireEvent.pointerDown(canvas(), { ...at(200, 150), shiftKey: true });
  fireEvent.pointerUp(canvas(), at(200, 150));
  fireEvent.click(screen.getByLabelText('Elbow'));
  expect(saved()[0]).not.toHaveProperty('elbow');
  expect(saved()[1].elbow).toBe(true);
});

it('selects an elbow arrow along its bends, not along the straight diagonal', () => {
  fireEvent.click(screen.getByLabelText('Elbow'));
  drawArrow([100, 100], [300, 200]);
  drag([150, 125], [150, 125]);
  fireEvent.keyDown(window, { key: 'Delete' });
  expect(saved()).toHaveLength(1);
  drag([200, 100], [200, 100]);
  fireEvent.keyDown(window, { key: 'Delete' });
  expect(saved()).toEqual([]);
});

it('keeps a bound elbow arrow attached when a rectangle moves', () => {
  drawRectangle();
  fireEvent.click(screen.getByLabelText('Rectangle'));
  drag([500, 400], [700, 500]);
  fireEvent.click(screen.getByLabelText('Elbow'));
  drawArrow([200, 150], [600, 450]);
  drag([600, 450], [600, 850]);
  expect(route(saved()[2], saved())).toEqual([
    { x: 200, y: 204 },
    { x: 200, y: 500 },
    { x: 600, y: 500 },
    { x: 600, y: 796 },
  ]);
});

type P = { x: number; y: number };
// True when the segment from p to q leaves the box's side that p sits on at a right angle.
const perpendicular = (p: P, q: P, b: P & { w: number; h: number }) =>
  p.y < b.y || p.y > b.y + b.h ? p.x === q.x : p.y === q.y;
const boundBetweenOffsetRects = () => {
  drawRectangle();
  fireEvent.click(screen.getByLabelText('Rectangle'));
  drag([500, 400], [700, 500]);
  drawArrow([200, 150], [600, 450]);
  drag([600, 450], [600, 650]);
  return saved();
};

it('bends a bound elbow arrow once when its rectangles sit diagonally close', () => {
  fireEvent.click(screen.getByLabelText('Elbow'));
  const [a, b, arrow] = boundBetweenOffsetRects();
  const points = route(arrow, saved());
  expect(points).toHaveLength(3);
  expect(perpendicular(points[0], points[1], a)).toBe(true);
  expect(perpendicular(points.at(-1)!, points.at(-2)!, b)).toBe(true);
});

it('keeps bound straight arrows on the side facing the other end', () => {
  const arrow = boundBetweenOffsetRects()[2];
  expect(arrow).toMatchObject({ x: 200, y: 204, w: 400, h: 392 });
});
