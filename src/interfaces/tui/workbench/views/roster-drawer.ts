import type { TerminalCanvas } from '../../canvas.js';
import { RESET } from '../../ansi-constants.js';
import type { AgentRosterSnapshot, AgentSummary } from '../model/agent-roster.js';
import type { TaskRosterSnapshot } from '../model/task-roster.js';
import type { WorkbenchArtifactSnapshot } from '../model/artifact-inspection.js';
import type { WorkbenchResponsiveLayout } from '../layout/responsive-layout.js';
import { truncateDisplayText } from '../render/terminal-text.js';
import { getWorkbenchPreviewTheme, getWorkbenchAgentPresentation, type WorkbenchPreviewTheme } from '../model/preview-theme.js';
import { formatByteSize, formatCoordMeta, taskStateGlyph } from '../model/display-format.js';
import { visibleArtifacts, visibleForRun } from '../model/selection.js';

function fit(text: string, width: number): string {
  return truncateDisplayText(text, width);
}

export function paintRosterDrawer(input: {
  readonly canvas: TerminalCanvas;
  readonly terminalColumns: number;
  readonly left?: number;
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
  readonly theme?: WorkbenchPreviewTheme;
}): void {
  const { canvas, terminalColumns, top, bottom, layout } = input;
  if (layout.drawerMode === 'hidden' || layout.drawer === 'closed' || bottom < top) return;
  if (layout.drawer === 'agents') {
    paintPreviewAgentRoster(input);
    return;
  }
  if (layout.drawer === 'tasks') {
    paintPreviewTaskRoster(input);
    return;
  }
  const write = (x: number, y: number, text: string): void => {
    if (y >= top && y <= bottom) canvas.write(x, y, text);
  };
  const width = layout.drawerWidth;
  const left = input.left ?? (layout.drawerMode === 'side' ? terminalColumns - width : 0);
  const inner = Math.max(1, width - 3);
  for (let row = top; row <= bottom; row++) write(left, row, ' '.repeat(width));
  if (layout.drawerMode === 'side') {
    for (let row = top; row <= bottom; row++) write(left, row, `\x1b[90m│${RESET}`);
  }
  const title = `ARTIFACTS  ${input.artifacts?.artifacts ?? 0} files · ${input.artifacts?.results ?? 0} results`;
  write(left + 2, top, `\x1b[1m${fit(title, inner)}${RESET}`);
  write(left + 2, top + 1, `\x1b[90m${'─'.repeat(inner)}${RESET}`);

  const runLabel = input.selectedRunId ? `RUN ${input.selectedRunId}` : 'RUN all';
  write(left + 2, top + 2, `\x1b[90m${fit(`${runLabel} · [ ] switch`, inner)}${RESET}`);
  const hasFooter = bottom >= top + 5;
  const contentBottom = hasFooter ? bottom - 1 : bottom;
  if (hasFooter) {
    write(left + 2, bottom, `\x1b[90m${fit('↑↓ select · [ ] run · Esc close', inner)}${RESET}`);
  }
  let row = top + 4;
  {
    const items = visibleArtifacts(input.artifacts?.items ?? [], {
      runId: input.selectedRunId,
      agentId: input.selectedAgentId,
      taskId: input.selectedTaskId,
    });
    if (items.length === 0) {
      write(left + 2, row, `\x1b[90mNo artifacts or results${RESET}`);
      return;
    }
    const offset = Math.max(0, input.agentScrollOffset ?? 0);
    for (const item of items.slice(offset)) {
      if (row > contentBottom) break;
      const selected = item.id === input.selectedArtifactId ? '›' : ' ';
      const marker = item.status === 'failed' ? '✗' : item.status === 'unavailable' ? '!' : item.kind === 'artifact' ? '◆' : '✓';
      write(left + 2, row++, fit(`${selected}${marker} ${item.title}`, inner));
      if (item.id !== input.selectedArtifactId) continue;
      const correlation = [item.artifactType ?? item.kind, item.agentId ? `agent ${item.agentId}` : '', item.taskId ? `task ${item.taskId}` : '']
        .filter(Boolean).join(' · ');
      if (row <= contentBottom) write(left + 2, row++, `\x1b[90m${fit(correlation, inner)}${RESET}`);
      if (row <= contentBottom && item.uri) write(left + 2, row++, `\x1b[90m${fit(item.uri, inner)}${RESET}`);
      const metadata = [item.mediaType, item.sizeBytes !== undefined ? formatByteSize(item.sizeBytes) : '', item.digest ? `digest ${item.digest.slice(0, 12)}` : '']
        .filter(Boolean).join(' · ');
      if (row <= contentBottom && metadata) write(left + 2, row++, `\x1b[90m${fit(metadata, inner)}${RESET}`);
      if (row <= contentBottom && item.preview) {
        for (const line of item.preview.split(/\r?\n/).slice(0, 5)) {
          if (row > contentBottom) break;
          write(left + 2, row++, fit(`  ${line}`, inner));
        }
      }
      row++;
    }
  }
}


