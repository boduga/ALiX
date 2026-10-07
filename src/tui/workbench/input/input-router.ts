export interface WorkbenchInputContext {
  readonly turnActive: boolean;
  readonly composerText: string;
  readonly slashActive: boolean;
  readonly approvalPending?: boolean;
  readonly overlayOpen?: boolean;
  readonly inspectorOpen?: boolean;
  readonly coordinationOpen?: boolean;
  readonly coordinationBusy?: boolean;
  readonly transcriptMode: 'compact' | 'detailed' | 'raw';
  readonly drawer: 'closed' | 'agents' | 'tasks' | 'artifacts';
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
  | { readonly type: 'overlay.scroll'; readonly delta: number }
  | { readonly type: 'transcript.toggle' }
  | { readonly type: 'focus.set'; readonly focus: 'composer' | 'transcript' }
  | { readonly type: 'transcript.filter'; readonly filter: 'all' | 'response' | 'tool' | 'activity' | 'error' }
  | { readonly type: 'transcript.scope.toggle' }
  | { readonly type: 'transcript.follow.toggle' }
  | { readonly type: 'drawer.toggle'; readonly drawer: 'agents' | 'tasks' | 'artifacts' }
  | { readonly type: 'drawer.move'; readonly direction: -1 | 1 }
  | { readonly type: 'run.move'; readonly direction: -1 | 1 }
  | { readonly type: 'agentRoster.toggle' }
  | { readonly type: 'agent.shortcut'; readonly index: number }
  | { readonly type: 'agent.aggregate' }
  | { readonly type: 'coordination.inspect' }
  | { readonly type: 'coordination.submit' }
  | { readonly type: 'coordination.edit'; readonly edit: import('../model/ui-action.js').ComposerEditAction }
  | { readonly type: 'inspector.open' }
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
  if (context.inspectorOpen && key === 'Ctrl+r') return { type: 'drawer.toggle', drawer: 'artifacts' };
  if (context.coordinationOpen) {
    if (key === 'Escape') return { type: 'overlay.close' };
    if (context.approvalPending && key === 'Ctrl+o') return { type: 'transcript.toggle' };
    if (key === 'Enter') return { type: 'coordination.submit' };
    if (context.coordinationBusy) return { type: 'unhandled' };
    if (key === 'Shift+Enter') return { type: 'coordination.edit', edit: { type: 'composer.insert', text: '\n' } };
    if (key === 'Backspace') return { type: 'coordination.edit', edit: { type: 'composer.backspace' } };
    if (key === 'Delete') return { type: 'coordination.edit', edit: { type: 'composer.delete' } };
    const direction = key === 'ArrowLeft' ? 'left' : key === 'ArrowRight' ? 'right' : key === 'Home' ? 'start' : key === 'End' ? 'end' : undefined;
    if (direction) return { type: 'coordination.edit', edit: { type: 'composer.move', direction } };
    if (isPrintableGrapheme(key)) return { type: 'coordination.edit', edit: { type: 'composer.insert', text: key } };
    return { type: 'unhandled' };
  }
  if (context.overlayOpen) {
    if (context.approvalPending && key === 'Ctrl+o') return { type: 'transcript.toggle' };
    if (key === 'ArrowUp' || key === 'PageUp') return { type: 'overlay.scroll', delta: key === 'PageUp' ? -8 : -1 };
    if (key === 'ArrowDown' || key === 'PageDown') return { type: 'overlay.scroll', delta: key === 'PageDown' ? 8 : 1 };
    return key === 'Escape' ? { type: 'overlay.close' } : { type: 'unhandled' };
  }
  if (key === 'Escape' && context.drawer !== 'closed') return { type: 'drawer.close' };
  if (key === 'Ctrl+e') return { type: 'inspector.open' };
  if (key === 'Ctrl+o') return { type: 'transcript.toggle' };
  if (key === 'Shift+Tab') return { type: 'permission.cycle' };
  if (key === 'Ctrl+f') return { type: 'focus.set', focus: context.focus === 'transcript' ? 'composer' : 'transcript' };
  if (key === 'Ctrl+a') return { type: 'drawer.toggle', drawer: 'agents' };
  if (key === 'Ctrl+t') return { type: 'drawer.toggle', drawer: 'tasks' };
  if (key === 'Ctrl+r') return { type: 'drawer.toggle', drawer: 'artifacts' };
  if (context.focus === 'drawer' && context.drawer !== 'closed') {
    if (key === 'Escape') return { type: 'drawer.close' };
    if (key === 'ArrowUp' || key === 'k') return { type: 'drawer.move', direction: -1 };
    if (key === 'ArrowDown' || key === 'j') return { type: 'drawer.move', direction: 1 };
    if (key === '[') return { type: 'run.move', direction: -1 };
    if (key === ']') return { type: 'run.move', direction: 1 };
    if (context.drawer === 'agents') {
      if (/^[1-9]$/.test(key)) return { type: 'agent.shortcut', index: Number(key) };
      if (key === '/') return { type: 'agent.aggregate' };
      if (key === 'c') return { type: 'coordination.inspect' };
    }
    if (context.drawer === 'agents' && key === 'Enter') return { type: 'agentRoster.toggle' };
    return { type: 'unhandled' };
  }
  if (context.focus === 'modal') return { type: 'unhandled' };
  if (context.focus === 'transcript') {
    const filters = ['all', 'response', 'tool', 'activity', 'error'] as const;
    if (/^[1-5]$/.test(key)) return { type: 'transcript.filter', filter: filters[Number(key) - 1]! };
    if (key === 's') return { type: 'transcript.scope.toggle' };
    if (key === 'f') return { type: 'transcript.follow.toggle' };
    if (key === 'Escape') return context.turnActive ? { type: 'turn.cancel' } : { type: 'focus.set', focus: 'composer' };
    return { type: 'unhandled' };
  }
  if (key === 'Shift+Enter') return { type: 'composer.insert', text: '\n' };
  if (key === 'Backspace') return { type: 'composer.backspace' };
  if (key === 'Delete') return { type: 'composer.delete' };
  if (key === 'ArrowLeft') return { type: 'composer.move', direction: 'left' };
  if (key === 'ArrowRight') return { type: 'composer.move', direction: 'right' };
  if (key === 'Home') return { type: 'composer.move', direction: 'start' };
  if (key === 'End') return { type: 'composer.move', direction: 'end' };
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
