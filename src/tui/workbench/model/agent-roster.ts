export type WorkbenchAgentState =
  | 'queued' | 'starting' | 'thinking' | 'tool_running'
  | 'waiting' | 'verifying' | 'completed' | 'partial'
  | 'failed' | 'cancelling' | 'cancelled';

export interface AgentSummary {
  readonly agentId: string;
  readonly parentAgentId?: string;
  readonly role: string;
  readonly model?: string;
  readonly state: WorkbenchAgentState;
  readonly currentTaskId?: string;
  readonly currentOperation?: string;
  readonly ownedPaths: readonly string[];
  readonly startedAt: number;
  readonly lastProgressAt: number;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number; readonly costUsd: number };
}

export interface AgentRosterSnapshot {
  readonly agents: readonly AgentSummary[];
  readonly active: number;
}
