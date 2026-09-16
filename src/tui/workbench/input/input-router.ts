export interface WorkbenchInputContext {
  readonly turnActive: boolean;
  readonly composerText: string;
  readonly slashActive: boolean;
  readonly approvalPending?: boolean;
  readonly overlayOpen?: boolean;
  readonly transcriptMode: 'compact' | 'detailed' | 'raw';
}

export type WorkbenchInputIntent =
  | { readonly type: 'composer.insert'; readonly text: string }
  | { readonly type: 'composer.backspace' }
  | { readonly type: 'turn.submit' }
  | { readonly type: 'turn.queue' }
  | { readonly type: 'slash.submit' }
  | { readonly type: 'turn.cancel' }
  | { readonly type: 'approval.resolve'; readonly decision: 'approved' | 'denied' }
  | { readonly type: 'permission.cycle' }
  | { readonly type: 'overlay.close' }
  | { readonly type: 'transcript.toggle' }
  | { readonly type: 'drawer.toggle'; readonly drawer: 'agents' | 'tasks' }
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
  if (key === 'Shift+Enter') return { type: 'composer.insert', text: '\n' };
  if (key === 'Backspace') return { type: 'composer.backspace' };
  if (key === 'Ctrl+o') return { type: 'transcript.toggle' };
  if (key === 'Ctrl+a') return { type: 'drawer.toggle', drawer: 'agents' };
  if (key === 'Ctrl+t') return { type: 'drawer.toggle', drawer: 'tasks' };
  if (key === 'Shift+Tab') return { type: 'permission.cycle' };
  if (key === 'Escape') {
    return context.turnActive ? { type: 'turn.cancel' } : { type: 'unhandled' };
  }
  if (key === 'Enter') {
    if (context.slashActive) return { type: 'slash.submit' };
    if (context.composerText.trim().length === 0) return { type: 'unhandled' };
    return context.turnActive ? { type: 'turn.queue' } : { type: 'turn.submit' };
  }
  if (key.length === 1 && key.charCodeAt(0) >= 32) {
    return { type: 'composer.insert', text: key };
  }
  return { type: 'unhandled' };
}
