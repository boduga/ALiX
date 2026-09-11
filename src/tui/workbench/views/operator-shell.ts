import type { TerminalCanvas } from '../../canvas.js';
import { RESET } from '../../ansi-constants.js';
import type { OperatorShellSnapshot } from '../model/operator-shell.js';

export interface PaintOperatorShellInput {
  readonly canvas: TerminalCanvas;
  readonly width: number;
  readonly height: number;
  readonly model: OperatorShellSnapshot;
}

function fitEnd(value: string, width: number): string {
  if (width <= 0) return '';
  if (value.length <= width) return value;
  if (width === 1) return '…';
  return `…${value.slice(-(width - 1))}`;
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
  if (width >= hint.length + 14) {
    canvas.write(width - hint.length - 1, 0, `\x1b[90m${hint}${RESET}`);
  }

  const state = `agent · ${model.mode} · ${model.transcriptMode}`;
  const stateStart = Math.max(1, width - state.length - 1);
  const workspaceBudget = Math.max(0, stateStart - 9);
  const workspace = fitEnd(model.workspace, workspaceBudget);
  const modeColor = model.mode === 'bypass' ? '\x1b[31m' : model.mode === 'ask' ? '\x1b[32m' : '\x1b[33m';

  canvas.write(1, 1, `\x1b[32m\x1b[1mALiX${RESET}`);
  if (workspace) canvas.write(7, 1, `\x1b[90m${workspace}${RESET}`);
  canvas.write(stateStart, 1, `\x1b[90magent · ${modeColor}${model.mode}${RESET}\x1b[90m · ${model.transcriptMode}${RESET}`);
  canvas.write(0, 2, `\x1b[90m${'─'.repeat(width)}${RESET}`);

  const counters = `tokens ${model.tokensUsed.toLocaleString('en-US')} · files ${model.filesTouched.toLocaleString('en-US')} · events ${model.eventCount.toLocaleString('en-US')}`;
  const counterStart = Math.max(1, width - counters.length - 1);
  let operator = model.running ? 'Esc cancel' : '↑↓ scroll';
  if (model.approval) {
    const prefix = model.approval.count > 1 ? `${model.approval.count} approvals` : '1 approval';
    operator = `⏸ ${prefix} · a/d ${model.approval.label}`;
  }
  const canShareFooter = operator.length + counters.length + 4 <= width;
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
