/**
 * long-running-turn.vitest.ts — Phase 7 (Tests 7.1–7.10): crossing the old
 * 120s wall-clock deadline with a REAL agent turn path under a fake clock.
 *
 * WHY THIS FILE EXISTS (and what it deliberately does NOT duplicate):
 *
 *   - tests/agent/activity-wiring.vitest.ts drives the real `processTurn`
 *     closure but MOCKS `runTaskLoop` and pulses the loop's `onProgress` /
 *     `onStream` seams by hand.
 *   - tests/run/activity-seam.vitest.ts and
 *     tests/run/operator-cancel-seam.vitest.ts drive the REAL `runTaskLoop`
 *     with a scripted provider but are NOT wrapped in the session (no liveness
 *     watchdog / activity feed / cancellation summary) and never cross the old
 *     boundary under fake time.
 *
 * This file is the missing COMPOSITION: the real session (`processTurn`) with
 * the REAL `runTaskLoop` and a fully controllable provider, all under
 * `vi.useFakeTimers()`. It proves the plan's central invariant — *crossing 120
 * seconds must no longer terminate the invocation* — without ever waiting real
 * seconds, and it asserts the session-level outcomes the loop-only harnesses
 * cannot see (activity states, liveness-driven watchdog transitions, the
 * cancelling/cancelled terminal surface, stall-warning-not-failure metrics).
 *
 * Provider transport timeouts (the per-provider idle `timeoutMs`) belong to
 * the real SDK clients and are deliberately NOT modelled here: the fake
 * provider stands in for "the transport is alive", so these tests isolate the
 * AGENT layer — the layer whose fixed deadline was removed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ModelAdapter } from "../../src/providers/types.js";
import type { AgentTurnResult } from "../../src/agent/session.js";
import type { RunResult } from "../../src/run.js";
import type { EventLog } from "../../src/events/event-log.js";
import type { AgentActivity } from "../../src/agent/agent-activity.js";
import type { AgentLivenessSnapshot } from "../../src/agent/agent-liveness.js";

const mocks = vi.hoisted(() => ({
  initAgent: vi.fn(),
}));

vi.mock("../../src/agent/agent.js", () => ({ initAgent: mocks.initAgent }));
vi.mock("../../src/utils/memory/recall.js", () => ({
  buildMemoryContext: vi.fn(() => Promise.resolve(undefined)),
  buildMemoryStats: vi.fn(() => Promise.resolve(undefined)),
}));
vi.mock("../../src/skills/loader.js", () => ({
  loadSkillManifests: vi.fn(() => Promise.resolve([])),
}));
vi.mock("../../src/skills/catalog.js", () => ({
  buildSkillCatalog: vi.fn(() => ({
    getMatchedContent: vi.fn(() => Promise.resolve([])),
  })),
}));
vi.mock("../../src/skills/lifecycle.js", () => ({ evictIfNeeded: vi.fn() }));

// NOTE: `../../src/run/task-loop.js` is deliberately NOT mocked — the real
// loop is the thing under test together with the real processTurn closure.

type StreamChunk =
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string };

/** Sentinel pushed to end a gate-driven stream. */
const STREAM_END = Symbol("stream-end");

type ProviderResult = {
  text: string;
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  usage: { inputTokens: number; outputTokens: number };
  finishReason: string;
};

/** A canned single-turn provider response. */
function textResult(text: string, finishReason = "stop"): ProviderResult {
  return { text, toolCalls: [], usage: { inputTokens: 100, outputTokens: 50 }, finishReason };
}

/**
 * A fully controllable fake ModelAdapter.
 *
 * Non-streaming: `complete()` returns `instantResult` when set, otherwise
 * blocks on `completeGate` until the test resolves/rejects it.
 *
 * Streaming: `stream()` is a gate-driven async generator — the test pushes
 * each chunk (`push`) and the generator only advances when a chunk is
 * available, so the test controls exactly when (in fake time) each token
 * lands. Pushing STREAM_END closes the stream.
 */
class ControllableProvider {
  readonly id = "mock";
  readonly editFormatPreference = "structured_patch";
  readonly longContextStrategy = "trimmed_context";
  readonly capabilities: {
    provider: string;
    model: string;
    inputTokenLimit: number;
    outputTokenLimit: number;
    supportsTools: boolean;
    supportsStreaming: boolean;
    supportsStructuredOutput: boolean;
    supportsVision: boolean;
    parallelToolCalls: boolean;
  };

