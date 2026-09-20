export interface WorkbenchInputContext {
  readonly turnActive: boolean;
  readonly composerText: string;
  readonly slashActive: boolean;
  readonly approvalPending?: boolean;
  readonly overlayOpen?: boolean;
  readonly transcriptMode: 'compact' | 'detailed' | 'raw';
  readonly drawer: 'closed' | 'agents' | 'tasks';
  readonly focus: 'composer' | 'transcript' | 'drawer' | 'modal';
}

export type WorkbenchInputIntent =
  | { readonly type: 'composer.insert'; readonly text: string }
  | { readonly type: 'composer.backspace' }
  | { readonly type: 'composer.delete' }
  | { readonly type: 'composer.move'; readonly direction: 'left' | 'right' | 'start' | 'end' }
  | { readonly type: 'turn.submit' }
  | { readonly type: 'turn.queue' }
  | { readonly type: 'slash.submit' }
  | { readonly type: 'turn.cancel' }
  | { readonly type: 'approval.resolve'; readonly decision: 'approved' | 'denied' }
  | { readonly type: 'permission.cycle' }
  | { readonly type: 'overlay.close' }
  | { readonly type: 'transcript.toggle' }
  | { readonly type: 'drawer.toggle'; readonly drawer: 'agents' | 'tasks' }
  | { readonly type: 'drawer.move'; readonly direction: -1 | 1 }
  | { readonly type: 'run.move'; readonly direction: -1 | 1 }
  | { readonly type: 'agentRoster.toggle' }
  | { readonly type: 'drawer.close' }
  | { readonly type: 'unhandled' };

/** Pure context-sensitive key router for the Workbench work surface. */
export function routeWorkbenchInput(
  key: string,
  context: WorkbenchInputContext,
): WorkbenchInputIntent {
  if (context.approvalPending && (key === 'a' || key === 'd')) {
    return { type: 'approval.resolve', decision: key === 'a' ? 'approved' : 'denied' };
  }
  if (context.overlayOpen) {
    return key === 'Escape' ? { type: 'overlay.close' } : { type: 'unhandled' };
  }
  if (key === 'Ctrl+a') return { type: 'drawer.toggle', drawer: 'agents' };
  if (key === 'Ctrl+t') return { type: 'drawer.toggle', drawer: 'tasks' };
  if (context.focus === 'drawer' && context.drawer !== 'closed') {
    if (key === 'Escape') return { type: 'drawer.close' };
    if (key === 'ArrowUp' || key === 'k') return { type: 'drawer.move', direction: -1 };
    if (key === 'ArrowDown' || key === 'j') return { type: 'drawer.move', direction: 1 };
    if (key === '[') return { type: 'run.move', direction: -1 };
    if (key === ']') return { type: 'run.move', direction: 1 };
    if (context.drawer === 'agents' && key === 'Enter') return { type: 'agentRoster.toggle' };
    return { type: 'unhandled' };
  }
  if (key === 'Shift+Enter') return { type: 'composer.insert', text: '\n' };
  if (key === 'Backspace') return { type: 'composer.backspace' };
  if (key === 'Delete') return { type: 'composer.delete' };
  if (key === 'ArrowLeft') return { type: 'composer.move', direction: 'left' };
  if (key === 'ArrowRight') return { type: 'composer.move', direction: 'right' };
  if (key === 'Home') return { type: 'composer.move', direction: 'start' };
  if (key === 'End') return { type: 'composer.move', direction: 'end' };
  if (key === 'Ctrl+o') return { type: 'transcript.toggle' };
  if (key === 'Shift+Tab') return { type: 'permission.cycle' };
  if (key === 'Escape') {
    return context.turnActive ? { type: 'turn.cancel' } : { type: 'unhandled' };
  }
  if (key === 'Enter') {
    if (context.slashActive) return { type: 'slash.submit' };
    if (context.composerText.trim().length === 0) return { type: 'unhandled' };
    return context.turnActive ? { type: 'turn.queue' } : { type: 'turn.submit' };
  }
  if (isPrintableGrapheme(key)) {
    return { type: 'composer.insert', text: key };
  }
  return { type: 'unhandled' };
}
import { isPrintableGrapheme } from '../render/terminal-text.js';
