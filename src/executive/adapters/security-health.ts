/**
 * P10.0 — Security Health (Tier-2 adapter).
 *
 * Pure read. Computes 0-100 score for the security subsystem.
 * Stub: 100 until Task 3 implements real signal.
 *
 * @module
 */

export interface SecurityHealthReport {
  score: number;
  summary: string;
  topIssues: string[];
}

export interface SecurityHealthOptions {
  cwd: string;
  windowDays?: number;
  generatedAt?: string;
}

export async function buildSecurityHealth(_opts: SecurityHealthOptions): Promise<SecurityHealthReport> {
  return { score: 100, summary: "stub", topIssues: [] };
}