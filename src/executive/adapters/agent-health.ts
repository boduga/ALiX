/**
 * P10.0 — Agent Health (Tier-2 adapter).
 *
 * Pure read. Computes 0-100 score for the agents subsystem.
 * Stub: 100 until Task 3 implements real signal.
 *
 * @module
 */

export interface AgentHealthReport {
  score: number;
  summary: string;
  topIssues: string[];
}

export interface AgentHealthOptions {
  cwd: string;
  windowDays?: number;
  generatedAt?: string;
}

export async function buildAgentHealth(_opts: AgentHealthOptions): Promise<AgentHealthReport> {
  return { score: 100, summary: "stub", topIssues: [] };
}