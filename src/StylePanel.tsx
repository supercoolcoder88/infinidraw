import { ICON, PANEL, PANEL_BUTTON } from './Menu';
import type { Shape } from './shapes';

// Mid-tones that read on both the light and dark canvas; no colour means theme ink.
const COLORS = [
  { label: 'Ink' },
  { label: 'Red', color: '#e5484d' },
  { label: 'Orange', color: '#e8890c' },
  { label: 'Green', color: '#30a46c' },
  { label: 'Blue', color: '#3b82f6' },
  { label: 'Purple', color: '#9b6ef3' },
];

export function StylePanel(p: {
  dotted: boolean;
  elbow: boolean;
  color?: string;
  selected?: Shape;
  onStroke: (dotted: boolean) => void;
  onElbow: (elbow: boolean) => void;
  onColor: (color?: string) => void;
}) {
  const current = p.selected ?? p;
  return (
    <div className={`${PANEL} top-1/2 right-3 -translate-y-1/2 flex-col`}>
      {[false, true].map((d) => (
        <button
          key={String(d)}
          className={PANEL_BUTTON}
          title={d ? 'Dotted' : 'Solid'}
          aria-label={d ? 'Dotted' : 'Solid'}
          aria-pressed={current.dotted === d}
          onClick={() => p.onStroke(d)}
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
      {[false, true].map((e) => (
        <button
          key={String(e)}
          className={PANEL_BUTTON}
          title={e ? 'Elbow' : 'Straight'}
          aria-label={e ? 'Elbow' : 'Straight'}
          aria-pressed={!!current.elbow === e}
          onClick={() => p.onElbow(e)}
        >
          <svg viewBox="0 0 20 20" className={ICON}>
            <path d={e ? 'M3 16h7V4h7' : 'M3 17L17 3'} />
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
          aria-pressed={current.color === c.color}
          onClick={() => p.onColor(c.color)}
        />
      ))}
    </div>
  );
}
