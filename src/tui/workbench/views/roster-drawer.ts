import type { TerminalCanvas } from '../../canvas.js';
import { RESET } from '../../ansi-constants.js';
import type { AgentRosterSnapshot } from '../model/agent-roster.js';
import type { TaskRosterSnapshot } from '../model/task-roster.js';
import type { WorkbenchResponsiveLayout } from '../layout/responsive-layout.js';
import { truncateDisplayText } from '../render/terminal-text.js';

function fit(text: string, width: number): string {
  return truncateDisplayText(text, width);
}

function taskStateGlyph(state: TaskRosterSnapshot['tasks'][number]['state']): string {
  if (state === 'running') return '●';
  if (state === 'queued' || state === 'assigned') return '◌';
  if (state === 'completed') return '✓';
  if (state === 'partial') return '◐';
  if (state === 'failed') return '✗';
  return '○';
}

export function paintRosterDrawer(input: {
  readonly canvas: TerminalCanvas;
  readonly terminalColumns: number;
  readonly top: number;
  readonly bottom: number;
  readonly layout: WorkbenchResponsiveLayout;
  readonly agents: AgentRosterSnapshot | null;
  readonly tasks: TaskRosterSnapshot | null;
  readonly selectedAgentId?: string;
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
    : `TASKS  ${input.tasks?.running ?? 0} running · ${input.tasks?.queued ?? 0} queued`;
  canvas.write(left + 2, top, `\x1b[1m${fit(title, inner)}${RESET}`);
  canvas.write(left + 2, top + 1, `\x1b[90m${'─'.repeat(inner)}${RESET}`);

  let row = top + 3;
  if (layout.drawer === 'agents') {
    const agents = input.agents?.agents ?? [];
    const visibleAgents = agents.slice(Math.max(0, input.agentScrollOffset ?? 0));
    if (agents.length === 0) canvas.write(left + 2, row, `\x1b[90mNo subagents${RESET}`);
    for (const agent of visibleAgents) {
      if (row > bottom - 1) break;
      const active = ['completed', 'partial', 'failed', 'cancelled'].includes(agent.state) ? '○' : '●';
      const selected = agent.agentId === input.selectedAgentId ? '›' : ' ';
      canvas.write(left + 2, row++, fit(`${selected}${active} ${agent.role} · ${agent.state}`, inner));
      if (row <= bottom - 1 && (agent.coordinationRunId || agent.assignedAgentId)) {
        const run = agent.coordinationRunId ? `run ${agent.coordinationRunId}` : '';
        const assigned = agent.assignedAgentId ? `assigned ${agent.assignedAgentId}` : '';
        canvas.write(left + 2, row++, `\x1b[90m${fit([run, assigned].filter(Boolean).join(' · '), inner)}${RESET}`);
      }
      if (row <= bottom - 1 && agent.liveness?.state !== undefined && agent.liveness.state !== 'healthy') {
        const label = agent.liveness.state === 'stalled' ? 'possibly stalled' : 'slow progress';
        canvas.write(left + 2, row++, `\x1b[33m${fit(`⚠ ${label}`, inner)}${RESET}`);
      }
      if (row <= bottom - 1) canvas.write(left + 2, row++, `\x1b[90m${fit(agent.currentOperation ?? agent.currentTaskId ?? agent.agentId, inner)}${RESET}`);
      if (row <= bottom - 1 && agent.model) canvas.write(left + 2, row++, `\x1b[90m${fit(`model ${agent.model}`, inner)}${RESET}`);
      if (row <= bottom - 1 && agent.activeTool) {
        const elapsed = agent.activeTool.elapsedMs >= 1000 ? ` · ${(agent.activeTool.elapsedMs / 1000).toFixed(1)}s` : '';
        canvas.write(left + 2, row++, `\x1b[90m${fit(`tool ${agent.activeTool.toolName}${elapsed}`, inner)}${RESET}`);
      }
      if (row <= bottom - 1 && agent.ownedPaths.length > 0) canvas.write(left + 2, row++, `\x1b[90m${fit(`owns ${agent.ownedPaths.join(', ')}`, inner)}${RESET}`);
      const inputTokens = agent.usage.inputTokens;
      const outputTokens = agent.usage.outputTokens;
      const totalTokens = agent.usage.totalTokens ?? (inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined);
      if (row <= bottom - 1 && totalTokens !== undefined) {
        const context = agent.usage.contextWindowTokens;
        const utilization = context !== undefined && context > 0 ? ` / ${context.toLocaleString('en-US')} (${Math.round(totalTokens / context * 100)}%)` : '';
        canvas.write(left + 2, row++, `\x1b[90m${fit(`tokens ${totalTokens.toLocaleString('en-US')}${utilization}`, inner)}${RESET}`);
      }
      if (row <= bottom - 1 && agent.usage.costUsd !== undefined) {
        canvas.write(left + 2, row++, `\x1b[90m${fit(`cost $${agent.usage.costUsd.toFixed(4)}`, inner)}${RESET}`);
      }
      row++;
    }
  } else {
    const tasks = input.tasks?.tasks ?? [];
    if (tasks.length === 0) canvas.write(left + 2, row, `\x1b[90mNo delegated tasks${RESET}`);
    for (const task of tasks) {
      if (row > bottom - 1) break;
      canvas.write(left + 2, row++, fit(`${taskStateGlyph(task.state)} ${task.title}`, inner));
      const owner = task.agentId ? ` · agent ${task.agentId}` : '';
      if (row <= bottom - 1) canvas.write(left + 2, row++, `\x1b[90m${fit(`${task.state}${owner}`, inner)}${RESET}`);
      if (row <= bottom - 1 && (task.coordinationRunId || task.assignedAgentId)) {
        const run = task.coordinationRunId ? `run ${task.coordinationRunId}` : '';
        const assigned = task.assignedAgentId ? `assigned ${task.assignedAgentId}` : '';
        canvas.write(left + 2, row++, `\x1b[90m${fit([run, assigned].filter(Boolean).join(' · '), inner)}${RESET}`);
      }
      if (row <= bottom - 1 && task.currentOperation && task.currentOperation !== task.title) {
        canvas.write(left + 2, row++, `\x1b[90m${fit(task.currentOperation, inner)}${RESET}`);
      }
      if (row <= bottom - 1 && task.ownedPaths.length > 0) {
        canvas.write(left + 2, row++, `\x1b[90m${fit(`owns ${task.ownedPaths.join(', ')}`, inner)}${RESET}`);
      }
      row++;
    }
  }
}