function joinedAgentTask(agent: AgentSummary, tasks: readonly TaskRosterSnapshot['tasks'][number][]): TaskRosterSnapshot['tasks'][number] | undefined {
  const scopedTasks = tasks.filter(task => agent.coordinationRunId === undefined || task.coordinationRunId === agent.coordinationRunId);
  const candidates = agent.currentTaskId
    ? scopedTasks.filter(task => task.taskId === agent.currentTaskId && (task.agentId === undefined || task.agentId === agent.agentId))
    : scopedTasks.filter(task => task.agentId === agent.agentId);
  return candidates.length === 1 ? candidates[0] : undefined;
}

function agentTaskSubtitle(agent: AgentSummary, task: TaskRosterSnapshot['tasks'][number] | undefined, tasks: readonly TaskRosterSnapshot['tasks'][number][], agents: readonly AgentSummary[]): string {
  if (agent.state === 'waiting_dependency' && task?.dependencyIds?.length) {
    const labels = task.dependencyIds.map(id => {
      const dependencies = tasks.filter(entry => entry.taskId === id && (task.coordinationRunId === undefined || entry.coordinationRunId === task.coordinationRunId));
      const dependency = dependencies.length === 1 ? dependencies[0] : undefined;
      const owners = dependency?.agentId ? agents.filter(entry => entry.agentId === dependency.agentId && (dependency.coordinationRunId === undefined || entry.coordinationRunId === dependency.coordinationRunId)) : [];
      return owners.length === 1 ? owners[0]!.role : id;
    });
    return `Depends on ${labels.join(', ')}`;
  }
  return agent.taskLabel ?? task?.title ?? agent.currentOperation ?? 'Task unavailable';
}

function agentDiagnosticLines(agent: AgentSummary, subtitle: string): readonly string[] {
  const lines: string[] = [];
  const correlation = formatCoordMeta(agent);
  if (correlation) lines.push(correlation);
  if (agent.currentOperation && agent.currentOperation !== subtitle) lines.push(agent.currentOperation);
  if (agent.model) lines.push(`model ${agent.model}`);
  if (agent.activeTool) lines.push(`tool ${agent.activeTool.toolName} · ${(agent.activeTool.elapsedMs / 1000).toFixed(1)}s`);
  if (agent.ownedPaths.length) lines.push(`owns ${agent.ownedPaths.join(', ')}`);
  const tokens = agent.usage.totalTokens ?? (agent.usage.inputTokens !== undefined && agent.usage.outputTokens !== undefined ? agent.usage.inputTokens + agent.usage.outputTokens : undefined);
  if (tokens !== undefined) lines.push(`tokens ${tokens.toLocaleString('en-US')}`);
  if (agent.usage.costUsd !== undefined) lines.push(`cost $${agent.usage.costUsd.toFixed(4)}`);
  return lines;
}

/** Keep the selected identity visible without rewriting the operator's scroll state. */
function rosterWindowOffset(total: number, requested: number, selectedIndex: number, capacity: number, selectedRows: number): number {
  let offset = Math.max(0, Math.min(Math.max(0, total - 1), Math.floor(Number.isFinite(requested) ? requested : 0)));
  if (selectedIndex < 0) return offset;
  offset = Math.min(offset, selectedIndex);
  while (offset < selectedIndex && (selectedIndex - offset) * 3 + selectedRows > capacity) offset++;
  return offset;
}

