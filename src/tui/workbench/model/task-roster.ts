export type WorkbenchTaskState = 'queued' | 'assigned' | 'running' | 'blocked' | 'completed' | 'partial' | 'failed' | 'cancelled';

export interface TaskSummary {
  readonly taskId: string;
  readonly agentId?: string;
  readonly coordinationRunId?: string;
  readonly assignedAgentId?: string;
  readonly title: string;
  readonly state: WorkbenchTaskState;
  readonly currentOperation?: string;
  readonly blockReason?: string;
  readonly ownedPaths: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface TaskRosterSnapshot {
  readonly tasks: readonly TaskSummary[];
  readonly queued: number;
  readonly running: number;
}
