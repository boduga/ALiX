import { formatActivityLine } from '../../views/activity-line.js';
import type { ScrollbackLine } from '../../views/bottom-anchored-viewport.js';
import { wrapText } from '../../views/wrap-text.js';
import type { ViewRenderContext } from '../../views/types.js';
import { ConversationProjection } from '../projections/conversation-projection.js';
import type { TranscriptItem, ToolItem, TranscriptMode } from '../model/transcript-item.js';
import { buildWorkbenchApprovalCardLines } from './approval-dialog.js';
import { getTranscriptFocusAgentId, transcriptItemMatchesFilter } from '../model/transcript-filter.js';
import { displayWidth, truncateDisplayText, wrapDisplayText } from '../../terminal-text.js';
import { stripAnsi } from '../../box.js';
import { renderResponse } from '../../blocks/render.js';
import { getTheme } from '../../blocks/theme.js';
import { getWorkbenchPreviewTheme } from '../model/preview-theme.js';

export interface WorkbenchScrollbackLine extends ScrollbackLine {
  readonly previewFormatted?: true;
}

function transcriptActor(item: TranscriptItem, ctx: ViewRenderContext): string {
  if (item.kind === 'user') return 'YOU';
  if (!item.agentId) return 'ALiX';
  const agent = ctx.snap.runtime?.agents?.agents.find((agent) => agent.agentId === item.agentId);
  return agent?.assignedAgentId ?? item.agentId;
}

function formatTranscriptTime(startedAt: number): string {
  const date = new Date(startedAt);
  return startedAt > 0 && Number.isFinite(date.getTime()) ? date.toISOString().slice(11, 19) : '??:??:??';
}

function appendPreviewRows(out: ScrollbackLine[], kind: string, body: string, width: number, item: TranscriptItem, ctx: ViewRenderContext, status = ''): void {
  const p = getWorkbenchPreviewTheme().palette;
  const reset = '\x1b[0m';
  const outcome = item.kind === 'activity' ? item.verifiedOutcome : undefined;
  const outcomeGlyph = outcome === 'success' ? '✓' : outcome === 'failure' ? '✗' : undefined;
  const markedBody = outcomeGlyph && !body.startsWith(outcomeGlyph) ? `${outcomeGlyph} ${body}` : body;
  const bodyRows = (columns: number): readonly string[] => renderResponse(markedBody, columns, ctx.themeName ? getTheme(ctx.themeName) : undefined)
    .flatMap((row) => displayWidth(stripAnsi(row.text)) <= columns ? [row.text] : wrapDisplayText(stripAnsi(row.text), columns))
    .map((text, index) => index === 0 && outcome !== undefined
      ? text.replace(outcome === 'success' ? /^✓/ : /^✗/, (glyph) => `${outcome === 'success' ? p.green : p.red}${glyph}${p.foreground}`)
      : text);
  const agent = item.agentId ? ctx.snap.runtime?.agents?.agents.find((agent) => agent.agentId === item.agentId) : undefined;
  const actorColor = agent?.role === 'coordinator' || agent?.role === 'orchestrator' ? p.purple
    : item.kind === 'user' ? p.foreground
    : agent && ['waiting', 'waiting_dependency', 'waiting_approval'].includes(agent.state) ? p.yellow : p.teal;
  const actor = transcriptActor(item, ctx).replace(/[\x00-\x1f\x7f]/g, '');
  const time = `[${formatTranscriptTime(item.startedAt)}]`;
  const actorColumn = truncateDisplayText(actor, 18);
  const safeStatus = truncateDisplayText(stripAnsi(status).replace(/[\x00-\x1f\x7f]/g, ''), 10);
  const statusColor = /^(WAITING|APPROVAL|PARTIAL|CANCELLING)$/.test(safeStatus) ? p.yellow
    : /^(RUNNING|STARTING|VERIFYING)$/.test(safeStatus) ? p.green
    : safeStatus === 'FAILED' ? p.red : safeStatus === 'COMPLETED' ? p.purple : p.muted;
  if (width >= 72) {
    const prefix = `${time} ${actorColumn}${' '.repeat(18 - displayWidth(actorColumn))} ${safeStatus}${' '.repeat(10 - displayWidth(safeStatus))} `;
    const styledPrefix = `${p.muted}${time}${reset} ${actorColor}${actorColumn}${reset}${' '.repeat(18 - displayWidth(actorColumn))} ${statusColor}${safeStatus}${reset}${' '.repeat(10 - displayWidth(safeStatus))} `;
    const rows = bodyRows(Math.max(1, width - displayWidth(prefix)));
    rows.forEach((text, index) => out.push({ kind, text: `${index === 0 ? styledPrefix : ' '.repeat(displayWidth(prefix))}${p.foreground}${text}${reset}`, isFirst: index === 0, ...(index === 0 && (kind === 'user' || kind === 'agent') ? { gutter: kind === 'user' ? 'YOU' : 'ALiX' } : {}) }));
  } else {
    const metadata = `${time} ${actor}${status ? ` ${safeStatus}` : ''}`;
    const metadataRows = wrapDisplayText(metadata, width);
    metadataRows.forEach((text, index) => out.push({ kind, text: metadataRows.length === 1
      ? `${p.muted}${time}${reset} ${actorColor}${actor}${reset}${status ? ` ${statusColor}${safeStatus}${reset}` : ''}`
      : `${actorColor}${text}${reset}`, isFirst: index === 0 }));
    const indent = width > 2 ? '  ' : '';
    bodyRows(Math.max(1, width - indent.length)).forEach((text) => out.push({ kind, text: `${indent}${p.foreground}${text}${reset}`, isFirst: false }));
  }
}

