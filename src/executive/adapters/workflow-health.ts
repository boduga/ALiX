/**
 * P10.0 — Workflow Health (Tier-2 adapter).
 *
 * Pure read. Computes 0-100 score for the workflow subsystem.
 * Stub: 100 until Task 3 implements real signal.
 *
 * @module
 */

export interface WorkflowHealthReport {
  score: number;
  summary: string;
  topIssues: string[];
}

export interface WorkflowHealthOptions {
  cwd: string;
  windowDays?: number;
  generatedAt?: string;
}

export async function buildWorkflowHealth(_opts: WorkflowHealthOptions): Promise<WorkflowHealthReport> {
  return { score: 100, summary: "stub", topIssues: [] };
}