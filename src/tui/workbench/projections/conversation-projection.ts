import type { ExecutionTraceEntry } from '../../runtime/execution-trace.js';
import type { TimelineEntry } from '../../runtime/timeline-builder.js';
import type {
  AssistantMessageItem,
  ConversationSnapshot,
  DiagnosticItem,
  ToolGroupItem,
  ToolItem,
  TranscriptItem,
  TranscriptMode,
  TranscriptSourceRange,
} from '../model/transcript-item.js';

export interface ConversationProjectionInput {
  readonly timeline: readonly TimelineEntry[];
  readonly trace: readonly ExecutionTraceEntry[];
  readonly mode: TranscriptMode;
}

type Candidate = TranscriptItem & { readonly order: number };

const LOW_SIGNAL_CONTEXT = new Set([
  'context.snapshot.created',
  'context.budget.computed',
  'context.assembled',
]);

const HIGH_SIGNAL_CONTEXT = new Set([
  'context.preflight.failed',
  'context.irreducible',
]);

function sourceRange(source: { readonly firstSequence: number; readonly lastSequence?: number }): TranscriptSourceRange {
  return {
    firstSequence: source.firstSequence,
    lastSequence: source.lastSequence ?? source.firstSequence,
  };
}

function normalizedText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function toolName(title: string): string {
  return title.startsWith('tool.') ? title.slice('tool.'.length) : title;
}

function isCompletionTool(name: string): boolean {
  return name === 'done' || name === 'task.complete';
}

function cloneTool(entry: ExecutionTraceEntry): ToolItem {
  return {
    id: entry.id,
    name: toolName(entry.title),
    status: entry.status,
    ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
    ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
    sourceEvents: sourceRange(entry.sourceEvents),
  };
}

/**
 * Composes the existing agent timeline and outer execution trace into the
 * semantic transcript consumed by Workbench rendering. Both inputs are
 * already EventLog-derived read models; this layer owns presentation meaning,
 * not runtime state or event persistence.
 *
 * The split input is intentional. Agent prose is stamped into the
 * `${sessionId}-agent` domain while tool lifecycles are stamped into the outer
 * session. Their EventLog sequence ranges remain globally comparable, so the
 * projection can restore one truthful operator narrative without changing
 * either runtime contract.
 */
export class ConversationProjection {
  project(input: ConversationProjectionInput): ConversationSnapshot {
    const candidates: Candidate[] = [];
    let hiddenDiagnostics = 0;

    for (const entry of input.timeline) {
      const text = entry.text ?? '';
      const range = sourceRange(entry.sourceEvents);
      const base = {
        id: `conversation-${entry.id}`,
        startedAt: entry.startedAt,
        sourceEvents: range,
        order: range.firstSequence,
      } as const;

      if (entry.kind === 'agent.message' && entry.actor === 'user') {
        candidates.push({ ...base, kind: 'user', text });
        continue;
      }

      if (
        (entry.kind === 'agent.message' && entry.actor !== 'user') ||
        entry.kind === 'agent.decision' ||
        entry.kind === 'agent.response'
      ) {
        if (text.trim()) candidates.push({ ...base, kind: 'assistant', text });
        continue;
      }

      if (entry.kind === 'approval.requested') {
        candidates.push({ ...base, kind: 'approval', text: text || 'Approval requested' });
        continue;
      }

      if (entry.kind === 'agent.session.phase_changed') {
        if (input.mode === 'detailed') {
          candidates.push({ ...base, kind: 'phase', phase: text || 'unknown' });
        }
        continue;
      }

      if (LOW_SIGNAL_CONTEXT.has(entry.kind)) {
        if (input.mode === 'detailed') {
          candidates.push({ ...base, kind: 'diagnostic', severity: 'info', text: text || entry.kind });
        } else {
          hiddenDiagnostics += 1;
        }
        continue;
      }

      if (HIGH_SIGNAL_CONTEXT.has(entry.kind)) {
        const item: DiagnosticItem & { readonly order: number } = {
          ...base,
          kind: 'diagnostic',
          severity: 'error',
          text: text || entry.kind,
        };
        candidates.push(item);
      }
    }

    for (const entry of input.trace) {
      if (entry.kind !== 'tool') continue;
      const name = toolName(entry.title);
      if (isCompletionTool(name)) continue;
      const range = sourceRange(entry.sourceEvents);
      candidates.push({
        id: `conversation-${entry.id}`,
        kind: 'tool-group',
        tools: [cloneTool(entry)],
        startedAt: entry.startedAt,
        sourceEvents: range,
        order: range.firstSequence,
      });
    }

    candidates.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

    const items: TranscriptItem[] = [];
    for (const candidate of candidates) {
      const previous = items[items.length - 1];

      // The runtime may emit the same final prose as agent.message followed by
      // agent.response. Collapse only adjacent assistant duplicates so equal
      // answers from distinct turns remain distinct.
      if (
        candidate.kind === 'assistant' &&
        previous?.kind === 'assistant' &&
        normalizedText(candidate.text) === normalizedText(previous.text)
      ) {
        const merged: AssistantMessageItem = {
          ...previous,
          sourceEvents: {
            firstSequence: previous.sourceEvents.firstSequence,
            lastSequence: candidate.sourceEvents.lastSequence,
          },
        };
        items[items.length - 1] = merged;
        continue;
      }

      // Consecutive tool lifecycles form one compact operation group. A user,
      // assistant, approval, phase, or diagnostic item is a hard group break.
      if (candidate.kind === 'tool-group' && previous?.kind === 'tool-group') {
        const merged: ToolGroupItem = {
          ...previous,
          tools: [...previous.tools, ...candidate.tools],
          sourceEvents: {
            firstSequence: previous.sourceEvents.firstSequence,
            lastSequence: candidate.sourceEvents.lastSequence,
          },
        };
        items[items.length - 1] = merged;
        continue;
      }

      const { order: _order, ...item } = candidate;
      items.push(item);
    }

    return { items, hiddenDiagnostics };
  }
}
