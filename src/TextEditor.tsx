import { bounds, FONT, type Shape, type View } from './shapes';

export function TextEditor(p: {
  shape: Shape;
  view: View;
  onChange: (text: string) => void;
  onDone: () => void;
}) {
  const { shape, view } = p;
  const box = bounds(shape);
  return (
    <div
      className={`fixed box-content flex items-center ${shape.type === 'rect' ? 'justify-center text-center' : ''}`}
      style={{
        left: box.x * view.zoom + view.x,
        top: box.y * view.zoom + view.y,
        width: box.w * view.zoom,
        height: box.h * view.zoom,
        fontSize: FONT * view.zoom,
        ...(shape.children?.length && {
          alignItems: 'flex-start',
          paddingTop: 4 * view.zoom,
        }),
      }}
    >
      <textarea
        autoFocus
        className="field-sizing-content min-w-[1ch] resize-none overflow-hidden leading-tight whitespace-pre outline-none [text-align:inherit]"
        style={{ color: shape.color }}
        value={shape.text}
        onChange={(e) => p.onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
        onBlur={p.onDone}
      />
    </div>
  );
}
