/**
 * tool-span-wiring.vitest.ts — Task 12
 *
 * Verifies ToolExecutor.execute emits exactly ONE terminal tool span per tool
 * execution when tracing is enabled, and zero span work with identical results
 * when tracing is disabled / runId absent / run unknown.
 *
 * The executor reaches the TraceClient through `getProcessTraceClient()`
 * (client-factory), which is mocked here to inject a recording fake client (no
 * Langfuse SDK). A run is registered on the fake via startRun(runId) — exactly
 * how a run root establishes the active trace — so getRun(runId) resolves for
 * traced requests only.
 *
 * Covers:
 *   - success → 1 success span (tool name, capability, toolCallId, args,
 *     output, duration via startedAt/endedAt)
 *   - tool error result → 1 error span (status "error", error message)
 *   - throw out of dispatch → 1 error span, rethrown unchanged
 *   - cancellation (ExecutionCancelledError) out of dispatch → 1 cancelled
 *     span, rethrown unchanged
 *   - shell.run timeout → 1 error span (timeouts map to error)
 *   - parallel calls → sibling spans (one each, distinct toolCallIds, no
 *     parent/child relationship between spans)
 *   - disabled (Noop) / absent runId / unknown runId → no span work, no throw,
 *     results identical
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { ToolExecutor, type ExecuteResult } from "../../src/tools/executor.js";
import type { EventLog } from "../../src/events/event-log.js";
import type { AlixConfig } from "../../src/config/schema.js";
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
import { ExecutionCancelledError } from "../../src/runtime/cancellation-token.js";

const mocks = vi.hoisted(() => ({
  getProcessTraceClient: vi.fn(),
}));

vi.mock("../../src/tracing/client-factory.js", () => ({
  getProcessTraceClient: mocks.getProcessTraceClient,
}));

// ---------------------------------------------------------------------------
// Recording fake TraceClient (mirrors tests/providers/model-span-wiring)
// ---------------------------------------------------------------------------

class RecordingTraceClient implements TraceClient {
  started: ToolSpanInput[] = [];
  ended: { input: ToolSpanInput | undefined; outcome: SpanOutcome }[] = [];
  private runs = new Map<string, TraceRun>();
  failStartToolSpan = false;

  startRun(input: TraceRunInput): TraceRun {
    const handle = { runId: input.runId } as TraceRun;
    this.runs.set(input.runId, handle);
    return handle;
  }

  getRun(runId: string): TraceRun | null {
    return this.runs.get(runId) ?? null;
  }

  startModelSpan(_run: TraceRun, _input: ModelSpanInput): TraceSpan {
    return {} as TraceSpan;
  }

  startToolSpan(run: TraceRun, input: ToolSpanInput): TraceSpan {
    if (this.failStartToolSpan) throw new Error("startToolSpan boom");
    this.started.push(input);
    return { idx: this.started.length - 1 } as unknown as TraceSpan;
  }

  endSpan(span: TraceSpan, outcome: SpanOutcome): void {
    const idx = (span as unknown as { idx: number }).idx;
    this.ended.push({ input: this.started[idx], outcome });
  }

  async endRun(_run: TraceRun, _outcome: RunOutcome): Promise<void> {
    // no-op
  }

  async flush(): Promise<void> {
    // no-op
  }

  async shutdown(): Promise<void> {
    // no-op
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RUN_ID = "run-toolspan0";

const config: AlixConfig = {
  version: 1,
  model: { provider: "mock", name: "test-model" },
  permissions: {
    default: "allow",
    tools: {},
    protectedPaths: [],
    allowNetworkDomains: [],
    denyCommands: [],
  },
  context: {
    repoMap: false,
    repoMapMode: "lite",
    maxRepoMapTokens: 1000,
    semanticSearch: false,
    includeGitStatus: false,
    pinnedFiles: [],
  },
  runtime: {
    provider: "process",
    shell: "/bin/sh",
    commandTimeoutMs: 30000,
    envAllowlist: [],
  },
  ui: { enabled: false, host: "localhost", port: 3000, transport: "sse" as const },
};

/**
 * Minimal EventLog-shaped stub. Supports a deliberate append failure so a
 * throw (or cancellation) can be forced deterministically out of dispatch —
 * the executor awaits log.append for tool.requested BEFORE any router work.
 */
