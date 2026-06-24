/**
 * P10.0 — Tool Health (Tier-2 adapter).
 *
 * Pure read. Computes 0-100 score for the tools subsystem.
 * Stub: 100 until Task 3 implements real signal.
 *
 * @module
 */

export interface ToolHealthReport {
  score: number;
  summary: string;
  topIssues: string[];
}

export interface ToolHealthOptions {
  cwd: string;
  windowDays?: number;
  generatedAt?: string;
}

export async function buildToolHealth(_opts: ToolHealthOptions): Promise<ToolHealthReport> {
  return { score: 100, summary: "stub", topIssues: [] };
}