import type { AlixEvent } from '../../../events/types.js';
import type { ProjectionBuilder } from '../../runtime/projection-builder.js';
import type { WorkbenchArtifactSnapshot, WorkbenchInspectableItem } from '../model/artifact-inspection.js';

const INSPECTABLE_EVENTS = new Set([
  'execution.artifact_registered',
  'artifact.created',
  'collaboration.artifact.published',
  'subagent.result',
]);

function payload(event: AlixEvent): Record<string, unknown> {
  return event.payload && typeof event.payload === 'object' ? event.payload as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function nonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function boundedPreview(value: unknown): string | undefined {
  let candidate: string | undefined;
  if (typeof value === 'string') candidate = value;
  else if (Array.isArray(value)) candidate = value.filter((item): item is string => typeof item === 'string').join('\n');
  if (!candidate?.trim()) return undefined;
  const normalized = candidate.trim();
  return normalized.length <= 800 ? normalized : `${normalized.slice(0, 799)}…`;
}

/** EventLog-derived, read-only index for Workbench artifact/result inspection. */
export class ArtifactProjection implements ProjectionBuilder<WorkbenchArtifactSnapshot> {
  private readonly byId = new Map<string, WorkbenchInspectableItem>();
  private readonly seen = new Set<string>();

  update(events: readonly AlixEvent[]): void {
    for (const event of events) {
      if (!INSPECTABLE_EVENTS.has(event.type) || this.seen.has(event.id)) continue;
      this.seen.add(event.id);
      const p = payload(event);
      const at = Date.parse(event.timestamp) || 0;
      const sourceSequence = event.seq ?? 0;
      const coordinationRunId = text(p.coordinationRunId ?? p.runId);
      const agentId = text(p.agentId ?? p.workerId ?? p.subagentId);
      const taskId = text(p.taskId);

      if (event.type === 'subagent.result') {
        const id = text(p.resultRef) ?? `result-${agentId ?? taskId ?? sourceSequence}`;
        const statusValue = text(p.status)?.toLowerCase();
        const status = statusValue === 'failed' || statusValue === 'failure' || statusValue === 'error'
          ? 'failed' as const
          : 'available' as const;
        this.byId.set(id, {
          id,
          kind: 'result',
          status,
          title: text(p.title) ?? text(p.role) ?? `Result ${id}`,
          ...(boundedPreview(p.summary ?? p.content ?? p.findings ?? p.error) ? { preview: boundedPreview(p.summary ?? p.content ?? p.findings ?? p.error) } : {}),
          ...(coordinationRunId ? { coordinationRunId } : {}),
          ...(agentId ? { agentId } : {}),
          ...(taskId ? { taskId } : {}),
          createdAt: at,
          sourceSequence,
        });
        continue;
      }

      const id = text(p.artifactId ?? p.id) ?? `artifact-${sourceSequence}`;
      const uri = text(p.uri ?? p.path);
      const preview = boundedPreview(p.preview ?? p.content ?? p.outputPreview);
      this.byId.set(id, {
        id,
        kind: 'artifact',
        status: uri ? 'available' : 'unavailable',
        title: text(p.title ?? p.name) ?? id,
        ...(text(p.kind ?? p.artifactType) ? { artifactType: text(p.kind ?? p.artifactType) } : {}),
        ...(uri ? { uri } : {}),
        ...(text(p.mediaType ?? p.mimeType) ? { mediaType: text(p.mediaType ?? p.mimeType) } : {}),
        ...(nonNegative(p.sizeBytes ?? p.size) !== undefined ? { sizeBytes: nonNegative(p.sizeBytes ?? p.size) } : {}),
        ...(text(p.digest) ? { digest: text(p.digest) } : {}),
        ...(preview ? { preview } : {}),
        ...(coordinationRunId ? { coordinationRunId } : {}),
        ...(agentId ? { agentId } : {}),
        ...(taskId ? { taskId } : {}),
        createdAt: at,
        sourceSequence,
      });
    }
  }

  snapshot(): WorkbenchArtifactSnapshot {
    const items = [...this.byId.values()].sort((a, b) => a.sourceSequence - b.sourceSequence || a.id.localeCompare(b.id));
    return {
      items,
      artifacts: items.filter((item) => item.kind === 'artifact').length,
      results: items.filter((item) => item.kind === 'result').length,
      failed: items.filter((item) => item.status === 'failed' || item.status === 'unavailable').length,
    };
  }

  reset(): void {
    this.byId.clear();
    this.seen.clear();
  }
}
