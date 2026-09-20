/** Pure selectors shared by Workbench controllers and painters. */
export function coordinationRunIds(
  entries: readonly { readonly coordinationRunId?: string }[],
): string[] {
  return [...new Set(entries
    .map((entry) => entry.coordinationRunId)
    .filter((id): id is string => Boolean(id)))].sort();
}

export function visibleForRun<T extends { readonly coordinationRunId?: string }>(
  entries: readonly T[],
  runId?: string,
): T[] {
  return runId ? entries.filter((entry) => entry.coordinationRunId === runId) : [...entries];
}

export function approvalVisibleTo(
  approval: { readonly agentId?: string },
  agentId?: string,
): boolean {
  return !agentId || !approval.agentId || approval.agentId === agentId;
}