  /** Resolves once complete()/stream() has been entered. */
  private readonly enteredDeferred: { resolve: () => void; promise: Promise<void> };
  readonly entered: Promise<void>;
  /** Number of times complete()/stream() has been entered. */
  calls = 0;

  /** Non-streaming: immediate result to return (skips the gate). */
  instantResult: ProviderResult | undefined;
  /** Non-streaming: when set, complete() rejects immediately. */
  instantError: Error | undefined;
  /** Non-streaming: gate the test resolves/rejects to return / fail. */
  completeGate: { resolve: (r: ProviderResult) => void; reject: (e: unknown) => void; promise: Promise<ProviderResult> };

  // Streaming state.
  private readonly queued: Array<unknown> = [];
  private waiter: { resolve: () => void; promise: Promise<void> } | undefined;

  constructor(private readonly streaming: boolean) {
    this.capabilities = {
      provider: "mock",
      model: "mock",
      inputTokenLimit: 100_000,
      outputTokenLimit: 16_384,
      supportsTools: false,
      supportsStreaming: streaming,
      supportsStructuredOutput: false,
      supportsVision: false,
      parallelToolCalls: false,
    };
    this.enteredDeferred = (() => {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => { resolve = r; });
      return { resolve, promise };
    })();
    this.entered = this.enteredDeferred.promise;
    this.completeGate = (() => {
      let resolve!: (r: ProviderResult) => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise<ProviderResult>((res, rej) => { resolve = res; reject = rej; });
      return { resolve, reject, promise };
    })();
  }

  private enterOnce(): void {
    if (this.calls === 0) this.enteredDeferred.resolve();
    this.calls++;
  }

  async complete(): Promise<ProviderResult> {
    this.enterOnce();
    if (this.instantError) throw this.instantError;
    if (this.instantResult) return this.instantResult;
    return this.completeGate.promise;
  }

  /** Push a stream chunk, or push STREAM_END to close the stream. */
  push(chunk: StreamChunk | typeof STREAM_END): void {
    this.queued.push(chunk);
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = undefined;
      w.resolve();
    }
  }

  private async nextItem(): Promise<unknown> {
    while (this.queued.length === 0) {
      const w = (() => {
        let resolve!: () => void;
        const promise = new Promise<void>((r) => { resolve = r; });
        return { resolve, promise };
      })();
      this.waiter = w;
      await w.promise;
    }
    return this.queued.shift();
  }

  async *stream(): AsyncGenerator<unknown> {
    this.enterOnce();
    for (;;) {
      const item = await this.nextItem();
      if (item === STREAM_END) return;
      yield item;
    }
  }
}

interface SessionHandle {
  processTurn: (message: string) => Promise<AgentTurnResult>;
  getActivity: () => AgentActivity | undefined;
  getLiveness: () => AgentLivenessSnapshot | undefined;
  cancelActiveTurn: (reason?: string) => boolean;
  getLastCancelSummary: () => string | undefined;
}

async function makeSession(opts: {
  cwd: string;
  onStream?: (chunk: { type: string; text?: string }) => void;
}): Promise<SessionHandle> {
  const { createAgentSession } = await import("../../src/agent/session.js");
  const session = createAgentSession({ cwd: opts.cwd, task: "", planMode: false, onStream: opts.onStream });
  return {
    processTurn: (m: string) => session.processTurn(m),
    getActivity: () => session.getActivity?.(),
    getLiveness: () => session.getLiveness?.(),
    cancelActiveTurn: (r?: string) => session.cancelActiveTurn?.(r) ?? false,
    getLastCancelSummary: () => session.getLastCancelSummary?.(),
  };
}

/**
 * Build the session harness: real EventLog / MemoryStore / ScopeTracker on a
 * temp dir (the real loop needs real supporting objects) + a controllable
 * provider injected through the mocked initAgent ctx.
 */
