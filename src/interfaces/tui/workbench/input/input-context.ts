import type { WorkbenchUiState } from '../model/ui-state.js';
import type { WorkbenchInputContext } from './input-router.js';

export interface WorkbenchInputSignals {
  readonly turnActive: boolean;
  readonly slashActive: boolean;
  readonly approvalPending: boolean;
}

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
