/**
 * tracing-session-roots.vitest.ts — Task 10
 *
 * Verifies the session run roots (processTurn + processChat) emit exactly one
 * root trace per logical execution when tracing is ENABLED (a recording fake
 * TraceClient injected via AgentSessionConfig.traceClient), and that results
 * are byte-identical to the uninstrumented path when tracing is disabled (no
 * client → inert Noop default).
 *
 * Covers, per root:
 *   - processTurn: arithmetic / direct-generation success, agent-loop success,
 *     agent-loop thrown failure (error outcome), agent-loop cancellation
 *     (cancelled outcome), plan-rejection throw path — startRun/endRun exactly
 *     once each, outcome mapped from the actual return/throw (R1).
 *   - processChat: no-provider return, success return, chat-error return, and
 *     the truncation continuation loop (design §17 invariant) — one synthetic
 *     run-<uuid8>, one trace, the synthetic ExecutionContext threaded into
 *     EVERY complete() call (both initial + continuation) so T11 model spans
 *     can resolve getRun(context.runId).
 */

import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAgentSession } from "../../src/agent/session.js";
import type { ModelAdapter } from "../../src/providers/types.js";
import { ExecutionCancelledError } from "../../src/runtime/cancellation-token.js";
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
import { NOOP_TRACE_CLIENT } from "../../src/tracing/noop-client.js";

let testCwd: string;
let testCwdCleanup: (() => void) | null = null;

beforeEach(() => {
  testCwd = mkdtempSync(join(tmpdir(), "tracing-session-roots-"));
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
}));

vi.mock("../../src/agent/agent.js", () => ({ initAgent: mocks.initAgent }));
vi.mock("../../src/run/task-loop.js", () => ({ runTaskLoop: mocks.runTaskLoop }));
vi.mock("../../src/providers/registry.js", () => ({
  createProvider: vi.fn(async () => ({
    id: "mock",
    capabilities: {},
    editFormatPreference: "unified_diff",
    longContextStrategy: "trimmed_context",
    complete: vi.fn(async () => ({ text: "mock", toolCalls: [] })),
  })),
}));
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
vi.mock("../../src/tools/executor.js", () => ({
  ToolExecutor: class {
    execute = vi.fn(async () => ({ kind: "success", output: "mock" }));
  },
}));

