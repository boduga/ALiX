import { describe, expect, it, vi } from 'vitest';
import * as scrollbackModule from '../../../src/interfaces/tui/workbench/views/workbench-scrollback.js';
import * as terminalText from '../../../src/interfaces/tui/terminal-text.js';
import type { AgentActivity } from '../../../src/agents/agent/agent-activity.js';
import type { AgentLivenessSnapshot } from '../../../src/agents/agent/agent-liveness.js';
import type { TimelineEntry } from '../../../src/interfaces/tui/runtime/timeline-builder.js';
import type { RuntimeSnapshot, SessionMetadata } from '../../../src/interfaces/tui/snapshot.js';
import { SessionPhase } from '../../../src/interfaces/tui/state.js';
import { createWorkbenchRenderHarness } from '../../fixtures/tui/workbench-render-harness.js';

/**
 * Phase 10.4 — large-history rendering/input budgets, elapsed-tick repaint
 * bounds, and row-diff output bounding.
 *
 * Baselines this file measures against (both read-only):
 * - `tests/tui/workbench/input-paint-cost.vitest.ts` bounds grapheme
 *   segmentation work for one raw keystroke on the small 8-entry harness.
 * - `tests/manual/run-workbench-input-latency-pty.py` bounds real
 *   raw-key-to-frame latency at 200x44 (max < 250 ms, median printed).
 *
 * Budget style: wall-clock per-OPERATION bounds (one paint, one keystroke)
 * rather than an aggregate total, at a 10x margin over measured p95 so CI
 * noise cannot flake them. Every wall-clock bound is paired with a
 * deterministic work bound (grapheme bytes / patch-row counts) so a real
 * regression is caught even where timing is too noisy to be evidence.
 * The two wall-clock tests carry an explicit 60s per-test timeout so the
 * budget itself (per-op x iterations) can never be the thing that times out.
 *
 * MEASURED (200x44, 1500-message programmatic history => 4501 scrollback
 * lines, 5 warm + 10 measured iterations, dev machine):
 *   render paint   p50 = 263.90 ms, p95 = 307.32 ms  -> budget 3200 ms
 *   raw keystroke  p50 = 283.63 ms, p95 = 348.98 ms  -> budget 3600 ms
 *   keystroke grapheme bytes = 13559                 -> budget 150000
 *   elapsed tick  patch rows = 2 (header status + clock-derived activity row)
 *   first paint   patch rows = 44 (= terminal rows), bytes = 18291
 *
 * The paint cost was dominated by buildWorkbenchScrollbackLines re-running
 * on every tick; the history portion is now memoized by content key (only
 * the live activity tail rebuilds), asserted by the ref-sharing test below.
 */

const COLUMNS = 200;
const ROWS = 44;
const HISTORY_MESSAGES = 1500;
const TICK_NOW = Date.parse('2026-10-03T10:14:46.000Z');

/** Per-paint wall-clock budget = measured p95 (307.32 ms) x 10, rounded up. */
const RENDER_BUDGET_MS = 3200;
/** Per-keystroke wall-clock budget = measured p95 (348.98 ms) x 10, rounded up. */
const KEYSTROKE_BUDGET_MS = 3600;
/** Grapheme work per keystroke: measured 13559 x 10, aligned to the
 *  150000 work bound already used by input-paint-cost.vitest.ts. */
const KEYSTROKE_GRAPHEME_BYTES_BUDGET = 150_000;
/** Patch rows an elapsed tick may repaint: measured 2, bounded at 6 so the
 *  bound is structural (status + clock-derived row), not a recorded value. */
const TICK_PATCH_ROW_BOUND = 6;
/** First-paint payload bound: terminal rows x (visible width + ANSI headroom).
 *  A history-proportional repaint would be 4500 x 200 = 900000+ bytes. */
const FIRST_PAINT_BYTES_BOUND = ROWS * (COLUMNS + 512);

/** Wall-clock budgets need headroom past the 10s default test timeout:
 *  budget x iterations can legitimately reach ~54s on a pathological CI. */
const TIMING_TEST_TIMEOUT_MS = 60_000;

