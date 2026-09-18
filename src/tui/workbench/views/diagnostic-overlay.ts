import type { CanvasRect } from '../../canvas.js';
import { RESET } from '../../ansi-constants.js';
import type { WorkbenchDiffSnapshot } from '../model/diff-summary.js';
import type { WorkbenchOverlay } from '../model/ui-state.js';

function fit(text: string, width: number): string {
  return text.length <= width ? text : width <= 1 ? '…' : `${text.slice(0, width - 1)}…`;
}

export function paintWorkbenchDiagnosticOverlay(
  rect: CanvasRect,
  overlay: WorkbenchOverlay | undefined,
  diffs: WorkbenchDiffSnapshot | null | undefined,
): void {
  if (!overlay || rect.width < 30 || rect.height < 12) return;
  const width = Math.min(88, rect.width - 4);
  const height = Math.min(18, rect.height - rect.headerH - rect.footerH);
  const left = Math.floor((rect.width - width) / 2);
  const top = rect.headerH + 1;
  const inner = width - 2;
  for (let row = 0; row < height; row++) rect.canvas.write(left, top + row, ' '.repeat(width));
  const title = overlay === 'diff' ? ' DIFFS ' : overlay === 'review' ? ' REVIEW ' : ' HELP ';
  rect.canvas.write(left, top, `\x1b[36m╭${title}${'─'.repeat(Math.max(0, inner - title.length))}╮${RESET}`);
  for (let row = 1; row < height - 1; row++) {
    rect.canvas.write(left, top + row, `\x1b[36m│${RESET}`);
    rect.canvas.write(left + width - 1, top + row, `\x1b[36m│${RESET}`);
  }
  rect.canvas.write(left, top + height - 1, `\x1b[36m╰${'─'.repeat(inner)}╯${RESET}`);
  const lines = overlay === 'help'
    ? ['Enter submit / queue', 'Shift+Enter newline', 'Esc close / cancel', 'Ctrl+A agents · Ctrl+T tasks', 'Ctrl+O details · Shift+Tab permission', '/agents · /tasks · /diff · /review · /help']
    : [
        `${diffs?.filesChanged ?? 0} files across ${diffs?.diffs.length ?? 0} patch operations`,
        '',
        ...(diffs?.diffs.flatMap((diff) => [
          `${diff.status === 'applied' ? '✓' : diff.status === 'failed' ? '✗' : '○'} ${diff.status} · ${diff.toolCallId ?? diff.id}`,
          ...diff.changedFiles.map((file) => `  ${file}`),
        ]) ?? ['No patch activity in this session.']),
        ...(overlay === 'review' ? ['', 'Review is read-only; use the composer to request changes.'] : []),
      ];
  lines.slice(0, height - 3).forEach((line, index) => rect.canvas.write(left + 2, top + 1 + index, fit(line, inner - 2)));
  rect.canvas.write(left + 2, top + height - 2, `\x1b[90mEsc close${RESET}`);
}
