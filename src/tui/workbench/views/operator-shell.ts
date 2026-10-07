import type { TerminalCanvas } from '../../canvas.js';
import { RESET } from '../../ansi-constants.js';
import type { OperatorShellSnapshot, OperatorShellStatus } from '../model/operator-shell.js';
import { displayWidth, graphemes, graphemeWidth } from '../render/terminal-text.js';
import { getWorkbenchPreviewTheme, type WorkbenchPreviewTheme } from '../model/preview-theme.js';
import { formatActivityElapsed } from '../../../agent/agent-activity.js';

export interface PaintOperatorShellInput {
  readonly canvas: TerminalCanvas;
  readonly width: number;
  readonly height: number;
  readonly model: OperatorShellSnapshot;
  readonly theme?: WorkbenchPreviewTheme;
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

interface ChromePart {
  readonly text: string;
  readonly color: string;
}

function paintParts(canvas: TerminalCanvas, row: number, x: number, parts: readonly ChromePart[], separator: string, separatorColor: string): void {
  for (const [index, part] of parts.entries()) {
    if (index > 0) {
      canvas.write(x, row, `${separatorColor}${separator}${RESET}`);
      x += displayWidth(separator);
    }
    canvas.write(x, row, `${part.color}${part.text}${RESET}`);
    x += displayWidth(part.text);
  }
}

function partsWidth(parts: readonly ChromePart[], separator: string): number {
  return parts.reduce((sum, part) => sum + displayWidth(part.text), 0)
    + Math.max(0, parts.length - 1) * displayWidth(separator);
}

interface StatusPart {
  readonly text: string;
  readonly open: string;
  readonly close: string;
}

/**
 * Formats the top status line byte-for-byte like AgentView's legacy status
 * write: yellow approval-wait, cyan RUNNING with the ⚠ SLOW/POSSIBLY
 * STALLED suffix. Elapsed text is computed from the paint-time clock.
 */
function buildStatusParts(status: OperatorShellStatus, now: number): readonly StatusPart[] {
  if (status.kind === 'approval-wait') {
    return [{ text: `WAITING FOR APPROVAL · ${formatActivityElapsed(now - status.requestedAt)}`, open: '\x1b[33m', close: RESET }];
  }
  const parts: StatusPart[] = [
    { text: `RUNNING ${formatActivityElapsed(now - status.startedAt)}`, open: '\x1b[36m', close: '\x1b[0m' },
    { text: ` | progress ${formatActivityElapsed(now - status.lastProgressAt)} ago`, open: '', close: '' },
  ];
  if (status.state !== 'healthy') {
    const kind = status.lastProgressKind ?? 'no activity';
    const desc = status.lastProgressDescription ?? '';
    const flag = status.state === 'stalled' ? 'POSSIBLY STALLED' : 'SLOW';
    parts.push({ text: ' | ', open: '', close: '' });
    parts.push({ text: `⚠ ${flag}`, open: '\x1b[33m', close: '\x1b[0m' });
    parts.push({ text: ` (${kind}${desc ? `: ${desc}` : ''})`, open: '', close: '' });
  }
  return parts;
}

function joinStatusParts(parts: readonly StatusPart[], maxWidth: number): string {
  const full = parts.map((part) => `${part.open}${part.text}${part.close}`).join('');
  const plainWidth = parts.reduce((sum, part) => sum + displayWidth(part.text), 0);
  if (plainWidth <= maxWidth) return full;
  // Width pressure truncates the status, never the right-aligned row-1 facts.
  const budget = maxWidth === 1 ? 0 : maxWidth - 1;
  let used = 0;
  let out = '';
  let stopped = false;
  for (const part of parts) {
    if (stopped) break;
    out += part.open;
    for (const grapheme of graphemes(part.text)) {
      const next = graphemeWidth(grapheme);
      if (used + next > budget) { stopped = true; break; }
      out += grapheme;
      used += next;
    }
    if (!stopped) out += part.close;
  }
  return `${out}${RESET}…`;
}

/** Preview chrome preserves the shared three-row header and one-row footer. */
export function paintOperatorShell(input: PaintOperatorShellInput): void {
  const { canvas, width, height, model } = input;
  if (width <= 0 || height <= 0) return;
  const theme = input.theme ?? getWorkbenchPreviewTheme();
  const { palette, glyphs } = theme;
  for (const row of [0, 1, 2, height - 1]) clearRow(canvas, row, width);
  const budget = Math.max(0, width - 2);
  const modeColor = model.mode === 'bypass' ? palette.red : model.mode === 'ask' ? palette.green : palette.yellow;
  const brand = budget >= 14 ? 'ALiX WORKBENCH' : budget >= 4 ? 'ALiX' : '';
  const badge = model.demo ? 'CONCEPT PREVIEW' : 'PREVIEW';
  const brandParts: ChromePart[] = [{ text: brand, color: `${palette.cyan}\x1b[1m` }];
  if (brand && displayWidth(brand) + badge.length + 3 <= budget) brandParts.push({ text: badge, color: palette.muted });
  paintParts(canvas, 0, 1, brandParts, '  ', palette.muted);

  const facts: ChromePart[] = [{ text: model.mode, color: modeColor }];
  if (model.agents?.waitingApproval) facts.push({ text: `${model.agents.waitingApproval} ${model.agents.waitingApproval === 1 ? 'approval' : 'approvals'}`, color: palette.yellow });
  if (model.agents?.stalled) facts.push({ text: `${model.agents.stalled} stalled`, color: palette.yellow });
  if (model.agents) facts.push({ text: `${model.agents.total} agents ${glyphs.separator} ${model.agents.running} running`, color: palette.green });
  const factsWidth = partsWidth(facts, ' | ');
  const brandWidth = partsWidth(brandParts, '  ');
  const available = budget - brandWidth - 3 - factsWidth - 3;
  // Column where right-aligned row-1 content begins (narrow chrome only);
  // the top status line must never paint past it.
  let rowOneRightStart = width;
  if (available >= 12) {
    const path = fitEnd(model.workspace, available - 11);
    const workspace: ChromePart = { text: `workspace: ${path}`, color: palette.cyan };
    const right = [workspace, ...facts];
    const rightWidth = partsWidth(right, ' | ');
    const start = width - 1 - rightWidth;
    paintParts(canvas, 0, start, right, ' | ', palette.muted);
    canvas.write(start, 0, `${palette.muted}workspace:${RESET}`);
  } else {
    const mode = facts[0]!;
    if (partsWidth(brandParts, '  ') + mode.text.length + 3 <= budget) {
      canvas.write(width - 1 - mode.text.length, 0, `${mode.color}${mode.text}${RESET}`);
    } else if (budget >= mode.text.length) {
      clearRow(canvas, 0, width);
      canvas.write(1, 0, `${mode.color}${mode.text}${RESET}`);
    }
    const rowFacts: ChromePart[] = [];
    for (const fact of facts.slice(1)) {
      if (partsWidth([...rowFacts, fact], ' | ') <= budget) rowFacts.push(fact);
    }
    const countWidth = partsWidth(rowFacts, ' | ');
    const pathBudget = Math.max(0, budget - (countWidth ? countWidth + 3 : 0) - 11);
    const path = fitEnd(model.workspace, pathBudget);
    if (path) {
      canvas.write(1, 1, `${palette.muted}workspace: ${palette.cyan}${path}${RESET}`);
    }
    if (countWidth && countWidth <= budget) {
      rowOneRightStart = width - countWidth - 1;
      paintParts(canvas, 1, rowOneRightStart, rowFacts, ' | ', palette.muted);
    }
  }

  // Top status line on header row 1, left side: chrome owns it in Workbench
  // (agent-view keeps the write only for legacy mode). Approval wait and
  // running liveness never share the line — approval replaced liveness at
  // projection time.
  if (model.status) {
    const hasRowOneFacts = rowOneRightStart < width;
    const statusWidth = hasRowOneFacts ? rowOneRightStart - 2 : width - 1;
    if (statusWidth > 0) {
      const parts = buildStatusParts(model.status, Date.now());
      if (parts.length > 0) {
        canvas.write(1, 1, ' '.repeat(statusWidth));
        canvas.write(1, 1, joinStatusParts(parts, statusWidth));
      }
    }
  }

  const count = (value: number | undefined): string => value === undefined ? 'unavailable' : value.toLocaleString('en-US');
  const counters: ChromePart[] = [
    { text: `TOKENS ${count(model.tokensUsed)}`, color: palette.foreground },
    { text: `FILES ${count(model.filesTouched)}`, color: palette.foreground },
    { text: `EVENTS ${count(model.eventCount)}`, color: palette.foreground },
    { text: `AGENTS ${model.agents?.total ?? 'unavailable'}`, color: palette.foreground },
  ];
  if (model.agents?.knownCostUsd !== undefined) {
    counters.push({ text: `COST $${model.agents.knownCostUsd.toFixed(4)}${model.agents.costCoverage < model.agents.total ? '+' : ''}`, color: palette.foreground });
  }
  const escape = model.escapeAction === 'close' ? 'Esc close' : model.running ? 'Esc cancel' : model.focus === 'transcript' ? 'Esc type' : '';
  let hints = ['Tab views', 'Ctrl+O details', 'Ctrl+R artifacts', ...(escape ? [escape] : [])];
  if (model.focus === 'composer') hints.push('Ctrl+F transcript', 'Ctrl+E inspector');
  if (model.focus === 'transcript') {
    hints = ['Ctrl+F type', '1-5 filters', 's scope', 'f follow', 'Ctrl+O details', ...(escape ? [escape] : [])];
  } else if (model.focus === 'drawer') {
    hints = ['Up/Down select', ...(model.drawer === 'agents' ? ['1-9 agents', '/ all', 'c coordinate'] : []),
      'Ctrl+F transcript', ...(escape ? [escape] : [])];
  } else if (model.focus === 'modal') {
    hints = [...(model.inspectorOpen ? ['Ctrl+R artifacts'] : []), ...(escape ? [escape] : [])];
  }
  if (model.queuedMessages > 0) hints.push(`${model.queuedMessages} queued`);
  if (model.approval) {
    hints = [`${model.approval.count} ${model.approval.count === 1 ? 'approval' : 'approvals'}`, model.approval.toolName, 'a approve', 'd deny', ...(escape ? [escape] : [])];
  }
  const separator = ` ${glyphs.separator} `;
  const hintText = hints.join(separator);
  const counterWidth = partsWidth(counters, ' | ');
  const canShare = displayWidth(hintText) + counterWidth + 3 <= budget;
  if (!canShare && displayWidth(hintText) > budget) {
    // Decision and cancellation keys are indivisible; drop optional groups first.
    hints = model.approval ? ['a approve', 'd deny', ...(escape ? [escape] : []), `${model.approval.count} approval`] : [...(escape ? [escape] : []), ...(model.queuedMessages > 0 ? [`${model.queuedMessages} queued`] : []), 'Tab views'];
    while (hints.length && displayWidth(hints.join(separator)) > budget) hints.pop();
  }
  const hintParts: ChromePart[] = hints.map(text => ({ text, color: model.approval ? palette.yellow : palette.muted }));
  paintParts(canvas, height - 1, 1, hintParts, separator, palette.muted);
  // Accent keys without changing group widths or clipping key names.
  let hintX = 1;
  for (const hint of hints) {
    const key = /^(Ctrl\+\w|Tab|Esc|Up\/Down|[1-9]-[1-9]|\/|[adsfc])(?= )/u.exec(hint)?.[0];
    if (key) canvas.write(hintX, height - 1, `${palette.cyan}${key}${RESET}`);
    hintX += displayWidth(hint) + displayWidth(separator);
  }
  if (canShare) {
    const start = width - 1 - counterWidth;
    paintParts(canvas, height - 1, start, counters, ' | ', palette.muted);
    let x = start;
    for (const counter of counters) {
      const label = counter.text.split(' ')[0]!;
      canvas.write(x, height - 1, `${palette.muted}${label}${RESET}`);
      x += displayWidth(counter.text) + 3;
    }
  }
}
