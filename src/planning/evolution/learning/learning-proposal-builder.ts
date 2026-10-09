import type { LearningFinding, LearningProposal } from "./contracts/learning-contract.js";

/**
 * Construct a LearningProposal from findings.
 *
 * Pure function. Deterministic proposalId derived from sorted findingIds +
 * timestamp (so re-running with identical inputs yields identical proposalIds;
 * re-running with the same findings at a later `now` yields a different
 * proposalId, which is the desired behavior — each engine run is a distinct
 * proposal artifact).
 */
export function buildLearningProposal(
  findings: ReadonlyArray<LearningFinding>,
  now: string,
): LearningProposal {
  const sorted = [...findings].sort((a, b) => a.findingId.localeCompare(b.findingId));
  const proposalId = `a8:${now}:${sorted.map((f) => f.findingId).join("|")}`;
  return { proposalId, generatedAt: now, findings: sorted };
}