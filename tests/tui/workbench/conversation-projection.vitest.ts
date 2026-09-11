import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ExecutionTraceEntry } from '../../../src/tui/runtime/execution-trace.js';
import type { TimelineEntry } from '../../../src/tui/runtime/timeline-builder.js';
import { ConversationProjection } from '../../../src/tui/workbench/projections/conversation-projection.js';

const fixturePath = fileURLToPath(new URL('../../fixtures/tui/workbench-third-trace.json', import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  timeline: TimelineEntry[];
  trace: ExecutionTraceEntry[];
};

describe('ConversationProjection', () => {
  it('turns the captured trace into a compact semantic transcript', () => {
    const snapshot = new ConversationProjection().project({ ...fixture, mode: 'compact' });

    expect(snapshot.hiddenDiagnostics).toBe(2);
    expect(snapshot.items.map((item) => item.kind)).toEqual([
      'user',
      'tool-group',
      'assistant',
      'user',
      'tool-group',
      'assistant',
    ]);
    expect(snapshot.items.filter((item) => item.kind === 'assistant')).toHaveLength(2);
    expect(snapshot.items.some((item) => item.kind === 'tool-group' && item.tools.some((tool) => tool.name === 'done'))).toBe(false);
    expect(snapshot.items.at(-2)).toMatchObject({
      kind: 'tool-group',
      tools: [{ name: 'file.read', status: 'failed', detail: 'Access denied: path is outside workspace' }],
    });
  });

  it('retains low-signal diagnostics in detailed mode', () => {
    const snapshot = new ConversationProjection().project({ ...fixture, mode: 'detailed' });

    expect(snapshot.hiddenDiagnostics).toBe(0);
    expect(snapshot.items.filter((item) => item.kind === 'diagnostic')).toHaveLength(2);
  });

  it('groups adjacent tool lifecycles but not tools separated by prose', () => {
    const trace: ExecutionTraceEntry[] = [
      { id: 'tr-1', kind: 'tool', status: 'completed', title: 'tool.file.read', startedAt: 1, sourceEvents: { firstSequence: 1, lastSequence: 2 } },
      { id: 'tr-3', kind: 'tool', status: 'completed', title: 'tool.file.exists', startedAt: 3, sourceEvents: { firstSequence: 3, lastSequence: 4 } },
      { id: 'tr-6', kind: 'tool', status: 'completed', title: 'tool.shell.run', startedAt: 6, sourceEvents: { firstSequence: 6, lastSequence: 7 } },
    ];
    const timeline: TimelineEntry[] = [
      { id: 'tl-5', kind: 'agent.message', actor: 'agent', sessionId: 's-agent', startedAt: 5, text: 'Checked files.', sourceEvents: { firstSequence: 5 } },
    ];

    const snapshot = new ConversationProjection().project({ timeline, trace, mode: 'compact' });

    expect(snapshot.items).toHaveLength(3);
    expect(snapshot.items[0]).toMatchObject({ kind: 'tool-group', tools: [{ name: 'file.read' }, { name: 'file.exists' }] });
    expect(snapshot.items[2]).toMatchObject({ kind: 'tool-group', tools: [{ name: 'shell.run' }] });
  });

  it('does not collapse identical assistant text across user turns', () => {
    const timeline: TimelineEntry[] = [
      { id: 'tl-1', kind: 'agent.response', actor: 'agent', sessionId: 's', startedAt: 1, text: 'yes', sourceEvents: { firstSequence: 1 } },
      { id: 'tl-2', kind: 'agent.message', actor: 'user', sessionId: 's', startedAt: 2, text: 'Again?', sourceEvents: { firstSequence: 2 } },
      { id: 'tl-3', kind: 'agent.response', actor: 'agent', sessionId: 's', startedAt: 3, text: 'yes', sourceEvents: { firstSequence: 3 } },
    ];

    const snapshot = new ConversationProjection().project({ timeline, trace: [], mode: 'compact' });
    expect(snapshot.items.map((item) => item.kind)).toEqual(['assistant', 'user', 'assistant']);
  });

  it('projects a structured plan in source-event order', () => {
    const timeline: TimelineEntry[] = [
      { id: 'tl-1', kind: 'agent.message', actor: 'user', sessionId: 's', startedAt: 1, text: 'Make a plan', sourceEvents: { firstSequence: 1 } },
      {
        id: 'tl-2', kind: 'agent.plan', actor: 'agent', sessionId: 's', startedAt: 2,
        text: 'Two safe steps.',
        planTasks: [
          { id: 's:task:1', index: 1, title: 'Inspect files', status: 'completed' },
          { id: 's:task:2', index: 2, title: 'Apply change', status: 'in_progress' },
        ],
        sourceEvents: { firstSequence: 2 },
      },
      { id: 'tl-3', kind: 'agent.response', actor: 'agent', sessionId: 's', startedAt: 3, text: 'Finished.', sourceEvents: { firstSequence: 3 } },
    ];

    const snapshot = new ConversationProjection().project({ timeline, trace: [], mode: 'compact' });

    expect(snapshot.items.map((item) => item.kind)).toEqual(['user', 'plan', 'assistant']);
    expect(snapshot.items[1]).toMatchObject({
      kind: 'plan',
      text: 'Two safe steps.',
      tasks: [{ title: 'Inspect files' }, { title: 'Apply change' }],
      sourceEvents: { firstSequence: 2, lastSequence: 2 },
    });
  });
});