async function buildHarness(opts: {
  streaming: boolean;
  onStream?: (chunk: { type: string; text?: string }) => void;
}): Promise<{
  provider: ControllableProvider;
  eventLog: EventLog;
  createSession: () => Promise<SessionHandle>;
  cleanup: () => Promise<void>;
}> {
  const { EventLog } = await import("../../src/events/event-log.js");
  const { MemoryStore } = await import("../../src/utils/memory/store.js");
  const { ScopeTracker } = await import("../../src/autonomy/scope-tracker.js");

  const tmpRoot = mkdtempSync(join(tmpdir(), "long-running-turn-"));
  const sessionDir = join(tmpRoot, ".alix", "sessions", "lt");
  mkdirSync(sessionDir, { recursive: true });
  const eventLog = new EventLog(sessionDir);
  await eventLog.init();
  const memoryStore = new MemoryStore(join(tmpRoot, "memory"));
  await memoryStore.init();
  const scope = new ScopeTracker();

  const provider = new ControllableProvider(opts.streaming);
  mocks.initAgent.mockResolvedValue({
    sessionId: "long-running-session",
    sessionDir,
    log: eventLog,
    config: {
      model: {
        provider: "mock",
        name: "mock",
        streaming: opts.streaming,
        maxContextTokens: 100_000,
        maxIterations: 3,
      },
      models: {
        default: {
          provider: "mock",
          name: "mock",
          streaming: opts.streaming,
          maxContextTokens: 100_000,
          maxIterations: 3,
        },
      },
      permissions: { sessionMode: "auto" },
      apiKeys: {},
    },
    provider,
    editFormatPolicy: {},
    mcpManager: null,
    toolExecutor: {},
    checkpointManager: {},
    memoryStore,
    repoMap: undefined,
    scope,
    hookRunner: {},
  });

  return {
    provider,
    eventLog,
    createSession: () => makeSession({ cwd: tmpRoot, onStream: opts.onStream }),
    cleanup: async () => {
      mocks.initAgent.mockReset();
      rmSync(tmpRoot, { recursive: true, force: true });
    },
  };
}

interface MetricRow {
  name: string;
  type: string;
  value: number;
  labels?: Record<string, string>;
}

/** True while `promise` has not yet settled. */
function isPending(promise: Promise<unknown>): boolean {
  let settled = false;
  promise.then(
    () => { settled = true; },
    () => { settled = true; },
  );
  return !settled;
}

/**
 * Give fire-and-forget event-log appends a chance to land. Must run with REAL
 * timers (the flush itself is a real setTimeout).
 */
async function settleEventLogReal(): Promise<void> {
  vi.useRealTimers();
  await new Promise((r) => setTimeout(r, 50));
}

async function metricRowsNamed(eventLog: EventLog, name: string): Promise<MetricRow[]> {
  const events = await eventLog.readAll();
  return events
    .filter((e) => e.type === "observability.metric")
    .map((e) => e.payload as MetricRow)
    .filter((r) => r.name === name);
}

async function activityStatesFrom(eventLog: EventLog): Promise<string[]> {
  const events = await eventLog.readAll();
  return events
    .filter((e) => e.type === "agent.session.activity")
    .map((e) => (e.payload as { state: string }).state);
}

const FAST_MESSAGE = "do the thing";

