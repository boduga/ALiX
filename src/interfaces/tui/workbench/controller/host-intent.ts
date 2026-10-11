import type { WorkbenchStore } from '../app/workbench-store.js';
import type { WorkbenchInputIntent } from '../input/input-router.js';

export interface WorkbenchHostPorts {
  repaint(): void;
  syncComposer(): void;
  overlayScrollLimit(): number;
  submitCoordination(): void;
  openBuiltinSurface(text: string): boolean;
  clearSlashHint(): void;
  submitSlash(): void;
  hasSnapshot(): boolean;
  reportSubmitUnavailable(): void;
  setCancelArmed(armed: boolean): void;
  setPinnedBottom(value: boolean): void;
  anchorTranscriptBottom(): void;
  emitUserTimeline(text: string): void;
  submitTurn(text: string): void;
  nextQueuedId(): string;
  approvalTarget(): { readonly id: string } | undefined;
  isApprovalDecisionPending(id: string): boolean;
  markApprovalDecision(id: string): void;
  unmarkApprovalDecision(id: string): void;
  resolveApproval(id: string, decision: 'approved' | 'denied', onSettled: (handled: boolean) => void): void;
  cyclePermission(): void;
  refresh(): void;
  cancelActiveTurn(): boolean;
}

export function applyWorkbenchHostIntent(store: WorkbenchStore, intent: WorkbenchInputIntent, ports: WorkbenchHostPorts): boolean {
  switch (intent.type) {
    case 'overlay.scroll': {
      const offset = store.snapshot().overlayScrollOffset;
      const limit = ports.overlayScrollLimit();
      const next = Math.max(0, Math.min(limit, Math.min(limit, offset) + intent.delta));
      store.dispatch({ type: 'overlay.scroll', delta: next - offset });
      ports.repaint();
      return true;
    }
    case 'coordination.submit':
      ports.submitCoordination();
      return true;
    case 'slash.submit': {
      if (ports.openBuiltinSurface(store.snapshot().composer.text)) {
        store.dispatch({ type: 'composer.clear' });
        ports.syncComposer();
        ports.clearSlashHint();
        ports.repaint();
        return true;
      }
      ports.submitSlash();
      ports.repaint();
      return true;
    }
    case 'turn.submit': {
      if (!ports.hasSnapshot()) {
        ports.reportSubmitUnavailable();
        ports.repaint();
        return true;
      }
      const text = store.snapshot().composer.text;
      store.dispatch({ type: 'composer.clear' });
      ports.syncComposer();
      ports.setCancelArmed(false);
      ports.setPinnedBottom(true);
      ports.anchorTranscriptBottom();
      ports.emitUserTimeline(text);
      ports.submitTurn(text);
      ports.repaint();
      return true;
    }
    case 'turn.queue': {
      const text = store.snapshot().composer.text;
      store.dispatch({ type: 'queue.add', message: { id: ports.nextQueuedId(), text, createdAt: Date.now() } });
      store.dispatch({ type: 'composer.clear' });
      ports.syncComposer();
      ports.repaint();
      return true;
    }
    case 'approval.resolve': {
      const target = ports.approvalTarget();
      if (!target) return false;
      if (ports.isApprovalDecisionPending(target.id)) return true;
      ports.markApprovalDecision(target.id);
      ports.resolveApproval(target.id, intent.decision, (handled) => {
        if (!handled) ports.unmarkApprovalDecision(target.id);
        ports.repaint();
      });
      ports.repaint();
      return true;
    }
    case 'permission.cycle':
      ports.cyclePermission();
      ports.refresh();
      return true;
    case 'turn.cancel':
      if (ports.cancelActiveTurn()) {
        ports.repaint();
        return true;
      }
      return false;
    default:
      return false;
  }
}
