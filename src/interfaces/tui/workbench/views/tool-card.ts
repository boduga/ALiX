import type { ScrollbackLine } from '../../views/bottom-anchored-viewport.js';
import { displayWidth, truncateDisplayText, wrapDisplayText } from '../../terminal-text.js';
import type { ToolItem, TranscriptMode } from '../model/transcript-item.js';
import { getWorkbenchPreviewTheme, type WorkbenchPreviewTheme } from '../model/preview-theme.js';

export interface WorkbenchToolCardOptions {
  readonly width: number;
  readonly indent?: number;
  readonly mode?: TranscriptMode;
  readonly theme?: WorkbenchPreviewTheme;
  /** Explicit concept presentation only; live callers retain the exact tool label. */
  readonly displayLabel?: string;
  readonly approvalPending?: boolean;
}

export interface WorkbenchToolCardLine extends ScrollbackLine {
  readonly previewFormatted: true;
}

const MAX_FIELD_CHARACTERS = 2048;
const MAX_DETAIL_CHARACTERS = 4096;
const MAX_DETAIL_ROWS = 8;
const MAX_METADATA_ROWS = 8;

/** All event-provided strings remain data; discard terminal escape/control sequences. */
function safeToolCardText(value: string, limit: number): { text: string; clipped: boolean } {
  const clipped = value.length > limit;
  const bounded = value.slice(0, limit);
  const text = bounded
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\|$)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
    .replace(/\r\n?/g, '\n');
  return { text, clipped };
}

function boundedRows(text: string, width: number, limit: number, ascii: boolean): string[] {
  const rows = text.split('\n').flatMap((line) => wrapDisplayText(line.replace(/\t/g, ' '), Math.max(1, width)));
  const result = rows.slice(0, limit).map((row) => truncateDisplayText(row, width));
  if (rows.length > limit && result.length > 0) result[result.length - 1] = truncateDisplayText(ascii ? '[truncated]' : '… truncated', width);
  return result.map((row) => ascii ? row.replace(/…/g, '~') : row);
}

