export type WorkflowStatus = 'created' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface WorkflowRun {
  id: string;
  schemaVersion: '1.0';
  sessionId: string;
  goal: string;
  mode: 'interactive' | 'ci' | 'unattended';
  status: WorkflowStatus;
  budget?: { maxTokens?: number; maxCostUsd?: number; maxWallClockMs?: number; maxToolCalls?: number };
  policyContext?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export function createWorkflowRun(input: Pick<WorkflowRun, 'sessionId' | 'goal'> & Partial<WorkflowRun>): WorkflowRun {
  const now = new Date().toISOString();
  return {
    id: input.id ?? `wf_${crypto.randomUUID()}`,
    schemaVersion: '1.0',
    sessionId: input.sessionId,
    goal: input.goal,
    mode: input.mode ?? 'interactive',
    status: 'created',
    budget: input.budget,
    policyContext: input.policyContext,
    createdAt: now,
    updatedAt: now,
  };
}