/** A bounded preview roster; all joins remain presentation-only identity lookups. */
function paintPreviewAgentRoster(input: Parameters<typeof paintRosterDrawer>[0]): void {
  const { canvas, top, bottom, layout, terminalColumns } = input;
  const theme = input.theme ?? getWorkbenchPreviewTheme();
  const { palette, glyphs } = theme;
  const left = Math.max(0, input.left ?? (layout.drawerMode === 'side' ? terminalColumns - layout.drawerWidth : 0));
  const width = Math.max(0, Math.min(layout.drawerWidth, terminalColumns - left));
  if (width === 0) return;
  const put = (x: number, y: number, text: string, color = palette.foreground): void => {
    if (y < top || y > bottom || x < 0 || x >= width) return;
    const clipped = fit(text, width - x);
    canvas.write(left + x, y, `${color}${theme.glyphMode === 'ascii' ? clipped.replaceAll('…', '~') : clipped}${RESET}`);
  };
  for (let y = top; y <= bottom; y++) put(0, y, ' '.repeat(width));
  if (width < 4 || bottom - top < 2) {
    put(0, top, 'AGENTS & TASKS', palette.cyan);
    return;
  }
  const inside = width - 2;
  const box = (first: number, last: number, selected = false): void => {
    if (last < first) return;
    put(0, first, glyphs.topLeft + glyphs.horizontal.repeat(inside) + glyphs.topRight, palette.cyan);
    for (let y = first + 1; y < last; y++) {
      put(0, y, glyphs.vertical, palette.cyan);
      if (selected) put(1, y, ' '.repeat(inside), palette.selectionFill);
      put(width - 1, y, glyphs.vertical, palette.cyan);
    }
    if (last > first) put(0, last, glyphs.bottomLeft + glyphs.horizontal.repeat(inside) + glyphs.bottomRight, palette.cyan);
  };
  box(top, bottom);
  put(2, top, fit(' AGENTS & TASKS ', Math.max(0, width - 4)), `${palette.cyan}\x1b[1m`);
  const agents = visibleForRun(input.agents?.agents ?? [], input.selectedRunId);
  const tasks = visibleForRun(input.tasks?.tasks ?? [], input.selectedRunId);
  const activeStates = new Set(['starting', 'thinking', 'tool_running', 'verifying']);
  const running = agents.filter(agent => activeStates.has(agent.state)).length;
  const aggregateSelected = input.selectedAgentId === undefined;
  const height = bottom - top + 1;
  const actionVisible = height >= 18;
  const contentBottom = actionVisible ? bottom - 6 : bottom - 1;
  const innerText = Math.max(0, width - 5);
  let row = top + 2;
  const showAggregate = height >= 10 || aggregateSelected;
  if (showAggregate && row <= contentBottom) {
    put(2, row, fit(`${aggregateSelected ? (theme.glyphMode === 'ascii' ? '>' : '›') : ' '}${glyphs.idle} All agents`, innerText), aggregateSelected ? palette.cyan : palette.foreground);
    put(width - 3, row++, '/', palette.cyan);
  }
  if (showAggregate && row <= contentBottom) put(4, row++, fit(input.agents ? `${agents.length} agents ${glyphs.separator} ${running} running` : 'Roster unavailable', Math.max(0, width - 6)), palette.muted);
  if (showAggregate && row <= contentBottom) put(2, row++, glyphs.horizontal.repeat(Math.max(0, width - 4)), palette.divider);
  if (input.selectedRunId && row <= contentBottom) put(2, row++, fit(`RUN ${input.selectedRunId}`, innerText), palette.muted);
  if (input.agentRosterExpanded === false) {
    if (row <= contentBottom) put(2, row, fit('Enter to expand roster', innerText), palette.muted);
  } else if (agents.length === 0) {
    if (row <= contentBottom) put(2, row, input.agents ? 'No subagents' : 'Roster unavailable', palette.muted);
  } else {
    const capacity = contentBottom - row + 1;
    const selectedRows = capacity >= 4 ? 4 : Math.max(1, Math.min(2, capacity));
    const offset = rosterWindowOffset(agents.length, input.agentScrollOffset ?? 0, agents.findIndex(agent => agent.agentId === input.selectedAgentId), capacity, selectedRows);
    const entries = agents.slice(offset);
    for (const [index, agent] of entries.entries()) {
      const selected = agent.agentId === input.selectedAgentId;
      const coordinator = agent.role === 'coordinator' || agent.role === 'orchestrator';
      const presentation = getWorkbenchAgentPresentation(agent.state, theme);
      const color = coordinator ? palette.purple : presentation.color;
      const task = joinedAgentTask(agent, tasks);
      let subtitle = agentTaskSubtitle(agent, task, tasks, agents);
      if (agent.liveness?.state === 'stalled') subtitle = `STALLED ${glyphs.separator} ${subtitle}`;
      else if (agent.liveness?.state === 'warning') subtitle = `SLOW PROGRESS ${glyphs.separator} ${subtitle}`;
      const label = agent.assignedAgentId ?? (coordinator && agent.agentId === 'orchestrator' ? 'Orchestrator' : agent.role);
      const marker = selected ? (theme.glyphMode === 'ascii' ? '>' : '›') : ' ';
      const labelBudget = Math.max(0, innerText - presentation.label.length - 1);
      const name = `${fit(`${marker}${presentation.glyph} ${label}`, labelBudget)} ${presentation.label}`;
      const rowHeight = selected ? selectedRows : 2;
      if (row + rowHeight - 1 > contentBottom) break;
      const outlined = selected && rowHeight === 4;
      if (outlined) box(row, row + 3, true);
      const contentRow = outlined ? row + 1 : row;
      const fill = selected ? palette.selectionFill : '';
      put(2, contentRow, fit(name, innerText), fill + color);
      const shortcut = offset + index + 1;
      if (shortcut <= 9) put(width - 3, contentRow, String(shortcut), fill + palette.cyan);
      if (rowHeight > 1) put(4, contentRow + 1, fit(subtitle, Math.max(0, width - 6)), fill + palette.muted);
      row += rowHeight;
      if (selected) {
        // Reserve two-line rows for every remaining identity before expanding details.
        const reserved = Math.max(0, entries.length - index - 1) * 3;
        const detailBudget = Math.max(0, contentBottom - row + 1 - reserved);
        for (const detail of agentDiagnosticLines(agent, subtitle).slice(0, detailBudget)) put(4, row++, fit(detail, Math.max(0, width - 6)), palette.muted);
      }
      if (row <= contentBottom) {
        const next = entries[index + 1];
        const terminalStates = new Set(['completed', 'partial', 'failed', 'cancelled']);
        if (coordinator || (next && terminalStates.has(next.state) && !terminalStates.has(agent.state))) {
          put(2, row, glyphs.horizontal.repeat(Math.max(0, width - 4)), palette.divider);
        }
        row++;
      }
    }
  }
  if (actionVisible) {
    put(2, bottom - 5, glyphs.horizontal.repeat(Math.max(0, width - 4)), palette.divider);
    put(2, bottom - 4, fit(`${glyphs.idle} Coordination Run`, innerText));
    put(width - 3, bottom - 4, 'c', palette.cyan);
    put(4, bottom - 3, fit('Run setup (read-only)', Math.max(0, width - 6)), palette.muted);
    put(2, bottom - 1, fit(`${theme.glyphMode === 'ascii' ? 'Up/Down' : '↑↓'} select ${glyphs.separator} [ ] run ${glyphs.separator} Esc close`, Math.max(0, width - 4)), palette.muted);
  }
}


