import type { TraceEvent, TraceEventFilter, TraceSelectionState, TraceDetailMode } from "../runtime/trace-events.js";

export type AgentState = "idle" | "understanding" | "planning" | "executing" | "verifying" | "repairing" | "summarizing" | "done" | "error";
export type SubagentStatus = "pending" | "running" | "completed" | "failed";

export interface SubagentNode {
  id: string;
  role: "explorer" | "reviewer" | "test_investigator" | "docs_researcher" | "worker";
  task: string;
  status: SubagentStatus;
  findings?: string[];
  startedAt?: number;
  endedAt?: number;
}

export interface TokenBudget {
  used: number;
  max: number;
  files: number;
}

export interface Diff {
  path: string;
  before: string;
  after: string;
  timestamp: number;
}

export interface ApprovalRequest {
  tool: string;
  command?: string;
  path?: string;
  reason: string;
}

export interface DaemonTaskSummary {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  failedOrphaned: number;
}

export interface PanelApprovalRecord {
  id: string;
  capability?: string;
  riskLevel?: string;
  reason: string;
  createdAt: string;
  status?: string;     // "approved" | "denied" — for resolved records
  decidedAt?: string;  // when the approval was resolved
}

export interface PanelRuntimeEvent {
  id: string;
  action: string;
  source: string;
  summary?: string;
  timestamp?: string;
  graphId?: string;
}

export type TuiPanel = "chat" | "daemon" | "approvals" | "sops" | "policy" | "runtime" | "trace" | "replays";

export interface TuiState {
  sessionId: string;
  sessionDir?: string;
  agentState: AgentState;
  agentReasoning: string;
  subagents: SubagentNode[];
  tokenBudget: TokenBudget;
  diffs: Diff[];
  pendingApproval: ApprovalRequest | null;
  inputMode: "command" | "multi-line" | "confirm";
  activePanel: TuiPanel;
  daemonTasks?: DaemonTaskSummary;
  daemonRunning?: boolean;
  runtimeEventCount?: number;
  pendingApprovalsCount?: number;
  resolvedApprovalsCount?: number;          // NEW
  pendingApprovalRecords?: PanelApprovalRecord[];
  resolvedApprovalRecords?: PanelApprovalRecord[];  // NEW
  continuationsCount?: number;             // NEW
  sopsCount?: number;
  policyRulesCount?: number;
  daemonTaskRecords?: { id: string; task: string; status: string; sessionId?: string }[];
  recentRuntimeEvents?: PanelRuntimeEvent[];
  daemonPid?: number;
  daemonHeartbeatAge?: number;
  sopItems?: { id: string; name: string; version?: string; nodeCount?: number; tags?: string[] }[];
  showDashboard?: boolean;
  workspaceName?: string;
  workspacePath?: string;
  recentWorkspaces?: { path: string; name: string; lastUsed: string; taskCount: number; status: string }[];
  traceEvents: TraceEvent[];
  traceEventCount: number;
  traceFilter: TraceEventFilter;
  traceSelection: TraceSelectionState;
  replayResult?: import("../runtime/replay-executor.js").ReplayResult | null;
  replayExecuting?: boolean;
  replayMode?: import("../runtime/replay-plan.js").ReplayMode;
  replayStatus?: import("../runtime/replay-status-index.js").ReplayStatus;
  replayIndexData?: import("../runtime/replay-status-index.js").ReplayStatusIndexData;
  replayLockStates?: Record<string, boolean>;
  selectedReplayIds: string[];
}

export const PANELS: TuiPanel[] = ["chat", "daemon", "approvals", "sops", "policy", "runtime", "trace", "replays"];

const VALID_STATES: AgentState[] = ["idle", "understanding", "planning", "executing", "verifying", "repairing", "summarizing", "done", "error"];

type Listener = () => void;

export class TuiStore {
  private state: TuiState;
  private listeners: Set<Listener> = new Set();

  constructor(initialState?: Partial<TuiState>) {
    this.state = {
      sessionId: initialState?.sessionId ?? "",
      agentState: initialState?.agentState ?? "idle",
      agentReasoning: initialState?.agentReasoning ?? "",
      subagents: initialState?.subagents ?? [],
      tokenBudget: initialState?.tokenBudget ?? { used: 0, max: 62000, files: 0 },
      diffs: initialState?.diffs ?? [],
      pendingApproval: initialState?.pendingApproval ?? null,
      inputMode: initialState?.inputMode ?? "command",
      activePanel: initialState?.activePanel ?? "chat",
      showDashboard: initialState?.showDashboard ?? false,
      traceEvents: initialState?.traceEvents ?? [],
      traceEventCount: initialState?.traceEventCount ?? 0,
      traceFilter: initialState?.traceFilter ?? "all",
      traceSelection: initialState?.traceSelection ?? { selectedIndex: -1, detailOpen: false, detailMode: "summary" },
      replayResult: null,
      replayExecuting: false,
      replayMode: "dry-run",
      replayStatus: undefined,
      replayIndexData: undefined,
      replayLockStates: undefined,
      selectedReplayIds: [],
    };
  }

