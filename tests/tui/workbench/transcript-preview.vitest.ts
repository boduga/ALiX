import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { TimelineBuilder } from '../../../src/tui/runtime/timeline-builder.js';
import { ConversationProjection } from '../../../src/tui/workbench/projections/conversation-projection.js';
import { transcriptItemMatchesFilter, getTranscriptFocusAgentId } from '../../../src/tui/workbench/model/transcript-filter.js';
import type { TranscriptItem } from '../../../src/tui/workbench/model/transcript-item.js';
import type { AlixEvent } from '../../../src/events/types.js';

const base = { id: 'row', startedAt: 1, sourceEvents: { firstSequence: 1, lastSequence: 1 } };
const rows: TranscriptItem[] = [
  { ...base, kind: 'user', text: 'input' },
  { ...base, kind: 'assistant', text: 'output' },
  { ...base, kind: 'plan', tasks: [] },
  { ...base, kind: 'tool-group', tools: [{ id: 'ok', name: 'file.read', status: 'completed', sourceEvents: base.sourceEvents }] },
  { ...base, kind: 'tool-group', tools: [{ id: 'bad', name: 'file.read', status: 'failed', sourceEvents: base.sourceEvents }] },
  { ...base, kind: 'activity', text: 'Checking workspace' },
  { ...base, kind: 'phase', phase: 'working' },
  { ...base, kind: 'diagnostic', severity: 'info', text: 'bounded diagnostic' },
  { ...base, kind: 'diagnostic', severity: 'error', text: 'failed' },
  { ...base, kind: 'approval', text: 'Approve?' },
];

describe('preview semantic categories', () => {
  it.each([
    ['all', [true, true, true, true, true, true, true, true, true, true]],
    ['response', [true, true, true, false, false, false, false, false, false, true]],
    ['tool', [false, false, false, true, true, false, false, false, false, true]],
    ['activity', [false, false, false, false, false, true, true, true, false, true]],
    ['error', [false, false, false, false, true, false, false, false, true, true]],
  ] as const)('%s has explicit positive and negative membership', (filter, expected) => {
    expect(rows.map((row) => transcriptItemMatchesFilter(row, filter))).toEqual(expected);
  });
  it('keeps inspection independent from explicit transcript scope', () => {
    expect(getTranscriptFocusAgentId({ selectedAgentId: 'worker', transcriptScope: 'all' })).toBeUndefined();
    expect(getTranscriptFocusAgentId({ selectedAgentId: 'worker', transcriptScope: 'selected' })).toBe('worker');
    expect(getTranscriptFocusAgentId({ transcriptScope: 'selected' })).toBeUndefined();
  });
});

function event(seq: number, type: string, payload: Record<string, unknown>): AlixEvent {
  return { id: `event-${seq}`, seq, version: 1, sessionId: 's', timestamp: '2026-10-03T10:14:21.000Z', actor: 'agent', type, payload } as AlixEvent;
}

describe('safe activity projection', () => {
  it('admits explicit safe operation, never reasoning or unmarked progress', () => {
    const builder = new TimelineBuilder('s');
    const events = [
      event(1, 'agent.state_changed', { agentId: 'worker', state: 'thinking' }),
      event(2, 'agent.progress', { agentId: 'worker', operation: 'Inspecting layout', userSafe: true }),
      event(3, 'agent.progress', { agentId: 'worker', operation: 'private unmarked thought' }),
      event(4, 'agent.reasoning', { agentId: 'worker', text: 'private reasoning' }),
    ];
    builder.update(events); builder.update(events);
    const projected = new ConversationProjection().project({ timeline: builder.snapshot(), trace: [], mode: 'detailed' });
    expect(projected.items).toHaveLength(2);
    expect(projected.items[1]).toMatchObject({ kind: 'activity', text: 'Inspecting layout', status: 'thinking', agentId: 'worker', startedAt: Date.parse(events[1]!.timestamp), sourceEvents: { firstSequence: 2, lastSequence: 2 } });
    expect(JSON.stringify(projected)).not.toContain('private');
    const restored = new TimelineBuilder('s'); restored.importState(builder.exportState());
    expect(restored.snapshot()).toEqual(builder.snapshot());
  });
  it('does not collapse equal prose belonging to different workers', () => {
    const builder = new TimelineBuilder('s');
    builder.update([
      event(1, 'agent.response', { agentId: 'worker-1', text: 'Done' }),
      event(2, 'agent.response', { agentId: 'worker-2', text: 'Done' }),
    ]);
    expect(new ConversationProjection().project({ timeline: builder.snapshot(), trace: [], mode: 'compact' }).items).toHaveLength(2);
  });
});


it('projects every reference safe prose group once in stable source order', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../fixtures/tui/workbench-preview-events.json', import.meta.url), 'utf8')) as { sessionId: string; events: AlixEvent[] };
  const builder = new TimelineBuilder(fixture.sessionId);
  builder.update(fixture.events); builder.update(fixture.events);
  const items = new ConversationProjection().project({ timeline: builder.snapshot(), trace: [], mode: 'compact' }).items;
  const expected = fixture.events.filter((event) => event.type === 'agent.progress' && (event.payload as { userSafe?: boolean }).userSafe === true);
  expect(expected).toHaveLength(11);
  const actual = items.filter((item) => item.kind === 'activity' && item.text);
  expect(actual.map((item) => item.kind === 'activity' ? item.text : '')).toEqual(expected.map((event) => (event.payload as { operation: string }).operation));
  expect(actual.find((item) => item.sourceEvents.firstSequence === 17)).toMatchObject({ verifiedOutcome: 'success' });
  expect(new Set(actual.map((item) => item.id)).size).toBe(expected.length);
  expect(actual.map((item) => item.sourceEvents.firstSequence)).toEqual(expected.map((event) => event.seq));
});
