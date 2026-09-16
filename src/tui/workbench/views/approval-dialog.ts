import type { CanvasRect } from '../../canvas.js';
import { RESET } from '../../ansi-constants.js';
import type { ApprovalRecordSnapshot } from '../../snapshot.js';

function fit(text: string, width: number): string {
  if (width <= 0) return '';
  return text.length <= width ? text : width === 1 ? '…' : `${text.slice(0, width - 1)}…`;
}

/** Paint the oldest authoritative pending approval without mutating it. */
export function paintWorkbenchApprovalDialog(
  rect: CanvasRect,
  approval: ApprovalRecordSnapshot | undefined,
  totalPending: number,
): void {
  if (!approval || rect.width < 24 || rect.height - rect.headerH - rect.footerH < 6) return;
  const width = Math.min(rect.width - 4, 76);
  const left = Math.max(2, Math.floor((rect.width - width) / 2));
  const top = rect.headerH + 2;
  const inner = width - 2;
  const title = totalPending > 1 ? ` APPROVAL REQUIRED · 1 OF ${totalPending} ` : ' APPROVAL REQUIRED ';
  const toolTarget = `${approval.toolName}${approval.target ? ` · ${approval.target}` : ''}`;
  const lines = [
    `╭${title}${'─'.repeat(Math.max(0, inner - title.length))}╮`,
    `│${fit(toolTarget, inner).padEnd(inner)}│`,
    `│${fit(`id ${approval.id}`, inner).padEnd(inner)}│`,
    `│${fit('a approve · d deny · remains pending until runtime confirms', inner).padEnd(inner)}│`,
    `╰${'─'.repeat(inner)}╯`,
  ];
  for (let offset = 0; offset < lines.length; offset++) {
    rect.canvas.write(left, top + offset, `\x1b[33m${lines[offset]}${RESET}`);
  }
}
