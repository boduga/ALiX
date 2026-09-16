import { formatActivityLine } from '../../views/activity-line.js';
import type { ScrollbackLine } from '../../views/bottom-anchored-viewport.js';
import { wrapText } from '../../views/wrap-text.js';
import { renderResponse } from '../../blocks/render.js';
import { getTheme } from '../../blocks/theme.js';
import type { ViewRenderContext } from '../../views/types.js';
import { ConversationProjection } from '../projections/conversation-projection.js';
import type { ToolItem, TranscriptMode } from '../model/transcript-item.js';
import { buildWorkbenchApprovalCardLines } from './approval-dialog.js';

function appendRendered(
  out: ScrollbackLine[],
  kind: 'user' | 'agent',
  text: string,
  width: number,
  themeName?: string,
): void {
  const theme = themeName ? getTheme(themeName) : undefined;
  const rows = renderResponse(text, width, theme);
  rows.forEach((row: any, index: number) => {
    out.push({
      kind,
      text: row.text,
      isFirst: index === 0,
      ...(index === 0 ? { gutter: kind === 'user' ? 'YOU' : 'ALiX' } : {}),
    });
  });
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
  if (pendingApprovalTool === tool.name) return `→ ${tool.name} · approval required`;
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
): ScrollbackLine[] {
  const out: ScrollbackLine[] = [];
  const mode: TranscriptMode = ctx.perTab.transcriptMode ?? 'compact';
  const pendingApprovals = ctx.perTab.pendingApprovals ?? [];
  const pendingApproval = pendingApprovals[0];
  const pendingApprovalTool = pendingApproval?.toolName;
  let inlineApprovalRendered = false;
  const conversation = new ConversationProjection().project({
    timeline: ctx.runtime?.agent?.timeline ?? [],
    trace: ctx.snap.runtime?.trace ?? [],
    mode,
  });

  for (const item of conversation.items) {
    if (out.length > 0) out.push({ kind: 'user', text: '', isFirst: false });

    switch (item.kind) {
      case 'user':
        appendRendered(out, 'user', item.text, textWidth, ctx.themeName);
        break;
      case 'assistant':
        appendRendered(out, 'agent', item.text, textWidth, ctx.themeName);
        break;
      case 'tool-group':
        for (const tool of item.tools) {
          const lines = wrapText(toolSummary(tool, pendingApprovalTool), textWidth);
          lines.forEach((text, index) => out.push({ kind: 'toolCall', text, isFirst: index === 0 }));
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
        if (item.text) appendRendered(out, 'agent', item.text, textWidth, ctx.themeName);
        break;
      case 'phase':
        wrapText(`◇ ${item.phase}`, textWidth).forEach((text, index) => {
          out.push({ kind: 'context', text, isFirst: index === 0 });
        });
        break;
      case 'diagnostic': {
        const marker = item.severity === 'error' ? '✗' : item.severity === 'warning' ? '!' : '·';
        wrapText(`${marker} ${item.text}`, textWidth).forEach((text, index) => {
          out.push({ kind: item.severity === 'error' ? 'approval' : 'context', text, isFirst: index === 0 });
        });
        break;
      }
    }
  }

  // Runtime projection and timeline sampling can arrive in adjacent frames.
  // Preserve the authoritative pending action even before its semantic event
  // becomes visible; once present, the branch above places it in exact order.
  if (pendingApproval && !inlineApprovalRendered) {
    if (out.length > 0) out.push({ kind: 'user', text: '', isFirst: false });
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
  }

  const streaming = ctx.perTab.streamingText;
  if (streaming) {
    if (out.length > 0) out.push({ kind: 'user', text: '', isFirst: false });
    const lines = wrapText(streaming, textWidth);
    lines.forEach((text, index) => out.push({
      kind: 'streaming',
      text,
      isFirst: index === 0,
      isLast: index === lines.length - 1,
      ...(index === 0 ? { gutter: 'ALiX' } : {}),
    }));
  } else {
    const activity = ctx.snap.session?.activity;
    const activityText = activity ? formatActivityLine(activity, Date.now()) : undefined;
    if (activityText) {
      if (out.length > 0) out.push({ kind: 'user', text: '', isFirst: false });
      wrapText(activityText, textWidth).forEach((text, index) => {
        out.push({ kind: 'activity', text, isFirst: index === 0, ...(index === 0 ? { gutter: 'ALiX' } : {}) });
      });
    }
  }

  return out;
}