const initContext = {
  sessionId: "tracing-session",
  sessionDir: "/tmp/tracing-session",
  log: {
    append: mocks.append,
    readAll: mocks.readAll,
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
};

beforeEach(() => {
  mocks.append.mockReset().mockImplementation(() => Promise.resolve());
  mocks.readAll.mockReset().mockResolvedValue([]);
  mocks.initAgent.mockReset().mockResolvedValue(initContext);
  mocks.runTaskLoop.mockReset().mockResolvedValue({
    summary: "agent-loop complete",
    streamed: false,
    reason: "completed",
  });
});

// ---------------------------------------------------------------------------
// Recording fake TraceClient — records startRun/endRun pairs so tests can
// assert exactly-once lifecycle and outcome mapping without a Langfuse SDK.
// ---------------------------------------------------------------------------
class RecordingTraceClient implements TraceClient {
  starts: TraceRunInput[] = [];
  ends: { run: TraceRun; outcome: RunOutcome }[] = [];
  private handles = new Map<string, TraceRun>();

  startRun(input: TraceRunInput): TraceRun {
    this.starts.push(input);
    const handle = { runId: input.runId } as TraceRun;
    this.handles.set(input.runId, handle);
    return handle;
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

  async endRun(run: TraceRun, outcome: RunOutcome): Promise<void> {
    this.ends.push({ run, outcome });
  }

  async flush(): Promise<void> {
    // no-op
  }

  async shutdown(): Promise<void> {
    // no-op
  }

  get lastStart(): TraceRunInput | undefined {
    return this.starts[this.starts.length - 1];
  }

  get lastEnd(): { run: TraceRun; outcome: RunOutcome } | undefined {
    return this.ends[this.ends.length - 1];
  }

  handleFor(runId: string): TraceRun | undefined {
    return this.handles.get(runId);
  }
}

const RUN_ID_RE = /^run-[0-9a-f]{8}$/;

function makeMockProvider(complete: ReturnType<typeof vi.fn>): ModelAdapter {
  return {
    id: "mock",
    capabilities: {},
    editFormatPreference: "unified_diff",
    longContextStrategy: "trimmed_context",
    complete: complete as unknown as ModelAdapter["complete"],
  } as unknown as ModelAdapter;
}

// ---- processTurn roots -----------------------------------------------------

describe("processTurn root trace (Task 10, R1)", () => {
  it("arithmetic success: one startRun + one endRun(success), no init", async () => {
    const recorder = new RecordingTraceClient();
    const session = createAgentSession({
      cwd: testCwd,
      task: "",
      sessionId: "sess",
      traceClient: recorder,
    });

    const result = await session.processTurn("2+2");

    expect(result.summary).toBe("4");
    expect(result.reason).toBe("direct");
    expect(mocks.initAgent).not.toHaveBeenCalled();
    expect(recorder.starts).toHaveLength(1);
    expect(recorder.ends).toHaveLength(1);
    expect(recorder.lastStart!.runId).toMatch(RUN_ID_RE);
    expect(recorder.lastStart!.sessionId).toBe("sess");
    expect(recorder.lastStart!.task).toBe("2+2");
    expect(recorder.lastEnd!.outcome.status).toBe("success");
    // endRun receives the exact handle startRun returned (same trace).
    expect(recorder.lastEnd!.run).toBe(recorder.handleFor(recorder.lastStart!.runId)!);
  });

  it("direct-generation success: one startRun + one endRun(success)", async () => {
    const recorder = new RecordingTraceClient();
    const complete = vi.fn(async () => ({ text: "fib", toolCalls: [] }));
    const session = createAgentSession({
      cwd: testCwd,
      task: "",
      sessionId: "sess",
      chatProvider: makeMockProvider(complete),
      traceClient: recorder,
    });

    const result = await session.processTurn("Write Fibonacci function in Python");

    expect(result.summary).toBe("fib");
    expect(recorder.starts).toHaveLength(1);
    expect(recorder.ends).toHaveLength(1);
    expect(recorder.lastEnd!.outcome.status).toBe("success");
  });

  it("agent-loop success: one startRun + one endRun(success)", async () => {
    const recorder = new RecordingTraceClient();
    const session = createAgentSession({
      cwd: testCwd,
      task: "",
      sessionId: "sess",
      planMode: false,
      traceClient: recorder,
    });

    const result = await session.processTurn("Refactor this repo");

    expect(result.summary).toBe("agent-loop complete");
    expect(mocks.runTaskLoop).toHaveBeenCalledTimes(1);
    expect(recorder.starts).toHaveLength(1);
    expect(recorder.ends).toHaveLength(1);
    expect(recorder.lastEnd!.outcome.status).toBe("success");
    // The agent-loop ExecutionContext passed to runTaskLoop shares the root runId.
    const deps = mocks.runTaskLoop.mock.calls[0]?.[0] as { context?: { runId?: string } } | undefined;
    expect(deps?.context?.runId).toBe(recorder.lastStart!.runId);
  });

  it("agent-loop thrown failure: one endRun(error), turn rejects unchanged", async () => {
    const recorder = new RecordingTraceClient();
    mocks.runTaskLoop.mockRejectedValueOnce(new Error("boom"));
    const session = createAgentSession({
      cwd: testCwd,
      task: "",
      sessionId: "sess",
      planMode: false,
      traceClient: recorder,
    });

    await expect(session.processTurn("Refactor this repo")).rejects.toThrow("boom");
    expect(recorder.starts).toHaveLength(1);
    expect(recorder.ends).toHaveLength(1);
    expect(recorder.lastEnd!.outcome.status).toBe("error");
    expect(recorder.lastEnd!.outcome.error).toContain("boom");
  });

  it("agent-loop cancellation: one endRun(cancelled), turn rejects with the cancellation error", async () => {
    const recorder = new RecordingTraceClient();
    mocks.runTaskLoop.mockRejectedValueOnce(new ExecutionCancelledError("operator cancel"));
    const session = createAgentSession({
      cwd: testCwd,
      task: "",
      sessionId: "sess",
      planMode: false,
      traceClient: recorder,
    });

    await expect(session.processTurn("Refactor this repo")).rejects.toThrow(
      /cancelled/i,
    );
    expect(recorder.starts).toHaveLength(1);
    expect(recorder.ends).toHaveLength(1);
    expect(recorder.lastEnd!.outcome.status).toBe("cancelled");
  });

  it("throw from initialize (pre-runId, e.g. plan rejection) → endRun fires exactly once (error)", async () => {
    const recorder = new RecordingTraceClient();
    const session = createAgentSession({
      cwd: testCwd,
      task: "",
      sessionId: "sess",
      traceClient: recorder,
    });
    // A workspace_action routes to the agent-loop branch; initialize() is the
    // first thing it awaits and its failure (e.g. "Plan rejected by user") used
    // to escape processTurn BEFORE any runId existed. The task-10 root starts
    // at processTurn entry, so even this pre-runId throw must endRun once.
    mocks.initAgent.mockReset().mockRejectedValueOnce(new Error("Plan rejected by user"));

    await expect(session.processTurn("Refactor this repo")).rejects.toThrow(
      "Plan rejected by user",
    );
    expect(recorder.starts).toHaveLength(1);
    expect(recorder.ends).toHaveLength(1);
    expect(recorder.lastEnd!.outcome.status).toBe("error");
    expect(recorder.lastEnd!.outcome.error).toContain("Plan rejected");
  });
});

// ---- processChat roots -----------------------------------------------------

describe("processChat root trace (Task 10, R3)", () => {
  function makeSession(
    recorder: RecordingTraceClient,
    chatProvider?: ModelAdapter,
    extra?: { chatSystemPrompt?: string },
  ) {
    return createAgentSession({
      cwd: testCwd,
      task: "",
      sessionId: "chat-session",
      traceClient: recorder,
      ...(chatProvider ? { chatProvider } : {}),
      ...extra,
    });
  }

  it("no-provider return: one startRun + one endRun(success), placeholder unchanged", async () => {
    const recorder = new RecordingTraceClient();
    const session = makeSession(recorder);

    const result = await session.processChat("hello there");

    expect(result.summary).toContain("[chat:no-provider]");
    expect(result.reason).toBe("chat");
    expect(recorder.starts).toHaveLength(1);
    expect(recorder.ends).toHaveLength(1);
    expect(recorder.lastEnd!.outcome.status).toBe("success");
  });

  it("success return: one trace, context threaded into the provider request", async () => {
    const recorder = new RecordingTraceClient();
    const complete = vi.fn(async () => ({ text: "hi back", toolCalls: [] }));
    const session = makeSession(recorder, makeMockProvider(complete));

    const result = await session.processChat("hi");

    expect(result.summary).toBe("hi back");
    expect(complete).toHaveBeenCalledTimes(1);
    const req = (complete.mock.calls as unknown[][])[0]?.[0] as {
      context?: { runId?: string; sessionId?: string };
    } | undefined;
    expect(req?.context?.runId).toBe(recorder.lastStart!.runId);
    expect(req?.context?.sessionId).toBe("chat");
    expect(recorder.starts).toHaveLength(1);
    expect(recorder.ends).toHaveLength(1);
    expect(recorder.lastEnd!.outcome.status).toBe("success");
  });

  it("truncation continuation shares ONE synthetic runId + trace and threads context on every call", async () => {
    const recorder = new RecordingTraceClient();
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ text: "part1", toolCalls: [], finishReason: "length" })
      .mockResolvedValueOnce({ text: "part2", toolCalls: [], finishReason: "stop" });
    const session = makeSession(recorder, makeMockProvider(complete));

    const result = await session.processChat("long answer please");

    // Continuation happened: two physical provider calls under one invocation.
    expect(complete).toHaveBeenCalledTimes(2);
    expect(result.summary).toBe("part1part2");
    expect(result.reason).toBe("chat");
    // One synthetic run id, one trace — the invariant (design §17).
    expect(recorder.starts).toHaveLength(1);
    expect(recorder.ends).toHaveLength(1);
    expect(recorder.lastEnd!.outcome.status).toBe("success");
    const runId = recorder.lastStart!.runId;
    expect(runId).toMatch(RUN_ID_RE);
    for (const call of complete.mock.calls as unknown[][]) {
      const req = call[0] as { context?: { runId?: string; sessionId?: string } };
      expect(req.context?.runId).toBe(runId);
      expect(req.context?.sessionId).toBe("chat");
    }
  });

  it("chat-error return: one endRun(error), never throws, message dropped as before", async () => {
    const recorder = new RecordingTraceClient();
    const complete = vi.fn(async () => {
      throw new Error("rate limited");
    });
    const session = makeSession(recorder, makeMockProvider(complete));

    const result = await session.processChat("hi");

    expect(result.summary).toContain("[chat error]");
    expect(result.summary).toContain("rate limited");
    expect(result.reason).toBe("chat-error");
    expect(recorder.starts).toHaveLength(1);
    expect(recorder.ends).toHaveLength(1);
    expect(recorder.lastEnd!.outcome.status).toBe("error");
    expect(recorder.lastEnd!.outcome.error).toContain("rate limited");
  });

  it("chat-error endRun status while the NEXT invocation starts a fresh trace", async () => {
    const recorder = new RecordingTraceClient();
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new Error("rate limited"))
      .mockResolvedValueOnce({ text: "ok", toolCalls: [] });
    const session = makeSession(recorder, makeMockProvider(complete));

    const first = await session.processChat("hi");
    const second = await session.processChat("again");

    expect(first.reason).toBe("chat-error");
    expect(second.reason).toBe("chat");
    expect(recorder.starts).toHaveLength(2);
    expect(recorder.ends).toHaveLength(2);
    expect(recorder.ends[0]!.outcome.status).toBe("error");
    expect(recorder.ends[1]!.outcome.status).toBe("success");
    // Distinct per-invocation run ids.
    expect(recorder.starts[0]!.runId).not.toBe(recorder.starts[1]!.runId);
  });
});

