import { Icon, PANEL, PANEL_BUTTON } from './Menu';

export const TOOLS = [
  {
    tool: 'select',
    key: 'v',
    label: 'Select',
    icon: 'M5 3l10 6-4.5 1.5L9 15z',
  },
  { tool: 'rect', key: 'r', label: 'Rectangle', icon: 'M3 5h14v10H3z' },
  { tool: 'arrow', key: 'a', label: 'Arrow', icon: 'M4 16L16 4M8 4h8v8' },
] as const;
export type Tool = (typeof TOOLS)[number]['tool'];

export function Toolbar(p: { tool: Tool; onTool: (t: Tool) => void }) {
  return (
    <div className={`${PANEL} top-3 left-1/2 -translate-x-1/2`}>
      {TOOLS.map((t, i) => (
        <button
          key={t.tool}
          className={PANEL_BUTTON}
          data-key={i + 1}
          title={`${t.label} (${t.key.toUpperCase()} or ${i + 1})`}
          aria-label={t.label}
          aria-pressed={p.tool === t.tool}
          onClick={() => p.onTool(t.tool)}
        >
          <Icon d={t.icon} />
        </button>
      ))}
    </div>
  );
}
