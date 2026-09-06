/**
 * activity-metrics.vitest.ts — Phase 9 agent activity/liveness observability.
 *
 * Session-level: drives the real `processTurn` closure but mocks `runTaskLoop`
 * to control terminal outcomes (completed / result-failure / thrown failure /
 * ExecutionCancelledError) and to hold the turn pending while the liveness
 * watchdog fires (warning → stalled → recovery). Each test asserts the metric
 * rows flushed to `observability.metric` events (agent_activity_state,
 * agent_activity_duration_ms, agent_last_progress_age_ms,
 * agent_stall_warning_total, agent_invocation_cancelled_total,
 * agent_invocation_failed_total) with the expected values and labels.
 */

import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RunResult } from "../../src/run.js";

const mocks = vi.hoisted(() => ({
  append: vi.fn(() => Promise.resolve()),
  initAgent: vi.fn(),
  runTaskLoop: vi.fn(),
}));

vi.mock("../../src/agent/agent.js", () => ({ initAgent: mocks.initAgent }));
vi.mock("../../src/run/task-loop.js", () => ({ runTaskLoop: mocks.runTaskLoop }));
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

let testCwd: string;
let testCwdCleanup: (() => void) | null = null;

beforeEach(() => {
  testCwd = mkdtempSync(join(tmpdir(), "activity-metrics-"));
  testCwdCleanup = () => rmSync(testCwd, { recursive: true, force: true });
});

afterEach(() => {
  testCwdCleanup?.();
});

interface MockTaskLoopDeps {
  onProgress?: (kind: string, description?: string) => void;
  onStream?: (chunk: { type: "text" | "tool_call"; text?: string }) => void;
}

interface MetricRowPayload {
  name: string;
  type: string;
  value: number;
  labels?: Record<string, string>;
}

function configureSessionMocks(): void {
  mocks.append.mockClear();
  mocks.initAgent.mockReset().mockResolvedValue({
    sessionId: "activity-metrics-session",
    sessionDir: "/tmp/activity-metrics-session",
    log: {
      append: mocks.append,
      readAll: vi.fn(() => Promise.resolve([])),
    },
    config: {
      model: {
        provider: "anthropic",
        name: "test-model",
        streaming: false,
        maxContextTokens: 1_000,
        maxIterations: 1,
      },
      models: { default: { provider: "anthropic", name: "test-model" } },
      permissions: { sessionMode: "auto" },
      apiKeys: {},
    },
    provider: { editFormatPreference: "structured_patch" },
    editFormatPolicy: {},
    mcpManager: null,
    toolExecutor: {},
    checkpointManager: {},
    memoryStore: {},
    repoMap: undefined,
    scope: {},
    hookRunner: {},
  });
  mocks.runTaskLoop.mockReset();
}

function metricRows(): MetricRowPayload[] {
  return (mocks.append.mock.calls as unknown as Array<Array<{ type: string; payload: MetricRowPayload }>>)
    .map((call) => call[0])
    .filter((e) => e.type === "observability.metric")
    .map((e) => e.payload);
}

function rowsNamed(name: string): MetricRowPayload[] {
  return metricRows().filter((r) => r.name === name);
}

const completedResult: RunResult = {
  sessionId: "activity-metrics-session",
  summary: "done",
  streamed: false,
  reason: "completed",
};

