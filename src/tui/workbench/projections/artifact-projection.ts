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

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
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
      const coordinationRunId = nonEmptyString(p.coordinationRunId ?? p.runId);
      const agentId = nonEmptyString(p.agentId ?? p.workerId ?? p.subagentId);
      const taskId = nonEmptyString(p.taskId);

      if (event.type === 'subagent.result') {
        const id = nonEmptyString(p.resultRef) ?? `result-${agentId ?? taskId ?? 'event'}-${sourceSequence}`;
        const statusValue = nonEmptyString(p.status)?.toLowerCase();
        const preview = boundedPreview(p.summary ?? p.content ?? p.findings ?? p.error);
        const status = statusValue === 'failed' || statusValue === 'failure' || statusValue === 'error'
          ? 'failed' as const
          : 'available' as const;
        this.byId.set(id, {
          id,
          kind: 'result',
          status,
          title: nonEmptyString(p.title) ?? nonEmptyString(p.role) ?? `Result ${id}`,
          ...(preview ? { preview } : {}),
          ...(coordinationRunId ? { coordinationRunId } : {}),
          ...(agentId ? { agentId } : {}),
          ...(taskId ? { taskId } : {}),
          createdAt: at,
          sourceSequence,
        });
        continue;
      }

      const id = nonEmptyString(p.artifactId ?? p.id) ?? `artifact-${sourceSequence}`;
      const uri = nonEmptyString(p.uri ?? p.path);
      const preview = boundedPreview(p.preview ?? p.content ?? p.outputPreview);
      const artifactType = nonEmptyString(p.kind ?? p.artifactType);
      const mediaType = nonEmptyString(p.mediaType ?? p.mimeType);
      const sizeBytes = nonNegativeNumber(p.sizeBytes ?? p.size);
      const digest = nonEmptyString(p.digest);
      this.byId.set(id, {
        id,
        kind: 'artifact',
        status: uri ? 'available' : 'unavailable',
        title: nonEmptyString(p.title ?? p.name) ?? id,
        ...(artifactType ? { artifactType } : {}),
        ...(uri ? { uri } : {}),
        ...(mediaType ? { mediaType } : {}),
        ...(sizeBytes !== undefined ? { sizeBytes } : {}),
        ...(digest ? { digest } : {}),
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
      failed: items.filter((item) => item.status === 'failed').length,
    };
  }

  reset(): void {
    this.byId.clear();
    this.seen.clear();
  }
}
