import type { TerminalCanvas } from '../../canvas.js';
import { RESET } from '../../ansi-constants.js';
import type { OperatorShellSnapshot } from '../model/operator-shell.js';
import { displayWidth, graphemes, graphemeWidth } from '../render/terminal-text.js';

export interface PaintOperatorShellInput {
  readonly canvas: TerminalCanvas;
  readonly width: number;
  readonly height: number;
  readonly model: OperatorShellSnapshot;
}

function fitEnd(value: string, width: number): string {
  if (width <= 0) return '';
  if (displayWidth(value) <= width) return value;
  if (width === 1) return '…';
  const suffix: string[] = [];
  let used = 0;
  for (const grapheme of [...graphemes(value)].reverse()) {
    const next = graphemeWidth(grapheme);
    if (used + next > width - 1) break;
    suffix.unshift(grapheme);
    used += next;
  }
  return `…${suffix.join('')}`;
}

function clearRow(canvas: TerminalCanvas, row: number, width: number): void {
  canvas.write(0, row, ' '.repeat(width));
}

/**
 * Paints the Agent Workbench's quiet Codex/Claude-style frame chrome while
 * retaining the established three-row header and one-row footer geometry.
 * This lets the shell ship behind the Workbench flag without disturbing
 * viewport math, overlays, cursor placement, or legacy tabs.
 */
export function paintOperatorShell(input: PaintOperatorShellInput): void {
  const { canvas, width, height, model } = input;
  if (width <= 0 || height <= 0) return;

  for (const row of [0, 1, 2, height - 1]) clearRow(canvas, row, width);

  const hint = 'Tab views  ·  Ctrl+O details  ·  ? help';
  canvas.write(1, 0, `\x1b[90mworkbench${RESET}`);
  const hintWidth = displayWidth(hint);
  if (width >= hintWidth + 14) {
    canvas.write(width - hintWidth - 1, 0, `\x1b[90m${hint}${RESET}`);
  }

  const state = `agent · ${model.mode} · ${model.transcriptMode}`;
  const stateStart = Math.max(1, width - displayWidth(state) - 1);
  const workspaceBudget = Math.max(0, stateStart - 9);
  const workspace = fitEnd(model.workspace, workspaceBudget);
  const modeColor = model.mode === 'bypass' ? '\x1b[31m' : model.mode === 'ask' ? '\x1b[32m' : '\x1b[33m';

  canvas.write(1, 1, `\x1b[32m\x1b[1mALiX${RESET}`);
  if (workspace) canvas.write(7, 1, `\x1b[90m${workspace}${RESET}`);
  canvas.write(stateStart, 1, `\x1b[90magent · ${modeColor}${model.mode}${RESET}\x1b[90m · ${model.transcriptMode}${RESET}`);
  canvas.write(0, 2, `\x1b[90m${'─'.repeat(width)}${RESET}`);

  const counterParts = [
    `tokens ${model.tokensUsed.toLocaleString('en-US')}`,
    `files ${model.filesTouched.toLocaleString('en-US')}`,
    `events ${model.eventCount.toLocaleString('en-US')}`,
  ];
  if (model.agents) {
    counterParts.push(`agents ${model.agents.active}/${model.agents.total}`);
    if (model.agents.waitingApproval > 0) counterParts.push(`wait ${model.agents.waitingApproval}`);
    if (model.agents.stalled > 0) counterParts.push(`stalled ${model.agents.stalled}`);
    if (model.agents.knownCostUsd !== undefined) {
      const partial = model.agents.costCoverage < model.agents.total ? '+' : '';
      counterParts.push(`cost $${model.agents.knownCostUsd.toFixed(4)}${partial}`);
    }
  }
  const counters = counterParts.join(' · ');
  const countersWidth = displayWidth(counters);
  const counterStart = Math.max(1, width - countersWidth - 1);
  let operator = model.running ? 'Esc cancel' : '↑↓ scroll';
  if (model.queuedMessages > 0) {
    operator += ` · ${model.queuedMessages} queued`;
  }
  if (model.approval) {
    const prefix = model.approval.count > 1 ? `${model.approval.count} approvals` : '1 approval';
    operator = `⏸ ${prefix} · ${model.approval.toolName} · a approve · d deny`;
  }
  const canShareFooter = displayWidth(operator) + countersWidth + 4 <= width;
  const operatorBudget = Math.max(0, canShareFooter ? counterStart - 3 : width - 2);
  const operatorText = fitEnd(operator, operatorBudget);

  if (operatorText) {
    const color = model.approval ? '\x1b[33m' : '\x1b[90m';
    canvas.write(1, height - 1, `${color}${operatorText}${RESET}`);
  }
  if (canShareFooter) {
    canvas.write(counterStart, height - 1, `\x1b[90m${counters}${RESET}`);
  }
}