const PATCH_ROW_PATTERN = /\x1b\[\d+;1H\x1b\[2K/g;

type Harness = ReturnType<typeof createWorkbenchRenderHarness>;
type RebuildSpy = { mock: { results: readonly { readonly value: unknown }[] } };

function patchRowsIn(writes: readonly string[]): number {
  let total = 0;
  for (const write of writes) total += write.match(PATCH_ROW_PATTERN)?.length ?? 0;
  return total;
}

function percentile(samples: readonly number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index]!;
}

function measure(label: string, samples: readonly number[], extra = ''): void {
  const p50 = percentile(samples, 50);
  const p95 = percentile(samples, 95);
  const max = Math.max(...samples);
  process.stdout.write(
    `[Phase10.4] ${label} p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms max=${max.toFixed(2)}ms${extra}\n`,
  );
}

function withTerminal<T>(columns: number, rows: number, run: () => T): T {
  const columnsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
  const rowsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
  try {
    Object.defineProperty(process.stdout, 'columns', { value: columns, configurable: true });
    Object.defineProperty(process.stdout, 'rows', { value: rows, configurable: true });
    return run();
  } finally {
    if (columnsDescriptor) Object.defineProperty(process.stdout, 'columns', columnsDescriptor);
    else Reflect.deleteProperty(process.stdout, 'columns');
    if (rowsDescriptor) Object.defineProperty(process.stdout, 'rows', rowsDescriptor);
    else Reflect.deleteProperty(process.stdout, 'rows');
  }
}

/** Programmatic large history — no fixture file; every message is unique. */
function largeTimeline(messageCount: number): TimelineEntry[] {
  return Array.from({ length: messageCount }, (_, index) => ({
    id: `perf-${index}`,
    kind: 'agent.message' as const,
    actor: index % 2 === 0 ? 'user' : 'agent',
    sessionId: 'perf',
    startedAt: 1_000 + index * 10,
    text: `Perf entry ${index} — the operator asked for a small change and the assistant confirmed the edit landed cleanly (${index}).`,
    sourceEvents: { firstSequence: index + 1 },
  }));
}

function largeHistoryHarness(messageCount = HISTORY_MESSAGES, session?: SessionMetadata): Harness {
  const harness = createWorkbenchRenderHarness();
  const runtime: RuntimeSnapshot = {
    trace: [],
    timeline: largeTimeline(messageCount),
    workflow: null,
    totalEventCount: messageCount,
    lastEventAt: null,
    sessionId: 'perf',
    capabilities: null,
    metrics: null,
    context: null,
  };
  const internal = harness.app as unknown as { agentRuntime: RuntimeSnapshot };
  internal.agentRuntime = runtime;
  const base = harness.state.lastSnapshot!;
  harness.state.lastSnapshot = { ...base, runtime, ...(session ? { session } : {}) };
  return harness;
}

/** Running session whose header status line and trailing activity row are
 *  clock-derived — the R09 "tick without replaying events" surface. */
function liveSession(now: number): SessionMetadata {
  const activity: AgentActivity = {
    state: 'tool_running',
    toolName: 'shell.run',
    toolStartedAt: now - 5_000,
    startedAt: now - 18_000,
    lastProgressAt: now - 1_000,
    lastEventAt: now - 1_000,
    elapsedMs: 18_000,
    invocationId: 'inv-perf',
  };
  const liveness: AgentLivenessSnapshot = {
    startedAt: now - 18_000,
    idleMs: 1_000,
    progressCount: 3,
    lastProgressAt: now - 1_000,
    state: 'healthy',
  };
  return {
    mode: 'auto',
    phase: SessionPhase.Executing,
    version: 'test',
    startedAt: now - 18_000,
    turns: 1,
    filesTouched: 0,
    activity,
    liveness,
  };
}

/** Scrollback line count from the most recent buildWorkbenchScrollbackLines
 *  call recorded by the spy. */
function scrollbackLineCount(spy: RebuildSpy): number {
  const last = spy.mock.results.at(-1)?.value;
  return Array.isArray(last) ? last.length : 0;
}

describe('Phase 10 perf parity [Phase10.4]', () => {
  it('[Phase10.4, T09] large-history frame render stays within the measured budget', { timeout: TIMING_TEST_TIMEOUT_MS }, () => {
    withTerminal(COLUMNS, ROWS, () => {
      const harness = largeHistoryHarness();
      const spy = vi.spyOn(scrollbackModule, 'buildWorkbenchScrollbackLines');
      try {
        for (let index = 0; index < 5; index++) harness.paint();
        const historyLines = scrollbackLineCount(spy);
        expect(historyLines).toBeGreaterThanOrEqual(2000);

        const samples: number[] = [];
        for (let index = 0; index < 10; index++) {
          const started = performance.now();
          harness.paint();
          samples.push(performance.now() - started);
        }
        measure(`render historyLines=${historyLines}`, samples);
        // Per-operation bound: no single paint may exceed the 10x budget.
        for (const sample of samples) expect(sample).toBeLessThanOrEqual(RENDER_BUDGET_MS);
      } finally {
        spy.mockRestore();
      }
    });
  });

  it('[Phase10.4, T09] raw keystroke over large history stays within the input budget', { timeout: TIMING_TEST_TIMEOUT_MS }, () => {
    withTerminal(COLUMNS, ROWS, () => {
      const harness = largeHistoryHarness();
      const graphemeSpy = vi.spyOn(terminalText, 'graphemes');
      try {
        const type = (text: string): void => {
          (harness.app as unknown as { handleRaw(bytes: Buffer): void }).handleRaw(Buffer.from(text));
        };
        for (let index = 0; index < 5; index++) type('w');

        const samples: number[] = [];
        const work: number[] = [];
        for (let index = 0; index < 10; index++) {
          graphemeSpy.mockClear();
          const started = performance.now();
          type('k');
          samples.push(performance.now() - started);
          work.push(graphemeSpy.mock.calls.reduce((total, [text]) => total + text.length, 0));
        }
        measure('keystroke', samples, ` graphemeBytes=${work[0]}`);
        for (const sample of samples) expect(sample).toBeLessThanOrEqual(KEYSTROKE_BUDGET_MS);
        // Deterministic work bound: grapheme segmentation across module
        // boundaries during one keystroke paint. Bounded by the visible
        // frame (44 x 200 cells), independent of the 4500-line history.
        for (const bytes of work) expect(bytes).toBeLessThanOrEqual(KEYSTROKE_GRAPHEME_BYTES_BUDGET);
      } finally {
        graphemeSpy.mockRestore();
      }
    });
  });

  it('[Phase10.4, R09] elapsed tick repaints only clock-derived rows, never the whole frame', () => {
    withTerminal(COLUMNS, ROWS, () => {
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(TICK_NOW);
      try {
        const harness = largeHistoryHarness(HISTORY_MESSAGES, liveSession(TICK_NOW));
        const rebuildSpy = vi.spyOn(scrollbackModule, 'buildWorkbenchScrollbackLines');
        try {
          harness.paint();
          const historyLines = scrollbackLineCount(rebuildSpy);
          expect(historyLines).toBeGreaterThanOrEqual(2000);

          const writesBefore = harness.output.writes.length;
          nowSpy.mockReturnValue(TICK_NOW + 1_000);
          harness.paint();
          const tickWrites = harness.output.writes.slice(writesBefore);
          const tickPatchRows = patchRowsIn(tickWrites);
          process.stdout.write(
            `[Phase10.4] tick historyLines=${historyLines} patchRows=${tickPatchRows} writes=${tickWrites.length}\n`,
          );
          // Clock moved only: the header status row (RUNNING Ns) plus the
          // clock-derived activity row at the transcript tail — measured 2.
          // Bounded by a small constant: independent of the 4500-line history
          // above and independent of the ~30 visible body rows.
          expect(tickPatchRows).toBeGreaterThan(0);
          expect(tickPatchRows).toBeLessThanOrEqual(TICK_PATCH_ROW_BOUND);
        } finally {
          rebuildSpy.mockRestore();
        }
      } finally {
        nowSpy.mockRestore();
      }
    });
  });

  it('[Phase10.4, R09] elapsed tick with no clock-derived content writes no rows', () => {
    withTerminal(COLUMNS, ROWS, () => {
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(TICK_NOW);
      try {
        const harness = largeHistoryHarness();
        harness.paint();
        const writesBefore = harness.output.writes.length;
        nowSpy.mockReturnValue(TICK_NOW + 1_000);
        harness.paint();
        const tickWrites = harness.output.writes.slice(writesBefore);
        // Idle session: nothing on screen is clock-derived, so the row diff
        // emits zero content patches — the 4500-line body is not re-sent.
        expect(patchRowsIn(tickWrites)).toBe(0);
      } finally {
        nowSpy.mockRestore();
      }
    });
  });

  it('[Phase10.4] elapsed tick reuses cached scrollback lines (no whole-history rebuild)', () => {
    // Phase 10.4 requires "Avoid whole-history reformatting on elapsed
    // ticks". buildWorkbenchScrollbackLines memoizes the clock-free history
    // portion by content key and rebuilds only the live activity tail, so a
    // tick that advances only Date.now() shares every history line object
    // with the previous paint (reference equality) instead of
    // re-projecting and re-wrapping the whole history. Only the trailing
    // clock-derived tail rows (activity elapsed) are fresh objects.
    withTerminal(COLUMNS, ROWS, () => {
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(TICK_NOW);
      try {
        const harness = largeHistoryHarness();
        const rebuildSpy = vi.spyOn(scrollbackModule, 'buildWorkbenchScrollbackLines');
        try {
          harness.paint();
          const first = rebuildSpy.mock.results.at(-1)?.value as unknown[];
          expect(first.length).toBeGreaterThan(4000);
          rebuildSpy.mockClear();
          nowSpy.mockReturnValue(TICK_NOW + 1_000);
          harness.paint();
          const second = rebuildSpy.mock.results.at(-1)?.value as unknown[];
          // Same length: the tick changed no content, only the clock.
          expect(second.length).toBe(first.length);
          // Every history line is the SAME object (cache hit); only a small
          // trailing tail (live activity elapsed) may be fresh.
          let firstFresh = first.findIndex(
            (line, index) => line !== (second as unknown[])[index],
          );
          if (firstFresh === -1) firstFresh = first.length;
          expect(first.length - firstFresh).toBeLessThanOrEqual(10);
          expect(firstFresh).toBeGreaterThan(4000);
        } finally {
          rebuildSpy.mockRestore();
        }
      } finally {
        nowSpy.mockRestore();
      }
    });
  });

  it('[Phase10.4, T17] frame output is bounded to visible rows and row-diffed across paints', () => {
    withTerminal(COLUMNS, ROWS, () => {
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(TICK_NOW);
      try {
        const harness = largeHistoryHarness();
        const rebuildSpy = vi.spyOn(scrollbackModule, 'buildWorkbenchScrollbackLines');
        try {
          // (a) First paint: previous frame is null, so every terminal row is
          // patched — bounded by visible rows + chrome, not by history size.
          harness.paint();
          const historyLines = scrollbackLineCount(rebuildSpy);
          expect(historyLines).toBeGreaterThanOrEqual(2000);
          const firstWrites = harness.output.writes;
          const firstPatchRows = patchRowsIn(firstWrites);
          const firstBytes = firstWrites.join('').length;
          process.stdout.write(
            `[Phase10.4] firstPaint patchRows=${firstPatchRows} bytes=${firstBytes} historyLines=${historyLines}\n`,
          );
          expect(firstPatchRows).toBeLessThanOrEqual(ROWS);
          expect(firstPatchRows).toBeLessThan(historyLines / 10);
          expect(firstBytes).toBeLessThanOrEqual(FIRST_PAINT_BYTES_BOUND);

          // (b) Identical repaint: the diff path emits no content rows and at
          // most the cursor-position write.
          const identicalBefore = harness.output.writes.length;
          harness.paint();
          const identicalWrites = harness.output.writes.slice(identicalBefore);
          expect(patchRowsIn(identicalWrites)).toBe(0);
          expect(identicalWrites.length).toBeLessThanOrEqual(2);

          // (c) Content change: rows are repainted — but only the diff.
          harness.state.views.agent.inputBuffer = 'changed';
          const changedBefore = harness.output.writes.length;
          harness.paint();
          const changedWrites = harness.output.writes.slice(changedBefore);
          const changedPatchRows = patchRowsIn(changedWrites);
          expect(changedPatchRows).toBeGreaterThanOrEqual(1);
          expect(changedPatchRows).toBeLessThanOrEqual(ROWS);
        } finally {
          rebuildSpy.mockRestore();
        }
      } finally {
        nowSpy.mockRestore();
      }
    });
  });
});
