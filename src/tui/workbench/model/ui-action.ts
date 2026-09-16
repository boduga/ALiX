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
  | { readonly type: 'overlay.toggle'; readonly overlay: WorkbenchOverlay }
  | { readonly type: 'overlay.close' }
  | { readonly type: 'transcript.mode'; readonly mode: WorkbenchTranscriptMode }
  | { readonly type: 'dimensions.set'; readonly columns: number; readonly rows: number };