describe("Phase 9 agent activity/liveness observability in processTurn", () => {
  it("completed turn records state gauges + terminal completed duration, no outcome counters", async () => {
    const { createAgentSession } = await import("../../src/agent/session.js");
    configureSessionMocks();
    mocks.runTaskLoop.mockResolvedValue(completedResult);

    const session = createAgentSession({ cwd: testCwd, task: "", planMode: false });
    await session.processTurn("hello");

    // activity-state gauge: one 1-valued sample per transition into a state.
    const states = rowsNamed("agent_activity_state");
    expect(states.length).toBeGreaterThan(0);
    const stateLabels = states.map((r) => r.labels?.state);
    expect(stateLabels).toContain("thinking");
    expect(stateLabels).toContain("verifying");
    expect(stateLabels).toContain("summarizing");
    for (const s of states) {
      expect(s.type).toBe("gauge");
      expect(s.value).toBe(1);
      expect(s.labels?.invocationId).toBeTruthy();
    }

    // Terminal duration histogram sample labelled completed.
    const durations = rowsNamed("agent_activity_duration_ms");
    expect(durations).toHaveLength(1);
    expect(durations[0]!.labels?.state).toBe("completed");
    expect(durations[0]!.value).toBeGreaterThanOrEqual(0);

    // No cancellation/failure/stall rows on a clean completed turn.
    expect(rowsNamed("agent_invocation_failed_total")).toHaveLength(0);
    expect(rowsNamed("agent_invocation_cancelled_total")).toHaveLength(0);
    expect(rowsNamed("agent_stall_warning_total")).toHaveLength(0);

    // Existing workflow metrics still emitted (token accounting untouched).
    expect(rowsNamed("workflow_runs_total").length).toBeGreaterThan(0);
    expect(rowsNamed("workflow_duration_ms")).toHaveLength(1);
  });

  it("result-reason failure (max_iterations) records failed counter + failed duration without throwing", async () => {
    const { createAgentSession } = await import("../../src/agent/session.js");
    configureSessionMocks();
    mocks.runTaskLoop.mockResolvedValue({
      ...completedResult,
      reason: "max_iterations",
      summary: "gave up",
    });

    const session = createAgentSession({ cwd: testCwd, task: "", planMode: false });
    const result = await session.processTurn("run a command");
    expect(result.reason).toBe("max_iterations");

    const failed = rowsNamed("agent_invocation_failed_total");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.value).toBe(1);
    expect(rowsNamed("agent_invocation_cancelled_total")).toHaveLength(0);

    const durations = rowsNamed("agent_activity_duration_ms");
    expect(durations).toHaveLength(1);
    expect(durations[0]!.labels?.state).toBe("failed");
  });

  it("thrown loop error records exactly one failed counter + failed duration and rejects", async () => {
    const { createAgentSession } = await import("../../src/agent/session.js");
    configureSessionMocks();
    mocks.runTaskLoop.mockRejectedValue(new Error("provider boom"));

    const session = createAgentSession({ cwd: testCwd, task: "", planMode: false });
    await expect(session.processTurn("run a command")).rejects.toThrow("provider boom");

    const failed = rowsNamed("agent_invocation_failed_total");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.value).toBe(1);
    expect(rowsNamed("agent_invocation_cancelled_total")).toHaveLength(0);
    expect(rowsNamed("agent_stall_warning_total")).toHaveLength(0);

    const durations = rowsNamed("agent_activity_duration_ms");
    expect(durations).toHaveLength(1);
    expect(durations[0]!.labels?.state).toBe("failed");
  });

  it("ExecutionCancelledError records cancelled counter (never failed) + cancelled duration", async () => {
    const { createAgentSession } = await import("../../src/agent/session.js");
    const { ExecutionCancelledError } = await import("../../src/runtime/cancellation-token.js");
    configureSessionMocks();
    mocks.runTaskLoop.mockRejectedValue(new ExecutionCancelledError("operator stop"));

    const session = createAgentSession({ cwd: testCwd, task: "", planMode: false });
    await expect(session.processTurn("run a command")).rejects.toThrow("Execution cancelled");

    const cancelled = rowsNamed("agent_invocation_cancelled_total");
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]!.value).toBe(1);
    expect(rowsNamed("agent_invocation_failed_total")).toHaveLength(0);

    const durations = rowsNamed("agent_activity_duration_ms");
    expect(durations).toHaveLength(1);
    expect(durations[0]!.labels?.state).toBe("cancelled");
  });

  it("watchdog counts warning+stalled transitions as stall warnings but NOT failures; recovery + completion emit no failure", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const { createAgentSession } = await import("../../src/agent/session.js");
      const { DEFAULT_LIVENESS_THRESHOLDS } = await import("../../src/agent/agent-liveness.js");
      configureSessionMocks();
      let capturedDeps!: MockTaskLoopDeps;
      let resolveLoop!: (r: RunResult) => void;
      const loopPending = new Promise<RunResult>((resolve) => {
        resolveLoop = resolve;
      });
      mocks.runTaskLoop.mockImplementation(async (deps: MockTaskLoopDeps) => {
        capturedDeps = deps;
        return loopPending;
      });

      const session = createAgentSession({ cwd: testCwd, task: "", planMode: false });
      const turn = session.processTurn("wait for the watchdog");
      await vi.waitFor(() => {
        expect(session.getActivity?.()?.state).toBe("thinking");
      });

      // Crossing the warning threshold → one stall warning + an age sample.
      vi.advanceTimersByTime(DEFAULT_LIVENESS_THRESHOLDS.warningAfterMs + 5_000);
      expect(session.getActivity?.()?.state).toBe("possibly_stalled");

      // Crossing the stalled threshold → a second (escalated) stall warning.
      vi.advanceTimersByTime(
        DEFAULT_LIVENESS_THRESHOLDS.stalledAfterMs - DEFAULT_LIVENESS_THRESHOLDS.warningAfterMs,
      );

      // Recovery: a progress mark arrives, then the next tick reports healthy.
      capturedDeps.onProgress?.("model_response", "test-model");
      vi.advanceTimersByTime(5_000);
      expect(session.getActivity?.()?.state).toBe("thinking");

      resolveLoop(completedResult);
      await turn;

      // Two stall-warning rows, labelled by the transition state.
      const stall = rowsNamed("agent_stall_warning_total");
      expect(stall).toHaveLength(2);
      expect(stall.map((r) => r.labels?.state).sort()).toEqual(["stalled", "warning"]);

      // A stall warning is NOT a failure: nothing terminal was reached while
      // stalled, and the turn completed cleanly afterwards.
      expect(rowsNamed("agent_invocation_failed_total")).toHaveLength(0);
      expect(rowsNamed("agent_invocation_cancelled_total")).toHaveLength(0);

      // Progress-age gauge sampled at the liveness transitions: the warning/
      // stalled samples carry the grown idle window; every row has an
      // invocationId label.
      const ages = rowsNamed("agent_last_progress_age_ms");
      expect(ages.length).toBeGreaterThanOrEqual(2);
      for (const a of ages) {
        expect(a.type).toBe("gauge");
        expect(a.labels?.invocationId).toBeTruthy();
      }
      expect(Math.max(...ages.map((a) => a.value))).toBeGreaterThanOrEqual(
        DEFAULT_LIVENESS_THRESHOLDS.warningAfterMs,
      );

      const durations = rowsNamed("agent_activity_duration_ms");
      expect(durations).toHaveLength(1);
      expect(durations[0]!.labels?.state).toBe("completed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stall-then-failure does NOT double count: one failed counter plus the stall warnings already counted", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const { createAgentSession } = await import("../../src/agent/session.js");
      const { DEFAULT_LIVENESS_THRESHOLDS } = await import("../../src/agent/agent-liveness.js");
      configureSessionMocks();
      let capturedDeps!: MockTaskLoopDeps;
      let rejectLoop!: (err: Error) => void;
      const loopPending = new Promise<RunResult>((_, reject) => {
        rejectLoop = reject;
      });
      mocks.runTaskLoop.mockImplementation(async (deps: MockTaskLoopDeps) => {
        capturedDeps = deps;
        return loopPending;
      });

      const session = createAgentSession({ cwd: testCwd, task: "", planMode: false });
      const turn = session.processTurn("wait for the watchdog");
      await vi.waitFor(() => {
        expect(session.getActivity?.()?.state).toBe("thinking");
      });

      // Stall first…
      vi.advanceTimersByTime(DEFAULT_LIVENESS_THRESHOLDS.warningAfterMs + 5_000);
      expect(session.getActivity?.()?.state).toBe("possibly_stalled");
      // …then fail.
      rejectLoop(new Error("boom after stall"));
      await expect(turn).rejects.toThrow("boom after stall");

      // The stall was counted once (warning); the failure is counted exactly
      // once and is NOT double counted by the preceding stall.
      expect(rowsNamed("agent_stall_warning_total").map((r) => r.labels?.state)).toContain("warning");
      const failed = rowsNamed("agent_invocation_failed_total");
      expect(failed).toHaveLength(1);
      expect(rowsNamed("agent_invocation_cancelled_total")).toHaveLength(0);

      const durations = rowsNamed("agent_activity_duration_ms");
      expect(durations).toHaveLength(1);
      expect(durations[0]!.labels?.state).toBe("failed");
    } finally {
      vi.useRealTimers();
    }
  });
});
