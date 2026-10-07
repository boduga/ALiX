import type { CanvasRect } from '../../canvas.js';
import { RESET } from '../../ansi-constants.js';
import type { WorkbenchDiffSnapshot } from '../model/diff-summary.js';
import type { AgentRosterSnapshot } from '../model/agent-roster.js';
import type { TaskRosterSnapshot } from '../model/task-roster.js';
import type { WorkbenchArtifactSnapshot } from '../model/artifact-inspection.js';
import type { WorkbenchOverlay } from '../model/ui-state.js';
import { truncateDisplayText, wrapDisplayText } from '../render/terminal-text.js';
import { paintCoordinationEntry } from './coordination-entry.js';

export interface WorkbenchDiagnosticInput {
  readonly scrollOffset?: number;
  readonly agents?: AgentRosterSnapshot | null;
  readonly tasks?: TaskRosterSnapshot | null;
  readonly artifacts?: WorkbenchArtifactSnapshot | null;
  readonly selectedRunId?: string;
  readonly selectedAgentId?: string;
  readonly selectedTaskId?: string;
}

function fit(text: string, width: number): string {
  return truncateDisplayText(text, width);
}

/** Derive operator-actionable diagnostics without mutating runtime state. */
export function buildWorkbenchDiagnosticLines(input: WorkbenchDiagnosticInput): string[] {
  const inScope = (item: { coordinationRunId?: string; agentId?: string; taskId?: string }): boolean => (
    (!input.selectedRunId || item.coordinationRunId === input.selectedRunId)
    && (!input.selectedAgentId || item.agentId === input.selectedAgentId)
    && (!input.selectedTaskId || item.taskId === input.selectedTaskId)
  );
  const agents = (input.agents?.agents ?? []).filter((agent) => inScope({
    coordinationRunId: agent.coordinationRunId,
    agentId: agent.agentId,
    taskId: agent.currentTaskId,
  }));
  const tasks = (input.tasks?.tasks ?? []).filter(inScope);
  const artifacts = (input.artifacts?.items ?? []).filter(inScope);
  const failedAgents = agents.filter((agent) => agent.state === 'failed');
  const stalledAgents = agents.filter((agent) => agent.liveness?.state === 'stalled');
  const failedTasks = tasks.filter((task) => task.state === 'failed');
  const blockedTasks = tasks.filter((task) => task.state === 'blocked');
  const failedArtifacts = artifacts.filter((artifact) => artifact.status === 'failed');
  const total = failedAgents.length + stalledAgents.length + failedTasks.length + blockedTasks.length + failedArtifacts.length;
  const scope = input.selectedTaskId
    ? `task ${input.selectedTaskId}`
    : input.selectedAgentId
      ? `agent ${input.selectedAgentId}`
      : input.selectedRunId
        ? `run ${input.selectedRunId}`
        : 'all runs and agents';
  const lines = [`${total === 0 ? '✓' : '⚠'} ${total} issue${total === 1 ? '' : 's'} · ${scope}`];
  if (total === 0) return [...lines, '', 'No failed, blocked, stalled, or failed-artifact records in scope.'];

  for (const agent of failedAgents) lines.push(`✗ agent failed · ${agent.agentId}`);
  for (const agent of stalledAgents) lines.push(`⚠ agent stalled · ${agent.agentId} · progress ${Math.floor((agent.liveness?.idleMs ?? 0) / 1000)}s ago`);
  for (const task of failedTasks) lines.push(`✗ task failed · ${task.title} · ${task.taskId}`);
  for (const task of blockedTasks) lines.push(`! task blocked · ${task.title} · ${task.blockReason ?? 'unspecified'}`);
  for (const artifact of failedArtifacts) lines.push(`✗ artifact failed · ${artifact.title}`);

  const runId = input.selectedRunId
    ?? tasks.find((task) => task.coordinationRunId)?.coordinationRunId
    ?? agents.find((agent) => agent.coordinationRunId)?.coordinationRunId;
  lines.push('', 'Recovery');
  if (blockedTasks.some((task) => task.blockReason === 'ownership_conflict')) lines.push('• Resolve overlapping ownership scopes before resuming.');
  if (blockedTasks.some((task) => task.blockReason === 'dependency_failed')) lines.push('• Repair or replace the failed dependency before resuming.');
  if (runId) lines.push(`• alix coordination resume ${runId}`);
  else lines.push('• Select a run to reveal its exact recovery command.');
  lines.push('• Use detailed transcript mode (Ctrl+O) for event evidence.');
  return lines;
}

