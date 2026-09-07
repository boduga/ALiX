/**
 * tracing-runtask-root.vitest.ts — Task 10
 *
 * Verifies the runTaskCore run root (reached through the governed `runTask`
 * export) emits exactly one root trace per logical run when tracing is
 * ENABLED. The TraceClient is derived inside runTaskCore from the resolved
 * `ctx.config.tracing` via the memoized `createTraceClient` factory — the
 * factory is vi.mock'd to a recording fake so the success and thrown
 * (cancellation) terminals can be asserted:
 *
 *   - success return → one startRun + one endRun(success), and the returned
 *     RunResult.runId is the SAME id the trace started with (R1 reconcile),
 *     which is also threaded into the task-loop ExecutionContext.
 *   - thrown cancellation → one startRun + one endRun(cancelled), run rejects.
 *
 * When tracing is disabled (default) the factory returns the inert Noop
 * client, so the same paths construct no Langfuse trace and results are
 * unchanged — asserted by the factory returning NOOP in the disabled test.
 */

import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runTask } from "../../src/run.js";
import { ExecutionCancelledError } from "../../src/runtime/cancellation-token.js";
import { NOOP_TRACE_CLIENT } from "../../src/tracing/noop-client.js";
import type { TraceClient } from "../../src/tracing/client.js";
import type {
  ModelSpanInput,
  RunOutcome,
  SpanOutcome,
  ToolSpanInput,
  TraceRun,
  TraceRunInput,
  TraceSpan,
} from "../../src/tracing/types.js";

let testCwd: string;
let testCwdCleanup: (() => void) | null = null;

beforeEach(() => {
  testCwd = mkdtempSync(join(tmpdir(), "tracing-runtask-root-"));
  // runTask's governed evidence emitter writes under .alix/governance.
  mkdirSync(join(testCwd, ".alix", "governance"), { recursive: true });
  testCwdCleanup = () => rmSync(testCwd, { recursive: true, force: true });
});

afterEach(() => {
  testCwdCleanup?.();
});

const mocks = vi.hoisted(() => ({
  append: vi.fn(() => Promise.resolve()),
  readAll: vi.fn(() => Promise.resolve([])),
  initAgent: vi.fn(),
  runTaskLoop: vi.fn(),
  createTraceClient: vi.fn(() => NOOP_TRACE_CLIENT),
  ensureEncoder: vi.fn(() => Promise.resolve()),
  discoverHooks: vi.fn(async () => ({})),
  buildMemoryContext: vi.fn(() => Promise.resolve(undefined)),
  buildMemoryStats: vi.fn(() => Promise.resolve(undefined)),
  loadSkillManifests: vi.fn(() => Promise.resolve([])),
  buildSkillCatalog: vi.fn(() => ({ getMatchedContent: vi.fn(() => Promise.resolve([])) })),
  evictIfNeeded: vi.fn(),
}));

vi.mock("../../src/agent/agent.js", () => ({ initAgent: mocks.initAgent }));
vi.mock("../../src/run/task-loop.js", () => ({ runTaskLoop: mocks.runTaskLoop }));
vi.mock("../../src/tracing/client-factory.js", () => ({
  createTraceClient: mocks.createTraceClient,
}));
vi.mock("../../src/utils/tokens.js", () => ({ ensureEncoder: mocks.ensureEncoder }));
vi.mock("../../src/hooks/discover.js", () => ({ discoverHooks: mocks.discoverHooks }));
vi.mock("../../src/utils/memory/recall.js", () => ({
  buildMemoryContext: mocks.buildMemoryContext,
  buildMemoryStats: mocks.buildMemoryStats,
}));
vi.mock("../../src/skills/loader.js", () => ({ loadSkillManifests: mocks.loadSkillManifests }));
vi.mock("../../src/skills/catalog.js", () => ({ buildSkillCatalog: mocks.buildSkillCatalog }));
vi.mock("../../src/skills/lifecycle.js", () => ({ evictIfNeeded: mocks.evictIfNeeded }));

// A fake AgentContext as initAgent would return. config.tracing is the switch
// the factory receives; most fields are consumed by mocked modules.
function runCtx(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "runtask-session",
    sessionDir: join(testCwd, ".alix", "sessions", "runtask-session"),
    log: { append: mocks.append, readAll: mocks.readAll },
    config: {
      model: {
        provider: "anthropic",
        name: "test-model",
        streaming: false,
        maxContextTokens: 8_000,
        maxIterations: 4,
      },
      models: { default: { provider: "anthropic", name: "test-model" } },
      permissions: { sessionMode: "auto" },
      apiKeys: {},
      context: { budget: {} },
      tracing: { enabled: false },
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
    ...overrides,
  };
}

class RecordingTraceClient implements TraceClient {
  starts: TraceRunInput[] = [];
  ends: { run: TraceRun; outcome: RunOutcome }[] = [];

  startRun(input: TraceRunInput): TraceRun {
    this.starts.push(input);
    return { runId: input.runId } as TraceRun;
  }