function stubLog(opts?: { failOnType?: string; error?: unknown }): EventLog {
  const sessionDir = join(tmpdir(), "sessions", "tool-span-test");
  return {
    sessionDir,
    append: async (event: { type: string }) => {
      if (opts?.failOnType && event.type === opts.failOnType) {
        throw opts.error ?? new Error("stub append boom");
      }
    },
    readAll: async () => [],
  } as unknown as EventLog;
}

interface Setup {
  dir: string;
  executor: ToolExecutor;
  recorder: RecordingTraceClient;
}

beforeEach(() => {
  mocks.getProcessTraceClient.mockReset();
  mocks.getProcessTraceClient.mockResolvedValue(NOOP_TRACE_CLIENT);
});

function setup(opts?: { log?: EventLog; runId?: string; registerRun?: boolean }): Setup {
  const dir = mkdtempSync(join(tmpdir(), "tool-span-"));
  writeFileSync(join(dir, "hello.txt"), "Hello, World!", "utf8");
  const recorder = new RecordingTraceClient();
  const log = opts?.log ?? stubLog();
  const executor = new ToolExecutor(config, log, dir);
  mocks.getProcessTraceClient.mockResolvedValue(recorder);
  if (opts?.registerRun !== false) recorder.startRun({ runId: opts?.runId ?? RUN_ID });
  return { dir, executor, recorder };
}

function toolCall(overrides?: Partial<{
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  executionId: string;
  invocationId: string;
  runId: string;
}>): {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  executionId: string;
  invocationId: string;
  runId: string;
} {
  return {
    toolCallId: "tool_1736000000000_abc123",
    name: "file.read",
    args: { path: "hello.txt" },
    executionId: "exec-1",
    invocationId: "inv-1",
    runId: RUN_ID,
    ...overrides,
  };
}

afterEach(() => {
  for (const s of setups) rmSync(s.dir, { recursive: true, force: true });
  setups.length = 0;
  vi.restoreAllMocks();
});

const setups: Setup[] = [];

/**
 * Wrapper for setup() that tracks created dirs for afterEach cleanup. Kept
 * separate so tests can use raw setup() when they want their own dir.
 */
function track(setupResult: Setup): Setup {
  setups.push(setupResult);
  return setupResult;
}

// ---------------------------------------------------------------------------
// Enabled — success
// ---------------------------------------------------------------------------

