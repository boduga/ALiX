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
 *  ApprovalManager — routes through the ApprovalStore + EventLog. Stateless
 *  over the constructed deps, so it is a factory (per CONTRIBUTING "no
 *  classes where functions suffice") rather than a class. */
export interface ApprovalResolver {
  resolve(approvalId: string, status: 'approved' | 'denied'): Promise<void>;
}

export function createApprovalResolver(deps: ApprovalResolverDeps): ApprovalResolver {
  const resolve = async (approvalId: string, status: 'approved' | 'denied'): Promise<void> => {
    if (!approvalId) return;
    let originalTool = 'unknown';
    let originalTarget = '';
    let requestedAt = Date.now();
    for (const t of deps.syncTabs) {
      const found = deps.views()[t]?.pendingApprovals?.find((a) => a.id === approvalId);
      if (found) {
        originalTool = found.toolName;
        originalTarget = found.target;
        requestedAt = found.requestedAt;
        break;
      }
    }
    const mgr = deps.approvalManager;
    if (!mgr) {
      deps.emit(deps.activeTab(), `[approval] no ApprovalManager wired for ${status} ${approvalId}`);
      await deps.refresh();
      return;
    }
    try {
      const result = await mgr.tryHandleCommand(status === 'approved' ? `/approve ${approvalId}` : `/deny ${approvalId}`);
      const summary = result.handled ? result.message : `${status} ${approvalId} (no handler)`;
      deps.emit(deps.activeTab(), `[approval:${status}] ${summary}`);
      for (const t of deps.syncTabs) {
        const tab = deps.views()[t];
        if (!tab) continue;
        tab.resolvedApprovals.unshift({ id: approvalId, toolName: originalTool, target: originalTarget, status, requestedAt, resolvedAt: Date.now() });
        if (tab.resolvedApprovals.length > 200) tab.resolvedApprovals.length = 200;
      }
    } catch (err) {
      deps.emit(deps.activeTab(), `[approval:${status}] error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await deps.refresh();
    }
  };

  return { resolve };
}
