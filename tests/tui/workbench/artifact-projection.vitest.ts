import { describe, expect, it } from 'vitest';
import type { AlixEvent } from '../../../src/events/types.js';
import { ArtifactProjection } from '../../../src/tui/workbench/projections/artifact-projection.js';

const event = (seq: number, type: string, payload: Record<string, unknown>): AlixEvent => ({
  id: `e${seq}`, seq, version: 1, sessionId: 's', timestamp: new Date(seq * 1000).toISOString(), actor: 'system', type, payload,
});

describe('ArtifactProjection', () => {
  it('projects artifact metadata and correlated worker results without duplicates', () => {
    const projection = new ArtifactProjection();
    const events = [
      event(1, 'execution.artifact_registered', {
        artifactId: 'report-1', kind: 'report', uri: 'file:///tmp/report.md', mediaType: 'text/markdown',
        sizeBytes: 2048, digest: 'abcdef1234567890', preview: 'Summary', coordinationRunId: 'run-1', agentId: 'agent-1', taskId: 'task-1',
      }),
      event(2, 'subagent.result', {
        resultRef: 'result-1', role: 'researcher', status: 'failure', error: 'provider unavailable',
        coordinationRunId: 'run-1', agentId: 'agent-1', taskId: 'task-1',
      }),
    ];
    projection.update(events);
    projection.update(events);

    expect(projection.snapshot()).toMatchObject({ artifacts: 1, results: 1, failed: 1 });
    expect(projection.snapshot().items).toEqual([
      expect.objectContaining({ id: 'report-1', kind: 'artifact', status: 'available', uri: 'file:///tmp/report.md', preview: 'Summary' }),
      expect.objectContaining({ id: 'result-1', kind: 'result', status: 'failed', preview: 'provider unavailable' }),
    ]);
  });

  it('marks pathless artifacts unavailable and bounds previews', () => {
    const projection = new ArtifactProjection();
    projection.update([event(1, 'artifact.created', { artifactId: 'a1', content: 'x'.repeat(1000) })]);
    const item = projection.snapshot().items[0]!;
    expect(item.status).toBe('unavailable');
    expect(item.preview?.length).toBe(800);
    expect(item.preview?.endsWith('…')).toBe(true);
    expect(projection.snapshot().failed).toBe(0);
  });

  it('keeps multiple unreferenced results from the same agent', () => {
    const projection = new ArtifactProjection();
    projection.update([
      event(1, 'subagent.result', { agentId: 'agent-1', findings: 'first' }),
      event(2, 'subagent.result', { agentId: 'agent-1', findings: 'second' }),
    ]);

    expect(projection.snapshot().items).toEqual([
      expect.objectContaining({ id: 'result-agent-1-1', preview: 'first' }),
      expect.objectContaining({ id: 'result-agent-1-2', preview: 'second' }),
    ]);
  });
});
