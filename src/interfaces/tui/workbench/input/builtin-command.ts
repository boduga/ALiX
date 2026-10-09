import type { WorkbenchDrawer, WorkbenchOverlay } from '../model/ui-state.js';

export type WorkbenchBuiltinCommand =
  | { readonly type: 'overlay.open'; readonly overlay: WorkbenchOverlay }
  | { readonly type: 'drawer.open'; readonly drawer: Exclude<WorkbenchDrawer, 'closed'> };

/** Parse exact, presentation-only Workbench commands before skill dispatch. */
export function parseWorkbenchBuiltinCommand(text: string): WorkbenchBuiltinCommand | null {
  switch (text.trim().toLowerCase()) {
    case '/diff':
      return { type: 'overlay.open', overlay: 'diff' };
    case '/review':
      return { type: 'overlay.open', overlay: 'review' };
    case '/diagnostics':
    case '/diag':
      return { type: 'overlay.open', overlay: 'diagnostics' };
    case '/help':
    case '/?':
      return { type: 'overlay.open', overlay: 'help' };
    case '/agents':
      return { type: 'drawer.open', drawer: 'agents' };
    case '/tasks':
      return { type: 'drawer.open', drawer: 'tasks' };
    case '/artifacts':
      return { type: 'drawer.open', drawer: 'artifacts' };
    default:
      return null;
  }
}
