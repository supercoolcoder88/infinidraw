import { Fragment } from 'react';

type Item = {
  label: string;
  keys?: string;
  disabled?: boolean;
  separator?: boolean;
  run: () => void;
};

export const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 20 20">
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
        className="backdrop"
        onPointerDown={p.onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          p.onClose();
        }}
      />
      <div
        role="menu"
        className="menu"
        style={{
          left: Math.min(p.x, innerWidth - 220),
          top: Math.min(p.y, innerHeight - p.items.length * 32 - 12),
        }}
      >
        {p.items.map((i) => (
          <Fragment key={i.label}>
            {i.separator && <hr />}
            <button
              role="menuitem"
              disabled={i.disabled}
              onClick={() => {
                i.run();
                p.onClose();
              }}
            >
              {i.label}
              {i.keys && <kbd>{i.keys}</kbd>}
            </button>
          </Fragment>
        ))}
      </div>
    </>
  );
}
