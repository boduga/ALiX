import type { Widgets } from 'neo-blessed';
import type { OperatorViewState } from '../../../tui/presentation/types.js';

/**
 * Render the main content viewport from the view state.
 * Sets the box content to joined mainLines and restores scroll position.
 */
export function renderMain(
  box: Widgets.BoxElement,
  state: OperatorViewState,
): void {
  box.setContent(state.viewContent.mainLines.join('\n'));
  box.setScrollPerc(state.viewContent.scrollPercent);
}
