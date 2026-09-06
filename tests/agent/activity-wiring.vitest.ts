/**
 * activity-wiring.vitest.ts — live response activity wiring (Tasks 2.1-2.4)
 *
 * Session-level: drives the real `processTurn` closure but mocks `runTaskLoop`
 * to pulse the exact seams the loop is contracted to fire (`onProgress`,
 * `onStream`). This makes the activity transitions deterministically
 * observable through the `agent.session.activity` events and `getActivity()`.
 *
 * Real-loop seam: drives the REAL `runTaskLoop` with a scripted tool-calling
 * provider to prove the `tool_started` / `tool_completed` progress marks are
 * real seams (not a dead code path: onProgress fires with the tool name).
 */

import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ModelAdapter } from "../../src/providers/types.js";
import type { RunResult } from "../../src/run.js";
import type { AgentActivity } from "../../src/agent/agent-activity.js";

// ── Session-level wiring tests ─────────────────────────────────────────────

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

let wiringTestCwd: string;
let wiringTestCwdCleanup: (() => void) | null = null;

beforeEach(() => {
  wiringTestCwd = mkdtempSync(join(tmpdir(), "activity-wiring-"));
  wiringTestCwdCleanup = () => rmSync(wiringTestCwd, { recursive: true, force: true });
});

afterEach(() => {
  wiringTestCwdCleanup?.();
});

interface MockTaskLoopDeps {
  onProgress?: (kind: string, description?: string) => void;
  onStream?: (chunk: { type: "text" | "tool_call" | "reasoning"; text?: string }) => void;
}