  getState(): TuiState {
    return this.state;
  }

  setPanel(panel: TuiPanel): void {
    this.state.activePanel = panel;
    this.notify();
  }

  cyclePanel(direction: 1 | -1): void {
    const idx = PANELS.indexOf(this.state.activePanel);
    const next = (idx + direction + PANELS.length) % PANELS.length;
    this.state.activePanel = PANELS[next];
    this.notify();
  }

  setSessionId(sessionId: string): void {
    this.state.sessionId = sessionId;
    this.notify();
  }

  setSessionDir(dir: string): void {
    this.state.sessionDir = dir;
    this.notify();
  }

  setAgentState(state: AgentState): void {
    if (!VALID_STATES.includes(state)) {
      throw new Error(`Invalid agent state: ${state}`);
    }
    this.state.agentState = state;
    this.notify();
  }

  setAgentReasoning(reasoning: string): void {
    this.state.agentReasoning = reasoning;
    this.notify();
  }

  setTokenBudget(budget: Partial<TokenBudget>): void {
    this.state.tokenBudget = { ...this.state.tokenBudget, ...budget };
    this.notify();
  }

  addSubagent(subagent: SubagentNode): void {
    this.state.subagents.push(subagent);
    this.notify();
  }

  updateSubagent(id: string, updates: Partial<SubagentNode>): void {
    const idx = this.state.subagents.findIndex(s => s.id === id);
    if (idx !== -1) {
      this.state.subagents[idx] = { ...this.state.subagents[idx], ...updates };
      this.notify();
    }
  }

  removeSubagent(id: string): void {
    this.state.subagents = this.state.subagents.filter(s => s.id !== id);
    this.notify();
  }

  addDiff(diff: Diff): void {
    this.state.diffs.push(diff);
    this.notify();
  }

  setPendingApproval(approval: ApprovalRequest): void {
    this.state.pendingApproval = approval;
    this.notify();
  }

  clearPendingApproval(): void {
    this.state.pendingApproval = null;
    this.notify();
  }

  setInputMode(mode: TuiState["inputMode"]): void {
    this.state.inputMode = mode;
    this.notify();
  }

  setDaemonRunning(running: boolean): void {
    this.state.daemonRunning = running;
    this.notify();
  }

  setDaemonTaskSummary(summary: DaemonTaskSummary): void {
    this.state.daemonTasks = summary;
    this.notify();
  }

  setRuntimeEventCount(count: number): void {
    this.state.runtimeEventCount = count;
    this.notify();
  }

  setPendingApprovalsCount(count: number): void {
    this.state.pendingApprovalsCount = count;
    this.notify();
  }

  setSopsCount(count: number): void {
    this.state.sopsCount = count;
    this.notify();
  }

  setPolicyRulesCount(count: number): void {
    this.state.policyRulesCount = count;
    this.notify();
  }

  setPendingApprovalRecords(records: PanelApprovalRecord[]): void {
    this.state.pendingApprovalRecords = records;
    this.notify();
  }

  setResolvedApprovalsCount(count: number): void {
    this.state.resolvedApprovalsCount = count;
    this.notify();
  }

  setResolvedApprovalRecords(records: PanelApprovalRecord[]): void {
    this.state.resolvedApprovalRecords = records;
    this.notify();
  }

  setContinuationsCount(count: number): void {
    this.state.continuationsCount = count;
    this.notify();
  }

  setDaemonTaskRecords(records: { id: string; task: string; status: string; sessionId?: string }[]): void {
    this.state.daemonTaskRecords = records;
    this.notify();
  }

  setRecentRuntimeEvents(events: PanelRuntimeEvent[]): void {
    this.state.recentRuntimeEvents = events;
    this.notify();
  }

  setDaemonPid(pid?: number): void {
    this.state.daemonPid = pid;
    this.notify();
  }

  setDaemonHeartbeatAge(age: number): void {
    this.state.daemonHeartbeatAge = age;
    this.notify();
  }

  setSopItems(items: { id: string; name: string; version?: string; nodeCount?: number; tags?: string[] }[]): void {
    this.state.sopItems = items;
    this.notify();
  }

  setShowDashboard(show: boolean): void {
    this.state.showDashboard = show;
    this.notify();
  }

  toggleDashboard(): void {
    this.state.showDashboard = !this.state.showDashboard;
    this.notify();
  }

  setWorkspaceInfo(name: string, path: string): void {
    this.state.workspaceName = name;
    this.state.workspacePath = path;
    this.notify();
  }

  setRecentWorkspaces(workspaces: { path: string; name: string; lastUsed: string; taskCount: number; status: string }[]): void {
    this.state.recentWorkspaces = workspaces;
    this.notify();
  }

