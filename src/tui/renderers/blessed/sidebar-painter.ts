import type { Widgets } from 'neo-blessed';
import type { OperatorViewState } from '../../../tui/presentation/types.js';
import type { SidebarPanelId } from '../../../tui/state.js';

/**
 * Render all visible sidebar panels from the view state.
 * Each panel's box is updated with its title, items, and status indicators.
 *
 * @throws Error if a widget for a panel id is missing from the widgets record.
 */
export function renderSidebar(
  widgets: Record<SidebarPanelId, Widgets.BoxElement>,
  state: OperatorViewState,
): void {
  for (const [id, panel] of Object.entries(state.viewContent.sidebarPanels)) {
    const widget = widgets[id as SidebarPanelId];
    if (!widget) throw new Error(`Missing sidebar widget: ${id}`);

    const lines: string[] = [];
    if (panel.visible) {
      lines.push(` ${panel.title}`);
      lines.push('');

      if (panel.loading) {
        lines.push(' ...');
      } else if (panel.items.length === 0) {
        lines.push(' (no entries)');
      } else {
        for (const item of panel.items) {
          const indicator = item.status === 'pending' ? '●' : '○';
          lines.push(
            ` ${indicator} ${item.title}${item.subtitle ? ` ${item.subtitle}` : ''}`,
          );
        }
      }
    }
    widget.setContent(lines.join('\n'));
  }
}
