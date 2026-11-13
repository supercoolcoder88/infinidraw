import { Fragment } from 'react';
import { PANEL, PANEL_BUTTON } from './Menu';
import type { Shape } from './shapes';

const name = (s: Shape) => s.text.split('\n')[0] || 'Untitled';

export function Breadcrumbs(p: {
  trail: Shape[];
  onLeave: (depth: number) => void;
}) {
  return (
    <nav
      className={`${PANEL} top-3 left-[62px] items-center text-muted`}
      aria-label="Breadcrumb"
    >
      {p.trail.map((s, i) => (
        <Fragment key={s.id}>
          <button
            className={`${PANEL_BUTTON} max-w-[20ch] truncate`}
            onClick={() => p.onLeave(i)}
          >
            {i ? name(p.trail[i - 1]) : 'Home'}
          </button>
          /
        </Fragment>
      ))}
      <span
        className="box-content max-w-[20ch] truncate px-1.5 text-ink"
        aria-current="page"
      >
        {name(p.trail.at(-1)!)}
      </span>
    </nav>
  );
}
