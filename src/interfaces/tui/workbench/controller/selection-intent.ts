import type { AgentSummary } from '../model/agent-roster.js';
import type { WorkbenchInspectableItem } from '../model/artifact-inspection.js';
import { artifactItemsFrom, coordinationRunIds, visibleArtifacts, visibleForRun } from '../model/selection.js';
import type { TaskSummary } from '../model/task-roster.js';
import type { WorkbenchUiState } from '../model/ui-state.js';

/** The runtime facts selection resolution reads; a `DashboardSnapshot` satisfies it. */
export interface SelectionSnapshot {
  readonly runtime?: {
    readonly agents?: { readonly agents: readonly AgentSummary[] } | null;
    readonly tasks?: { readonly tasks: readonly TaskSummary[] } | null;
    readonly artifacts?: { readonly items: readonly WorkbenchInspectableItem[] } | null;
  } | null;
}

export interface AgentSelection {
  readonly agentId?: string;
  readonly scrollOffset: number;
}

/**
 * Pure selection resolution shared by both renderers. Each function maps a
 * navigation intent plus the current projection to the store selection it
 * should produce; the caller dispatches and repaints.
 */
export function selectAgentShortcut(snapshot: SelectionSnapshot | undefined, state: WorkbenchUiState, index: number): AgentSelection | undefined {
  const agents = visibleForRun(snapshot?.runtime?.agents?.agents ?? [], state.selectedRunId);
  const selected = agents[index - 1];
  return selected ? { agentId: selected.agentId, scrollOffset: Math.max(0, index - 2) } : undefined;
}

export function moveAgentSelection(snapshot: SelectionSnapshot | undefined, state: WorkbenchUiState, direction: -1 | 1): AgentSelection {
  const agents = visibleForRun(snapshot?.runtime?.agents?.agents ?? [], state.selectedRunId);
  const ids: Array<string | undefined> = [undefined, ...agents.map((agent) => agent.agentId)];
  const selectedIndex = ids.findIndex((id) => id === state.selectedAgentId);
  const current = selectedIndex >= 0 ? selectedIndex : 0;
  const target = Math.max(0, Math.min(ids.length - 1, current + direction));
  return { agentId: ids[target], scrollOffset: Math.max(0, target - 2) };
}

export function moveTaskSelection(snapshot: SelectionSnapshot | undefined, state: WorkbenchUiState, direction: -1 | 1): { taskId: string; agentId?: string; scrollOffset: number } | undefined {
  const tasks = visibleForRun(snapshot?.runtime?.tasks?.tasks ?? [], state.selectedRunId);
  if (tasks.length === 0) return undefined;
  const selectedIndex = tasks.findIndex((task) => task.taskId === state.selectedTaskId);
  const current = selectedIndex >= 0 ? selectedIndex : direction > 0 ? -1 : 0;
  const target = Math.max(0, Math.min(tasks.length - 1, current + direction));
  const selected = tasks[target]!;
  return { taskId: selected.taskId, agentId: selected.agentId, scrollOffset: Math.max(0, target - 1) };
}

export function moveArtifactSelection(snapshot: SelectionSnapshot | undefined, state: WorkbenchUiState, direction: -1 | 1): { artifactId: string; runId?: string; agentId?: string; taskId?: string; scrollOffset: number } | undefined {
  const items = visibleArtifacts(artifactItemsFrom(snapshot), {
    runId: state.selectedRunId,
    agentId: state.selectedAgentId,
    taskId: state.selectedTaskId,
  });
  if (items.length === 0) return undefined;
  const selectedIndex = items.findIndex((item) => item.id === state.selectedArtifactId);
  const current = selectedIndex >= 0 ? selectedIndex : direction > 0 ? -1 : 0;
  const target = Math.max(0, Math.min(items.length - 1, current + direction));
  const selected = items[target]!;
  return {
    artifactId: selected.id,
    runId: selected.coordinationRunId,
    agentId: selected.agentId,
    taskId: selected.taskId,
    scrollOffset: Math.max(0, target - 1),
  };
}

export function moveRunSelection(snapshot: SelectionSnapshot | undefined, state: WorkbenchUiState, direction: -1 | 1): { runId?: string } {
  const agents = snapshot?.runtime?.agents?.agents ?? [];
  const tasks = snapshot?.runtime?.tasks?.tasks ?? [];
  const runs = coordinationRunIds([...agents, ...tasks]);
  const ids: Array<string | undefined> = [undefined, ...runs];
  const current = Math.max(0, ids.findIndex((id) => id === state.selectedRunId));
  const target = (current + direction + ids.length) % ids.length;
  return { runId: ids[target] };
}
