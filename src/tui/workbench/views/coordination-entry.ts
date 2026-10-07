import type { CanvasRect } from '../../canvas.js';
import type { CoordinationEntryState } from '../model/ui-state.js';
import { layoutComposer } from './composer-view.js';
import { truncateDisplayText } from '../render/terminal-text.js';

export function validateCoordinationObjective(goal: string): string | undefined {
  if (!goal.trim()) return 'Enter an objective before launching.';
  if (goal.length > 12000) return 'Objective exceeds 12,000 characters; shorten it before launching.';
  if (/[\x00-\x09\x0b-\x1f\x7f]/u.test(goal)) return 'Objective contains unsupported control characters.';
  return undefined;
}

/** Bounded editable objective; no runtime calls or inferred worker state. */
export function paintCoordinationEntry(
  rect: CanvasRect,
  state: CoordinationEntryState,
  mode: string,
): { row: number; column: number } | undefined {
  const width = Math.max(0, Math.min(88, rect.width - 2));
  const height = Math.max(0, Math.min(14, rect.height - rect.headerH - rect.footerH - 1));
  if (width < 8 || height < 4) return;
  const left = Math.floor((rect.width - width) / 2);
  const top = rect.headerH + 1;
  const inner = width - 2;
  const fit = (text: string) => truncateDisplayText(text.replace(/[\x00-\x1f\x7f]/g, ' '), inner - 2);
  for (let y = 0; y < height; y++) rect.canvas.write(left, top + y, ' '.repeat(width));
  rect.canvas.write(left, top, `\x1b[36m╭${truncateDisplayText(' COORDINATION RUN ', inner).padEnd(inner, '─')}╮\x1b[0m`);
  for (let y = 1; y < height - 1; y++) {
    rect.canvas.write(left, top + y, '\x1b[36m│\x1b[0m');
    rect.canvas.write(left + width - 1, top + y, '\x1b[36m│\x1b[0m');
  }
  rect.canvas.write(left, top + height - 1, `\x1b[36m╰${'─'.repeat(inner)}╯\x1b[0m`);
  if (height >= 6) rect.canvas.write(left + 2, top + 1, fit(`Objective · ${mode} · ${state.phase}`));
  const firstRow = top + (height >= 6 ? 3 : 1);
  const maxRows = Math.max(1, top + height - 3 - firstRow);
  const displayDraft = state.draft.text.replace(/[\x00-\x09\x0b-\x1f\x7f]/g, ' ');
  const composer = layoutComposer(displayDraft, width, maxRows, state.draft.cursor);
  composer.rows.forEach((text, index) => rect.canvas.write(left + 2, firstRow + index,
    text ? fit(text) : '\x1b[90m' + fit('Describe the coordinated work…') + '\x1b[0m'));
  if (state.message && height >= 7) rect.canvas.write(left + 2, top + height - 3, '\x1b[33m' + fit(state.message) + '\x1b[0m');
  rect.canvas.write(left + 2, top + height - 2, '\x1b[90m' + fit(state.phase === 'submitting'
    ? 'Running · Esc close · Ctrl+C cancel'
    : 'Enter launch · Shift+Enter newline · Esc close') + '\x1b[0m');
  if (state.phase === 'submitting') return;
  return { row: firstRow + composer.cursorRow, column: left + 2 + composer.cursorColumn };
}
