/**
 * cancellation.vitest.ts — operator cancellation of long-running agent turns
 * (Tasks 6.1-6.3).
 *
 * Session-level: drives the real `processTurn` closure with `runTaskLoop`
 * mocked so the turn can be held pending, cancelled by the operator, and the
 * cancellation lifecycle asserted deterministically:
 *
 *   - `cancelActiveTurn()` flips a shared per-turn CancellationToken + aborts
 *     an AbortSignal the loop (or its seam) observes;
 *   - the live activity record transitions thinking → cancelling → cancelled;
 *   - the invocation classifies as CANCELLED — never failed, never a timeout
 *     (metrics counter `agent_invocation_cancelled_total`, duration sample
 *     state=cancelled, ExecutionCancelledError rejected out of processTurn);
 *   - a user-facing "Cancelled after Ns" summary is exposed for the TUI.
 *
 * The REAL runTaskLoop abort path is covered separately by
 * tests/run/operator-cancel-seam.vitest.ts (no task-loop mock).
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
  testCwd = mkdtempSync(join(tmpdir(), "cancellation-"));
  testCwdCleanup = () => rmSync(testCwd, { recursive: true, force: true });
});

afterEach(() => {
  testCwdCleanup?.();
});

interface CancellableLoopDeps {
  cancellationToken?: import("../../src/runtime/cancellation-token.js").CancellationToken;
  cancelSignal?: AbortSignal;
}

function configureSessionMocks(): void {
  mocks.append.mockClear();
  mocks.initAgent.mockReset().mockResolvedValue({
    sessionId: "cancellation-session",
    sessionDir: "/tmp/cancellation-session",
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

interface ActivityEvent {
  type: string;
  payload: { state: string };
}

function activityEvents(): ActivityEvent[] {
  return (mocks.append.mock.calls as unknown as Array<Array<ActivityEvent>>)
    .map((call) => call[0])
    .filter((e) => e.type === "agent.session.activity");
}

function activityStates(): string[] {
  return activityEvents().map((e) => e.payload.state);
}

interface MetricRowPayload {
  name: string;
  type: string;
  value: number;
  labels?: Record<string, string>;
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
  sessionId: "cancellation-session",
  summary: "done",
  streamed: false,
  reason: "completed",
};

describe("operator cancellation of an agent turn (Tasks 6.1-6.3)", () => {
  it("Task 6.1/6.3 — a held turn cancelled by the operator classifies cancelled (never failed / timeout), activity goes cancelling → cancelled, and the loop seam observes the token + signal", async () => {
    const { createAgentSession } = await import("../../src/agent/session.js");
    const { ExecutionCancelledError, CancellationToken } = await import("../../src/runtime/cancellation-token.js");
    configureSessionMocks();

    let capturedDeps!: CancellableLoopDeps;
    mocks.runTaskLoop.mockImplementation(async (deps: CancellableLoopDeps) => {
      capturedDeps = deps;
      // A real loop would unwind on its own via its cancellation seam. Model
      // that: reject as an ExecutionCancelledError once the operator cancels.
      return new Promise<RunResult>((_, reject) => {
        deps.cancelSignal?.addEventListener(
          "abort",
          () => reject(new ExecutionCancelledError(String(deps.cancelSignal?.reason ?? "cancelled"))),
          { once: true },
        );
      });
    });

    const session = createAgentSession({ cwd: testCwd, task: "", planMode: false });
    // Idle session → cancel is a no-op.
    expect(session.cancelActiveTurn?.("no turn yet")).toBe(false);
    expect(session.getLastCancelSummary?.()).toBeUndefined();

    const turn = session.processTurn("long task");
    await vi.waitFor(() => {
      expect(session.getActivity?.()?.state).toBe("thinking");
    });
    expect(capturedDeps).toBeDefined();
    expect(capturedDeps.cancellationToken).toBeInstanceOf(CancellationToken);
    expect(capturedDeps.cancellationToken?.isCancelled).toBe(false);
    expect(capturedDeps.cancelSignal?.aborted).toBe(false);

    // Operator presses the cancel key.
    const ok = session.cancelActiveTurn?.("operator stop") ?? false;
    expect(ok).toBe(true);
    // The loop seam observes the cancellation immediately.
    expect(capturedDeps.cancellationToken?.isCancelled).toBe(true);
    expect(capturedDeps.cancelSignal?.aborted).toBe(true);
    // Live surface shows "Cancelling…" while the turn unwinds.
    expect(session.getActivity?.()?.state).toBe("cancelling");

    // The turn rejects as an ExecutionCancelledError (classified cancelled).
    await expect(turn).rejects.toThrow("Execution cancelled");

    // Activity transitioned through cancelling → cancelled (terminal).
    const states = activityStates();
    expect(states).toContain("cancelling");
    expect(states[states.length - 1]).toBe("cancelled");

    // Cancelled audit rows mirror the failure paths: task.cancelled +
    // graph.cancelled + workflow.cancelled (never task.failed/workflow.failed).
    const types = (mocks.append.mock.calls as unknown as Array<Array<{ type: string }>>)
      .map((call) => call[0]?.type);
    expect(types).toContain("task.cancelled");
    expect(types).toContain("graph.cancelled");
    expect(types).toContain("workflow.cancelled");
    expect(types).not.toContain("task.failed");
    expect(types).not.toContain("graph.failed");
    expect(types).not.toContain("workflow.failed");

    // Metrics: cancelled, never failed; terminal duration labelled cancelled.
    expect(rowsNamed("agent_invocation_cancelled_total")).toHaveLength(1);
    expect(rowsNamed("agent_invocation_failed_total")).toHaveLength(0);
    const durations = rowsNamed("agent_activity_duration_ms");
    expect(durations).toHaveLength(1);
    expect(durations[0]!.labels?.state).toBe("cancelled");

    // User-facing summary: "Cancelled after Ns" — never "timed out".
    const summary = session.getLastCancelSummary?.();
    expect(summary).toMatch(/^Cancelled after \d+s$/);
    expect(summary).not.toMatch(/timed out/i);

    // Next cancel after the turn finished is a no-op again.
    expect(session.cancelActiveTurn?.("late")).toBe(false);
    expect(session.getActivity?.()).toBeUndefined();
  });

  it("a genuine loop failure is still counted failed, never cancelled (classification not inverted)", async () => {
    const { createAgentSession } = await import("../../src/agent/session.js");
    configureSessionMocks();
    mocks.runTaskLoop.mockRejectedValue(new Error("provider boom"));

    const session = createAgentSession({ cwd: testCwd, task: "", planMode: false });
    await expect(session.processTurn("run")).rejects.toThrow("provider boom");

    expect(rowsNamed("agent_invocation_failed_total")).toHaveLength(1);
    expect(rowsNamed("agent_invocation_cancelled_total")).toHaveLength(0);
    const durations = rowsNamed("agent_activity_duration_ms");
    expect(durations[0]!.labels?.state).toBe("failed");
    expect(session.getLastCancelSummary?.()).toBeUndefined();
  });

  it("a provider-level abort (AbortError name / 408 shape) is a FAILURE, never an operator cancel", async () => {
    const { createAgentSession, isCancellationError } = await import("../../src/agent/session.js");
    // The predicate itself: a provider-internal abort is NOT an operator
    // cancel; only ExecutionCancelledError is.
    const providerAbort = new Error("The operation was aborted");
    providerAbort.name = "AbortError"; // AbortSignal.timeout / fetch abort shape
    expect(isCancellationError(providerAbort)).toBe(false);
    expect(isCancellationError(new Error("boom"))).toBe(false);
    const { ExecutionCancelledError } = await import("../../src/runtime/cancellation-token.js");
    expect(isCancellationError(new ExecutionCancelledError("operator stop"))).toBe(true);

    // End-to-end: a provider abort thrown out of the loop is classified
    // FAILED (workflow.failed, failed counter, failed activity) — never
    // CANCELLED (no workflow.cancelled, no cancelled counter, no summary).
    configureSessionMocks();
    mocks.runTaskLoop.mockRejectedValue(providerAbort);

    const session = createAgentSession({ cwd: testCwd, task: "", planMode: false });
    await expect(session.processTurn("run")).rejects.toThrow("aborted");

    expect(rowsNamed("agent_invocation_failed_total")).toHaveLength(1);
    expect(rowsNamed("agent_invocation_cancelled_total")).toHaveLength(0);
    const durations = rowsNamed("agent_activity_duration_ms");
    expect(durations).toHaveLength(1);
    expect(durations[0]!.labels?.state).toBe("failed");
    expect(session.getLastCancelSummary?.()).toBeUndefined();

    // Workflow/activity terminal states: failed, not cancelled.
    const types = (mocks.append.mock.calls as unknown as Array<Array<{ type: string }>>)
      .map((call) => call[0]?.type);
    expect(types).toContain("task.failed");
    expect(types).toContain("workflow.failed");
    expect(types).not.toContain("workflow.cancelled");
    const states = activityStates();
    expect(states[states.length - 1]).toBe("failed");
    expect(states).not.toContain("cancelled");
  });

  it("completing a turn then cancelling reports false and leaves no stale summary", async () => {
    const { createAgentSession } = await import("../../src/agent/session.js");
    configureSessionMocks();
    mocks.runTaskLoop.mockResolvedValue(completedResult);

    const session = createAgentSession({ cwd: testCwd, task: "", planMode: false });
    const result = await session.processTurn("done quickly");
    expect(result.reason).toBe("completed");
    expect(session.cancelActiveTurn?.("late")).toBe(false);
    expect(session.getActivity?.()).toBeUndefined();
    expect(session.getLastCancelSummary?.()).toBeUndefined();
  });

  it("an Escape during the post-loop verifying/summarizing window is NOT consumed (returns false) and the turn completes normally", async () => {
    const { createAgentSession } = await import("../../src/agent/session.js");
    configureSessionMocks();
    mocks.runTaskLoop.mockResolvedValue(completedResult);

    // Gate the first post-loop append (task.done fires after the loop has
    // resolved and the turn has advanced to Verifying) so we can probe
    // cancelActiveTurn WHILE the turn is still in flight past every
    // cancellation check.
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const reachedPromise = new Promise<void>((r) => { reached = r; });
    let gated = false;
    mocks.append.mockImplementation((async (evt: { type: string }) => {
      if (!gated && evt.type === "task.done") {
        gated = true;
        reached();
        await gate;
      }
    }) as unknown as () => Promise<void>);

    const session = createAgentSession({ cwd: testCwd, task: "", planMode: false });
    const turn = session.processTurn("verify and summarize");
    await reachedPromise;

    // The loop has resolved; the turn is in its post-loop verifying tail and
    // there are no further cancellation checks. An Escape here must NOT be
    // silently swallowed: cancelActiveTurn reports false, so the caller
    // surfaces it as a no-op rather than a consumed cancel.
    expect(session.getActivity?.()?.state).toBe("verifying");
    expect(session.cancelActiveTurn?.("escape during verifying")).toBe(false);
    expect(session.getLastCancelSummary?.()).toBeUndefined();

    release();
    const result = await turn;
    expect(result.reason).toBe("completed");
    // No cancelling activity was fed and no cancel summary was produced.
    expect(activityStates()).not.toContain("cancelling");
    expect(activityStates()[activityStates().length - 1]).toBe("completed");
    expect(session.cancelActiveTurn?.("late")).toBe(false);
  });
});