/** Pure, bounded card rows with per-invocation anchors; never reads the displayed path. */
export function buildWorkbenchToolCardLines(tool: ToolItem, options: WorkbenchToolCardOptions): WorkbenchToolCardLine[] {
  const width = Math.max(1, Number.isFinite(options.width) ? Math.floor(options.width) : 1);
  const theme = options.theme ?? getWorkbenchPreviewTheme();
  const { palette: p, glyphs: g } = theme;
  const ascii = theme.glyphMode === 'ascii';
  const reset = theme.colorMode === 'monochrome' ? '' : '\x1b[0m';
  const name = safeToolCardText(options.displayLabel ?? tool.name, MAX_FIELD_CHARACTERS).text.replace(/\s+/g, ' ');
  const status = tool.status === 'completed' ? 'success' : tool.status;
  const glyph = tool.status === 'completed' ? g.success : tool.status === 'failed' ? g.failed : tool.status === 'cancelled' ? g.cancelled : ascii ? '>' : '→';
  const statusColor = tool.status === 'completed' ? p.green : tool.status === 'failed' ? p.red : tool.status === 'cancelled' ? p.muted : p.yellow;
  const outcome = `${glyph} ${status}`;
  const requestedIndent = Number.isFinite(options.indent) ? Math.max(0, Math.floor(options.indent!)) : 0;
  const indent = width - requestedIndent >= 24 ? requestedIndent : Math.min(2, Math.max(0, width - 6));
  const cardWidth = width - indent;
  const texts: string[] = [];
  const push = (text: string): void => { texts.push(text); };

  if (cardWidth < 8) {
    boundedRows(`TOOL ${name}`, cardWidth, 2, ascii).forEach((text) => push(`${p.cyan}${text}${reset}`));
    boundedRows(outcome, cardWidth, 2, ascii).forEach((text) => push(`${statusColor}${text}${reset}`));
  } else {
    const inner = cardWidth - 2;
    const border = (left: string, right: string): string => `${p.divider}${left}${g.horizontal.repeat(inner)}${right}${reset}`;
    const row = (text: string, color = p.foreground): void => {
      const bounded = truncateDisplayText(text, inner).replace(/…/g, ascii ? '~' : '…');
      push(`${p.divider}${g.vertical}${reset}${color}${bounded}${' '.repeat(Math.max(0, inner - displayWidth(bounded)))}${p.divider}${g.vertical}${reset}`);
    };
    push(border(g.topLeft, g.topRight));
    const headerNameWidth = Math.max(0, inner - 9 - displayWidth(outcome));
    if (headerNameWidth >= 4) {
      const label = truncateDisplayText(name, headerNameWidth).replace(/…/g, ascii ? '~' : '…');
      const header = ` TOOL ${label}`;
      const gap = Math.max(1, inner - displayWidth(header) - displayWidth(outcome) - 1);
      push(`${p.divider}${g.vertical}${reset} ${p.badgeFill}${p.badgeText}TOOL${reset} ${p.cyan}${label}${' '.repeat(gap)}${statusColor}${outcome} ${p.divider}${g.vertical}${reset}`);
    } else {
      row(` TOOL ${name}`, p.cyan);
      row(` ${outcome}`, statusColor);
    }
    push(border(ascii ? '+' : '├', ascii ? '+' : '┤'));

    const path = tool.metadata?.path === undefined ? 'unavailable' : safeToolCardText(tool.metadata.path, MAX_FIELD_CHARACTERS).text;
    const range = tool.metadata?.requestedRange;
    const validRange = range && Number.isInteger(range.startLine) && Number.isInteger(range.endLine) && range.startLine > 0 && range.endLine >= range.startLine;
    const rangeText = validRange ? `${range.startLine}${ascii ? '-' : '–'}${range.endLine}` : 'unavailable';
    const observed = tool.metadata?.observedLineCount;
    const validCount = observed !== undefined && Number.isSafeInteger(observed) && observed >= 0;
    const count = validCount ? `(${observed} lines)` : 'lines unavailable';
    const countWidth = Math.min(20, Math.max(displayWidth(count), 10));
    const splitColumns = inner >= countWidth + 24;
    const metadataWidth = splitColumns ? inner - countWidth - 4 : inner - 3;
    const metadata = [
      ...boundedRows(`path: ${path}`, Math.max(1, metadataWidth), MAX_METADATA_ROWS - 3, ascii),
      ...boundedRows(`requested lines: ${rangeText}`, Math.max(1, metadataWidth), 3, ascii),
    ];
    metadata.forEach((text, index) => {
      const label = truncateDisplayText(text, metadataWidth);
      const left = ` ${g.vertical} ${label}${' '.repeat(Math.max(0, metadataWidth - displayWidth(label)))}`;
      if (splitColumns) {
        const right = index === 0 ? truncateDisplayText(count, countWidth).replace(/…/g, ascii ? '~' : '…') : '';
        push(`${p.divider}${g.vertical} ${g.vertical} ${reset}${p.muted}${label}${' '.repeat(Math.max(0, metadataWidth - displayWidth(label)))}${p.divider}${g.vertical}${reset}${p.muted}${' '.repeat(Math.max(0, countWidth - displayWidth(right)))}${right}${p.divider}${g.vertical}${reset}`);
      } else row(left, p.muted);
    });
    if (!splitColumns) row(`returned: ${count}`, p.muted);
    if (options.approvalPending && tool.status === 'running') row('approval required', p.yellow);
    if (tool.durationMs !== undefined && Number.isFinite(tool.durationMs) && tool.durationMs >= 0) row(`duration: ${tool.durationMs}ms`, p.muted);
    if (options.mode === 'detailed' || tool.status === 'failed') {
      if (options.mode === 'detailed' || (options.displayLabel !== undefined && options.displayLabel !== tool.name)) {
        boundedRows(`tool: ${safeToolCardText(tool.name, MAX_FIELD_CHARACTERS).text}`, Math.max(1, inner - 2), 3, ascii).forEach((text) => row(` ${text}`, p.muted));
      }
      if (options.mode === 'detailed') row(`call: ${safeToolCardText(tool.metadata?.toolCallId ?? tool.id, MAX_FIELD_CHARACTERS).text}`, p.muted);
      if (tool.detail) {
        const detail = safeToolCardText(tool.detail, MAX_DETAIL_CHARACTERS);
        push(border(ascii ? '+' : '├', ascii ? '+' : '┤'));
        boundedRows(detail.text, Math.max(1, inner - 2), MAX_DETAIL_ROWS, ascii).forEach((line) => row(` ${line}`, tool.status === 'failed' ? p.red : p.muted));
        if (detail.clipped) row('[output truncated]', p.muted);
      }
    }
    push(border(g.bottomLeft, g.bottomRight));
  }
  return texts.map((text, index) => {
    const connector = index === 0 ? (ascii ? '+-' : '├─') : index === texts.length - 1 ? (ascii ? '+-' : '└─') : `${g.vertical} `;
    const guide = indent >= 2 ? `${' '.repeat(indent - 2)}${p.divider}${connector}${reset}` : ' '.repeat(indent);
    return { kind: 'toolCall', text: `${guide}${text}`, isFirst: index === 0,
    itemId: `tool:${tool.id}`, wrappedOffset: index, previewFormatted: true };
  });
}
