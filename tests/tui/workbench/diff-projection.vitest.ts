import { describe, expect, it } from 'vitest';
import type { AlixEvent } from '../../../src/events/types.js';
import { DiffProjection } from '../../../src/tui/workbench/projections/diff-projection.js';

const event = (seq: number, type: string, payload: Record<string, unknown>): AlixEvent => ({
  id: `e${seq}`, seq, version: 1, sessionId: 's', timestamp: new Date(seq * 1000).toISOString(), actor: 'system', type, payload,
});

describe('DiffProjection', () => {
  it('reconciles checkpoint, changed files, and rollback by tool call', () => {
    const projection = new DiffProjection();
    const events = [
      event(1, 'patch.checkpoint_created', { toolCallId: 't1', files: ['src/a.ts'] }),
      event(2, 'patch.changed_files', { toolCallId: 't1', changedFiles: ['src/a.ts', 'src/b.ts'] }),
      event(3, 'patch.rollback_completed', { toolCallId: 't1' }),
    ];
    projection.update(events);
    projection.update(events);
    expect(projection.snapshot()).toEqual({
      filesChanged: 2,
      diffs: [{ id: 't1', toolCallId: 't1', changedFiles: ['src/a.ts', 'src/b.ts'], status: 'rolled_back', firstSequence: 1, lastSequence: 3 }],
    });
  });
});
