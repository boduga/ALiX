import type { CanvasRect } from '../../canvas.js';
import { RESET } from '../../ansi-constants.js';
import type { ApprovalRecordSnapshot } from '../../snapshot.js';
import { formatActivityElapsed } from '../../../agent/agent-activity.js';

function fit(text: string, width: number): string {
  if (width <= 0) return '';
  return text.length <= width ? text : width === 1 ? '…' : `${text.slice(0, width - 1)}…`;
}

/** Paint the oldest authoritative pending approval without mutating it. */
export function paintWorkbenchApprovalDialog(
  rect: CanvasRect,
  approval: ApprovalRecordSnapshot | undefined,
  totalPending: number,
  now = Date.now(),
): void {
  if (!approval || rect.width < 24 || rect.height - rect.headerH - rect.footerH < 7) return;
  const width = Math.min(rect.width - 4, 76);
  const left = Math.max(2, Math.floor((rect.width - width) / 2));
  const top = rect.headerH + 2;
  const inner = width - 2;
  const position = totalPending > 1 ? ` · 1 OF ${totalPending}` : '';
  const title = ` ${fit(`APPROVAL REQUIRED · ${approval.toolName}${position}`, inner - 2)} `;
  const pendingFor = formatActivityElapsed(now - approval.requestedAt);
  const lines = [
    `╭${title}${'─'.repeat(Math.max(0, inner - title.length))}╮`,
    `│${fit(approval.target || 'No target details provided', inner).padEnd(inner)}│`,
    `│${fit(`pending ${pendingFor} · id ${approval.id}`, inner).padEnd(inner)}│`,
    `│${fit('a approve · d deny', inner).padEnd(inner)}│`,
    `│${fit('Ctrl+O details · remains pending until runtime confirms', inner).padEnd(inner)}│`,
    `╰${'─'.repeat(inner)}╯`,
  ];
  for (let offset = 0; offset < lines.length; offset++) {
    rect.canvas.write(left, top + offset, `\x1b[33m${lines[offset]}${RESET}`);
  }
}
