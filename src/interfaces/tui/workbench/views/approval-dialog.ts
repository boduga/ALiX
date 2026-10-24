import type { CanvasRect } from '../../canvas.js';
import { RESET } from '../../ansi-constants.js';
import type { ApprovalRecordSnapshot } from '../../snapshot.js';

function fit(text: string, width: number): string {
  if (width <= 0) return '';
  return text.length <= width ? text : width === 1 ? '…' : `${text.slice(0, width - 1)}…`;
}

const DECISION_ROW_TEXT = 'a approve · d deny';
const APPROVE_LABEL = 'a approve';
const DENY_LABEL = 'd deny';

/** Row index of the decision labels inside a built approval card. */
export const WORKBENCH_APPROVAL_DECISION_ROW = 3;

export interface WorkbenchApprovalDecisionSpan {
  readonly label: string;
  readonly decision: 'approved' | 'denied';
  readonly start: number;
  readonly end: number;
}

/**
 * Column spans of the approve/deny labels inside a built card. Both renderers
 * derive these from the same literal the card text is built from, so a hit
 * target can never drift from the painted label.
 */
export function workbenchApprovalDecisionSpans(): readonly WorkbenchApprovalDecisionSpan[] {
  const base = 1;
  const denyAt = DECISION_ROW_TEXT.indexOf(DENY_LABEL);
  return [
    { label: APPROVE_LABEL, decision: 'approved', start: base, end: base + APPROVE_LABEL.length },
    { label: DENY_LABEL, decision: 'denied', start: base + denyAt, end: base + denyAt + DENY_LABEL.length },
  ];
}

/** Build the shared, bounded representation of an authoritative approval. */
export function buildWorkbenchApprovalCardLines(
  approval: Pick<ApprovalRecordSnapshot, 'id' | 'toolName' | 'target' | 'requestedAt'>,
  totalPending: number,
  width: number,
  _now = Date.now(),
  /**
   * 1-based position of this approval among the pending set.
   *
   * The title used to hardcode `1 OF ${totalPending}` for every card, so two
   * pending approvals both read "1 OF 2" and the second was indistinguishable
   * from the first. Optional to keep existing callers that render a single card
   * unchanged.
   */
  position?: number,
): string[] {
  if (width < 12) return [];
  const cardWidth = Math.min(width, 76);
  const inner = cardWidth - 2;
  const ordinal = totalPending > 1 ? ` · ${position ?? 1} OF ${totalPending}` : '';
  const title = ` ${fit(`APPROVAL REQUIRED · ${approval.toolName}${ordinal}`, inner - 2)} `;
  return [
    `╭${title}${'─'.repeat(Math.max(0, inner - title.length))}╮`,
    `│${fit(approval.target || 'No target details provided', inner).padEnd(inner)}│`,
    `│${fit(`pending · id ${approval.id}`, inner).padEnd(inner)}│`,
    `│${fit(DECISION_ROW_TEXT, inner).padEnd(inner)}│`,
    `│${fit('Ctrl+O details · remains pending until runtime confirms', inner).padEnd(inner)}│`,
    `╰${'─'.repeat(inner)}╯`,
  ];
}

/** Paint the oldest authoritative pending approval without mutating it. */
export function paintWorkbenchApprovalDialog(
  rect: CanvasRect,
  approval: ApprovalRecordSnapshot | Pick<ApprovalRecordSnapshot, 'id' | 'toolName' | 'target' | 'requestedAt'> | undefined,
  totalPending: number,
  now = Date.now(),
): void {
  if (!approval || rect.width < 24 || rect.height - rect.headerH - rect.footerH < 7) return;
  const width = Math.min(rect.width - 4, 76);
  const left = Math.max(2, Math.floor((rect.width - width) / 2));
  const top = rect.headerH + 2;
  const lines = buildWorkbenchApprovalCardLines(approval, totalPending, width, now);
  for (let offset = 0; offset < lines.length; offset++) {
    rect.canvas.write(left, top + offset, `\x1b[33m${lines[offset]}${RESET}`);
  }
}
