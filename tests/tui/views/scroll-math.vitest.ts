import { describe, it, expect } from 'vitest';
import { buildAgentScrollbackLines, buildChatScrollbackLines, computeBottomAnchor } from '../../../src/tui/views/scroll-math.js';
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

  // Regression: alix-init-test 1785998769198 had the plan rendered ABOVE the
  // user prompt. After the fix, plan content sits between the user prompt and
  // the first agent response of the current turn.
  it('renders planContent AFTER the user prompt of the current turn (not above)', () => {
    const c = ctx([
      { kind: 'agent.message' as const, text: 'is llama.cpp installed', actor: 'user' as const },
      { kind: 'agent.message' as const, text: 'Yes, it is', actor: 'agent' as const },
    ]) as any;
    c.perTab.planContent = '## Summary\nCheck installed.';
    const lines = buildAgentScrollbackLines(c, 200);
    const userIdx = lines.findIndex((l: any) => l.text.includes('is llama.cpp'));
    const planIdx = lines.findIndex((l: any) => l.kind === 'plan');
    const agentIdx = lines.findIndex((l: any) => l.text.includes('Yes, it is'));
    expect(userIdx).toBeGreaterThanOrEqual(0);
    expect(planIdx).toBeGreaterThanOrEqual(0);
    expect(agentIdx).toBeGreaterThanOrEqual(0);
    expect(userIdx).toBeLessThan(planIdx);
    expect(planIdx).toBeLessThan(agentIdx);
  });
});

describe('buildAgentScrollbackLines — live streaming line', () => {
  function streamCtx(streamingText?: string): ViewRenderContext {
    return {
      ...ctx([]),
      perTab: { ...createInitialPerTabState(), streamingText },
    };
  }

  it('appends nothing when streamingText is unset', () => {
    expect(buildAgentScrollbackLines(streamCtx(undefined), 76)).toEqual([]);
    expect(buildAgentScrollbackLines(streamCtx(''), 76)).toEqual([]);
  });

  it('appends the streamed text as a single streaming line at the bottom', () => {
    const lines = buildAgentScrollbackLines(streamCtx('Hel'), 76);
    expect(lines.length).toBe(1);
    expect(lines[0]!.kind).toBe('streaming');
    expect(lines[0]!.text).toBe('Hel');
    expect(lines[0]!.isFirst).toBe(true);
    expect(lines[0]!.isLast).toBe(true);
  });

  it('wraps a long streamed response, marking first and last rows', () => {
    const long = 'word '.repeat(40).trim();
    const lines = buildAgentScrollbackLines(streamCtx(long), 20);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.filter((l) => l.kind === 'streaming').length).toBe(lines.length);
    expect(lines[0]!.isFirst).toBe(true);
    expect(lines[lines.length - 1]!.isLast).toBe(true);
    expect(lines.slice(1).every((l) => l.isFirst === false)).toBe(true);
  });

  it('renders the streaming line after completed turns (bottom, most recent)', () => {
    const timeline = [{ kind: 'agent.message' as const, text: 'done turn', actor: 'agent' as const }];
    const lines = buildAgentScrollbackLines({ ...ctx(timeline), perTab: { ...createInitialPerTabState(), streamingText: 'growing' } }, 76);
    expect(lines[lines.length - 1]!.kind).toBe('streaming');
    expect(lines[lines.length - 1]!.text).toBe('growing');
    expect(lines.some((l) => l.kind === 'agent')).toBe(true);
  });

  // Regression: streaming tokens were previously pinned at the absolute bottom
  // of the scrollback, separate from the turn they belong to. The fix pins the
  // streaming line inline at the bottom of the LAST turn's agent response
  // section, so streamed tokens render where the user prompt + plan + agent
  // response of the same turn live.
  it('renders streaming inline within the last turn (not at absolute bottom)', () => {
    const c = ctx([
      { kind: 'agent.message' as const, text: 'go', actor: 'user' as const },
      { kind: 'agent.message' as const, text: 'ok', actor: 'agent' as const },
      { kind: 'agent.message' as const, text: 'next', actor: 'user' as const },
    ]) as any;
    c.perTab.streamingText = 'still streaming';
    const lines = buildAgentScrollbackLines(c, 200);
    const userIdx = lines.findIndex((l: any) => l.text === 'next');
    const streamIdx = lines.findIndex((l: any) => l.kind === 'streaming');
    // streaming must come after the LAST user prompt (inline within that turn)
    expect(streamIdx).toBeGreaterThan(userIdx);
    // and must be at the very end of the scrollback (no ledger slot below it)
    expect(streamIdx).toBe(lines.length - 1);
  });

  it('includes the streaming line in computeBottomAnchor when content overflows', () => {
    // 100 turns × 1 line + 99 separators = 199; streaming adds 1 more = 200.
    const timeline = Array.from({ length: 100 }, (_, i) => ({ kind: 'agent.message' as const, text: `L${i}`, actor: 'user' as const }));
    const withStream = { ...ctx(timeline), perTab: { ...createInitialPerTabState(), streamingText: 'x' } };
    expect(computeBottomAnchor(withStream, 'agent')).toBe(180);
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

describe('computeBottomAnchor', () => {
  it('returns max(0, allLines.length - scrollbackRows)', () => {
    const ctx30 = ctx(Array.from({ length: 100 }, (_, i) => ({ kind: 'agent.message' as const, text: `L${i}`, actor: 'user' as const })));
    // 100 turns × 1 line each + 99 blank-line separators (agent-view adds a
    // separator before every turn after the first) = 199 allLines. With rows=30,
    // scrollbackTop=6, FOOTER_H=5 → topBorderRow=26, scrollbackBottom=25,
    // scrollbackRows=25-6+1=20 → bottomAnchor=199-20=179.
    // (Brief expected 80, but that ignored the blank-line separator rule.)
    expect(computeBottomAnchor(ctx30, 'agent')).toBe(179);
  });

  it('returns 0 when content fits in scrollbackRows', () => {
    const ctx3 = ctx(Array.from({ length: 3 }, (_, i) => ({ kind: 'agent.message' as const, text: `L${i}`, actor: 'user' as const })));
    expect(computeBottomAnchor(ctx3, 'agent')).toBe(0);
  });
});