describe("ToolExecutor.execute tool spans — enabled", () => {
  it("emits exactly one success span per tool execution with full capture", async () => {
    const s = track(setup());
    const result = await s.executor.execute(toolCall());

    expect(result.kind).toBe("success");
    expect((result as { content?: string }).content).toBe("Hello, World!");
    expect(s.recorder.started).toHaveLength(1);
    expect(s.recorder.ended).toHaveLength(1);

    const input = s.recorder.started[0]!;
    expect(input.toolName).toBe("file.read");
    expect(input.capability).toBe("file.read");
    expect(input.toolCallId).toBe("tool_1736000000000_abc123");
    expect(input.invocationId).toBe("inv-1");
    expect(input.executionId).toBe("exec-1");
    expect(input.args).toEqual({ path: "hello.txt" });
    expect(input.startedAt).toBeTypeOf("number");

    const end = s.recorder.ended[0]!;
    expect(end.outcome.status).toBe("success");
    expect(end.outcome.output).toBe("Hello, World!");
    expect(end.outcome.endedAt).toBeTypeOf("number");
    expect(end.outcome.endedAt!).toBeGreaterThanOrEqual(input.startedAt!);
  });

  it("emits one error span when the tool returns an error result", async () => {
    const s = track(setup());
    const result = await s.executor.execute(toolCall({ args: { path: "missing.txt" } }));

    expect(result.kind).toBe("error");
    expect(s.recorder.started).toHaveLength(1);
    expect(s.recorder.ended).toHaveLength(1);
    expect(s.recorder.ended[0]!.outcome).toMatchObject({
      status: "error",
      error: expect.stringContaining("not found") as string,
    } as object);
  });

  it("emits exactly ONE terminal span for an approval-gated tool call (pre-approval denial emits none)", async () => {
    const s = track(setup());
    const req = toolCall();

    // Mimic handleToolCall's execute-twice flow (event-handlers.ts:303,324):
    // the FIRST execute returns the policy gate's pre-approval "denied"
    // (reason "Approval required (…)"), then after the operator approves the
    // SAME physical tool call's SECOND execute actually runs the tool.
    // A real ToolkitExecutor goes through ExecutionAuthorization to reach this;
    // here we force the first dispatch to short-circuit with the approval
    // denial and let the second dispatch execute for real.
    const executorDispatch = s.executor as unknown as { dispatch: (r: unknown) => Promise<ExecuteResult> };
    const realDispatch = executorDispatch.dispatch.bind(s.executor);
    let call = 0;
    const dispatchSpy = vi
      .spyOn(executorDispatch, "dispatch")
      .mockImplementation(async (r) => {
        call += 1;
        if (call === 1) {
          return { kind: "denied", reason: "Approval required (appr-1): needs operator approval" };
        }
        return realDispatch(r);
      });

    try {
      // First attempt — approval pause. Must NOT burn a span (and no "error" span).
      const first = await s.executor.execute(req);
      expect(first).toMatchObject({ kind: "denied" });
      expect(s.recorder.started).toHaveLength(0);
      expect(s.recorder.ended).toHaveLength(0);

      // Second attempt — the real execution. Exactly one terminal span, success.
      const second = await s.executor.execute(req);
      expect(second.kind).toBe("success");

      // ONE physical tool call → exactly ONE terminal span, never an "error"
      // span for the pre-approval pause, and the real span carries the success.
      expect(s.recorder.started).toHaveLength(1);
      expect(s.recorder.ended).toHaveLength(1);
      expect(s.recorder.ended[0]!.input?.toolCallId).toBe(req.toolCallId);
      expect(s.recorder.ended[0]!.outcome.status).toBe("success");
    } finally {
      dispatchSpy.mockRestore();
    }
  });

  it("keeps a single error span for a genuine (non-approval) denial — not double-spanned", async () => {
    const s = track(setup());
    const req = toolCall();

    // A policy/ownership denial returns `denied` with a NON-"Approval required"
    // reason. handleToolCall does NOT re-execute for these, so this is the one
    // and only physical attempt — it keeps its single error span (unchanged).
    const executorDispatch = s.executor as unknown as { dispatch: (r: unknown) => Promise<ExecuteResult> };
    const dispatchSpy = vi
      .spyOn(executorDispatch, "dispatch")
      .mockResolvedValue({ kind: "denied", reason: "Policy denied: not allowed" } as never);

    try {
      const result = await s.executor.execute(req);
      expect(result).toMatchObject({ kind: "denied" });
      expect(s.recorder.started).toHaveLength(1);
      expect(s.recorder.ended).toHaveLength(1);
      expect(s.recorder.ended[0]!.outcome.status).toBe("error");
    } finally {
      dispatchSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Enabled — throw / cancellation / timeout
// ---------------------------------------------------------------------------

describe("ToolExecutor.execute tool spans — throw / cancel / timeout", () => {
  it("emits one error span and rethrows the original error when dispatch throws", async () => {
    const log = stubLog({ failOnType: "tool.requested", error: new Error("dispatch boom") });
    const s = track(setup({ log }));

    await expect(s.executor.execute(toolCall())).rejects.toThrow("dispatch boom");
    expect(s.recorder.started).toHaveLength(1);
    expect(s.recorder.ended).toHaveLength(1);
    expect(s.recorder.ended[0]!.outcome).toMatchObject({
      status: "error",
      error: "dispatch boom",
    });
  });

  it("maps an ExecutionCancelledError to a cancelled span and rethrows", async () => {
    const log = stubLog({
      failOnType: "tool.requested",
      error: new ExecutionCancelledError("operator cancel"),
    });
    const s = track(setup({ log }));

    await expect(s.executor.execute(toolCall())).rejects.toBeInstanceOf(ExecutionCancelledError);
    expect(s.recorder.started).toHaveLength(1);
    expect(s.recorder.ended).toHaveLength(1);
    expect(s.recorder.ended[0]!.outcome).toMatchObject({
      status: "cancelled",
      error: "Execution cancelled: operator cancel",
    });
  });

  it("ends a shell.run timeout as one error span", async () => {
    const s = track(setup());
    const result = await s.executor.execute(
      toolCall({
        name: "shell.run",
        args: { command: "sleep 5", timeoutMs: 100 },
      }),
    );

    expect(result.kind).toBe("error");
    expect(s.recorder.started).toHaveLength(1);
    expect(s.recorder.ended).toHaveLength(1);
    expect(s.recorder.ended[0]!.outcome.status).toBe("error");
  });

  it("fails open when startToolSpan throws — tool result is unaffected", async () => {
    const s = track(setup());
    s.recorder.failStartToolSpan = true;

    const result = await s.executor.execute(toolCall());
    expect(result.kind).toBe("success");
    expect((result as { content?: string }).content).toBe("Hello, World!");
    expect(s.recorder.started).toHaveLength(0);
    expect(s.recorder.ended).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Parallel tool calls — sibling spans
// ---------------------------------------------------------------------------

describe("ToolExecutor.execute tool spans — parallel siblings", () => {
  it("emits one sibling span per parallel execution (no parent/child nesting)", async () => {
    const s = track(setup());
    const callA = toolCall({ toolCallId: "tool_1_aaa", args: { path: "hello.txt" }, invocationId: "inv-1" });
    const callB = toolCall({ toolCallId: "tool_2_bbb", args: { path: "hello.txt" }, invocationId: "inv-1" });

    const [ra, rb] = await Promise.all([
      s.executor.execute(callA),
      s.executor.execute(callB),
    ]);

    expect(ra.kind).toBe("success");
    expect(rb.kind).toBe("success");
    expect(s.recorder.started).toHaveLength(2);
    expect(s.recorder.ended).toHaveLength(2);

    const toolCallIds = s.recorder.started.map((i) => i.toolCallId).sort();
    expect(toolCallIds).toEqual(["tool_1_aaa", "tool_2_bbb"]);

    // Each span is independent (own handle, own end) — a sibling of the other,
    // never a parent/child pair. The fake's span handles are per-start indices.
    const aIdx = s.recorder.started.findIndex((i) => i.toolCallId === "tool_1_aaa");
    const bIdx = s.recorder.started.findIndex((i) => i.toolCallId === "tool_2_bbb");
    expect(aIdx).toBeGreaterThanOrEqual(0);
    expect(bIdx).toBeGreaterThanOrEqual(0);
    expect(aIdx).not.toBe(bIdx);
    expect(s.recorder.ended.some((e) => e.input?.toolCallId === "tool_1_aaa")).toBe(true);
    expect(s.recorder.ended.some((e) => e.input?.toolCallId === "tool_2_bbb")).toBe(true);
    expect(s.recorder.ended.every((e) => e.outcome.status === "success")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Disabled / absent / unknown run
// ---------------------------------------------------------------------------

describe("ToolExecutor.execute tool spans — disabled & unresolvable runs", () => {
  it("produces no span work and identical results when tracing is disabled (Noop)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tool-span-"));
    setups.push({ dir, executor: undefined as never, recorder: undefined as never });
    writeFileSync(join(dir, "hello.txt"), "Hello, World!", "utf8");
    const executor = new ToolExecutor(config, stubLog(), dir);
    // getProcessTraceClient resolves to NOOP (default from beforeEach).

    const result = await executor.execute(toolCall());
    expect(result.kind).toBe("success");
    expect((result as { content?: string }).content).toBe("Hello, World!");
  });

  it("produces no span when runId is absent (no throw, result unchanged)", async () => {
    const s = track(setup());
    const req = toolCall();
    delete (req as { runId?: string }).runId;

    const result = await s.executor.execute(req);
    expect(result.kind).toBe("success");
    expect((result as { content?: string }).content).toBe("Hello, World!");
    expect(s.recorder.started).toHaveLength(0);
    expect(s.recorder.ended).toHaveLength(0);
  });

  it("produces no span when the runId is unknown to the client (no throw)", async () => {
    const s = track(setup({ registerRun: false }));

    const result = await s.executor.execute(toolCall());
    expect(result.kind).toBe("success");
    expect((result as { content?: string }).content).toBe("Hello, World!");
    expect(s.recorder.started).toHaveLength(0);
    expect(s.recorder.ended).toHaveLength(0);
  });
});