import type { DashboardSnapshot } from '../snapshot.js';
import type { PerTabState, TabId } from '../state.js';
import type {
  OperatorViewState, PanelViewModel, PanelItem, InputViewModel, StatusBarViewModel, TabInfo,
  SidebarPanelView, ViewContent,
} from './types.js';

const TAB_ORDER: readonly TabId[] = ['chat', 'agent', 'daemon', 'approvals', 'runtime', 'sops', 'policy'];
const PHASE_DEFS: ReadonlyArray<{ readonly phase: string; readonly label: string }> = [
  { phase: 'Understanding', label: 'UNDERSTANDING' },
  { phase: 'Planning', label: 'PLANNING' },
  { phase: 'Executing', label: 'EXECUTING' },
  { phase: 'Verifying', label: 'VERIFYING' },
  { phase: 'Summarizing', label: 'SUMMARIZING' },
];

export class ViewModelBuilder {
  build(snapshot: DashboardSnapshot, state: PerTabState, activeTab: TabId): OperatorViewState {
    const daemonPanel = this.daemonPanel(snapshot);
    const approvalsPanel = this.approvalsPanel(snapshot, state);
    const runtimePanel = this.runtimePanel(snapshot);
    const sopsPanel = this.sopsPolicyPanel(snapshot, state);

    const toSidebarView = (p: PanelViewModel): SidebarPanelView => ({
      kind: p.kind, title: p.title, visible: p.visible, loading: false,
      items: p.items, scrollOffset: p.scrollOffset,
      focused: p.focused, totalItems: p.totalItems,
    });

    return {
      tabs: TAB_ORDER.map((id) => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1), active: id === activeTab })),
      activeTab,
      panels: [daemonPanel, approvalsPanel, runtimePanel, sopsPanel],
      input: this.buildInput(activeTab, state),
      statusBar: this.buildStatusBar(snapshot, activeTab),
      sessionMetadata: snapshot.session ? { version: snapshot.session.version, mode: snapshot.session.mode, phase: snapshot.session.phase } : null,
      daemonStatus: snapshot.daemon ? { running: true, cpuPercent: snapshot.daemon.cpuPercent, memoryRssBytes: snapshot.daemon.memoryRssBytes, memoryTotalBytes: snapshot.daemon.memoryTotalBytes, diskUsedBytes: snapshot.daemon.diskUsedBytes, diskTotalBytes: snapshot.daemon.diskTotalBytes, pid: snapshot.daemon.pid, uptimeSeconds: snapshot.daemon.uptimeSeconds } : null,
      viewContent: {
        sidebarPanels: {
          daemon: toSidebarView(daemonPanel),
          approvals: toSidebarView(approvalsPanel),
          runtime: toSidebarView(runtimePanel),
          sops_policy: toSidebarView(sopsPanel),
        },
      },
    };
  }

  private daemonPanel(snap: DashboardSnapshot): PanelViewModel {
    const d = snap.daemon;
    const items: PanelItem[] = d
      ? [
          { id: 'pid', title: `PID: ${d.pid ?? '—'}`, status: 'info', subtitle: '' },
          { id: 'uptime', title: `Uptime: ${fmtUptime(d.uptimeSeconds)}`, status: 'info', subtitle: '' },
          { id: 'version', title: `Version: ${snap.session?.version ?? '—'}`, status: 'info', subtitle: '' },
          { id: 'cpu', title: `CPU: ${fmtPct(d.cpuPercent / 100)}`, status: d.cpuPercent > 80 ? 'warning' : 'info', subtitle: '' },
          { id: 'mem', title: `MEM: ${fmtBytes(d.memoryRssBytes)} / ${fmtBytes(d.memoryTotalBytes)}`, status: 'info', subtitle: '' },
        ]
      : [{ id: 'stopped', title: '○ not running', status: 'error', subtitle: '' }];
    return { id: 'daemon', title: 'DAEMON', items, scrollOffset: 0, focused: false, totalItems: items.length, visible: true, kind: 'daemon' };
  }

  private approvalsPanel(snap: DashboardSnapshot, state: PerTabState): PanelViewModel {
    const now = Date.now();
    const items: PanelItem[] = [
      ...(snap.approvals?.pending ?? []).slice().sort((a, b) => b.requestedAt - a.requestedAt).map((a) => ({ id: a.id, title: a.toolName, subtitle: a.targetPath, status: 'pending' as const, rightLabel: fmtRelative(a.requestedAt, now) })),
      ...(snap.approvals?.recentlyResolved ?? []).slice().sort((a, b) => b.requestedAt - a.requestedAt).map((a) => ({ id: a.id, title: a.toolName, subtitle: a.targetPath, status: 'resolved' as const, statusLabel: '✓ approved', rightLabel: fmtRelative(a.requestedAt, now) })),
    ];
    return { id: 'approvals', title: 'APPROVALS', items, scrollOffset: state.panelScrollOffsets.approvals, focused: state.panelFocus === 'approvals', totalItems: items.length, visible: true, kind: 'approvals' };
  }

  private runtimePanel(snap: DashboardSnapshot): PanelViewModel {
    const wf = snap.runtime?.workflow;
    const events = snap.runtime?.totalEventCount ?? 0;
    const items: PanelItem[] = wf
      ? [{ id: 'step', title: `Step ${wf.currentStep} / ${wf.totalSteps}`, status: 'active', subtitle: '', rightLabel: `${events} events` }, { id: 'name', title: wf.name, status: 'info', subtitle: '' }]
      : [{ id: 'idle', title: events > 0 ? `${events} events` : '○ no active workflow', status: 'info', subtitle: '' }];
    return { id: 'runtime', title: 'RUNTIME', items, scrollOffset: 0, focused: false, totalItems: items.length, visible: true, kind: 'runtime' };
  }

  private sopsPolicyPanel(snap: DashboardSnapshot, state: PerTabState): PanelViewModel {
    const sopItems: PanelItem[] = (snap.sops?.items ?? []).map((s) => ({ id: s.id, title: s.name, subtitle: s.version, status: 'info' as const }));
    const policyItems: PanelItem[] = snap.policy ? [{ id: 'mode', title: `Policy: ${snap.policy.enforcementMode}`, status: 'info', subtitle: '', rightLabel: `${snap.policy.recentViolationCount} violations` }] : [];
    return { id: 'sops_policy', title: 'SOPS & POLICY', items: [...sopItems, ...policyItems], scrollOffset: state.panelScrollOffsets.sops, focused: state.panelFocus === 'sops', totalItems: sopItems.length + policyItems.length, visible: true, kind: 'sops_policy' };
  }

  private buildInput(activeTab: TabId, state: PerTabState): InputViewModel {
    if (activeTab === 'chat' || activeTab === 'agent') {
      return { buffer: state.inputBuffer, prompt: activeTab === 'chat' ? 'alix> ' : 'alix-agent> ', cursorPos: state.inputBuffer.length, activeTab, mode: activeTab };
    }
    return { buffer: '', prompt: '', cursorPos: 0, activeTab, mode: 'neutral' };
  }

  private buildStatusBar(snap: DashboardSnapshot, activeTab: TabId): StatusBarViewModel {
    const activePhase = snap.session?.phase ?? 'Idle';
    const phaseRadios = PHASE_DEFS.map((p) => ({ phase: p.phase, active: p.phase === activePhase, label: p.label }));
    return { phaseRadios, fields: [
      { label: 'DAEMON', value: snap.daemon ? '● running' : '○ stopped' },
      { label: 'EVENTS', value: (snap.runtime?.totalEventCount ?? 0).toLocaleString('en-US') },
      { label: 'SOPS', value: String(snap.sops?.totalLoaded ?? 0) },
      { label: 'RULES', value: String(snap.policy?.rules.length ?? 0) },
    ], activeTab };
  }
}

function fmtUptime(s: number): string {
  const t = Math.max(0, Math.floor(s));
  return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
function fmtPct(f: number): string { return f < 0 || !Number.isFinite(f) ? '(?)%' : `${Math.max(0, Math.min(100, f * 100)).toFixed(1)}%`; }
function fmtBytes(b: number): string { if (b < 1024) return `${b}B`; if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`; return `${(b / (1024 * 1024)).toFixed(1)}MB`; }
function fmtRelative(ts: number, now: number): string { const s = Math.max(0, Math.floor((now - ts) / 1000)); if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.floor(s / 60)}m ago`; return `${Math.floor(s / 3600)}h ago`; }