function paintPreviewTaskRoster(input: Parameters<typeof paintRosterDrawer>[0]): void {
  const { canvas, top, bottom, layout, terminalColumns } = input;
  const theme = input.theme ?? getWorkbenchPreviewTheme();
  const { palette, glyphs } = theme;
  const left = Math.max(0, input.left ?? (layout.drawerMode === 'side' ? terminalColumns - layout.drawerWidth : 0));
  const width = Math.max(0, Math.min(layout.drawerWidth, terminalColumns - left));
  if (width === 0) return;
  const put = (x: number, y: number, text: string, color = palette.foreground): void => {
    if (y < top || y > bottom || x < 0 || x >= width) return;
    const clipped = fit(text, width - x);
    canvas.write(left + x, y, `${color}${theme.glyphMode === 'ascii' ? clipped.replaceAll('…', '~') : clipped}${RESET}`);
  };
  for (let y = top; y <= bottom; y++) put(0, y, ' '.repeat(width));
  if (width < 4 || bottom - top < 2) {
    put(0, top, 'TASKS', palette.cyan);
    return;
  }
  const box = (first: number, last: number, selected = false): void => {
    put(0, first, glyphs.topLeft + glyphs.horizontal.repeat(width - 2) + glyphs.topRight, palette.cyan);
    for (let y = first + 1; y < last; y++) {
      put(0, y, glyphs.vertical, palette.cyan);
      if (selected) put(1, y, ' '.repeat(width - 2), palette.selectionFill);
      put(width - 1, y, glyphs.vertical, palette.cyan);
    }
    if (last > first) put(0, last, glyphs.bottomLeft + glyphs.horizontal.repeat(width - 2) + glyphs.bottomRight, palette.cyan);
  };
  box(top, bottom);
  put(2, top, fit(' TASKS ', Math.max(0, width - 4)), `${palette.cyan}\x1b[1m`);
  const tasks = visibleForRun(input.tasks?.tasks ?? [], input.selectedRunId);
  const running = tasks.filter(task => task.state === 'running').length;
  const waiting = tasks.filter(task => task.state === 'waiting_dependency' || task.state === 'waiting_approval').length;
  const queued = tasks.filter(task => task.state === 'queued' || task.state === 'assigned').length;
  const blocked = tasks.filter(task => task.state === 'blocked').length;
  put(2, top + 1, fit(input.tasks ? `${blocked} blocked ${glyphs.separator} ${waiting} waiting ${glyphs.separator} ${running} running ${glyphs.separator} ${queued} queued` : 'Tasks unavailable', Math.max(0, width - 4)), palette.muted);
  put(2, top + 2, fit(`RUN ${input.selectedRunId ?? 'all'} ${glyphs.separator} [ ] switch`, Math.max(0, width - 4)), palette.muted);
  const footer = bottom >= top + 6;
  const contentBottom = footer ? bottom - 2 : bottom - 1;
  if (footer) put(2, bottom - 1, fit(`${theme.glyphMode === 'ascii' ? 'Up/Down' : '↑↓'} select ${glyphs.separator} Esc close`, Math.max(0, width - 4)), palette.muted);
  let row = top + 4;
  if (tasks.length === 0 && row <= contentBottom) put(2, row, input.tasks ? 'No delegated tasks' : 'Tasks unavailable', palette.muted);
  const capacity = contentBottom - row + 1;
  const selectedRows = capacity >= 4 ? 4 : Math.max(1, Math.min(2, capacity));
  const offset = rosterWindowOffset(tasks.length, input.agentScrollOffset ?? 0, tasks.findIndex(task => task.taskId === input.selectedTaskId), capacity, selectedRows);
  const entries = tasks.slice(offset);
  for (const [index, task] of entries.entries()) {
    const selected = task.taskId === input.selectedTaskId;
    const height = selected ? selectedRows : 2;
    if (row + height - 1 > contentBottom) break;
    const color = task.state === 'running' ? palette.green
      : task.state === 'completed' ? palette.purple
      : task.state === 'failed' || task.state === 'blocked' ? palette.red
      : task.state === 'waiting_dependency' || task.state === 'waiting_approval' || task.state === 'partial' ? palette.yellow : palette.muted;
    const marker = theme.glyphMode === 'unicode' ? taskStateGlyph(task.state)
      : task.state === 'running' ? glyphs.active
      : task.state === 'failed' || task.state === 'blocked' ? glyphs.failed
      : task.state === 'completed' ? glyphs.success : glyphs.idle;
    const outlined = selected && height === 4;
    if (outlined) box(row, row + 3, true);
    const y = outlined ? row + 1 : row;
    const fill = selected ? palette.selectionFill : '';
    put(2, y, fit(`${selected ? (theme.glyphMode === 'ascii' ? '>' : '›') : ' '}${marker} ${task.title}`, Math.max(0, width - 4)), fill + color);
    if (height > 1) put(4, y + 1, fit(`${task.state.toUpperCase().replaceAll('_', ' ')}${task.agentId ? ` ${glyphs.separator} agent ${task.agentId}` : ''}`, Math.max(0, width - 6)), fill + palette.muted);
    row += height;
    const details: string[] = [];
    if (task.blockReason) details.push(task.blockReason === 'ownership_conflict' ? 'OWNERSHIP CONFLICT' : task.blockReason === 'dependency_failed' ? 'DEPENDENCY BLOCKED' : `BLOCKED ${glyphs.separator} ${task.blockReason}`);
    if (selected) {
      const correlation = formatCoordMeta(task);
      if (correlation) details.push(correlation);
      if (task.currentOperation && task.currentOperation !== task.title) details.push(task.currentOperation);
      if (task.ownedPaths.length) details.push(`owns ${task.ownedPaths.join(', ')}`);
      if (task.dependencyIds?.length) details.push(`Depends on ${task.dependencyIds.join(', ')}`);
    }
    const budget = Math.max(0, contentBottom - row + 1 - (entries.length - index - 1) * 3);
    for (const detail of details.slice(0, budget)) put(4, row++, fit(detail, Math.max(0, width - 6)), task.blockReason ? palette.yellow : palette.muted);
    row++;
  }
}