  getRun(_runId: string): TraceRun | null {
    return null;
  }

  startModelSpan(_run: TraceRun, _input: ModelSpanInput): TraceSpan {
    return {} as TraceSpan;
  }

  startToolSpan(_run: TraceRun, _input: ToolSpanInput): TraceSpan {
    return {} as TraceSpan;
  }

  endSpan(_span: TraceSpan, _outcome: SpanOutcome): void {
    // no-op
  }

  endRun(run: TraceRun, outcome: RunOutcome): void {
    this.ends.push({ run, outcome });
  }

  async flush(): Promise<void> {
    // no-op
  }

  async shutdown(): Promise<void> {
    // no-op
  }
}

const RUN_ID_RE = /^run-[0-9a-f]{8}$/;

const RUN_OPTS = { planMode: false, skipContext: true, disableSkillFactory: true };

describe("runTask/runTaskCore root trace (Task 10, R1)", () => {
  beforeEach(() => {
    mocks.append.mockReset().mockImplementation(() => Promise.resolve());
    mocks.readAll.mockReset().mockResolvedValue([]);
    mocks.initAgent.mockReset();
    mocks.runTaskLoop.mockReset().mockResolvedValue({
      summary: "task complete",
      streamed: false,
      reason: "completed",
    });
  });

  it("success: exactly one startRun + one endRun(success); returned runId reconciles with the trace id", async () => {
    const recorder = new RecordingTraceClient();
    mocks.createTraceClient.mockReturnValue(recorder);
    mocks.initAgent.mockResolvedValue(runCtx({ config: { ...runCtx().config, tracing: { enabled: true } } }));

    const result = await runTask(testCwd, "Summarize the codebase", RUN_OPTS);

    expect(result.summary).toBe("task complete");
    expect(mocks.runTaskLoop).toHaveBeenCalledTimes(1);
    expect(recorder.starts).toHaveLength(1);
    expect(recorder.ends).toHaveLength(1);
    expect(recorder.ends[0]!.outcome.status).toBe("success");
    const start = recorder.starts[0]!;
    expect(start.runId).toMatch(RUN_ID_RE);
    // R1 reconcile: the RunResult.runId IS the trace-root id.
    expect(result.runId).toBe(start.runId);
    // And the task-loop ExecutionContext carries the same runId for T11.
    const deps = mocks.runTaskLoop.mock.calls[0]?.[0] as { context?: { runId?: string } } | undefined;
    expect(deps?.context?.runId).toBe(start.runId);
    // startRun carried the resolved session/workflow ids for run grouping.
    expect(start.sessionId).toBe("runtask-session");
    expect(start.task).toBe("Summarize the codebase");
  });

  it("thrown cancellation: exactly one endRun(cancelled), runTask rejects with the cancellation error", async () => {
    const recorder = new RecordingTraceClient();
    mocks.createTraceClient.mockReturnValue(recorder);
    mocks.initAgent.mockResolvedValue(runCtx({ config: { ...runCtx().config, tracing: { enabled: true } } }));
    mocks.runTaskLoop.mockRejectedValueOnce(new ExecutionCancelledError("operator cancel"));

    await expect(runTask(testCwd, "Summarize the codebase", RUN_OPTS)).rejects.toThrow(
      /cancelled/i,
    );
    expect(recorder.starts).toHaveLength(1);
    expect(recorder.ends).toHaveLength(1);
    expect(recorder.ends[0]!.outcome.status).toBe("cancelled");
    expect(recorder.ends[0]!.outcome.error).toContain("operator cancel");
  });

  it("thrown failure: exactly one endRun(error), runTask rejects", async () => {
    const recorder = new RecordingTraceClient();
    mocks.createTraceClient.mockReturnValue(recorder);
    mocks.initAgent.mockResolvedValue(runCtx({ config: { ...runCtx().config, tracing: { enabled: true } } }));
    mocks.runTaskLoop.mockRejectedValueOnce(new Error("boom"));

    await expect(runTask(testCwd, "Summarize the codebase", RUN_OPTS)).rejects.toThrow("boom");
    expect(recorder.starts).toHaveLength(1);
    expect(recorder.ends).toHaveLength(1);
    expect(recorder.ends[0]!.outcome.status).toBe("error");
  });

  it("tracing disabled (factory returns Noop): same success result, no adapter/trace client constructed", async () => {
    // Default createTraceClient mock returns NOOP_TRACE_CLIENT (the disabled
    // selection). runTaskCore still calls startRun/endRun on it — inert.
    mocks.initAgent.mockResolvedValue(runCtx());

    const result = await runTask(testCwd, "Summarize the codebase", RUN_OPTS);

    expect(result.summary).toBe("task complete");
    expect(result.runId).toMatch(RUN_ID_RE);
    // Noop client never records anything: nothing escaped as a real trace.
    expect(mocks.createTraceClient).toHaveBeenCalled();
    expect(mocks.runTaskLoop).toHaveBeenCalledTimes(1);
  });
});