describe("long-running agent turns across the old 120s deadline (Tests 7.1-7.9)", () => {
  let now: number;

  beforeEach(() => {
    now = 0;
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function advance(ms: number): void {
    now += ms;
    vi.advanceTimersByTime(ms);
  }

  // ── Test 7.1 — Long model call: provider returns after 125s ─────────────
  it("7.1 — a model call that returns after 125s keeps the invocation alive and completes normally (no 120s termination)", async () => {
    const h = await buildHarness({ streaming: false });
    try {
      const session = await h.createSession();
      const turn = session.processTurn(FAST_MESSAGE);
      await h.provider.entered;

      // The invocation is active and the live surface is in the Thinking
      // family (waiting_for_provider renders as "◐ Thinking…").
      expect(["thinking", "waiting_for_provider"]).toContain(session.getActivity()?.state);

      // Cross the old deadline: 121s of idle model processing.
      advance(121_000);
      // The watchdog has flagged POSSIBLY_STALLED — but the invocation is
      // STILL pending (a warning is not a termination).
      expect(session.getActivity()?.state).toBe("possibly_stalled");
      expect(isPending(turn)).toBe(true);

      // The provider finally returns. The run completes as a normal completed
      // result — never a timeout, never a failure.
      h.provider.completeGate.resolve(textResult("long-awaited answer. Done."));
      const result = await turn;
      expect(result.summary).toBe("long-awaited answer. Done.");
      expect(result.reason).toBe("completed");
      expect(await metricRowsNamed(h.eventLog, "agent_invocation_failed_total")).toHaveLength(0);
      expect(await metricRowsNamed(h.eventLog, "agent_invocation_cancelled_total")).toHaveLength(0);
      // The boundary crossing produced stall warnings — NOT failures.
      expect((await metricRowsNamed(h.eventLog, "agent_stall_warning_total")).length).toBeGreaterThan(0);
    } finally {
      await h.cleanup();
    }
  });

  // ── Test 7.2 — Long streaming generation over >120s ─────────────────────
  it("7.2 — streaming chunks across >120s keep the run alive, advance lastProgressAt, and hold STREAMING", async () => {
    const h = await buildHarness({ streaming: true, onStream: vi.fn() });
    try {
      const session = await h.createSession();
      const turn = session.processTurn("say hello");
      await h.provider.entered;

      // First chunk at ~1s → activity flips to STREAMING.
      h.provider.push({ type: "text_delta", text: "Hello " });
      await vi.advanceTimersByTimeAsync(1);
      expect(session.getActivity()?.state).toBe("streaming");
      const firstProgressAt = session.getActivity()!.lastProgressAt;

      // Stream well past the old 120s deadline: chunks keep the run alive and
      // the indicator streaming; no watchdog stall, no termination.
      await vi.advanceTimersByTimeAsync(90_000);
      h.provider.push({ type: "text_delta", text: "this is a " });
      await vi.advanceTimersByTimeAsync(1);
      expect(session.getActivity()?.state).toBe("streaming");
      expect(isPending(turn)).toBe(true);

      await vi.advanceTimersByTimeAsync(60_000); // cumulative > 150s
      h.provider.push({ type: "text_delta", text: "long streaming answer. Done." });
      await vi.advanceTimersByTimeAsync(1);
      expect(session.getActivity()?.state).toBe("streaming");
      // lastProgressAt advanced by >120s of streamed generation.
      expect(session.getActivity()!.lastProgressAt - firstProgressAt).toBeGreaterThan(120_000);

      // End the stream → the turn completes normally.
      h.provider.push(STREAM_END);
      const result = await turn;
      expect(result.summary).toBe("Hello this is a long streaming answer. Done.");
      expect(result.reason).toBe("completed");
      expect(await metricRowsNamed(h.eventLog, "agent_invocation_failed_total")).toHaveLength(0);
    } finally {
      await h.cleanup();
    }
  });

  // ── Test 7.3 — Silent model processing: invisible reasoning, Thinking… ──
  it("7.3 — reasoning-only generation past 120s keeps the run alive in the Thinking family (no visible text, no stall, no reasoning leak)", async () => {
    const visible = vi.fn<(chunk: { type: string; text?: string }) => void>();
    const h = await buildHarness({ streaming: true, onStream: visible });
    try {
      const session = await h.createSession();
      const turn = session.processTurn("think silently");
      await h.provider.entered;

      // The model "thinks" for >120s emitting ONLY private reasoning deltas —
      // real progress for liveness, never visible text.
      for (let t = 0; t < 13; t++) {
        h.provider.push({ type: "reasoning_delta", text: "private reasoning…" });
        await vi.advanceTimersByTimeAsync(10_000);
        // Never STREAMING (no visible text) and never flagged stalled (the
        // reasoning still proves liveness) — the indicator stays Thinking.
        expect(session.getActivity()?.state).not.toBe("streaming");
        expect(session.getActivity()?.state).not.toBe("possibly_stalled");
        expect(isPending(turn)).toBe(true);
      }
      expect(Date.now()).toBeGreaterThan(120_000);

      // The private trace never reached the caller's stream subscription.
      expect(visible.mock.calls.filter(([c]) => c.type === "text")).toHaveLength(0);
      expect(visible.mock.calls.filter(([c]) => c.type === "reasoning")).toHaveLength(0);

      // The visible answer finally arrives; the model was alive the whole time.
      h.provider.push({ type: "text_delta", text: "the answer, done" });
      await vi.advanceTimersByTimeAsync(1);
      expect(session.getActivity()?.state).toBe("streaming");
      h.provider.push(STREAM_END);
      const result = await turn;
      expect(result.summary).toBe("the answer, done");
      expect(result.reason).toBe("completed");
    } finally {
      await h.cleanup();
    }
  });

  // ── Test 7.4 — Stall warning: frozen progress → POSSIBLY_STALLED, alive ──
  it("7.4 — freezing provider progress past the watchdog threshold flags POSSIBLY_STALLED but the invocation stays alive", async () => {
    const h = await buildHarness({ streaming: false });
    try {
      const session = await h.createSession();
      const turn = session.processTurn(FAST_MESSAGE);
      await h.provider.entered;

      // Freeze progress well past the watchdog threshold.
      advance(130_000);
      expect(session.getActivity()?.state).toBe("possibly_stalled");
      // The invocation is NOT terminated by the stall — it remains pending.
      expect(isPending(turn)).toBe(true);

      // Cancellation is what ends it (a stall is never terminal on its own).
      expect(session.cancelActiveTurn("operator stop")).toBe(true);
      await expect(turn).rejects.toMatchObject({ name: "ExecutionCancelledError" });
      // The stall was reported as warnings, NOT as an invocation failure.
      expect(await metricRowsNamed(h.eventLog, "agent_invocation_failed_total")).toHaveLength(0);
      expect(await metricRowsNamed(h.eventLog, "agent_invocation_cancelled_total")).toHaveLength(1);
    } finally {
      await h.cleanup();
    }
  });

  // ── Test 7.5 — Recovery from stall: resumed progress → STREAMING ─────────
  it("7.5 — resuming provider progress recovers POSSIBLY_STALLED → STREAMING and the run completes", async () => {
    const h = await buildHarness({ streaming: true, onStream: vi.fn() });
    try {
      const session = await h.createSession();
      const turn = session.processTurn("say hello");
      await h.provider.entered;

      // First chunk → STREAMING, then freeze mid-stream past the threshold.
      h.provider.push({ type: "text_delta", text: "Hello " });
      await vi.advanceTimersByTimeAsync(1);
      expect(session.getActivity()?.state).toBe("streaming");
      await vi.advanceTimersByTimeAsync(130_000);
      expect(session.getActivity()?.state).toBe("possibly_stalled");
      expect(isPending(turn)).toBe(true);

      // Progress resumes → the next watchdog tick recovers to STREAMING.
      h.provider.push({ type: "text_delta", text: "world, done" });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(session.getActivity()?.state).toBe("streaming");

      h.provider.push(STREAM_END);
      const result = await turn;
      expect(result.summary).toBe("Hello world, done");
      expect(result.reason).toBe("completed");
    } finally {
      await h.cleanup();
    }
  });

  // ── Test 7.7 — Cancellation of an indefinitely-waiting provider ─────────
  it("7.7 — cancelling an indefinitely-waiting provider past 120s surfaces Cancelling → Cancelled (never failed, never a timeout)", async () => {
    const h = await buildHarness({ streaming: false });
    try {
      const session = await h.createSession();
      const turn = session.processTurn(FAST_MESSAGE);
      await h.provider.entered;

      // The provider waits forever; cross the old deadline first.
      advance(121_000);
      expect(session.getActivity()?.state).toBe("possibly_stalled");
      expect(isPending(turn)).toBe(true);

      expect(session.cancelActiveTurn("operator stop")).toBe(true);
      // Live surface immediately shows Cancelling… while the turn unwinds.
      expect(session.getActivity()?.state).toBe("cancelling");

      await expect(turn).rejects.toMatchObject({ name: "ExecutionCancelledError" });
      // Terminal classification: cancelled, never failed, never a timeout.
      expect(await metricRowsNamed(h.eventLog, "agent_invocation_cancelled_total")).toHaveLength(1);
      expect(await metricRowsNamed(h.eventLog, "agent_invocation_failed_total")).toHaveLength(0);
      const summary = session.getLastCancelSummary();
      expect(summary).toMatch(/^Cancelled after (\d+s|\d+m \d+s)$/);
      expect(summary).not.toMatch(/timed out/i);

      // The cancelled terminal state was fed before the turn unwound.
      await settleEventLogReal();
      const states = await activityStatesFrom(h.eventLog);
      expect(states).toContain("cancelling");
      expect(states[states.length - 1]).toBe("cancelled");
    } finally {
      await h.cleanup();
    }
  });

  // ── Test 7.8 — Provider failure: rejection is Failed, never a stall ─────
  it("7.8 — a rejected provider request fails the turn as Failed — the activity never reported Possibly stalled", async () => {
    const h = await buildHarness({ streaming: false });
    try {
      h.provider.instantError = new Error("provider boom");
      const session = await h.createSession();
      const turn = session.processTurn(FAST_MESSAGE);
      await h.provider.entered;

      await expect(turn).rejects.toThrow("provider boom");
      // A failure is classified failed (not cancelled, not a stall).
      expect(await metricRowsNamed(h.eventLog, "agent_invocation_failed_total")).toHaveLength(1);
      expect(await metricRowsNamed(h.eventLog, "agent_invocation_cancelled_total")).toHaveLength(0);
      expect(session.getLastCancelSummary()).toBeUndefined();

      // The activity record never flipped to possibly_stalled for the error.
      await settleEventLogReal();
      expect(await activityStatesFrom(h.eventLog)).not.toContain("possibly_stalled");
    } finally {
      await h.cleanup();
    }
  });

  // ── Test 7.9 — Short-response regression ────────────────────────────────
  it("7.9 — a normal fast response behaves exactly as before (no stall, no warning, clean completion)", async () => {
    const h = await buildHarness({ streaming: false });
    try {
      h.provider.instantResult = textResult("quick answer. Done.");
      const session = await h.createSession();
      const turn = session.processTurn(FAST_MESSAGE);
      await h.provider.entered;

      // A little sub-warning-threshold runtime elapses; the turn completes.
      advance(5_000);
      expect(session.getActivity()?.state).not.toBe("possibly_stalled");
      expect(isPending(turn)).toBe(true);

      const result = await turn;
      expect(result.summary).toBe("quick answer. Done.");
      expect(result.reason).toBe("completed");
      expect(await metricRowsNamed(h.eventLog, "agent_invocation_failed_total")).toHaveLength(0);
      expect(await metricRowsNamed(h.eventLog, "agent_invocation_cancelled_total")).toHaveLength(0);
      // No stall warnings on the fast path.
      expect(await metricRowsNamed(h.eventLog, "agent_stall_warning_total")).toHaveLength(0);
    } finally {
      await h.cleanup();
    }
  });

  // ── Test 7.10 — Spinner isolation (client-side-only animation) ──────────
  it("7.10 — animating the live activity line emits no runtime/event-log/token activity", async () => {
    // The presentation helpers are pure & local (activity-line.vitest.ts has
    // the deterministic/stateless unit assertions). Here we prove isolation
    // end-to-end against the REAL session: while the turn is held pending,
    // rendering animation frames must not append a single event-log row and
    // must not touch token accounting. (Real timers — the animation passes its
    // wall-clock value in, so no fake clock is needed.)
    vi.useRealTimers();
    const h = await buildHarness({ streaming: false });
    try {
      const session = await h.createSession();
      const turn = session.processTurn(FAST_MESSAGE);
      await h.provider.entered; // blocked inside provider.complete → pending
      expect(isPending(turn)).toBe(true);

      // Wait until the session's own startup/activity appends have landed so
      // the baseline count is stable (fire-and-forget log writes).
      async function stableCount(): Promise<number> {
        for (let attempt = 0; attempt < 20; attempt++) {
          const a = (await h.eventLog.readAll()).length;
          await new Promise((r) => setTimeout(r, 50));
          const b = (await h.eventLog.readAll()).length;
          if (a === b) return a;
        }
        return (await h.eventLog.readAll()).length;
      }
      const baseline = await stableCount();

      // Animate: re-derive the spinner line repeatedly against the live
      // activity record (what the ~1s render cadence does every tick).
      const { formatActivityLine, activitySpinnerFrame } = await import("../../src/tui/views/activity-line.js");
      const a = session.getActivity();
      expect(a).toBeDefined();
      for (let t = 1_000; t <= 60_000; t += 250) {
        formatActivityLine(a!, t);
        activitySpinnerFrame(t);
      }

      // The animation produced no runtime/event-log/token-count activity: the
      // log is byte-for-byte the same size it was before animating.
      const after = (await h.eventLog.readAll()).length;
      expect(after).toBe(baseline);
      expect((await h.eventLog.readAll()).filter((e) => e.type === "model.usage")).toHaveLength(0);

      // The turn's OWN token accounting (model.usage) still arrives from the
      // loop on completion — proof that token accounting belongs to the loop,
      // never to the indicator.
      h.provider.completeGate.resolve(textResult("answer. Done."));
      const result = await turn;
      expect(result.reason).toBe("completed");
      await settleEventLogReal();
      expect((await h.eventLog.readAll()).filter((e) => e.type === "model.usage").length).toBeGreaterThan(0);
    } finally {
      await h.cleanup();
    }
  });

  // ── Regression: the real loop never grows an agent-level deadline ───────
  it("7.1 companion — the REAL runTaskLoop itself stays pending past 125s (no loop-level deadline)", async () => {
    // Session-level proof above already crosses the boundary; this guards the
    // loop in isolation so a future loop-level deadline cannot hide behind the
    // session wrapper.
    const { EventLog } = await import("../../src/events/event-log.js");
    const { MemoryStore } = await import("../../src/utils/memory/store.js");
    const { ScopeTracker } = await import("../../src/autonomy/scope-tracker.js");
    const { TaskStateMachine, RunLimiter } = await import("../../src/autonomy/state-machine.js");
    const { createContextBudget } = await import("../../src/config/context-budget.js");
    const { ToolExecutor } = await import("../../src/tools/executor.js");
    const { runTaskLoop } = await import("../../src/run/task-loop.js");
    const { CancellationToken } = await import("../../src/runtime/cancellation-token.js");

    const tmpRoot = mkdtempSync(join(tmpdir(), "long-running-loop-"));
    const sessionDir = join(tmpRoot, ".alix", "sessions", "loop");
    mkdirSync(sessionDir, { recursive: true });
    const eventLog = new EventLog(sessionDir);
    await eventLog.init();
    const memoryStore = new MemoryStore(join(tmpRoot, "memory"));
    await memoryStore.init();
    const executor = new ToolExecutor({} as any, eventLog, tmpRoot);

    const provider = new ControllableProvider(false);
    const deps: import("../../src/run/task-loop.js").TaskLoopDeps = {
      config: { models: { default: { provider: "mock", name: "mock", streaming: false } }, permissions: {}, context: {} } as any,
      provider: provider as unknown as ModelAdapter,
      providerTools: [],
      mcpToolIndex: [],
      messages: [{ role: "user", content: FAST_MESSAGE }],
      sessionState: {
        created: new Set(),
        deleted: new Set(),
        changed: new Set(),
        fatalErrors: [],
        pendingScopeExpansion: false,
      },
      stateMachine: new TaskStateMachine(new RunLimiter({ maxIterations: 3, maxRepairs: 3, maxFileChanges: 100, maxShellCommands: 50, maxRuntimeMs: 60_000 })),
      scope: new ScopeTracker(),
      session: { sessionId: "loop", actor: "system" },
      log: eventLog,
      executor,
      mcpDiscovery: null,
      selectedTools: [],
      hooks: {},
      maxIterations: 3,
      contextBudget: createContextBudget({ contextWindowTokens: 100_000 }, {}),
      tokenizer: "cl100k_base",
      task: "loop deadline guard",
      taskType: "docs",
      depth: "quick",
      memoryStore,
      sessionId: "loop",
      sessionDir,
      systemPrompt: "You are a test assistant.",
      cancellationToken: new CancellationToken(),
      cancelSignal: new AbortController().signal,
    };

    try {
      const loop = runTaskLoop(deps);
      await provider.entered;
      // 125s of fake wall clock: the real loop is still pending (no deadline).
      advance(125_000);
      expect(isPending(loop)).toBe(true);

      // Completing the provider lets the real loop finish normally.
      provider.completeGate.resolve(textResult("done"));
      const result = (await loop) as RunResult;
      expect(result.summary).toBe("done");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
