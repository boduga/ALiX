import type { ExecutionTraceEntry } from '../../runtime/execution-trace.js';
import type { TimelineEntry } from '../../runtime/timeline-builder.js';
import type { ConversationSnapshot, TranscriptMode } from '../model/transcript-item.js';
import { ConversationProjection } from './conversation-projection.js';

/**
 * Full-content fingerprints. Lengths alone are insufficient: a same-length edit
 * (a glyph swap, a corrected word) must invalidate. Shared by the scrollback
 * line cache and the conversation memo so both key on identical content.
 */
export function timelineFingerprint(timeline: readonly TimelineEntry[]): string {
  return `${timeline.length}|${timeline
    .map((e) =>
      [
        e.id,
        e.kind,
        e.actor ?? '',
        e.agentId ?? '',
        e.sessionId,
        e.startedAt,
        e.text ?? '',
        e.userSafe ?? '',
        e.activityState ?? '',
        e.verifiedOutcome ?? '',
        e.detail ?? '',
        e.planTasks?.map((t) => `${t.index}:${t.status}:${t.title}`).join(',') ?? '',
      ].join(','),
    )
    .join(';')}`;
}

export function traceFingerprint(trace: readonly ExecutionTraceEntry[]): string {
  return `${trace.length}|${trace
    .map((e) =>
      [e.id, e.kind, e.status, e.title, e.agentId ?? '', e.startedAt, e.detail ?? '', JSON.stringify(e.toolMetadata ?? null)].join(','),
    )
    .join(';')}`;
}

export interface ConversationCacheInput {
  readonly timeline: readonly TimelineEntry[];
  readonly trace: readonly ExecutionTraceEntry[];
  readonly mode: TranscriptMode;
  readonly focusAgentId?: string;
}

const projection = new ConversationProjection();
let cached: { key: string; snapshot: ConversationSnapshot } | undefined;

/**
 * Project the semantic conversation once per distinct content. Paints are
 * sequential and repeat the same event content, so a single-entry cache is
 * enough. The view-state assembler and the scrollback builder share this, so
 * the transcript is never projected twice for one frame.
 */
export function projectConversation(input: ConversationCacheInput): ConversationSnapshot {
  const key = `${input.mode}\u0000${input.focusAgentId ?? ''}\u0000${timelineFingerprint(input.timeline)}\u0000${traceFingerprint(input.trace)}`;
  if (cached && cached.key === key) return cached.snapshot;
  const snapshot = projection.project({
    timeline: input.timeline,
    trace: input.trace,
    mode: input.mode,
    ...(input.focusAgentId ? { focusAgentId: input.focusAgentId } : {}),
  });
  cached = { key, snapshot };
  return snapshot;
}