function tagRows(out: ScrollbackLine[], start: number, itemId: string): void {
  for (let index = start; index < out.length; index++) {
    out[index]!.itemId = itemId;
    out[index]!.wrappedOffset = index - start;
  }
}

function appendSeparator(out: ScrollbackLine[], itemId: string): void {
  if (out.length > 0) out.push({ kind: 'user', text: '', isFirst: false, itemId: `separator:${itemId}`, wrappedOffset: 0 });
}

function toolMarker(tool: ToolItem): string {
  switch (tool.status) {
    case 'running': return '→';
    case 'completed': return '✓';
    case 'failed': return '✗';
    case 'cancelled': return '○';
  }
}

function toolSummary(tool: ToolItem, pendingApprovalTool?: string): string {
  if (pendingApprovalTool === tool.name && tool.status === 'running') return `→ ${tool.name} · approval required`;
  const duration = tool.durationMs === undefined ? '' : ` · ${tool.durationMs}ms`;
  return `${toolMarker(tool)} ${tool.name}${duration}`;
}

/**
 * Converts the semantic conversation snapshot into the existing scrollback
 * renderer's line contract. This is the temporary strangler adapter: the new
 * information architecture can ship inside AgentView while the canvas,
 * viewport, input panel, plans, streaming, and activity contracts remain
 * stable.
 */
