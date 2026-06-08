import { randomUUID } from "node:crypto";

export type WorkflowStatus = "created" | "running" | "completed" | "failed" | "cancelled";
export type WorkflowMode = "interactive" | "ci" | "unattended";

export interface WorkflowRun {
  id: string;
  schemaVersion: "1.0";
  sessionId: string;
  goal: string;
  mode: WorkflowMode;
  status: WorkflowStatus;
  budget?: { maxTokens?: number; maxCostUsd?: number; maxWallClockMs?: number; maxToolCalls?: number };
  policyContext?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export function createWorkflowRun(sessionId: string, goal: string, mode?: WorkflowMode): WorkflowRun {
  const now = new Date().toISOString();
  return {
    id: `wf_${randomUUID()}`,
    schemaVersion: "1.0",
    sessionId,
    goal,
    mode: mode ?? "interactive",
    status: "created",
    createdAt: now,
    updatedAt: now,
  };
}

export function transitionWorkflowStatus(run: WorkflowRun, status: WorkflowStatus): WorkflowRun {
  return { ...run, status, updatedAt: new Date().toISOString() };
}
