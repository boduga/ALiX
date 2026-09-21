import type { WorkbenchInspectableItem } from './artifact-inspection.js';

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

export interface WorkbenchArtifactScope {
  readonly runId?: string;
  readonly agentId?: string;
  readonly taskId?: string;
}

/** Keep artifact correlation filters strict whenever the operator selects a scope. */
export function visibleArtifacts(
  entries: readonly WorkbenchInspectableItem[],
  scope: WorkbenchArtifactScope,
): WorkbenchInspectableItem[] {
  return entries.filter((entry) =>
    (!scope.runId || entry.coordinationRunId === scope.runId) &&
    (!scope.agentId || entry.agentId === scope.agentId) &&
    (!scope.taskId || entry.taskId === scope.taskId));
}

export function artifactItemsFrom(
  snapshot?: { readonly runtime?: { readonly artifacts?: { readonly items: readonly WorkbenchInspectableItem[] } | null } | null } | null,
): readonly WorkbenchInspectableItem[] {
  return snapshot?.runtime?.artifacts?.items ?? [];
}

export function approvalVisibleTo(
  approval: { readonly agentId?: string },
  agentId?: string,
): boolean {
  return !agentId || !approval.agentId || approval.agentId === agentId;
}
