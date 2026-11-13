import { Fragment } from 'react';

type Item = {
  label: string;
  keys?: string;
  disabled?: boolean;
  separator?: boolean;
  run: () => void;
};

export const BUTTON =
  'h-8 cursor-pointer rounded-sm transition-[background,color] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent enabled:hover:bg-hover disabled:cursor-default disabled:opacity-35';
export const ICON =
  'fill-none stroke-current stroke-[1.5] [stroke-linecap:round] [stroke-linejoin:round]';

export const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 20 20" className={ICON}>
    <path d={d} />
  </svg>
);

export function Menu(p: {
  x: number;
  y: number;
  items: Item[];
  onClose: () => void;
}) {
  return (
    <>
      <div
        className="fixed inset-0"
        onPointerDown={p.onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          p.onClose();
        }}
      />
      <div
        role="menu"
        className="fixed box-content flex min-w-54 animate-appear flex-col rounded-lg border border-border bg-surface p-1 shadow-panel"
        style={{
          left: Math.min(p.x, innerWidth - 220),
          top: Math.min(p.y, innerHeight - p.items.length * 32 - 12),
        }}
      >
        {p.items.map((i) => (
          <Fragment key={i.label}>
            {i.separator && <hr className="-mx-1 my-1 border-border" />}
            <button
              role="menuitem"
              className={`${BUTTON} flex items-center justify-between gap-6 px-2 text-left`}
              disabled={i.disabled}
              onClick={() => {
                i.run();
                p.onClose();
              }}
            >
              {i.label}
              {i.keys && <kbd className="text-muted">{i.keys}</kbd>}
            </button>
          </Fragment>
        ))}
      </div>
    </>
  );
}
