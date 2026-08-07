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

  it('does not render the snapshot-derived progress ledger', () => {
    const c = ctx([]) as any;
    c.perTab.progressLedger = '✓ edit_file — 3 lines changed\n✗ run_tests — 2 failing';
    c.perTab.ledgerExpanded = true;

    const lines = buildAgentScrollbackLines(c, 200);

    expect(lines).toEqual([]);
    expect(lines.some((line: any) => line.text.includes('edit_file'))).toBe(false);
    expect(lines.some((line: any) => line.text.includes('run_tests'))).toBe(false);
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

// ─── #434 — render tool calls in the stream with outcomes ───────────────
// Tool invocations and results render chronologically (not bottom-pinned).
// Success and failure are visually distinct. Result lines render under the
// stage in which the call occurred, and the append-only invariant pins the
// assumption that tool calls execute strictly sequentially — if parallel
// tool execution is introduced, this test fails loudly. See spec #429,
// slice #5, and ticket #434.
// ───────────────────────────────────────────────────────────────────────
describe('buildAgentScrollbackLines — #434 tool calls in the stream with outcomes', () => {
  /** Build a tool.started entry at the given timestamp (ms). */
  function toolStartedAt(t: number, toolName: string, detail?: string): any {
    return {
      kind: 'tool.started', text: toolName, startedAt: t, actor: 'agent',
      ...(detail !== undefined ? { detail } : {}),
    };
  }
  /** Build a tool.completed entry at the given timestamp (ms). */
  function toolCompletedAt(t: number, toolName: string, detail?: string): any {
    return {
      kind: 'tool.completed', text: toolName, startedAt: t, actor: 'agent',
      ...(detail !== undefined ? { detail } : {}),
    };
  }
  /** Build a tool.failed entry at the given timestamp (ms). */
  function toolFailedAt(t: number, toolName: string, detail?: string): any {
    return {
      kind: 'tool.failed', text: toolName, startedAt: t, actor: 'agent',
      ...(detail !== undefined ? { detail } : {}),
    };
  }

  it('a tool.started event renders an invocation line with → marker', () => {
    const t0 = Date.now() - 5_000;
    const timeline = [
      phaseAt(t0, 'Executing'),
      toolStartedAt(t0 + 100, 'edit_file'),
    ];
    const lines = buildAgentScrollbackLines(ctx(timeline), 200);
    // Invocation line is present and uses the → marker.
    const invLine = lines.find((l: any) => l.text.includes('→ edit_file'));
    expect(invLine).toBeDefined();
    // Invocation is the first line of its stage — it carries the gutter.
    expect((invLine as any).gutter).toBe('  EXECUTING'.padEnd(GUTTER_WIDTH));
    // Invocation is the first row (isFirst=true) of its content group.
    expect((invLine as any).isFirst).toBe(true);
  });

  it('a tool.completed event renders a result line with ✓ marker (success)', () => {
    const t0 = Date.now() - 5_000;
    const timeline = [
      phaseAt(t0, 'Executing'),
      toolStartedAt(t0 + 100, 'edit_file'),
      toolCompletedAt(t0 + 1500, 'edit_file', '3 lines changed'),
    ];
    const lines = buildAgentScrollbackLines(ctx(timeline), 200);
    // Result line is present and uses the ✓ marker for success.
    const resultLine = lines.find((l: any) => l.text.includes('✓ edit_file'));
    expect(resultLine).toBeDefined();
    // Success marker: ✓ (U+2713) is the visual signal that distinguishes success
    // from failure. The detail surfaces in the result line.
    expect(resultLine!.text).toContain('3 lines changed');
  });

  it('a tool.failed event renders a result line with ✗ marker (failure)', () => {
    const t0 = Date.now() - 5_000;
    const timeline = [
      phaseAt(t0, 'Executing'),
      toolStartedAt(t0 + 100, 'run_tests'),
      toolFailedAt(t0 + 1500, 'run_tests', '2 failing'),
    ];
    const lines = buildAgentScrollbackLines(ctx(timeline), 200);
    // Result line is present and uses the ✗ marker for failure.
    const resultLine = lines.find((l: any) => l.text.includes('✗ run_tests'));
    expect(resultLine).toBeDefined();
    // Failure marker: ✗ (U+2717) — visually distinct from the success ✓.
    expect(resultLine!.text).toContain('2 failing');
  });

  it('tool.completed without a preceding tool.started renders as first-of-stage (regression for orphan-result edge case)', () => {
    // The executor never emits tool.completed without first emitting
    // tool.started, so this case should not occur in practice. But the
    // timeline is permissive and the line builder handles it: the result
    // becomes first-of-stage (carries the gutter) because no content has
    // yet been attributed to the running stage. Pin this behavior so a
    // future tightening of the line builder does not silently drop
    // orphan results.
    const t0 = Date.now() - 5_000;
    const timeline = [
      phaseAt(t0, 'Executing'),
      toolCompletedAt(t0 + 500, 'orphan_tool', 'made it through somehow'),
    ];
    const lines = buildAgentScrollbackLines(ctx(timeline), 200);
    const resultLine = lines.find((l: any) => l.text.includes('✓ orphan_tool'));
    expect(resultLine).toBeDefined();
    // No invocation preceded this completion, so the result is the stage's
    // first content — it carries the gutter label.
    expect((resultLine as any).gutter).toBe('  EXECUTING'.padEnd(GUTTER_WIDTH));
    expect(resultLine!.text).toContain('made it through somehow');
  });

  it('success and failure markers are visually distinct (✓ vs ✗)', () => {
    // The whole point of slice #5: an operator can tell at a glance
    // which calls worked. Same tool, two outcomes — markers differ.
    const t0 = Date.now() - 10_000;
    const successTimeline = [
      phaseAt(t0, 'Executing'),
      toolStartedAt(t0 + 100, 'shell'),
      toolCompletedAt(t0 + 500, 'shell', 'ok'),
    ];
    const failureTimeline = [
      phaseAt(t0, 'Executing'),
      toolStartedAt(t0 + 100, 'shell'),
      toolFailedAt(t0 + 500, 'shell', 'exit 1'),
    ];
    const succLines = buildAgentScrollbackLines(ctx(successTimeline), 200);
    const failLines = buildAgentScrollbackLines(ctx(failureTimeline), 200);
    const succResult = succLines.find((l: any) => l.text.includes('shell') && l.text.includes('ok'));
    const failResult = failLines.find((l: any) => l.text.includes('shell') && l.text.includes('exit 1'));
    expect(succResult).toBeDefined();
    expect(failResult).toBeDefined();
    expect(succResult!.text).toMatch(/✓/);
    expect(failResult!.text).toMatch(/✗/);
    // And the same tool name appears in both — only the marker differentiates.
    expect(succResult!.text).not.toBe(failResult!.text);
  });

  it('invocation and result render under the stage the call occurred in (gutter alignment)', () => {
    // Executing stage wraps the entire tool lifecycle. Both lines fall under
    // the EXECUTING gutter (the first line of the content group, which is
    // the invocation, decorates; the result line is a continuation and
    // leaves the gutter blank).
    const t0 = Date.now() - 5_000;
    const timeline = [
      phaseAt(t0, 'Executing'),
      toolStartedAt(t0 + 100, 'edit_file'),
      toolCompletedAt(t0 + 1500, 'edit_file', 'done'),
    ];
    const lines = buildAgentScrollbackLines(ctx(timeline), 200);
    const invLine = lines.find((l: any) => l.text.includes('→ edit_file'));
    const resultLine = lines.find((l: any) => l.text.includes('✓ edit_file'));
    expect(invLine).toBeDefined();
    expect(resultLine).toBeDefined();
    // Invocation: first of stage → gutter present.
    expect((invLine as any).gutter).toBe('  EXECUTING'.padEnd(GUTTER_WIDTH));
    // Result: continuation within the same stage → no gutter (blank).
    expect((resultLine as any).gutter).toBeUndefined();
  });

  it('the bottom-pinned pending-tool-call section is removed (no PENDING TOOL CALLS line)', () => {
    // #435 will subsume the data flow too. For now the rendering of
    // `perTab.pendingToolCalls` (snapshot-derived) is gone — only timeline
    // events drive the tool-call display.
    const c = ctx([]);
    (c.perTab as any).pendingToolCalls = [
      { name: 'edit_file', summary: 'src/foo.ts' },
      { name: 'run_tests' },
    ];
    const lines = buildAgentScrollbackLines(c, 200);
    // No "PENDING TOOL CALLS" header line — that whole section is gone.
    expect(lines.some((l: any) => l.text === 'PENDING TOOL CALLS')).toBe(false);
    // And no toolCall kind lines either (the section's kind was 'toolCall').
    expect(lines.some((l: any) => l.kind === 'toolCall')).toBe(false);
  });

  // ─── THE append-only invariant test (#434 acceptance criterion) ───
  // "An already-rendered prefix does not change as the stream grows."
  // This pins the design contract that the scrollback's offset is stable
  // across tail-appends. The property currently holds for four reasons;
  // one of them — sequential tool execution — is an assumption a future
  // parallel-execution change would break with no obvious link to
  // scrolling. This test turns that from silent corruption into a failure.
  // ─────────────────────────────────────────────────────────────────
  it('append-only invariant: an already-rendered prefix does not change as tool calls run to completion', () => {
    // Phase 1: user prompt + Executing stage + tool.started edit_file.
    // This produces an invocation line and is the "early prefix" — every
    // line the operator can already see when the tool is in flight.
    const t0 = Date.now() - 30_000;
    const earlyTimeline: any[] = [
      { kind: 'agent.message' as const, text: 'fix the login redirect', actor: 'user' as const, startedAt: t0 },
      phaseAt(t0 + 100, 'Executing'),
      toolStartedAt(t0 + 200, 'edit_file'),
    ];
    const earlyLines = buildAgentScrollbackLines(ctx(earlyTimeline), 200);
    const earlyPrefixLen = earlyLines.length;

    // Phase 2: the SAME prefix plus the rest of the tool's lifecycle, plus
    // a SECOND tool (run_tests) that fails. Each of these events MUST
    // append at the tail — none may shift an earlier line.
    const fullTimeline: any[] = [
      ...earlyTimeline,
      toolCompletedAt(t0 + 1500, 'edit_file', '3 lines changed'),
      toolStartedAt(t0 + 1700, 'run_tests'),
      toolFailedAt(t0 + 3000, 'run_tests', '2 failing'),
    ];
    const fullLines = buildAgentScrollbackLines(ctx(fullTimeline), 200);

    // The exact-content assertion: every early line survives byte-for-byte.
    // If tool.completed retroactively mutated the invocation line, this
    // fails. If a parallel tool arrived between started and completed,
    // the early line count would be wrong and the splice would fail.
    expect(fullLines.length).toBeGreaterThan(earlyPrefixLen);
    for (let i = 0; i < earlyPrefixLen; i++) {
      expect(fullLines[i]).toEqual(earlyLines[i]);
    }

    // The tail must contain the expected new lines in order.
    const tail = fullLines.slice(earlyPrefixLen);
    // Result line for edit_file (success) appears in the tail.
    expect(tail.some((l: any) => l.text.includes('✓ edit_file'))).toBe(true);
    // Invocation line for run_tests appears after edit_file's result.
    expect(tail.some((l: any) => l.text.includes('→ run_tests'))).toBe(true);
    // Result line for run_tests (failure) appears at the end.
    expect(tail.some((l: any) => l.text.includes('✗ run_tests'))).toBe(true);

    // Strict-ordering invariant: edit_file's result precedes run_tests's
    // invocation, which precedes run_tests's result. Anything else means
    // a tool result has been inserted mid-stream — the property broken.
    const succIdx = fullLines.findIndex((l: any) => l.text.includes('✓ edit_file'));
    const inv2Idx = fullLines.findIndex((l: any) => l.text.includes('→ run_tests'));
    const failIdx = fullLines.findIndex((l: any) => l.text.includes('✗ run_tests'));
    expect(succIdx).toBeGreaterThan(0);
    expect(inv2Idx).toBeGreaterThan(succIdx);
    expect(failIdx).toBeGreaterThan(inv2Idx);
  });

  it('append-only invariant: inserting a tool.completed between two timeline snapshots does not mutate the prefix', () => {
    // A second variant of the invariant: drive the same builder with two
    // snapshots of the same growing timeline and assert identity. This is
    // the test the ticket pins — it MUST fail if a tool result retro-
    // decorates the matching invocation (e.g. by replacing its text).
    const t0 = Date.now() - 60_000;
    const base: any[] = [
      { kind: 'agent.message' as const, text: 'run a command', actor: 'user' as const, startedAt: t0 },
      phaseAt(t0 + 100, 'Executing'),
      toolStartedAt(t0 + 200, 'shell'),
    ];
    const a = buildAgentScrollbackLines(ctx(base), 200);
    const b = buildAgentScrollbackLines(ctx([...base, toolCompletedAt(t0 + 800, 'shell', 'ok')]), 200);
    // Strictly longer — at least one new line (the result).
    expect(b.length).toBeGreaterThan(a.length);
    // And the prefix is identical, line-for-line.
    for (let i = 0; i < a.length; i++) {
      expect(b[i]).toEqual(a[i]);
    }
  });
});

// ─── #436 — render approvals inline + pending-approval banner ─────
// Slice #7 of the stage-decorated scrollback plan (#429). Approvals
// render inline and chronologically, under the stage in which they
// occurred. The bottom callout block is gone: the pending banner now
// surfaces a pending approval at the bottom of the agent tab (status
// row, painted by frame-painter.ts), and the inline line gives the
// audit/history surface.
// ───────────────────────────────────────────────────────────────────────
describe('buildAgentScrollbackLines — #436 approvals inline', () => {
  /** Build a tool.started entry at the given timestamp (ms). */
  function toolStartedAt(t: number, toolName: string, detail?: string): any {
    return { kind: 'tool.started', text: toolName, detail, startedAt: t, actor: 'agent' };
  }
  /** Build a tool.completed entry at the given timestamp (ms). */
  function toolCompletedAt(t: number, toolName: string, detail?: string): any {
    return { kind: 'tool.completed', text: toolName, detail, startedAt: t, actor: 'agent' };
  }
  /** Build an approval.requested entry at the given timestamp (ms). */
  function approvalRequestedAt(t: number, prompt: string): any {
    return {
      kind: 'approval.requested',
      text: prompt,
      startedAt: t,
      actor: 'agent',
    };
  }

  it('renders an approval.requested event inline under the running stage', () => {
    const t0 = Date.now() - 5_000;
    // Place a tool invocation first so the Executing stage's gutter
    // label is claimed by the tool line; the approval is then a
    // continuation line under the same stage.
    const timeline = [
      phaseAt(t0, 'Executing'),
      toolStartedAt(t0 + 100, 'write_file'),
      approvalRequestedAt(t0 + 500, 'Approve write_file on guard.ts'),
    ];
    const lines = buildAgentScrollbackLines(ctx(timeline), 200);
    // Inline approval line is present.
    const approvalLine = lines.find((l: any) => l.text && l.text.includes('Approve write_file'));
    expect(approvalLine).toBeDefined();
    // The approval line itself is a continuation — no gutter label
    // (one gutter per stage, on the first content line of that stage).
    expect((approvalLine as any).gutter).toBeUndefined();
    // The gutter label sits on the stage's first content line above it
    // (the tool invocation). Confirms the approval is attributed to
    // that stage.
    const invocation = lines.find((l: any) => l.text && l.text.includes('write_file') && l.text.startsWith('→'));
    expect(invocation).toBeDefined();
    const expectedGutter = '  ' + 'EXECUTING'.padEnd(GUTTER_WIDTH - 2);
    expect((invocation as any).gutter).toBe(expectedGutter);
    // The approval line appears AFTER the invocation (chronological).
    expect(lines.indexOf(approvalLine as any)).toBeGreaterThan(lines.indexOf(invocation as any));
  });

  it('renders an approval.requested with no prior content as the first-of-stage (carries gutter)', () => {
    const t0 = Date.now() - 5_000;
    // Approval arrives under Executing with no preceding content.
    const timeline = [
      phaseAt(t0, 'Executing'),
      approvalRequestedAt(t0 + 200, 'approval without prior content'),
    ];
    const lines = buildAgentScrollbackLines(ctx(timeline), 200);
    const approvalLine = lines.find((l: any) => l.text && l.text.includes('approval without prior'));
    expect(approvalLine).toBeDefined();
    // No prior content means the approval IS the first content of the
    // stage — it gets the gutter label.
    const expectedGutter = '  ' + 'EXECUTING'.padEnd(GUTTER_WIDTH - 2);
    expect((approvalLine as any).gutter).toBe(expectedGutter);
  });

  it('renders multiple approval.requested events chronologically across stage transitions', () => {
    const t0 = Date.now() - 5_000;
    // First approval under Executing (it claims the gutter for that
    // stage). Second approval under Verifying (claims its own gutter).
    const timeline = [
      phaseAt(t0, 'Executing'),
      approvalRequestedAt(t0 + 200, 'first approval prompt'),
      phaseAt(t0 + 500, 'Verifying'),
      approvalRequestedAt(t0 + 800, 'second approval prompt'),
    ];
    const lines = buildAgentScrollbackLines(ctx(timeline), 200);
    const first = lines.find((l: any) => l.text && l.text.includes('first approval'));
    const second = lines.find((l: any) => l.text && l.text.includes('second approval'));
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // First approval is the first content of Executing — gutter label.
    const execGutter = '  ' + 'EXECUTING'.padEnd(GUTTER_WIDTH - 2);
    const verGutter = '  ' + 'VERIFYING'.padEnd(GUTTER_WIDTH - 2);
    expect((first as any).gutter).toBe(execGutter);
    expect((second as any).gutter).toBe(verGutter);
    // Chronological order preserved.
    const firstIdx = lines.indexOf(first as any);
    const secondIdx = lines.indexOf(second as any);
    expect(firstIdx).toBeLessThan(secondIdx);
  });

  it('does NOT render the bottom callout block (replaced by inline + banner)', () => {
    // The bottom block used to render when perTab.pendingApprovals was
    // populated; ticket #436 retires it. Pending list is non-empty
    // here; no "X approval requests pending" callout should appear.
    const c = ctx([]);
    (c.perTab as any).pendingApprovals = [
      { id: 'a1', toolName: 'write_file', target: 'guard.ts', requestedAt: Date.now() },
    ];
    const lines = buildAgentScrollbackLines(c, 200);
    expect(lines.some((l: any) => l.text && l.text.includes('approval request'))).toBe(false);
    expect(lines.some((l: any) => l.text && l.text.includes('press'))).toBe(false);
  });

  it('append-only invariant: an arriving approval.requested does not mutate prior lines', () => {
    // The append-only property pinned by #434 must hold across the new
    // approval rendering: a newly arrived approval.requested appends to
    // the tail; it does not re-decorate any prior line. The banner
    // itself lives on the status row (outside the scrollback content),
    // so it is irrelevant to this test.
    const t0 = Date.now() - 30_000;
    const earlyTimeline: any[] = [
      { kind: 'agent.message' as const, text: 'fix the bug', actor: 'user' as const, startedAt: t0 },
      phaseAt(t0 + 100, 'Executing'),
      toolStartedAt(t0 + 200, 'edit_file'),
      toolCompletedAt(t0 + 1500, 'edit_file', '3 lines changed'),
    ];
    const earlyLines = buildAgentScrollbackLines(ctx(earlyTimeline), 200);
    const earlyPrefixLen = earlyLines.length;

    const fullTimeline: any[] = [
      ...earlyTimeline,
      approvalRequestedAt(t0 + 1700, 'approve the next edit'),
    ];
    const fullLines = buildAgentScrollbackLines(ctx(fullTimeline), 200);

    expect(fullLines.length).toBeGreaterThan(earlyPrefixLen);
    // Prefix identical, line-for-line — same assertion #434 uses.
    for (let i = 0; i < earlyPrefixLen; i++) {
      expect(fullLines[i]).toEqual(earlyLines[i]);
    }
    // Tail contains the new inline approval.
    const tail = fullLines.slice(earlyPrefixLen);
    expect(tail.some((l: any) => l.text && l.text.includes('approve the next edit'))).toBe(true);
  });
});
