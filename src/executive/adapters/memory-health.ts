/**
 * P10.0 — Memory Health (Tier-2 adapter).
 *
 * Pure read. Computes 0-100 score for the memory subsystem.
 * Stub: 100 until Task 3 implements real signal.
 *
 * @module
 */

export interface MemoryHealthReport {
  score: number;
  summary: string;
  topIssues: string[];
}

export interface MemoryHealthOptions {
  cwd: string;
  windowDays?: number;
  generatedAt?: string;
}

export async function buildMemoryHealth(_opts: MemoryHealthOptions): Promise<MemoryHealthReport> {
  return { score: 100, summary: "stub", topIssues: [] };
}