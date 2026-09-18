export type WorkbenchAgentState =
  | 'queued' | 'starting' | 'thinking' | 'tool_running'
  | 'waiting' | 'waiting_approval' | 'waiting_dependency' | 'verifying' | 'completed' | 'partial'
  | 'failed' | 'cancelling' | 'cancelled';

export interface AgentRosterLiveness {
  readonly state: 'healthy' | 'warning' | 'stalled';
  readonly idleMs: number;
}

export interface ActiveToolSummary {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly startedAt: number;
  readonly lastProgressAt: number;
  readonly elapsedMs: number;
}

export interface AgentUsageSummary {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheTokens?: number;
  readonly totalTokens?: number;
  readonly contextWindowTokens?: number;
  readonly costUsd?: number;
  readonly provider?: string;
  readonly costSource?: string;
}

export interface AgentSummary {
  readonly agentId: string;
  readonly parentAgentId?: string;
  readonly role: string;
  readonly model?: string;
  readonly state: WorkbenchAgentState;
  readonly currentTaskId?: string;
  readonly currentOperation?: string;
  readonly activeTool?: ActiveToolSummary;
  readonly ownedPaths: readonly string[];
  readonly startedAt: number;
  readonly lastProgressAt: number;
  readonly liveness?: AgentRosterLiveness;
  readonly usage: AgentUsageSummary;
}

export interface AgentRosterSnapshot {
  readonly agents: readonly AgentSummary[];
  readonly active: number;
  readonly totals: {
    readonly agents: number;
    readonly running: number;
    readonly waitingApproval: number;
    readonly stalled: number;
    readonly knownTokens?: number;
    readonly tokenCoverage: number;
    readonly knownCostUsd?: number;
    readonly costCoverage: number;
  };
}