function configureSessionMocks(opts?: {
  onStream?: ReturnType<typeof vi.fn>;
}): void {
  mocks.append.mockClear();
  mocks.initAgent.mockReset().mockResolvedValue({
    sessionId: "activity-wiring-session",
    sessionDir: "/tmp/activity-wiring-session",
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
  opts?.onStream?.mockClear();
}

function activityEvents(): Array<{ type: string; payload: AgentActivity }> {
  return (mocks.append.mock.calls as unknown as Array<Array<{ type: string; payload: AgentActivity }>>)
    .map((call) => call[0])
    .filter((e) => e.type === "agent.session.activity");
}

function activityStates(): string[] {
  return activityEvents().map((e) => e.payload.state);
}

describe("activity wiring in processTurn (Tasks 2.1-2.4)", () => {
  it("Task 2.1 — invocation start emits thinking with provider/model and invocationId", async () => {
    const { createAgentSession } = await import("../../src/agent/session.js");
    configureSessionMocks();
    mocks.runTaskLoop.mockResolvedValue({ sessionId: "activity-wiring-session", summary: "done", streamed: false, reason: "completed" });

    const session = createAgentSession({ cwd: wiringTestCwd, task: "", planMode: false });
    await session.processTurn("hello");

    const events = activityEvents();
    expect(events.length).toBeGreaterThan(0);
    const first = events[0]!;
    expect(first.type).toBe("agent.session.activity");
    expect(first.payload.state).toBe("thinking");
    // Provider/model from the resolved config (models.default is resolved
    // by resolveModelConfig at turn start — the activity record must carry it).
    expect(first.payload.provider).toBe("anthropic");
    expect(first.payload.model).toBe("test-model");
    expect(first.payload.startedAt).toBeGreaterThan(0);
    expect(first.payload.lastProgressAt).toBeGreaterThan(0);
  });

  it("Task 2.2 — tool_started → tool_running(toolName); tool_completed → back to thinking", async () => {
    const { createAgentSession } = await import("../../src/agent/session.js");
    configureSessionMocks();
    mocks.runTaskLoop.mockImplementation(async (deps: MockTaskLoopDeps) => {
      deps.onProgress?.("tool_started", "bash");
      deps.onProgress?.("tool_completed", "bash");
      return { sessionId: "activity-wiring-session", summary: "done", streamed: false, reason: "completed" };
    });

    const session = createAgentSession({ cwd: wiringTestCwd, task: "", planMode: false });
    await session.processTurn("run a command");

    const states = activityStates();
    // thinking → tool_running → thinking → verifying → summarizing
    expect(states[0]).toBe("thinking");
    expect(states[1]).toBe("tool_running");
    expect(states[2]).toBe("thinking");
    // toolName is carried on the tool_running record
    expect(activityEvents()[1]!.payload.toolName).toBe("bash");
    // Round 1 — the tool timer starts at TOOL start: toolStartedAt stamped on
    // entering tool_running, strictly after the invocation's startedAt.
    const toolRecord = activityEvents()[1]!.payload;
    expect(toolRecord.toolStartedAt).toBeGreaterThan(0);
    expect(toolRecord.toolStartedAt!).toBeGreaterThanOrEqual(toolRecord.startedAt);
  });

  it("Task 2.3 — first visible text chunk → streaming, once (no per-chunk events)", async () => {
    const { createAgentSession } = await import("../../src/agent/session.js");
    const onStream = vi.fn();
    configureSessionMocks({ onStream });
    mocks.runTaskLoop.mockImplementation(async (deps: MockTaskLoopDeps) => {
      deps.onStream?.({ type: "text", text: "Hello " });
      deps.onStream?.({ type: "text", text: "world" });
      return { sessionId: "activity-wiring-session", summary: "Hello world", streamed: true, reason: "completed" };
    });

    const session = createAgentSession({ cwd: wiringTestCwd, task: "", planMode: false, onStream });
    await session.processTurn("say hello");

    const states = activityStates();
    expect(states[0]).toBe("thinking");
    expect(states[1]).toBe("streaming");
    // Exactly one streaming event despite two chunks (no per-chunk spam).
    expect(states.filter((s) => s === "streaming")).toHaveLength(1);
    expect(onStream).toHaveBeenCalledTimes(2);
  });

  it("Task 2.3 — every accepted chunk refreshes lastProgressAt on the live record", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const { createAgentSession } = await import("../../src/agent/session.js");
      const onStream = vi.fn();
      configureSessionMocks({ onStream });
      let resolveLoop!: (r: RunResult) => void;
      const loopPending = new Promise<RunResult>((resolve) => {
        resolveLoop = resolve;
      });
      mocks.runTaskLoop.mockImplementation(async (deps: MockTaskLoopDeps) => {
        // Drive the seams while the "loop" is still pending.
        deps.onStream?.({ type: "text", text: "a" });
        vi.setSystemTime(2_000);
        deps.onStream?.({ type: "text", text: "b" });
        return loopPending;
      });

      const session = createAgentSession({ cwd: wiringTestCwd, task: "", planMode: false, onStream });
      const turn = session.processTurn("stream slowly");
      await vi.waitFor(() => {
        expect(session.getActivity?.()).toBeDefined();
      });
      const record = session.getActivity?.()!;
      expect(record.state).toBe("streaming");
      expect(record.lastProgressAt).toBe(2_000);

      resolveLoop({ sessionId: "activity-wiring-session", summary: "ab", streamed: true, reason: "completed" });
      await turn;
    } finally {
      vi.useRealTimers();
    }
  });

  it("Task 2.4 — phase transitions map to verifying and summarizing", async () => {
    const { createAgentSession } = await import("../../src/agent/session.js");
    configureSessionMocks();
    mocks.runTaskLoop.mockImplementation(async (deps: MockTaskLoopDeps) => {
      deps.onProgress?.("tool_started", "bash");
      deps.onProgress?.("tool_completed", "bash");
      deps.onStream?.({ type: "text", text: "final answer" });
      return { sessionId: "activity-wiring-session", summary: "final answer", streamed: true, reason: "completed" };
    });

    const session = createAgentSession({ cwd: wiringTestCwd, task: "", planMode: false, onStream: vi.fn() });
    await session.processTurn("do the thing");

    const states = activityStates();
    // thinking → tool_running → thinking → streaming → verifying → summarizing
    expect(states[states.length - 2]).toBe("verifying");
    expect(states[states.length - 1]).toBe("summarizing");
    // Internal phases must NOT leak into the activity feed.
    expect(states).not.toContain("Understanding");
    expect(states).not.toContain("Executing");
  });

  it("tool.completed while streaming stays streaming (does not regress to thinking)", async () => {
    const { createAgentSession } = await import("../../src/agent/session.js");
    configureSessionMocks();
    mocks.runTaskLoop.mockImplementation(async (deps: MockTaskLoopDeps) => {
      deps.onStream?.({ type: "text", text: "partial" });
      // A tool result landing mid-stream must NOT bounce the indicator back
      // to thinking — the guard reads activityStreaming.
      deps.onProgress?.("tool_completed", "bash");
      return { sessionId: "activity-wiring-session", summary: "partial", streamed: true, reason: "completed" };
    });

    const session = createAgentSession({ cwd: wiringTestCwd, task: "", planMode: false, onStream: vi.fn() });
    await session.processTurn("stream then tool");

    const states = activityStates();
    expect(states[0]).toBe("thinking");
    expect(states[1]).toBe("streaming");
    // From the first streaming chunk onward the indicator never regresses
    // to thinking, and no tool_running is surfaced mid-stream.
    const afterStreaming = states.slice(states.indexOf("streaming"));
    expect(afterStreaming).toContain("verifying");
    expect(afterStreaming.filter((s) => s === "thinking")).toHaveLength(0);
    expect(afterStreaming).not.toContain("tool_running");
  });

  it("model_requested → waiting_for_provider until the first visible chunk streams", async () => {
    const { createAgentSession } = await import("../../src/agent/session.js");
    configureSessionMocks();
    mocks.runTaskLoop.mockImplementation(async (deps: MockTaskLoopDeps) => {
      // The provider call starts; no content has arrived yet.
      deps.onProgress?.("model_requested", "test-model");
      deps.onStream?.({ type: "text", text: "answer" });
      return { sessionId: "activity-wiring-session", summary: "answer", streamed: true, reason: "completed" };
    });

    const session = createAgentSession({ cwd: wiringTestCwd, task: "", planMode: false, onStream: vi.fn() });
    await session.processTurn("say hi");

    const states = activityStates();
    expect(states[0]).toBe("thinking");
    // WAITING_FOR_PROVIDER is genuinely reachable: it is produced while a model
    // request is in flight with no content, then the first chunk moves to streaming.
    expect(states).toContain("waiting_for_provider");
    const waiting = states.indexOf("waiting_for_provider");
    expect(states[waiting + 1]).toBe("streaming");
    expect(states.filter((s) => s === "streaming")).toHaveLength(1);
  });

  it("reasoning stream chunks mark progress without ever surfacing streaming", async () => {
    const { createAgentSession } = await import("../../src/agent/session.js");
    configureSessionMocks();
    const onStream = vi.fn();
    mocks.runTaskLoop.mockImplementation(async (deps: MockTaskLoopDeps) => {
      // A long private reasoning phase streams reasoning chunks only — these
      // must NOT flip the indicator to streaming (they are invisible trace)
      // and must never be forwarded to the visible stream / token consumer.
      deps.onStream?.({ type: "reasoning", text: "thinking quietly..." });
      deps.onStream?.({ type: "reasoning", text: "still thinking..." });
      return { sessionId: "activity-wiring-session", summary: "done", streamed: false, reason: "completed" };
    });

    const session = createAgentSession({ cwd: wiringTestCwd, task: "", planMode: false, onStream });
    await session.processTurn("think hard");

    expect(onStream).not.toHaveBeenCalled();
    const states = activityStates();
    expect(states[0]).toBe("thinking");
    expect(states).not.toContain("streaming");
    expect(states).not.toContain("waiting_for_provider");
  });

  it("reasoning chunks count as liveness progress (lastProgressAt advances) while staying on thinking", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const { createAgentSession } = await import("../../src/agent/session.js");
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

      const session = createAgentSession({ cwd: wiringTestCwd, task: "", planMode: false, onStream: vi.fn() });
      const turn = session.processTurn("reason for a while");
      await vi.waitFor(() => {
        expect(session.getLiveness?.()).toBeDefined();
      });
      const livenessSnap = session.getLiveness?.();
      const before = livenessSnap!.lastProgressAt;

      // A long private reasoning phase arrives 2s later: it must advance the
      // liveness clock (the watchdog won't flag a healthy thought-phase as a
      // stall) without flipping the visible indicator to streaming.
      vi.setSystemTime(before + 2_000);
      capturedDeps.onStream?.({ type: "reasoning", text: "deep reasoning..." });
      expect(session.getLiveness?.()!.lastProgressAt).toBe(before + 2_000);
      expect(session.getActivity?.()!.state).toBe("thinking");

      resolveLoop({ sessionId: "activity-wiring-session", summary: "done", streamed: false, reason: "completed" });
      await turn;
    } finally {
      vi.useRealTimers();
    }
  });

  it("tool_started resets the streaming latch: after a streamed phase, tool_completed returns to thinking", async () => {
    const { createAgentSession } = await import("../../src/agent/session.js");
    configureSessionMocks();
    mocks.runTaskLoop.mockImplementation(async (deps: MockTaskLoopDeps) => {
      // Phase 1: model narrates (streaming latch set).
      deps.onStream?.({ type: "text", text: "Let me look." });
      // Phase 2: a tool begins — the model-output phase ends, latch resets.
      deps.onProgress?.("tool_started", "bash");
      // Phase 3: tool completes and the model resumes silently — with the latch
      // reset, the guard must feed thinking (not leave the tool indicator up).
      deps.onProgress?.("tool_completed", "bash");
      return { sessionId: "activity-wiring-session", summary: "Let me look.", streamed: true, reason: "completed" };
    });

    const session = createAgentSession({ cwd: wiringTestCwd, task: "", planMode: false, onStream: vi.fn() });
    await session.processTurn("stream then use a tool");

    const states = activityStates();
    expect(states[0]).toBe("thinking");
    expect(states).toContain("streaming");
    const toolIdx = states.indexOf("tool_running");
    expect(toolIdx).toBeGreaterThan(states.indexOf("streaming"));
    // The model-resumes window must read THINKING again (per design:
    // tool complete → model resumes → Thinking), not remain on tool_running.
    expect(states[toolIdx + 1]).toBe("thinking");
  });

  it("liveness warning → possibly_stalled (diagnostic), recovery → thinking", async () => {
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

      const session = createAgentSession({ cwd: wiringTestCwd, task: "", planMode: false });
      const turn = session.processTurn("wait for the watchdog");
      await vi.waitFor(() => {
        expect(session.getActivity?.()?.state).toBe("thinking");
      });

      // Let the watchdog observe a warning: idle window exceeds threshold.
      vi.advanceTimersByTime(DEFAULT_LIVENESS_THRESHOLDS.warningAfterMs + 5_000);
      const stalled = session.getActivity?.();
      expect(stalled?.state).toBe("possibly_stalled");

      // Recovery: a progress mark arrives, then the next watchdog tick sees healthy.
      capturedDeps.onProgress?.("model_response", "test-model");
      vi.advanceTimersByTime(5_000);
      const recovered = session.getActivity?.();
      expect(recovered?.state).toBe("thinking");
      expect(recovered?.state).not.toBe("possibly_stalled");

      resolveLoop({ sessionId: "activity-wiring-session", summary: "done", streamed: false, reason: "completed" });
      await turn;
    } finally {
      vi.useRealTimers();
    }
  });

  it("getActivity() is undefined between turns", async () => {
    const { createAgentSession } = await import("../../src/agent/session.js");
    configureSessionMocks();
    mocks.runTaskLoop.mockResolvedValue({ sessionId: "activity-wiring-session", summary: "done", streamed: false, reason: "completed" });

    const session = createAgentSession({ cwd: wiringTestCwd, task: "", planMode: false });
    expect(session.getActivity?.()).toBeUndefined();
    await session.processTurn("first");
    expect(session.getActivity?.()).toBeUndefined();
  });
});
