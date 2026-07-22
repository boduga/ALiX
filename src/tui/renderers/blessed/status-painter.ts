import type { Widgets } from 'neo-blessed';
import type { OperatorViewState } from '../../../tui/presentation/types.js';

/**
 * Render the bottom status bar from the view state.
 * Shows phase radio indicators and field values.
 */
export function renderStatusBar(
  bar: Widgets.BoxElement,
  state: OperatorViewState,
): void {
  const phaseText = state.statusBar.phaseRadios
    .map((p) => (p.active ? `● ${p.label}` : `○ ${p.label}`))
    .join('   ');
  const fieldText = state.statusBar.fields
    .map((f) => `${f.label}: ${f.value}`)
    .join(' | ');
  bar.setContent(`${phaseText}  |  ${fieldText}`);
}