  // ── Trace event selectors/mutators ──

  getFilteredTraceEvents(): TraceEvent[] {
    if (this.state.traceFilter === "all") return this.state.traceEvents;
    return this.state.traceEvents.filter(e => e.sourceType === this.state.traceFilter);
  }

  getLatestTraceEvents(limit: number): TraceEvent[] {
    const events = this.getFilteredTraceEvents();
    return events.slice(-limit).reverse();
  }

  setTraceEventCount(count: number): void {
    this.state.traceEventCount = count;
    this.notify();
  }

  setTraceEvents(events: TraceEvent[]): void {
    const prevSelectedId = this.state.traceSelection.selectedTraceId;
    this.state.traceEvents = events;
    this.state.traceEventCount = events.length;
    // Preserve selection if selected event still exists
    if (prevSelectedId) {
      const idx = events.findIndex(e => e.id === prevSelectedId);
      if (idx >= 0) {
        this.state.traceSelection.selectedIndex = idx;
      } else {
        this.state.traceSelection.selectedIndex = -1;
        this.state.traceSelection.selectedTraceId = undefined;
        this.state.traceSelection.detailOpen = false;
      }
    }
    this.notify();
  }

  appendTraceEvent(event: TraceEvent): void {
    this.state.traceEvents.push(event);
    this.notify();
  }

  // ── Trace selection ──

  getSelectedTraceEvent(): TraceEvent | undefined {
    const events = this.getFilteredTraceEvents();
    const idx = this.state.traceSelection.selectedIndex;
    if (idx < 0 || idx >= events.length) return undefined;
    return events[idx];
  }

  selectNextTraceEvent(): void {
    const events = this.getFilteredTraceEvents();
    if (events.length === 0) return;
    const current = this.state.traceSelection.selectedIndex;
    const next = Math.min(current + 1, events.length - 1);
    this.state.traceSelection.selectedIndex = next;
    this.state.traceSelection.selectedTraceId = events[next]?.id;
    this.notify();
  }

  selectPreviousTraceEvent(): void {
    const events = this.getFilteredTraceEvents();
    if (events.length === 0) return;
    const current = this.state.traceSelection.selectedIndex;
    const prev = Math.max(current - 1, 0);
    this.state.traceSelection.selectedIndex = prev;
    this.state.traceSelection.selectedTraceId = events[prev]?.id;
    this.notify();
  }

  toggleTraceDetail(): void {
    this.state.traceSelection.detailOpen = !this.state.traceSelection.detailOpen;
    this.notify();
  }

  closeTraceDetail(): void {
    this.state.traceSelection.detailOpen = false;
    this.notify();
  }

  setTraceDetailMode(mode: TraceDetailMode): void {
    this.state.traceSelection.detailMode = mode;
    this.notify();
  }

  getTraceDetailMode(): TraceDetailMode {
    return this.state.traceSelection.detailMode;
  }

  getTraceSelection(): TraceSelectionState {
    return this.state.traceSelection;
  }

  setTraceFilter(filter: TraceEventFilter): void {
    this.state.traceFilter = filter;
    this.state.traceSelection.selectedIndex = -1;
    this.state.traceSelection.selectedTraceId = undefined;
    this.state.traceSelection.detailOpen = false;
    this.notify();
  }

  setReplayResult(result: any): void {
    this.state.replayResult = result;
    this.notify();
  }

  setReplayStatus(status: import("../runtime/replay-status-index.js").ReplayStatus | undefined): void {
    this.state.replayStatus = status;
    this.notify();
  }

  setReplayIndexData(data: import("../runtime/replay-status-index.js").ReplayStatusIndexData | undefined): void {
    this.state.replayIndexData = data;
    this.notify();
  }

  setReplayLockStates(states: Record<string, boolean> | undefined): void {
    this.state.replayLockStates = states;
    this.notify();
  }

  setSelectedReplayIds(ids: string[]): void {
    this.state.selectedReplayIds = ids;
    this.notify();
  }

  addSelectedReplayId(id: string): void {
    if (!this.state.selectedReplayIds.includes(id)) {
      this.state.selectedReplayIds.push(id);
      this.notify();
    }
  }

  removeSelectedReplayId(id: string): void {
    this.state.selectedReplayIds = this.state.selectedReplayIds.filter(x => x !== id);
    this.notify();
  }

  clearSelectedReplayIds(): void {
    this.state.selectedReplayIds = [];
    this.notify();
  }

  setReplayExecuting(v: boolean): void {
    this.state.replayExecuting = v;
    this.notify();
  }

  setReplayMode(mode: any): void {
    this.state.replayMode = mode;
    this.notify();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach(listener => listener());
  }
}

export function createTuiStore(initialState?: Partial<TuiState>): TuiStore {
  return new TuiStore(initialState);
}