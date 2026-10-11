import type { AgentSummary } from '../model/agent-roster.js';
import type { WorkbenchInspectableItem } from '../model/artifact-inspection.js';
import { artifactItemsFrom, coordinationRunIds, visibleArtifacts, visibleForRun } from '../model/selection.js';
import type { TaskSummary } from '../model/task-roster.js';
import type { WorkbenchUiAction } from '../model/ui-action.js';
import type { WorkbenchUiState } from '../model/ui-state.js';

export type NavigationDirection = -1 | 1;

export interface SelectionSnapshot {
  readonly runtime?: {
    readonly agents?: { readonly agents: readonly AgentSummary[] } | null;
    readonly tasks?: { readonly tasks: readonly TaskSummary[] } | null;
    readonly artifacts?: { readonly items: readonly WorkbenchInspectableItem[] } | null;
  } | null;
}

type AgentSelect = Omit<Extract<WorkbenchUiAction, { type: 'agent.select' }>, 'type'>;
type TaskSelect = Omit<Extract<WorkbenchUiAction, { type: 'task.select' }>, 'type'>;
type ArtifactSelect = Omit<Extract<WorkbenchUiAction, { type: 'artifact.select' }>, 'type'>;
type RunSelect = Omit<Extract<WorkbenchUiAction, { type: 'run.select' }>, 'type'>;

function navigate(length: number, currentIndex: number, direction: NavigationDirection, fallbackIndex: number): number {
  const current = currentIndex >= 0 ? currentIndex : fallbackIndex;
  return Math.max(0, Math.min(length - 1, current + direction));
}

export function selectAgentShortcut(snapshot: SelectionSnapshot | undefined, state: WorkbenchUiState, index: number): AgentSelect | undefined {
  const agents = visibleForRun(snapshot?.runtime?.agents?.agents ?? [], state.selectedRunId);
  const selected = agents[index - 1];
  return selected ? { agentId: selected.agentId, scrollOffset: Math.max(0, index - 2) } : undefined;
}

export function moveAgentSelection(snapshot: SelectionSnapshot | undefined, state: WorkbenchUiState, direction: NavigationDirection): AgentSelect {
  const agents = visibleForRun(snapshot?.runtime?.agents?.agents ?? [], state.selectedRunId);
  const ids: Array<string | undefined> = [undefined, ...agents.map((agent) => agent.agentId)];
  const target = navigate(ids.length, ids.findIndex((id) => id === state.selectedAgentId), direction, 0);
  return { agentId: ids[target], scrollOffset: Math.max(0, target - 2) };
}

export function moveTaskSelection(snapshot: SelectionSnapshot | undefined, state: WorkbenchUiState, direction: NavigationDirection): TaskSelect | undefined {
  const tasks = visibleForRun(snapshot?.runtime?.tasks?.tasks ?? [], state.selectedRunId);
  if (tasks.length === 0) return undefined;
  const target = navigate(tasks.length, tasks.findIndex((task) => task.taskId === state.selectedTaskId), direction, direction > 0 ? -1 : 0);
  const selected = tasks[target]!;
  return { taskId: selected.taskId, agentId: selected.agentId, scrollOffset: Math.max(0, target - 1) };
}

export function moveArtifactSelection(snapshot: SelectionSnapshot | undefined, state: WorkbenchUiState, direction: NavigationDirection): ArtifactSelect | undefined {
  const items = visibleArtifacts(artifactItemsFrom(snapshot), {
    runId: state.selectedRunId,
    agentId: state.selectedAgentId,
    taskId: state.selectedTaskId,
  });
  if (items.length === 0) return undefined;
  const target = navigate(items.length, items.findIndex((item) => item.id === state.selectedArtifactId), direction, direction > 0 ? -1 : 0);
  const selected = items[target]!;
  return {
    artifactId: selected.id,
    runId: selected.coordinationRunId,
    agentId: selected.agentId,
    taskId: selected.taskId,
    scrollOffset: Math.max(0, target - 1),
  };
}

export function moveRunSelection(snapshot: SelectionSnapshot | undefined, state: WorkbenchUiState, direction: NavigationDirection): RunSelect {
  const agents = snapshot?.runtime?.agents?.agents ?? [];
  const tasks = snapshot?.runtime?.tasks?.tasks ?? [];
  const runs = coordinationRunIds([...agents, ...tasks]);
  const ids: Array<string | undefined> = [undefined, ...runs];
  const current = Math.max(0, ids.findIndex((id) => id === state.selectedRunId));
  const target = (current + direction + ids.length) % ids.length;
  return { runId: ids[target] };
}
