import type { TerminalCanvas } from '../../canvas.js';
import { RESET } from '../../ansi-constants.js';
import type { AgentRosterSnapshot } from '../model/agent-roster.js';
import type { TaskRosterSnapshot } from '../model/task-roster.js';
import type { WorkbenchArtifactSnapshot } from '../model/artifact-inspection.js';
import type { WorkbenchResponsiveLayout } from '../layout/responsive-layout.js';
import { truncateDisplayText } from '../render/terminal-text.js';
import { visibleArtifacts, visibleForRun } from '../model/selection.js';

function fit(text: string, width: number): string {
  return truncateDisplayText(text, width);
}

function taskStateGlyph(state: TaskRosterSnapshot['tasks'][number]['state']): string {
  if (state === 'running') return '●';
  if (state === 'queued' || state === 'assigned') return '◌';
  if (state === 'completed') return '✓';
  if (state === 'partial') return '◐';
  if (state === 'failed') return '✗';
  if (state === 'blocked') return '!';
  return '○';
}

/** Dim coordination correlation line shared by agent and task rows. */
function formatCoordMeta(entry: { coordinationRunId?: string; assignedAgentId?: string }): string | null {
  if (!entry.coordinationRunId && !entry.assignedAgentId) return null;
  const run = entry.coordinationRunId ? `run ${entry.coordinationRunId}` : '';
  const assigned = entry.assignedAgentId ? `assigned ${entry.assignedAgentId}` : '';
  return [run, assigned].filter(Boolean).join(' · ');
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KiB`;
  return `${(value / 1_048_576).toFixed(1)} MiB`;
}

export function paintRosterDrawer(input: {
  readonly canvas: TerminalCanvas;
  readonly terminalColumns: number;
  readonly top: number;
  readonly bottom: number;
  readonly layout: WorkbenchResponsiveLayout;
  readonly agents: AgentRosterSnapshot | null;
  readonly tasks: TaskRosterSnapshot | null;
  readonly artifacts?: WorkbenchArtifactSnapshot | null;
  readonly selectedAgentId?: string;
  readonly selectedTaskId?: string;
  readonly selectedRunId?: string;
  readonly selectedArtifactId?: string;
  readonly agentRosterExpanded?: boolean;
  readonly agentScrollOffset?: number;
}): void {
  const { canvas, terminalColumns, top, bottom, layout } = input;
  if (layout.drawerMode === 'hidden' || layout.drawer === 'closed' || bottom < top) return;
  const width = layout.drawerWidth;
  const left = layout.drawerMode === 'side' ? terminalColumns - width : 0;
  const inner = Math.max(1, width - 3);
  for (let row = top; row <= bottom; row++) canvas.write(left, row, ' '.repeat(width));
  if (layout.drawerMode === 'side') {
    for (let row = top; row <= bottom; row++) canvas.write(left, row, `\x1b[90m│${RESET}`);
  }
  const title = layout.drawer === 'agents'
    ? `AGENTS  ${input.agents?.active ?? 0} active`
    : layout.drawer === 'tasks'
      ? `TASKS  ${input.tasks?.running ?? 0} running · ${input.tasks?.queued ?? 0} queued · ${input.tasks?.blocked ?? 0} blocked`
      : `ARTIFACTS  ${input.artifacts?.artifacts ?? 0} files · ${input.artifacts?.results ?? 0} results`;
  canvas.write(left + 2, top, `\x1b[1m${fit(title, inner)}${RESET}`);
  canvas.write(left + 2, top + 1, `\x1b[90m${'─'.repeat(inner)}${RESET}`);

  const runLabel = input.selectedRunId ? `RUN ${input.selectedRunId}` : 'RUN all';
  canvas.write(left + 2, top + 2, `\x1b[90m${fit(`${runLabel} · [ ] switch`, inner)}${RESET}`);
  const hasFooter = bottom >= top + 5;
  const contentBottom = hasFooter ? bottom - 1 : bottom;
  if (hasFooter) {
    canvas.write(left + 2, bottom, `\x1b[90m${fit('↑↓ select · [ ] run · Esc close', inner)}${RESET}`);
  }
  let row = top + 4;
  if (layout.drawer === 'agents') {
    const agents = visibleForRun(input.agents?.agents ?? [], input.selectedRunId);
    const aggregateSelected = input.selectedAgentId === undefined;
    canvas.write(left + 2, row++, fit(`${aggregateSelected ? '›' : ' '}◉ All agents`, inner));
    if (input.agentRosterExpanded === false) {
      if (row <= bottom) canvas.write(left + 2, row, `\x1b[90m${fit('Enter to expand roster', inner)}${RESET}`);
      return;
    }
    const visibleAgents = agents.slice(Math.max(0, input.agentScrollOffset ?? 0));
    if (agents.length === 0) canvas.write(left + 2, row, `\x1b[90mNo subagents${RESET}`);
    for (const agent of visibleAgents) {
      if (row > contentBottom) break;
      const active = ['completed', 'partial', 'failed', 'cancelled'].includes(agent.state) ? '○' : '●';
      const selected = agent.agentId === input.selectedAgentId ? '›' : ' ';
      const showDetails = agent.agentId === input.selectedAgentId;
      canvas.write(left + 2, row++, fit(`${selected}${active} ${agent.role} · ${agent.state}`, inner));
      const coordMeta = formatCoordMeta(agent);
      if (showDetails && row <= contentBottom && coordMeta) {
        canvas.write(left + 2, row++, `\x1b[90m${fit(coordMeta, inner)}${RESET}`);
      }
      if (row <= contentBottom && agent.liveness?.state !== undefined && agent.liveness.state !== 'healthy') {
        const label = agent.liveness.state === 'stalled' ? 'possibly stalled' : 'slow progress';
        canvas.write(left + 2, row++, `\x1b[33m${fit(`⚠ ${label}`, inner)}${RESET}`);
      }
      if (showDetails && row <= contentBottom) canvas.write(left + 2, row++, `\x1b[90m${fit(agent.currentOperation ?? agent.currentTaskId ?? agent.agentId, inner)}${RESET}`);
      if (showDetails && row <= contentBottom && agent.model) canvas.write(left + 2, row++, `\x1b[90m${fit(`model ${agent.model}`, inner)}${RESET}`);
      if (showDetails && row <= contentBottom && agent.activeTool) {
        const elapsed = agent.activeTool.elapsedMs >= 1000 ? ` · ${(agent.activeTool.elapsedMs / 1000).toFixed(1)}s` : '';
        canvas.write(left + 2, row++, `\x1b[90m${fit(`tool ${agent.activeTool.toolName}${elapsed}`, inner)}${RESET}`);
      }
      if (showDetails && row <= contentBottom && agent.ownedPaths.length > 0) canvas.write(left + 2, row++, `\x1b[90m${fit(`owns ${agent.ownedPaths.join(', ')}`, inner)}${RESET}`);
      const inputTokens = agent.usage.inputTokens;
      const outputTokens = agent.usage.outputTokens;
      const totalTokens = agent.usage.totalTokens ?? (inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined);
      if (showDetails && row <= contentBottom && totalTokens !== undefined) {
        const context = agent.usage.contextWindowTokens;
        const utilization = context !== undefined && context > 0 ? ` / ${context.toLocaleString('en-US')} (${Math.round(totalTokens / context * 100)}%)` : '';
        canvas.write(left + 2, row++, `\x1b[90m${fit(`tokens ${totalTokens.toLocaleString('en-US')}${utilization}`, inner)}${RESET}`);
      }
      if (showDetails && row <= contentBottom && agent.usage.costUsd !== undefined) {
        canvas.write(left + 2, row++, `\x1b[90m${fit(`cost $${agent.usage.costUsd.toFixed(4)}`, inner)}${RESET}`);
      }
      row++;
    }
  } else if (layout.drawer === 'tasks') {
    const tasks = visibleForRun(input.tasks?.tasks ?? [], input.selectedRunId);
    if (tasks.length === 0) canvas.write(left + 2, row, `\x1b[90mNo delegated tasks${RESET}`);
    for (const task of tasks) {
      if (row > contentBottom) break;
      const selected = task.taskId === input.selectedTaskId ? '›' : ' ';
      const showDetails = task.taskId === input.selectedTaskId;
      canvas.write(left + 2, row++, fit(`${selected}${taskStateGlyph(task.state)} ${task.title}`, inner));
      const owner = task.agentId ? ` · agent ${task.agentId}` : '';
      if (showDetails && row <= contentBottom) canvas.write(left + 2, row++, `\x1b[90m${fit(`${task.state}${owner}`, inner)}${RESET}`);
      const taskCoordMeta = formatCoordMeta(task);
      if (showDetails && row <= contentBottom && taskCoordMeta) {
        canvas.write(left + 2, row++, `\x1b[90m${fit(taskCoordMeta, inner)}${RESET}`);
      }
      if (showDetails && row <= contentBottom && task.currentOperation && task.currentOperation !== task.title) {
        canvas.write(left + 2, row++, `\x1b[90m${fit(task.currentOperation, inner)}${RESET}`);
      }
      if (row <= contentBottom && task.blockReason) {
        const label = task.blockReason === 'ownership_conflict' ? 'OWNERSHIP CONFLICT'
          : task.blockReason === 'dependency_failed' ? 'DEPENDENCY BLOCKED'
          : `BLOCKED · ${task.blockReason}`;
        canvas.write(left + 2, row++, `\x1b[33m${fit(`⚠ ${label}`, inner)}${RESET}`);
      }
      if (showDetails && row <= contentBottom && task.ownedPaths.length > 0) {
        canvas.write(left + 2, row++, `\x1b[90m${fit(`owns ${task.ownedPaths.join(', ')}`, inner)}${RESET}`);
      }
      row++;
    }
  } else {
    const items = visibleArtifacts(input.artifacts?.items ?? [], {
      runId: input.selectedRunId,
      agentId: input.selectedAgentId,
      taskId: input.selectedTaskId,
    });
    if (items.length === 0) {
      canvas.write(left + 2, row, `\x1b[90mNo artifacts or results${RESET}`);
      return;
    }
    const offset = Math.max(0, input.agentScrollOffset ?? 0);
    for (const item of items.slice(offset)) {
      if (row > contentBottom) break;
      const selected = item.id === input.selectedArtifactId ? '›' : ' ';
      const marker = item.status === 'failed' ? '✗' : item.status === 'unavailable' ? '!' : item.kind === 'artifact' ? '◆' : '✓';
      canvas.write(left + 2, row++, fit(`${selected}${marker} ${item.title}`, inner));
      if (item.id !== input.selectedArtifactId) continue;
      const correlation = [item.artifactType ?? item.kind, item.agentId ? `agent ${item.agentId}` : '', item.taskId ? `task ${item.taskId}` : '']
        .filter(Boolean).join(' · ');
      if (row <= contentBottom) canvas.write(left + 2, row++, `\x1b[90m${fit(correlation, inner)}${RESET}`);
      if (row <= contentBottom && item.uri) canvas.write(left + 2, row++, `\x1b[90m${fit(item.uri, inner)}${RESET}`);
      const metadata = [item.mediaType, item.sizeBytes !== undefined ? formatBytes(item.sizeBytes) : '', item.digest ? `digest ${item.digest.slice(0, 12)}` : '']
        .filter(Boolean).join(' · ');
      if (row <= contentBottom && metadata) canvas.write(left + 2, row++, `\x1b[90m${fit(metadata, inner)}${RESET}`);
      if (row <= contentBottom && item.preview) {
        for (const line of item.preview.split(/\r?\n/).slice(0, 5)) {
          if (row > contentBottom) break;
          canvas.write(left + 2, row++, fit(`  ${line}`, inner));
        }
      }
      row++;
    }
  }
}
