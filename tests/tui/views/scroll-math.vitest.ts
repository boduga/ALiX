import { describe, it, expect } from 'vitest';
import { buildAgentScrollbackLines, buildChatScrollbackLines, computeScrollbackRows, computeBottomAnchor } from '../../../src/tui/views/scroll-math.js';
import { createInitialPerTabState } from '../../../src/tui/state.js';
import type { ViewRenderContext } from '../../../src/tui/views/types.js';

function ctx(timeline: any[]): ViewRenderContext {
  return {
    snap: {} as never,
    dimensions: { columns: 80, rows: 30 },
    perTab: createInitialPerTabState(),
    runtime: { chat: null, agent: { timeline, totalEventCount: timeline.length, workflow: undefined, session: { pendingApprovals: [], pendingToolCalls: [], currentIntent: undefined } } as never },
    themeName: 'dark',
  } as unknown as ViewRenderContext;
}

describe('buildAgentScrollbackLines', () => {
  it('returns an empty array for an empty timeline', () => {
    expect(buildAgentScrollbackLines(ctx([]), 76)).toEqual([]);
  });

  it('wraps long agent responses into multiple lines', () => {
    const longText = 'word '.repeat(50).trim();
    const timeline = [{ kind: 'agent.message' as const, text: longText, actor: 'agent' as const }];
    const lines = buildAgentScrollbackLines(ctx(timeline), 40);
    expect(lines.length).toBeGreaterThan(1);
  });

  it('marks the first line of each turn with isFirst=true and subsequent lines with isFirst=false', () => {
    const timeline = [
      { kind: 'agent.message' as const, text: 'first turn\nsecond line', actor: 'user' as const },
    ];
    const lines = buildAgentScrollbackLines(ctx(timeline), 200);
    expect(lines[0]!.isFirst).toBe(true);
    expect(lines[1]!.isFirst).toBe(false);
  });
});

describe('buildChatScrollbackLines', () => {
  it('returns an empty array for an empty timeline', () => {
    const emptyCtx = { ...ctx([]), runtime: { chat: { timeline: [], totalEventCount: 0, workflow: undefined, session: {} as never } as never, agent: null } } as unknown as ViewRenderContext;
    expect(buildChatScrollbackLines(emptyCtx, 76)).toEqual([]);
  });

  it('inserts a blank-line separator between user turns', () => {
    const chatCtx = { ...ctx([]), runtime: { chat: { timeline: [
      { kind: 'chat.message' as const, text: 'one' },
      { kind: 'chat.message' as const, text: 'two' },
    ], totalEventCount: 2, workflow: undefined, session: {} as never } as never, agent: null } } as unknown as ViewRenderContext;
    const lines = buildChatScrollbackLines(chatCtx, 200);
    // Expect: 'one' line, blank separator, 'two' line.
    expect(lines.length).toBe(3);
    expect(lines[1]!.text).toBe('');
  });
});

describe('computeScrollbackRows', () => {
  it('returns panelRow - scrollbackTop when positive', () => {
    expect(computeScrollbackRows(30, 6, 26)).toBe(20);
  });

  it('clamps to 0 when panelRow <= scrollbackTop', () => {
    expect(computeScrollbackRows(30, 25, 24)).toBe(0);
  });
});

describe('computeBottomAnchor', () => {
  it('returns max(0, allLines.length - scrollbackRows)', () => {
    const ctx30 = ctx(Array.from({ length: 100 }, (_, i) => ({ kind: 'agent.message' as const, text: `L${i}`, actor: 'user' as const })));
    // 100 turns × 1 line each + 99 blank-line separators (agent-view adds a
    // separator before every turn after the first) = 199 allLines. With rows=30,
    // scrollbackTop=6, panelRow=26 → scrollbackRows=20 → bottomAnchor=199-20=179.
    // (Brief expected 80, but that ignored the blank-line separator rule.)
    expect(computeBottomAnchor(ctx30, 'agent', 76, 26)).toBe(179);
  });

  it('returns 0 when content fits in scrollbackRows', () => {
    const ctx3 = ctx(Array.from({ length: 3 }, (_, i) => ({ kind: 'agent.message' as const, text: `L${i}`, actor: 'user' as const })));
    expect(computeBottomAnchor(ctx3, 'agent', 76, 26)).toBe(0);
  });
});
