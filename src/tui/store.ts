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
}

export interface PanelRuntimeEvent {
  id: string;
  action: string;
  source: string;
  summary?: string;
  timestamp?: string;
  graphId?: string;
}

export type TuiPanel = "chat" | "daemon" | "approvals" | "sops" | "policy" | "runtime";

export interface TuiState {
  sessionId: string;
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
  sopsCount?: number;
  policyRulesCount?: number;
  pendingApprovalRecords?: PanelApprovalRecord[];
  daemonTaskRecords?: { id: string; task: string; status: string; sessionId?: string }[];
  recentRuntimeEvents?: PanelRuntimeEvent[];
}

export const PANELS: TuiPanel[] = ["chat", "daemon", "approvals", "sops", "policy", "runtime"];

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

  setDaemonTaskRecords(records: { id: string; task: string; status: string; sessionId?: string }[]): void {
    this.state.daemonTaskRecords = records;
    this.notify();
  }

  setRecentRuntimeEvents(events: PanelRuntimeEvent[]): void {
    this.state.recentRuntimeEvents = events;
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