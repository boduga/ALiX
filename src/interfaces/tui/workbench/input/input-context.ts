import type { WorkbenchUiState } from '../model/ui-state.js';
import type { WorkbenchInputContext } from './input-router.js';

/** Runtime signals the UI state cannot supply on its own. */
export interface WorkbenchInputSignals {
  readonly turnActive: boolean;
  readonly slashActive: boolean;
  readonly approvalPending: boolean;
}

/**
 * Derive the shared key-routing context from presentation state plus the few
 * live signals owned by the runtime. Renderer-neutral: both the ANSI canvas
 * and the OpenTUI host route keys from the same context.
 */
export function buildWorkbenchInputContext(state: WorkbenchUiState, signals: WorkbenchInputSignals): WorkbenchInputContext {
  return {
    turnActive: signals.turnActive,
    composerText: state.composer.text,
    slashActive: signals.slashActive,
    approvalPending: signals.approvalPending,
    overlayOpen: state.overlayStack.length > 0,
    inspectorOpen: state.overlayStack.at(-1) === 'inspector',
    coordinationOpen: state.overlayStack.at(-1) === 'coordination',
    coordinationBusy: state.coordination.phase === 'submitting',
    transcriptMode: state.transcriptMode,
    drawer: state.drawer,
    focus: state.focus,
  };
}
