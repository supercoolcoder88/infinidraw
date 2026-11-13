import { Icon, PANEL, PANEL_BUTTON } from './Menu';

export function Controls(p: {
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  onZoom: (k: number) => void;
  onResetZoom: () => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <div className={`${PANEL} bottom-3 left-3`}>
      <button
        className={PANEL_BUTTON}
        title="Zoom out (Ctrl+-)"
        aria-label="Zoom out"
        onClick={() => p.onZoom(1 / 1.2)}
      >
        <Icon d="M4 10h12" />
      </button>
      <button
        className={`${PANEL_BUTTON} min-w-13`}
        title="Reset zoom (Ctrl+0)"
        aria-label="Reset zoom"
        onClick={p.onResetZoom}
      >
        {Math.round(p.zoom * 100)}%
      </button>
      <button
        className={PANEL_BUTTON}
        title="Zoom in (Ctrl+=)"
        aria-label="Zoom in"
        onClick={() => p.onZoom(1.2)}
      >
        <Icon d="M4 10h12M10 4v12" />
      </button>
      <hr className="mx-0.5 my-1 h-auto border-t-0 border-l border-border" />
      <button
        className={PANEL_BUTTON}
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
        disabled={!p.canUndo}
        onClick={p.onUndo}
      >
        <Icon d="M7 4L3 8l4 4M3 8h8a5 5 0 010 9H8" />
      </button>
      <button
        className={PANEL_BUTTON}
        title="Redo (Ctrl+Shift+Z)"
        aria-label="Redo"
        disabled={!p.canRedo}
        onClick={p.onRedo}
      >
        <Icon d="M13 4l4 4-4 4M17 8H9a5 5 0 000 9h3" />
      </button>
    </div>
  );
}
