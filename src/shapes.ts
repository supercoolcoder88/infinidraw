// Arrows run from (x, y) to (x + w, y + h), so w and h can be negative.
export type Shape = {
  id: string;
  type: 'rect' | 'arrow' | 'text';
  x: number;
  y: number;
  w: number;
  h: number;
  dotted: boolean;
  text: string;
  color?: string;
  children?: Shape[];
  // Arrow ends bound to shapes on the same level.
  from?: string;
  to?: string;
};
export type Point = { x: number; y: number };
export type View = Point & { zoom: number };
export type Box = Point & { w: number; h: number };

export type Colors = { ink: string; accent: string; surface: string };
const LIGHT = { ink: '#1c1c1a', accent: '', surface: '#fff' };

export const FONT = 16;
export const LINE = FONT * 1.25;
const PAD = 24;
const GAP = 4;

export const bounds = (s: Box) => ({
  x: Math.min(s.x, s.x + s.w),
  y: Math.min(s.y, s.y + s.h),
  w: Math.abs(s.w),
  h: Math.abs(s.h),
});

export const extent = (shapes: Shape[]) => {
  const boxes = shapes.length
    ? shapes.map(bounds)
    : [{ x: 0, y: 0, w: 0, h: 0 }];
  const x = Math.min(...boxes.map((b) => b.x)) - PAD;
  const y = Math.min(...boxes.map((b) => b.y)) - PAD;
  return {
    x,
    y,
    w: Math.max(...boxes.map((b) => b.x + b.w)) + PAD - x,
    h: Math.max(...boxes.map((b) => b.y + b.h)) + PAD - y,
  };
};

// A rectangle's inner canvas sits on its face, below its label: parent = frame + inner * k.
export const frame = (s: Shape) => {
  const b = bounds(s);
  const top = s.text ? s.text.split('\n').length * LINE + 8 : 0;
  const h = Math.max(b.h - top, 1);
  const c = extent(s.children ?? []);
  const k = Math.min((b.w || 1) / Math.max(c.w, 1000), h / c.h);
  return {
    k,
    x: b.x + b.w / 2 - (c.x + c.w / 2) * k,
    y: b.y + top + h / 2 - (c.y + c.h / 2) * k,
  };
};

