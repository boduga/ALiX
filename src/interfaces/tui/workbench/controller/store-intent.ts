import type { WorkbenchStore } from '../app/workbench-store.js';
import type { WorkbenchInputIntent } from '../input/input-router.js';

export interface WorkbenchStoreIntentContext {
  /** Whether the session exposes a coordination launcher. */
  readonly coordinationAvailable: boolean;
}

/**
 * Declarative host effects a store-only intent implies. The neutral applier
 * mutates only `WorkbenchStore`; the host performs mirrors, scroll anchoring,
 * and repaint so ANSI and OpenTUI share one transition table.
 */
export interface WorkbenchStoreIntentResult {
  readonly handled: boolean;
  readonly repaint: boolean;
  /** Mirror the authoritative composer into the host's adapter. */
  readonly syncComposer?: boolean;
  /** Re-anchor the transcript to the semantic bottom. */
  readonly followToBottom?: boolean;
  readonly pinnedBottom?: boolean;
  readonly transcriptMode?: 'compact' | 'detailed';
}

const NONE: WorkbenchStoreIntentResult = { handled: false, repaint: false };

/**
 * Apply the store-only Workbench intents. Effectful intents (submit, cancel,
 * approval, slash, coordination submit, overlay scroll, selection navigation,
 * follow-toggle) return `{ handled: false }` for the host to run; follow-toggle
 * stays on the host because stopping follow must anchor before the dispatch.
 */
export function applyWorkbenchStoreIntent(
  store: WorkbenchStore,
  intent: WorkbenchInputIntent,
  context: WorkbenchStoreIntentContext,
): WorkbenchStoreIntentResult {
  const state = store.snapshot();
  switch (intent.type) {
    case 'coordination.edit':
    case 'focus.set':
    case 'transcript.filter':
    case 'transcript.scope.toggle':
    case 'composer.insert':
    case 'composer.backspace':
    case 'composer.delete':
    case 'composer.move': {
      store.dispatch(intent);
      const followToBottom = (intent.type === 'transcript.filter' || intent.type === 'transcript.scope.toggle') && state.followTail;
      const syncComposer = intent.type.startsWith('composer.');
      return { handled: true, repaint: true, ...(followToBottom ? { followToBottom: true } : {}), ...(syncComposer ? { syncComposer: true } : {}) };
    }
    case 'transcript.toggle': {
      const mode = state.transcriptMode === 'compact' ? 'detailed' : 'compact';
      store.dispatch({ type: 'transcript.mode', mode });
      return { handled: true, repaint: true, followToBottom: true, pinnedBottom: true, transcriptMode: mode };
    }
    case 'inspector.open':
      store.dispatch({ type: 'overlay.toggle', overlay: 'inspector' });
      return { handled: true, repaint: true };
    case 'drawer.toggle':
      if (state.overlayStack.at(-1) === 'inspector') store.dispatch({ type: 'overlay.close' });
      store.dispatch({ type: 'drawer.toggle', drawer: intent.drawer });
      return { handled: true, repaint: true };
    case 'drawer.close':
      store.dispatch({ type: 'drawer.close' });
      return { handled: true, repaint: true };
    case 'agent.aggregate':
      store.dispatch({ type: 'agent.select', agentId: undefined, scrollOffset: 0 });
      return { handled: true, repaint: true };
    case 'agentRoster.toggle':
      store.dispatch({ type: 'agentRoster.toggle' });
      return { handled: true, repaint: true };
    case 'overlay.close':
      store.dispatch({ type: 'overlay.close' });
      return { handled: true, repaint: true };
    case 'coordination.inspect':
      store.dispatch({ type: 'overlay.toggle', overlay: 'coordination' });
      if (!context.coordinationAvailable) store.dispatch({ type: 'coordination.status', phase: 'idle', message: 'Coordination launch unavailable in this session.' });
      return { handled: true, repaint: true };
    default:
      return NONE;
  }
}
