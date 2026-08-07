import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildAgentScrollbackLines, buildChatScrollbackLines, computeBottomAnchor, GUTTER_WIDTH } from '../../../src/tui/views/scroll-math.js';
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

/** Build a phase_changed entry at the given timestamp (ms). */
function phaseAt(t: number, phase: string): any {
  return { kind: 'agent.session.phase_changed', text: phase, startedAt: t, actor: 'system' };
}
/** Build a turn_completed entry at the given timestamp (ms). */
function turnCompletedAt(t: number): any {
  return { kind: 'agent.session.turn.completed', text: 'turn done', startedAt: t, actor: 'system' };
}
/** Build an agent response entry at the given timestamp (ms). */
function agentResponseAt(t: number, text: string): any {
  return { kind: 'agent.response', text, actor: 'agent', startedAt: t };
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

// ─── #430 — render-layer filter must admit agent.session.phase_changed and
//          agent.session.turn.completed alongside the agent.message/reasoning/
//          decision/response kinds. ──────────────────────────────────────
describe('buildAgentScrollbackLines — #430 render filter vocabulary', () => {
  it('admits agent.session.phase_changed entries through the timeline filter (drives stage attribution)', () => {
    // #430 trap: the scrollback filters twice — the projection whitelist,
    // then this render-layer filter. An entry admitted by the first and
    // rejected by the second vanishes with no error. Pin both halves:
    // this test exercises the render-layer half.
    //
    // #432 evolution: phase_changed events are no longer rendered as raw
    // content text — the line builder consumes them as stage boundaries.
    // Admission is verified through the new behavior: a phase_changed
    // before content drives the gutter label on the content's first line.
    // If the render filter dropped the phase_changed, the gutter would
    // stay blank (the content would have no stage attribution).
    const t0 = Date.now() - 5_000;
    const timeline = [
      { kind: 'agent.session.phase_changed' as const, text: 'Understanding', startedAt: t0 },
      { kind: 'agent.response' as const, text: 'reading files', actor: 'agent' as const, startedAt: t0 + 200 },
    ];
    const lines = buildAgentScrollbackLines(ctx(timeline), 200);
    const contentLine = lines.find((l: any) => l.text.includes('reading files'));
    expect(contentLine).toBeDefined();
    expect((contentLine as any).gutter).toBe('  UNDERSTANDING');
  });

  it('admits agent.session.turn.completed entries through the timeline filter (closes the running stage)', () => {
    // Same trap, second kind. If the filter dropped turn_completed, the
    // running stage would never close and the duration would remain a
    // live ticker (whole seconds + ellipsis). Verify the exact
    // (one-decimal) duration to prove the closing event landed.
    const t0 = Date.now() - 5_000;
    const timeline = [
      { kind: 'agent.session.phase_changed' as const, text: 'Understanding', startedAt: t0 },
      { kind: 'agent.response' as const, text: 'in flight', actor: 'agent' as const, startedAt: t0 + 500 },
      { kind: 'agent.session.turn.completed' as const, text: 'turn 1', startedAt: t0 + 1500 },
    ];
    const lines = buildAgentScrollbackLines(ctx(timeline), 200);
    const line = lines.find((l: any) => l.text.includes('in flight'));
    expect(line).toBeDefined();
    // turn_completed at t0+1500 closes Understanding → 1.5s exact.
    expect(line!.text).toContain('· 1.5s');
    expect(line!.text).not.toContain('…');
  });
});

// ─── #432 — render stage labels and durations in the agent scrollback ──
// Each line builder entry may carry an optional `gutter` field. When set,
// the view paints it into the 15-char reserved gutter column on the row's
// first wrap-line. Continuation lines of the same stage leave `gutter`
// undefined so the view paints a blank gutter. The scrollback remains
// append-only: gutter decoration inserts zero lines.
describe('buildAgentScrollbackLines — #432 stage labels and durations', () => {
  beforeEach(() => {
    // Pin Date.now() so "elapsed" assertions are deterministic.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T00:00:30.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sets gutter on the first content line of a stage; continuation lines blank', () => {
    // Understanding starts at t0, response at t0+200, wrap to 3 lines.
    const t0 = Date.now() - 5_000; // arbitrary recent anchor
    const timeline = [
      phaseAt(t0, 'Understanding'),
      agentResponseAt(t0 + 200, 'short response'),
      agentResponseAt(t0 + 400, 'another response'),
    ];
    const lines = buildAgentScrollbackLines(ctx(timeline), 200);
    const gutterLines = lines.filter((l: any) => l.gutter !== undefined);
    // Only the first content line of the Understanding stage gets gutter.
    expect(gutterLines).toHaveLength(1);
    expect(gutterLines[0]!.gutter).toBe('  UNDERSTANDING');
    expect(gutterLines[0]!.text).toContain('short response');
    expect(gutterLines[0]!.text).toContain('·');
  });

  it('a re-entered stage renders as a separate, later occurrence', () => {
    // Understanding → Planning → Understanding (re-entry).
    const t0 = Date.now() - 10_000;
    const timeline = [
      phaseAt(t0, 'Understanding'),
      agentResponseAt(t0 + 200, 'first understanding read'),
      phaseAt(t0 + 1200, 'Planning'),
      agentResponseAt(t0 + 1400, 'plan step'),
      phaseAt(t0 + 2600, 'Understanding'),
      agentResponseAt(t0 + 2800, 'second understanding read'),
    ];
    const lines = buildAgentScrollbackLines(ctx(timeline), 200);
    const understandingGutters = lines
      .filter((l: any) => l.gutter === '  UNDERSTANDING');
    expect(understandingGutters).toHaveLength(2);
    expect(understandingGutters[0]!.text).toContain('first understanding read');
    expect(understandingGutters[1]!.text).toContain('second understanding read');
  });

  it('a completed stage shows an exact duration (one-decimal seconds)', () => {
    // Understanding at t0, Planning at t0+1234 → Understanding lasted 1.234s.
    const t0 = Date.now() - 10_000;
    const timeline = [
      phaseAt(t0, 'Understanding'),
      agentResponseAt(t0 + 500, 'reading file A'),
      phaseAt(t0 + 1234, 'Planning'),
      agentResponseAt(t0 + 1500, 'plan step'),
    ];
    const lines = buildAgentScrollbackLines(ctx(timeline), 200);
    const understandingLine = lines.find((l: any) =>
      l.gutter === '  UNDERSTANDING' && l.text.includes('reading file A')
    );
    expect(understandingLine).toBeDefined();
    expect(understandingLine!.text).toContain('· 1.2s');
    // No ellipsis — completed stage.
    expect(understandingLine!.text).not.toContain('…');
  });

  it('the running stage shows whole-second elapsed with trailing ellipsis', () => {
    // Understanding at t0 (30s ago), no closing event yet.
    const t0 = Date.now() - 30_000;
    const timeline = [
      phaseAt(t0, 'Understanding'),
      agentResponseAt(t0 + 500, 'still reading'),
    ];
    const lines = buildAgentScrollbackLines(ctx(timeline), 200);
    const line = lines.find((l: any) => l.text.includes('still reading'));
    expect(line).toBeDefined();
    expect(line!.text).toContain('· 30s…');
    // Whole seconds only — no decimal.
    expect(line!.text).not.toMatch(/·\s*\d+\.\d/);
  });

  it('the running stage shows no final duration (no decimal seconds)', () => {
    const t0 = Date.now() - 5_000;
    const timeline = [
      phaseAt(t0, 'Understanding'),
      agentResponseAt(t0 + 500, 'mid-flight output'),
    ];
    const lines = buildAgentScrollbackLines(ctx(timeline), 200);
    const line = lines.find((l: any) => l.text.includes('mid-flight output'));
    expect(line!.text).not.toMatch(/·\s*\d+\.\d+s$/);
    expect(line!.text).toMatch(/·\s*\d+s…$/);
  });

  it('turn_completed terminates the final stage and stops ticking', () => {
    // Understanding at t0, content at t0+500, turn_completed at t0+1500.
    const t0 = Date.now() - 5_000;
    const timeline = [
      phaseAt(t0, 'Understanding'),
      agentResponseAt(t0 + 500, 'in flight output'),
      turnCompletedAt(t0 + 1500),
    ];
    const lines = buildAgentScrollbackLines(ctx(timeline), 200);
    const line = lines.find((l: any) => l.text.includes('in flight output'));
    expect(line).toBeDefined();
    expect(line!.text).toContain('· 1.5s');
    expect(line!.text).not.toContain('…');
  });

  it('a running stage with no output yet renders a bare gutter row carrying its timer', () => {
    // Phase_changed only — no content events at all yet.
    const t0 = Date.now() - 12_000;
    const timeline = [phaseAt(t0, 'Understanding')];
    const lines = buildAgentScrollbackLines(ctx(timeline), 200);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.kind).toBe('agent');
    expect((lines[0]! as any).gutter).toBe('  UNDERSTANDING');
    // Bare row — content carries the right-padded timer. Trim trailing
    // spaces (the line builder pads to textWidth so the duration sits at
    // the right column anchor).
    expect(lines[0]!.text.trimEnd()).toMatch(/·\s*\d+s…$/);
  });

  it('a stage that completes having produced no output drops out entirely', () => {
    // Understanding → Planning → Executing, no content between any of them.
    const t0 = Date.now() - 10_000;
    const timeline = [
      phaseAt(t0, 'Understanding'),
      phaseAt(t0 + 500, 'Planning'),
      phaseAt(t0 + 1000, 'Executing'),
      agentResponseAt(t0 + 1500, 'real output'),
    ];
    const lines = buildAgentScrollbackLines(ctx(timeline), 200);
    // Only the Executing stage gets a gutter (the only one with content).
    const gutterLines = lines.filter((l: any) => l.gutter !== undefined);
    expect(gutterLines).toHaveLength(1);
    expect(gutterLines[0]!.gutter).toBe('  EXECUTING'.padEnd(GUTTER_WIDTH - 2 + 2).slice(0, GUTTER_WIDTH));
    // No line carries the Understanding or Planning gutter.
    expect(lines.some((l: any) => l.gutter === '  UNDERSTANDING'.padEnd(GUTTER_WIDTH))).toBe(false);
    expect(lines.some((l: any) => l.gutter === '  PLANNING'.padEnd(GUTTER_WIDTH))).toBe(false);
  });

  it('a stage lasting a fraction of a second still renders with that duration', () => {
    // Understanding at t0, Planning at t0+350 → 0.35s, rounded to one decimal.
    const t0 = Date.now() - 5_000;
    const timeline = [
      phaseAt(t0, 'Understanding'),
      agentResponseAt(t0 + 100, 'whisper'),
      phaseAt(t0 + 350, 'Planning'),
    ];
    const lines = buildAgentScrollbackLines(ctx(timeline), 200);
    const line = lines.find((l: any) => l.text.includes('whisper'));
    expect(line).toBeDefined();
    expect(line!.text).toMatch(/·\s*0\.[34]s$/);
  });

  it('stage decoration inserts zero lines — line counts match the no-stage baseline', () => {
    // Same content events, two timelines: with stages and without stages.
    const t0 = Date.now() - 5_000;
    const baseline = [
      { kind: 'agent.message' as const, text: 'hi', actor: 'user' as const },
      { kind: 'agent.response' as const, text: 'hello', actor: 'agent' as const },
    ];
    const withStages = [
      ...baseline,
      // Stages don't add lines, just decorate them.
      phaseAt(t0, 'Understanding'),
      turnCompletedAt(t0 + 500),
    ];
    const baseLines = buildAgentScrollbackLines(ctx(baseline), 200);
    const stageLines = buildAgentScrollbackLines(ctx(withStages), 200);
    expect(stageLines.length).toBe(baseLines.length);
  });

  it('pre-stage turns keep flat rendering against the blank gutter', () => {
    // No phase_changed events — both lines stay blank-guttered.
    const timeline = [
      { kind: 'agent.message' as const, text: 'first prompt', actor: 'user' as const },
      { kind: 'agent.response' as const, text: 'first reply', actor: 'agent' as const },
    ];
    const lines = buildAgentScrollbackLines(ctx(timeline), 200);
    // No line should have a gutter attribute (pre-stage turns).
    expect(lines.some((l: any) => l.gutter !== undefined)).toBe(false);
  });

  it('gutter label is padded to GUTTER_WIDTH so the content column stays put', () => {
    const t0 = Date.now() - 5_000;
    const timeline = [
      phaseAt(t0, 'Understanding'),
      agentResponseAt(t0 + 200, 'x'),
    ];
    const lines = buildAgentScrollbackLines(ctx(timeline), 200);
    const gutterLine = lines.find((l: any) => l.gutter !== undefined);
    expect(gutterLine).toBeDefined();
    // Gutter is exactly GUTTER_WIDTH chars — fixed column anchor.
    expect((gutterLine as any).gutter.length).toBe(GUTTER_WIDTH);
  });
});
