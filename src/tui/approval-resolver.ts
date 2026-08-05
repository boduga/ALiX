import type { TabId, TuiAppState } from './state.js';
import type { ApprovalManager } from './approval-manager.js';

export interface ApprovalResolverDeps {
  views: () => TuiAppState['views'];
  activeTab: () => TabId;
  syncTabs: readonly TabId[];
  approvalManager?: ApprovalManager;
  emit: (tab: TabId, text: string) => void;
  refresh: () => Promise<void>;
}

/** Resolve an approval (approve/deny) by delegating to the wired
 *  ApprovalManager — routes through the ApprovalStore + EventLog. */
export class ApprovalResolver {
  constructor(private readonly deps: ApprovalResolverDeps) {}

  async resolve(approvalId: string, status: 'approved' | 'denied'): Promise<void> {
    if (!approvalId) return;
    let originalTool = 'unknown';
    let originalTarget = '';
    let requestedAt = Date.now();
    for (const t of this.deps.syncTabs) {
      const found = this.deps.views()[t]?.pendingApprovals?.find((a) => a.id === approvalId);
      if (found) {
        originalTool = found.toolName;
        originalTarget = found.target;
        requestedAt = found.requestedAt;
        break;
      }
    }
    const mgr = this.deps.approvalManager;
    if (!mgr) {
      this.deps.emit(this.deps.activeTab(), `[approval] no ApprovalManager wired for ${status} ${approvalId}`);
      await this.deps.refresh();
      return;
    }
    try {
      const result = await mgr.tryHandleCommand(status === 'approved' ? `/approve ${approvalId}` : `/deny ${approvalId}`);
      const summary = result.handled ? result.message : `${status} ${approvalId} (no handler)`;
      this.deps.emit(this.deps.activeTab(), `[approval:${status}] ${summary}`);
      for (const t of this.deps.syncTabs) {
        const tab = this.deps.views()[t];
        if (!tab) continue;
        tab.resolvedApprovals.unshift({ id: approvalId, toolName: originalTool, target: originalTarget, status, requestedAt, resolvedAt: Date.now() });
        if (tab.resolvedApprovals.length > 200) tab.resolvedApprovals.length = 200;
      }
    } catch (err) {
      this.deps.emit(this.deps.activeTab(), `[approval:${status}] error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await this.deps.refresh();
    }
  }
}
