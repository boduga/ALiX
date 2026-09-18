import type { TerminalCanvas } from '../../canvas.js';
import { RESET } from '../../ansi-constants.js';
import type { AgentRosterSnapshot } from '../model/agent-roster.js';
import type { TaskRosterSnapshot } from '../model/task-roster.js';
import type { WorkbenchResponsiveLayout } from '../layout/responsive-layout.js';

function fit(text: string, width: number): string {
  if (width <= 0) return '';
  return text.length <= width ? text : width === 1 ? '…' : `${text.slice(0, width - 1)}…`;
}

export function paintRosterDrawer(input: {
  readonly canvas: TerminalCanvas;
  readonly terminalColumns: number;
  readonly top: number;
  readonly bottom: number;
  readonly layout: WorkbenchResponsiveLayout;
  readonly agents: AgentRosterSnapshot | null;
  readonly tasks: TaskRosterSnapshot | null;
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
    : `TASKS  ${input.tasks?.running ?? 0} running`;
  canvas.write(left + 2, top, `\x1b[1m${fit(title, inner)}${RESET}`);
  canvas.write(left + 2, top + 1, `\x1b[90m${'─'.repeat(inner)}${RESET}`);

  let row = top + 3;
  if (layout.drawer === 'agents') {
    const agents = input.agents?.agents ?? [];
    if (agents.length === 0) canvas.write(left + 2, row, `\x1b[90mNo subagents${RESET}`);
    for (const agent of agents) {
      if (row > bottom - 1) break;
      const active = ['completed', 'partial', 'failed', 'cancelled'].includes(agent.state) ? '○' : '●';
      canvas.write(left + 2, row++, fit(`${active} ${agent.role} · ${agent.state}`, inner));
      if (row <= bottom - 1) canvas.write(left + 2, row++, `\x1b[90m${fit(agent.currentOperation ?? agent.currentTaskId ?? agent.agentId, inner)}${RESET}`);
      if (row <= bottom - 1 && agent.activeTool) {
        const elapsed = agent.activeTool.elapsedMs >= 1000 ? ` · ${(agent.activeTool.elapsedMs / 1000).toFixed(1)}s` : '';
        canvas.write(left + 2, row++, `\x1b[90m${fit(`tool ${agent.activeTool.toolName}${elapsed}`, inner)}${RESET}`);
      }
      if (row <= bottom - 1 && agent.ownedPaths.length > 0) canvas.write(left + 2, row++, `\x1b[90m${fit(`owns ${agent.ownedPaths.join(', ')}`, inner)}${RESET}`);
      row++;
    }
  } else {
    const tasks = input.tasks?.tasks ?? [];
    if (tasks.length === 0) canvas.write(left + 2, row, `\x1b[90mNo delegated tasks${RESET}`);
    for (const task of tasks) {
      if (row > bottom - 1) break;
      canvas.write(left + 2, row++, fit(`• ${task.state} · ${task.title}`, inner));
      if (row <= bottom - 1 && task.agentId) canvas.write(left + 2, row++, `\x1b[90m${fit(`agent ${task.agentId}`, inner)}${RESET}`);
      row++;
    }
  }
}
