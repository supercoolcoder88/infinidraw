import { SURFACE } from './Menu';

const SHORTCUTS = [
  ['V / R / A', 'Select, rectangle, arrow'],
  ['1 – 3', 'Toolbar buttons'],
  ['Space + drag', 'Pan'],
  ['Double-click', 'Add or edit text'],
  ['Shift+click', 'Add to selection'],
  ['Drag on canvas', 'Select area'],
  ['Ctrl+C / Ctrl+V', 'Copy / paste'],
  ['Ctrl+O / Ctrl+S', 'Open / save file'],
  ['Ctrl+D', 'Duplicate'],
  ['Delete', 'Delete'],
  ['Arrows', 'Nudge 1px, 10px with Shift'],
  ['Ctrl+Z', 'Undo'],
  ['Ctrl+Shift+Z', 'Redo'],
  ['Ctrl+= / Ctrl+-', 'Zoom in / out'],
  ['Ctrl+0', 'Reset zoom'],
  ['Shift+1', 'Zoom to fit'],
  ['Shift+2', 'Zoom to selection'],
  ['Zoom into a rectangle', 'Go inside it'],
  ['Escape', 'Deselect'],
  ['?', 'Keyboard shortcuts'],
];

export function ShortcutsDialog(p: { onClose: () => void }) {
  return (
    <>
      <div
        className="fixed inset-0 animate-[appear_160ms_ease] bg-shade"
        onPointerDown={p.onClose}
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
  );
}
