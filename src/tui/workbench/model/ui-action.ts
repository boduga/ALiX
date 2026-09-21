import type { QueuedMessage, WorkbenchDrawer, WorkbenchFocus, WorkbenchOverlay, WorkbenchTranscriptMode } from './ui-state.js';

export type WorkbenchUiAction =
  | { readonly type: 'composer.insert'; readonly text: string }
  | { readonly type: 'composer.backspace' }
  | { readonly type: 'composer.delete' }
  | { readonly type: 'composer.move'; readonly direction: 'left' | 'right' | 'start' | 'end' }
  | { readonly type: 'composer.clear' }
  | { readonly type: 'composer.replace'; readonly text: string }
  | { readonly type: 'queue.add'; readonly message: QueuedMessage }
  | { readonly type: 'queue.shift' }
  | { readonly type: 'focus.set'; readonly focus: WorkbenchFocus }
  | { readonly type: 'drawer.toggle'; readonly drawer: Exclude<WorkbenchDrawer, 'closed'> }
  | { readonly type: 'drawer.close' }
  | { readonly type: 'run.select'; readonly runId?: string }
  | { readonly type: 'agent.select'; readonly agentId?: string; readonly scrollOffset: number }
  | { readonly type: 'task.select'; readonly taskId?: string; readonly agentId?: string; readonly scrollOffset: number }
  | { readonly type: 'artifact.select'; readonly artifactId?: string; readonly runId?: string; readonly agentId?: string; readonly taskId?: string; readonly scrollOffset: number }
  | { readonly type: 'agentRoster.toggle' }
  | { readonly type: 'selection.reconcile'; readonly runIds: readonly string[]; readonly agentIds: readonly string[]; readonly taskIds: readonly string[]; readonly artifactIds?: readonly string[] }
  | { readonly type: 'overlay.toggle'; readonly overlay: WorkbenchOverlay }
  | { readonly type: 'overlay.close' }
  | { readonly type: 'transcript.mode'; readonly mode: WorkbenchTranscriptMode }
  | { readonly type: 'dimensions.set'; readonly columns: number; readonly rows: number };