// ---- disabled default ------------------------------------------------------

describe("tracing disabled (default) — behavior unchanged", () => {
  it("session without a traceClient uses the inert Noop client and returns identical results", async () => {
    const noClient = createAgentSession({ cwd: testCwd, task: "", sessionId: "sess" });
    const noopClient = createAgentSession({
      cwd: testCwd,
      task: "",
      sessionId: "sess",
      traceClient: NOOP_TRACE_CLIENT,
    });

    const a = await noClient.processTurn("2+2");
    const b = await noopClient.processTurn("2+2");
    expect(a).toEqual(b);
    expect(a.summary).toBe("4");

    const agentA = createAgentSession({ cwd: testCwd, task: "", sessionId: "sess", planMode: false });
    const agentB = createAgentSession({
      cwd: testCwd,
      task: "",
      sessionId: "sess",
      planMode: false,
      traceClient: NOOP_TRACE_CLIENT,
    });
    const ra = await agentA.processTurn("Refactor this repo");
    const rb = await agentB.processTurn("Refactor this repo");
    expect(ra).toEqual(rb);
    expect(ra.summary).toBe("agent-loop complete");

    const chatA = createAgentSession({ cwd: testCwd, task: "", sessionId: "sess" });
    const chatB = createAgentSession({ cwd: testCwd, task: "", sessionId: "sess", traceClient: NOOP_TRACE_CLIENT });
    const ca = await chatA.processChat("hi");
    const cb = await chatB.processChat("hi");
    expect(ca).toEqual(cb);
  });

  it("a throwing provider still surfaces exactly the same chat-error result with the Noop default", async () => {
    const complete = vi.fn(async () => {
      throw new Error("rate limited");
    });
    const session = createAgentSession({
      cwd: testCwd,
      task: "",
      sessionId: "sess",
      chatProvider: makeMockProvider(complete),
    });
    const result = await session.processChat("hi");
    expect(result.summary).toContain("[chat error]");
    expect(result.reason).toBe("chat-error");
  });
});
