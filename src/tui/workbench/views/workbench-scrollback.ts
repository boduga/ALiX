import { formatActivityLine } from '../../views/activity-line.js';
import type { ScrollbackLine } from '../../views/bottom-anchored-viewport.js';
import { wrapText } from '../../views/wrap-text.js';
import { renderResponse } from '../../blocks/render.js';
import { getTheme } from '../../blocks/theme.js';
import type { ViewRenderContext } from '../../views/types.js';
import { ConversationProjection } from '../projections/conversation-projection.js';
import type { ToolItem, TranscriptMode } from '../model/transcript-item.js';

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
    out.push({ kind, text: row.text, isFirst: index === 0 });
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

function toolSummary(tool: ToolItem): string {
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
          const lines = wrapText(toolSummary(tool), textWidth);
          lines.forEach((text, index) => out.push({ kind: 'toolCall', text, isFirst: index === 0 }));
          if ((mode === 'detailed' || tool.status === 'failed') && tool.detail) {
            wrapText(`  ${tool.detail}`, textWidth).forEach((text) => {
              out.push({ kind: tool.status === 'failed' ? 'approval' : 'context', text, isFirst: false });
            });
          }
        }
        break;
      case 'approval':
        wrapText(`⏸ ${item.text}`, textWidth).forEach((text, index) => {
          out.push({ kind: 'approval', text, isFirst: index === 0 });
        });
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

  // Preserve the current plan surface during the migration. The semantic plan
  // item will replace this adapter in the later operator-workflow slice.
  if (ctx.perTab.planTasks?.length || ctx.perTab.planContent) {
    if (out.length > 0) out.push({ kind: 'user', text: '', isFirst: false });
    for (const task of ctx.perTab.planTasks?.slice(0, 20) ?? []) {
      const marker = task.status === 'completed' ? '[x]' : task.status === 'in_progress' ? '[~]' : task.status === 'skipped' ? '[-]' : '[ ]';
      wrapText(`${marker} ${task.index}. ${task.title}`, textWidth).forEach((text) => {
        out.push({ kind: 'plan', text, isFirst: false });
      });
    }
    if (ctx.perTab.planContent) {
      appendRendered(out, 'agent', ctx.perTab.planContent, textWidth, ctx.themeName);
    }
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
    }));
  } else {
    const activity = ctx.snap.session?.activity;
    const activityText = activity ? formatActivityLine(activity, Date.now()) : undefined;
    if (activityText) {
      if (out.length > 0) out.push({ kind: 'user', text: '', isFirst: false });
      wrapText(activityText, textWidth).forEach((text, index) => {
        out.push({ kind: 'activity', text, isFirst: index === 0 });
      });
    }
  }

  return out;
}
