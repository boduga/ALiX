import type { WorkbenchStore } from '../app/workbench-store.js';
import type { WorkbenchInputIntent } from '../input/input-router.js';
import { applyWorkbenchHostIntent, type WorkbenchHostPorts } from './host-intent.js';
import { moveAgentSelection, moveArtifactSelection, moveRunSelection, moveTaskSelection, selectAgentShortcut, type SelectionSnapshot } from './selection-intent.js';
import { applyWorkbenchStoreIntent } from './store-intent.js';

export interface WorkbenchIntentContext {
  readonly snapshot: SelectionSnapshot | undefined;
  readonly ports: WorkbenchHostPorts;
  readonly coordinationAvailable: boolean;
}

export function applyWorkbenchIntent(store: WorkbenchStore, intent: WorkbenchInputIntent, context: WorkbenchIntentContext): boolean {
  const storeResult = applyWorkbenchStoreIntent(store, intent, { coordinationAvailable: context.coordinationAvailable });
  if (storeResult.handled) {
    if (storeResult.syncComposer) context.ports.syncComposer();
    if (storeResult.pinnedBottom !== undefined) context.ports.setPinnedBottom(storeResult.pinnedBottom);
    if (storeResult.transcriptMode) context.ports.setTranscriptMode(storeResult.transcriptMode);
    if (storeResult.followToBottom) context.ports.anchorTranscriptBottom();
    if (storeResult.repaint) context.ports.repaint();
    return true;
  }
  if (applyWorkbenchHostIntent(store, intent, context.ports)) return true;
  return applyWorkbenchSelectionIntent(store, intent, context.snapshot, context.ports);
}

function applyWorkbenchSelectionIntent(
  store: WorkbenchStore,
  intent: WorkbenchInputIntent,
  snapshot: SelectionSnapshot | undefined,
  ports: WorkbenchHostPorts,
): boolean {
  const state = store.snapshot();
  switch (intent.type) {
    case 'transcript.follow.toggle': {
      const followTail = !state.followTail;
      if (state.followTail) ports.anchorTranscriptBottom();
      store.dispatch({ type: 'transcript.follow', followTail });
      ports.setPinnedBottom(followTail);
      if (followTail) ports.anchorTranscriptBottom();
      ports.repaint();
      return true;
    }
    case 'agent.shortcut': {
      const target = selectAgentShortcut(snapshot, state, intent.index);
      if (target) store.dispatch({ type: 'agent.select', ...target });
      ports.repaint();
      return true;
    }
    case 'drawer.move': {
      if (state.drawer === 'agents') {
        store.dispatch({ type: 'agent.select', ...moveAgentSelection(snapshot, state, intent.direction) });
      } else if (state.drawer === 'tasks') {
        const target = moveTaskSelection(snapshot, state, intent.direction);
        if (!target) return true;
        store.dispatch({ type: 'task.select', ...target });
      } else if (state.drawer === 'artifacts') {
        const target = moveArtifactSelection(snapshot, state, intent.direction);
        if (!target) return true;
        store.dispatch({ type: 'artifact.select', ...target });
      }
      ports.repaint();
      return true;
    }
    case 'run.move':
      store.dispatch({ type: 'run.select', ...moveRunSelection(snapshot, state, intent.direction) });
      ports.repaint();
      return true;
    default:
      return false;
  }
}
