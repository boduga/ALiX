import type { AlixEvent } from '../../../events/types.js';
import type { ProjectionBuilder } from '../../runtime/projection-builder.js';
import type { WorkbenchDiffSnapshot, WorkbenchDiffSummary } from '../model/diff-summary.js';

function payload(event: AlixEvent): Record<string, unknown> {
  return event.payload && typeof event.payload === 'object' ? event.payload as Record<string, unknown> : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export class DiffProjection implements ProjectionBuilder<WorkbenchDiffSnapshot> {
  private readonly byId = new Map<string, WorkbenchDiffSummary>();
  private readonly seen = new Set<number>();

  update(events: readonly AlixEvent[]): void {
    for (const event of events) {
      if (this.seen.has(event.seq)) continue;
      this.seen.add(event.seq);
      const p = payload(event);
      const toolCallId = typeof p.toolCallId === 'string' ? p.toolCallId : undefined;
      const relevant = event.type.startsWith('patch.') || ((event.type === 'tool.completed' || event.type === 'tool.failed') && p.toolName === 'patch.apply');
      if (!relevant) continue;
      const id = toolCallId ?? (typeof p.proposalId === 'string' ? p.proposalId : `patch-${event.seq}`);
      const previous = this.byId.get(id);
      const files = strings(p.changedFiles).length > 0 ? strings(p.changedFiles) : strings(p.files);
      let status = previous?.status ?? 'checkpointed';
      if (event.type === 'patch.changed_files' || event.type === 'patch.applied' || event.type === 'tool.completed') status = 'applied';
      else if (event.type === 'patch.rolled_back' || event.type === 'patch.rollback_completed') status = 'rolled_back';
      else if (event.type === 'patch.rejected' || event.type === 'patch.rollback_failed' || event.type === 'tool.failed') status = 'failed';
      this.byId.set(id, {
        id,
        ...(toolCallId ? { toolCallId } : {}),
        changedFiles: files.length > 0 ? files : previous?.changedFiles ?? [],
        status,
        firstSequence: previous?.firstSequence ?? event.seq,
        lastSequence: event.seq,
      });
    }
  }

  snapshot(): WorkbenchDiffSnapshot {
    const diffs = [...this.byId.values()].sort((a, b) => a.firstSequence - b.firstSequence);
    return { diffs, filesChanged: new Set(diffs.flatMap((diff) => diff.changedFiles)).size };
  }

  reset(): void {
    this.byId.clear();
    this.seen.clear();
  }
}