export function paintWorkbenchDiagnosticOverlay(
  rect: CanvasRect,
  overlay: WorkbenchOverlay | undefined,
  diffs: WorkbenchDiffSnapshot | null | undefined,
  diagnostics: WorkbenchDiagnosticInput = {},
): number {
  if (overlay === 'coordination') {
    paintCoordinationEntry(rect, { draft: { text: '', cursor: 0 }, phase: 'idle',
      message: 'Launch requires a connected runtime session.' }, 'mode unavailable');
    return 0;
  }
  if (!overlay || rect.width < 30 || rect.height - rect.headerH - rect.footerH < 4) return 0;
  const width = Math.min(88, rect.width - 4);
  const height = Math.min(18, rect.height - rect.headerH - rect.footerH);
  const left = Math.floor((rect.width - width) / 2);
  const top = rect.headerH + 1;
  const inner = width - 2;
  for (let row = 0; row < height; row++) rect.canvas.write(left, top + row, ' '.repeat(width));
  const title = overlay === 'diff' ? ' DIFFS ' : overlay === 'review' ? ' REVIEW ' : overlay === 'diagnostics' ? ' DIAGNOSTICS ' : ' HELP ';
  rect.canvas.write(left, top, `\x1b[36m╭${title}${'─'.repeat(Math.max(0, inner - title.length))}╮${RESET}`);
  for (let row = 1; row < height - 1; row++) {
    rect.canvas.write(left, top + row, `\x1b[36m│${RESET}`);
    rect.canvas.write(left + width - 1, top + row, `\x1b[36m│${RESET}`);
  }
  rect.canvas.write(left, top + height - 1, `\x1b[36m╰${'─'.repeat(inner)}╯${RESET}`);
  const lines = overlay === 'help'
    ? ['Enter submit / queue · Shift+Enter newline', 'Tab views · Shift+Tab permission · Ctrl+O details', 'Ctrl+A agents · Ctrl+T tasks · Ctrl+R artifacts', 'Ctrl+E inspector · inspector Ctrl+R artifacts', 'Ctrl+F transcript / composer (also from drawers)', 'Transcript: 1–5 filters · s scope · f follow', 'Drawers: ↑/↓ or j/k select · [ and ] runs', 'Agents: 1–9 select · / all · c coordination objective · Enter expand', 'Composer: ←/→ graphemes · Home/End · Backspace/Delete', 'Slash: Tab complete · Shift+Tab previous · Enter submit', 'Bracketed paste inserts text; never submits', 'Esc closes surface first; otherwise cancels active turn', 'Ctrl+C cancels active turn first; then exits', '/agents · /tasks · /artifacts · /diagnostics', '/diff · /review · /help', 'Coordination: Enter launch · Shift+Enter newline · Esc close', 'Composer always targets foreground session']
    : overlay === 'diagnostics'
      ? buildWorkbenchDiagnosticLines(diagnostics)
    : [
        `${diffs?.filesChanged ?? 0} files across ${diffs?.diffs.length ?? 0} patch operations`,
        '',
        ...(diffs?.diffs.flatMap((diff) => [
          `${diff.status === 'applied' ? '✓' : diff.status === 'failed' ? '✗' : '○'} ${diff.status} · ${diff.toolCallId ?? diff.id}`,
          ...diff.changedFiles.map((file) => `  ${file}`),
        ]) ?? ['No patch activity in this session.']),
        ...(overlay === 'review' ? ['', 'Review is read-only; use the composer to request changes.'] : []),
      ];
  const wrapped = lines.flatMap(line => wrapDisplayText(line, Math.max(1, inner - 2)));
  const maxOffset = Math.max(0, wrapped.length - (height - 3));
  const offset = Math.min(Math.max(0, diagnostics.scrollOffset ?? 0), maxOffset);
  wrapped.slice(offset, offset + height - 3).forEach((line, index) => rect.canvas.write(left + 2, top + 1 + index, fit(line, inner - 2)));
  rect.canvas.write(left + 2, top + height - 2, `\x1b[90mEsc close · ↑/↓ scroll${RESET}`);
  return maxOffset;
}