// A bound arrow end sits just outside its shape, on the line from the shape's centre to the other end.
export const connect = (shapes: Shape[]) => {
  const find = (id?: string) =>
    shapes.find((s) => s.id === id && s.type !== 'arrow');
  const centre = (s?: Shape) => {
    const b = s && bounds(s);
    return b && { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  };
  const edge = (s: Shape, p: Point) => {
    const b = bounds(s);
    const c = centre(s)!;
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    if (!dx && !dy) return c;
    const t = Math.min(b.w / 2 / Math.abs(dx), b.h / 2 / Math.abs(dy));
    const gap = GAP / Math.hypot(dx, dy);
    return { x: c.x + dx * (t + gap), y: c.y + dy * (t + gap) };
  };
  return shapes.map((s) => {
    if (s.type !== 'arrow' || !(s.from || s.to)) return s;
    const a = find(s.from);
    const b = find(s.to);
    const start = centre(a) ?? { x: s.x, y: s.y };
    const end = centre(b) ?? { x: s.x + s.w, y: s.y + s.h };
    const p = a ? edge(a, end) : start;
    const q = b ? edge(b, start) : end;
    return {
      ...s,
      x: p.x,
      y: p.y,
      w: q.x - p.x,
      h: q.y - p.y,
      from: a?.id,
      to: b?.id,
    };
  });
};

// JetBrains Mono glyphs are 0.6em wide.
export const textSize = (text: string) => {
  const lines = text.split('\n');
  return {
    w: Math.max(...lines.map((l) => l.length)) * FONT * 0.6,
    h: lines.length * LINE,
  };
};

// Resize handles as fractions of the shape's w and h.
export const handles = (s: Shape): Point[] =>
  s.type === 'text'
    ? []
    : [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        ...(s.type === 'rect'
          ? [
              { x: 1, y: 0 },
              { x: 0, y: 1 },
            ]
          : []),
      ];

export const hit = (s: Shape, p: Point, tolerance: number) => {
  if (s.type !== 'arrow') {
    const b = bounds(s);
    return (
      p.x >= b.x - tolerance &&
      p.x <= b.x + b.w + tolerance &&
      p.y >= b.y - tolerance &&
      p.y <= b.y + b.h + tolerance
    );
  }
  const along =
    ((p.x - s.x) * s.w + (p.y - s.y) * s.h) / (s.w ** 2 + s.h ** 2 || 1);
  const t = Math.max(0, Math.min(1, along));
  return Math.hypot(p.x - s.x - t * s.w, p.y - s.y - t * s.h) <= tolerance;
};

function paint(
  ctx: CanvasRenderingContext2D,
  shapes: Shape[],
  ink: string,
  scale: number,
  editingId?: string,
) {
  for (const s of shapes) {
    ctx.strokeStyle = ctx.fillStyle = s.color ?? ink;
    const end = { x: s.x + s.w, y: s.y + s.h };
    ctx.setLineDash(s.dotted ? [1, 6] : []);
    ctx.beginPath();
    if (s.type === 'rect') ctx.roundRect(s.x, s.y, s.w, s.h, 6);
    if (s.type === 'arrow') {
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(end.x, end.y);
    }
    ctx.stroke();

    if (s.type === 'arrow') {
      const angle = Math.atan2(s.h, s.w);
      const length = Math.min(14, Math.hypot(s.w, s.h) / 2);
      ctx.setLineDash([]);
      ctx.beginPath();
      for (const a of [angle - 0.45, angle + 0.45]) {
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(end.x - length * Math.cos(a), end.y - length * Math.sin(a));
      }
      ctx.stroke();
    }

    const b = bounds(s);
    if (s.children?.length && b.w * scale > 8) {
      const f = frame(s);
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.scale(f.k, f.k);
      paint(ctx, s.children, ink, scale * f.k);
      ctx.restore();
    }

    if (s.id === editingId) continue;
    const lines = s.text.split('\n');
    const centred = s.type === 'rect';
    ctx.textAlign = centred ? 'center' : 'left';
    lines.forEach((line, i) =>
      ctx.fillText(
        line,
        centred ? b.x + b.w / 2 : b.x,
        // Canvas 'middle' sits 1px above where a textarea line box puts the glyphs.
        (s.children?.length
          ? b.y + 4 + (i + 0.5) * LINE
          : b.y + b.h / 2 + (i - (lines.length - 1) / 2) * LINE) + 1,
      ),
    );
  }
}

export function draw(
  ctx: CanvasRenderingContext2D,
  shapes: Shape[],
  view: View,
  colors: Colors,
  selected: Shape[] = [],
  editingId?: string,
  area?: Box,
  target?: Shape,
  ratio = devicePixelRatio,
) {
  const scale = ratio * view.zoom;
  ctx.setTransform(scale, 0, 0, scale, view.x * ratio, view.y * ratio);
  ctx.lineWidth = 2;
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.font = `${FONT}px 'JetBrains Mono'`;
  ctx.textBaseline = 'middle';
  paint(ctx, shapes, colors.ink, scale, editingId);

  ctx.strokeStyle = colors.accent;
  ctx.fillStyle = colors.surface;
  ctx.lineWidth = 1.5 / view.zoom;
  ctx.setLineDash([]);
  // One selected shape gets resize handles, several or an arrow's snap target get an outline each.
  const one = selected.length === 1 ? selected[0] : undefined;
  for (const s of target ? [...selected, target] : selected) {
    if (s === one && s.type !== 'text') continue;
    const b = bounds(s);
    ctx.beginPath();
    ctx.roundRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8, 4);
    ctx.stroke();
  }
  if (one)
    for (const f of handles(one)) {
      ctx.beginPath();
      ctx.arc(
        one.x + f.x * one.w,
        one.y + f.y * one.h,
        4 / view.zoom,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.stroke();
    }

  if (!area) return;
  const b = bounds(area);
  ctx.fillStyle = colors.accent;
  ctx.globalAlpha = 0.08;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1 / view.zoom;
  ctx.strokeRect(b.x, b.y, b.w, b.h);
}

export function exportPng(shapes: Shape[]) {
  if (!shapes.length) return;
  const { x, y, w, h } = extent(shapes);
  const canvas = document.createElement('canvas');
  canvas.width = w * 2;
  canvas.height = h * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = LIGHT.surface;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  draw(
    ctx,
    shapes,
    { x: -x, y: -y, zoom: 1 },
    LIGHT,
    [],
    undefined,
    undefined,
    undefined,
    2,
  );
  const a = document.createElement('a');
  a.download = 'infinidraw.png';
  a.href = canvas.toDataURL('image/png');
  a.click();
}