export function buildWorkbenchScrollbackLines(
  ctx: ViewRenderContext,
  textWidth: number,
): WorkbenchScrollbackLine[] {
  const out: ScrollbackLine[] = [];
  const mode: TranscriptMode = ctx.perTab.transcriptMode ?? 'compact';
  const focusAgentId = getTranscriptFocusAgentId(ctx.workbenchUiState);
  const filter = ctx.workbenchUiState?.transcriptFilter ?? 'all';
  const pendingApprovals = ctx.perTab.pendingApprovals ?? [];
  const pendingApproval = pendingApprovals[0];
  const pendingApprovalTool = pendingApproval?.toolName;
  let inlineApprovalRendered = false;
  const conversation = new ConversationProjection().project({
    timeline: ctx.runtime?.agent?.timeline ?? [],
    trace: ctx.snap.runtime?.trace ?? [],
    mode,
    ...(focusAgentId ? { focusAgentId } : {}),
  });

  if (focusAgentId) {
    const start = out.length;
    wrapText(`focused agent: ${focusAgentId}`, textWidth).forEach((text, index) => {
      out.push({ kind: 'context', text, isFirst: index === 0 });
    });
    tagRows(out, start, `scope:agent:${focusAgentId}`);
  }
  if (!focusAgentId && ctx.workbenchUiState) {
    const start = out.length;
    const aggregate = 'all agents';
    wrapText(aggregate, textWidth).forEach((text, index) => {
      out.push({ kind: 'context', text, isFirst: index === 0 });
    });
    tagRows(out, start, 'scope:all');
  }

  for (const item of conversation.items) {
    if (!transcriptItemMatchesFilter(item, filter)) continue;
    appendSeparator(out, item.id);
    const start = out.length;

    switch (item.kind) {
      case 'user':
        appendPreviewRows(out, 'user', item.text, textWidth, item, ctx);
        break;
      case 'assistant':
        appendPreviewRows(out, 'agent', item.text, textWidth, item, ctx);
        break;
      case 'activity':
        appendPreviewRows(out, 'activity', item.text, textWidth, item, ctx, item.status ? ({ thinking: 'RUNNING', tool_running: 'RUNNING', waiting_dependency: 'WAITING', waiting_approval: 'APPROVAL' } as Readonly<Record<string, string>>)[item.status] ?? item.status.toUpperCase() : '');
        break;
      case 'tool-group':
        for (const tool of item.tools) {
          if (filter === 'error' && tool.status !== 'failed') continue;
          appendPreviewRows(out, 'toolCall', toolSummary(tool, pendingApprovalTool), textWidth, { ...item, startedAt: tool.startedAt ?? item.startedAt }, ctx);
          if ((mode === 'detailed' || tool.status === 'failed') && tool.detail) {
            wrapText(`  ${tool.detail}`, textWidth).forEach((text) => {
              out.push({ kind: tool.status === 'failed' ? 'approval' : 'context', text, isFirst: false });
            });
          }
        }
        break;
      case 'approval':
        // Replace the semantic request row with the authoritative pending
        // record at the same transcript position. Resolution is projection-
        // driven, so key intent alone never removes this card.
        if (pendingApproval && !inlineApprovalRendered) {
          buildWorkbenchApprovalCardLines(
            pendingApproval,
            pendingApprovals.length,
            textWidth,
          ).forEach((text, index) => {
            out.push({
              kind: 'approvalCard',
              text,
              isFirst: index === 0,
              ...(index === 0 ? { gutter: 'APPROVAL' } : {}),
            });
          });
          inlineApprovalRendered = true;
          break;
        }
        wrapText(`⏸ ${item.text}`, textWidth).forEach((text, index) => {
          out.push({ kind: 'approval', text, isFirst: index === 0 });
        });
        break;
      case 'plan':
        for (const task of item.tasks.slice(0, 20)) {
          const marker = task.status === 'completed' ? '[x]' : task.status === 'in_progress' ? '[~]' : task.status === 'skipped' ? '[-]' : '[ ]';
          wrapText(`${marker} ${task.index}. ${task.title}`, textWidth).forEach((text) => {
            out.push({ kind: 'plan', text, isFirst: false });
          });
        }
        if (item.text) appendPreviewRows(out, 'agent', item.text, textWidth, item, ctx);
        break;
      case 'phase':
        appendPreviewRows(out, 'context', item.phase, textWidth, item, ctx);
        break;
      case 'diagnostic': {
        const marker = item.severity === 'error' ? '✗' : item.severity === 'warning' ? '!' : '·';
        appendPreviewRows(out, item.severity === 'error' ? 'approval' : 'context', `${marker} ${item.text}`, textWidth, item, ctx);
        break;
      }
    }
    tagRows(out, start, item.id);
  }

  // Runtime projection and timeline sampling can arrive in adjacent frames.
  // Preserve the authoritative pending action even before its semantic event
  // becomes visible; once present, the branch above places it in exact order.
  if (pendingApproval && !inlineApprovalRendered) {
    appendSeparator(out, `pending-approval:${pendingApproval.id}`);
    const start = out.length;
    buildWorkbenchApprovalCardLines(
      pendingApproval,
      pendingApprovals.length,
      textWidth,
    ).forEach((text, index) => {
      out.push({
        kind: 'approvalCard',
        text,
        isFirst: index === 0,
        ...(index === 0 ? { gutter: 'APPROVAL' } : {}),
      });
    });
    tagRows(out, start, `pending-approval:${pendingApproval.id}`);
  }

  const streaming = ctx.perTab.streamingText;
  const latestProse = [...conversation.items].reverse().find((item) => item.kind === 'assistant' || item.kind === 'user');
  const streamAlreadyLanded = latestProse?.kind === 'assistant' && latestProse.text.trim().replace(/\s+/g, ' ') === streaming?.trim().replace(/\s+/g, ' ');
  if (streaming && !streamAlreadyLanded && (filter === 'all' || filter === 'response') && !focusAgentId) {
    appendSeparator(out, `streaming:${focusAgentId ?? 'all'}`);
    const start = out.length;
    appendPreviewRows(out, 'streaming', streaming, textWidth, {
      id: 'live-stream', kind: 'assistant', text: streaming, startedAt: 0,
      sourceEvents: { firstSequence: 0, lastSequence: 0 },
    }, ctx);
    if (out.length > start) out[out.length - 1]!.isLast = true;
    tagRows(out, start, `streaming:${focusAgentId ?? 'all'}`);
  } else if (!streaming && (filter === 'all' || filter === 'activity') && !focusAgentId) {
    const activity = ctx.snap.session?.activity;
    const activityText = activity ? formatActivityLine(activity, Date.now()) : undefined;
    if (activityText) {
      appendSeparator(out, `activity:${focusAgentId ?? 'all'}`);
      const start = out.length;
      wrapText(activityText, textWidth).forEach((text, index) => {
        out.push({ kind: 'activity', text, isFirst: index === 0, ...(index === 0 ? { gutter: 'ALiX' } : {}) });
      });
      tagRows(out, start, `activity:${focusAgentId ?? 'all'}`);
    }
  }

  return out.map((line) => ({ ...line, previewFormatted: true as const }));
}
