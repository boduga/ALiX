import { renderDashboardCards } from '../dashboard-renderer.js';
import type { TuiRuntimeSnapshot } from '../runtime-snapshot.js';
import type { DashboardSnapshot } from '../snapshot.js';
import type { PerTabState, TabId } from '../state.js';
import type { ViewInputContext, ViewRenderContext, ViewRenderResult, TuiView } from './types.js';

/**
 * ChatView — default landing tab. Renders the input prompt placeholder
 * followed by a compact 4-panel dashboard (DAEMON, APPROVALS, RUNTIME,
 * SOPS / POLICY) reusing `renderDashboardCards` in `thin` mode.
 *
 * Pure: render(ctx) never mutates ctx; same input → same output.
 * Passive: only reads from ctx.snap — does not import any subsystem.
 */
export class ChatView implements TuiView {
  readonly id: TabId = 'chat';

  render(ctx: ViewRenderContext): ViewRenderResult {
    const rows: string[] = [];
    const { snap, dimensions } = ctx;

    // Header: input prompt placeholder (real buffer will arrive via perTab state).
    rows.push('alix> ');
    rows.push('');

    // Compact dashboard. The renderer's thin mode clamps each card to a
    // minimum of 30 cols and computes right-card padding from the supplied
    // `width`, so we pass the total available columns (not a per-card width)
    // to avoid a negative-pad crash on narrower terminals.
    const cards = renderDashboardCards(
      dashboardSnapshotToRuntime(snap),
      dimensions.columns,
      true /* thin */,
    );
    rows.push(...cards);

    // Footer: busy indicator when session is not Idle.
    if (snap.session && snap.session.phase !== 'Idle') {
      rows.push('');
      rows.push(`busy: ${snap.session.phase}`);
    }

    return { rows };
  }

  handleKey(key: string, _ctx: ViewInputContext): { type: 'handled' } {
    // Real input handling arrives in a later iteration. For now swallow keys.
    void key;
    return { type: 'handled' };
  }

  onActivate(_perTab: PerTabState): void {
    // No-op for now.
  }

  onDeactivate(_perTab: PerTabState): void {
    // No-op for now.
  }
}

/**
 * Adapter: DashboardSnapshot → TuiRuntimeSnapshot shape.
 *
 * DashboardSnapshot exposes nullable subsystem records (daemon, approvals,
 * runtime, sops, policy). renderDashboardCards reads flat fields with
 * non-null defaults. This adapter bridges the two shapes so ChatView can
 * delegate all rendering to the existing renderer without duplicating logic.
 */
function dashboardSnapshotToRuntime(snap: DashboardSnapshot): TuiRuntimeSnapshot {
  return {
    daemonRunning: snap.daemon !== null,
    daemonPid: undefined,
    daemonTasks: { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0, failedOrphaned: 0 },
    daemonTaskRecords: [],
    pendingApprovalsCount: snap.approvals?.totalPending ?? 0,
    pendingApprovalRecords: [],
    resolvedApprovalsCount: snap.approvals?.totalResolved ?? 0,
    resolvedApprovalRecords: [],
    continuationsCount: 0,
    sopsCount: snap.sops?.totalLoaded ?? 0,
    sopItems: (snap.sops?.items ?? []).map((i) => ({
      id: i.id,
      name: i.name,
      version: i.version,
    })),
    policyRulesCount: 0,
    runtimeEventCount: snap.runtime?.totalEventCount ?? 0,
    recentRuntimeEvents: [],
    traceEvents: [],
    traceEventCount: 0,
    daemonHeartbeatAge: -1,
  };
}