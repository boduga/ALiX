/**
 * Task 24 — R6 loop-level fail-soft streaming (design §20 "Physical vs logical
 * model calls"; recon deviation #10; adjudication R6).
 *
 * The LOGICAL stream across a non-routing provider is served by 2 physical
 * requests when the first one dies mid-stream:
 *
 *     request 1   provider.stream(request)     → one model span (stream: true)
 *         │  mid-stream error / abort
 *         ▼
 *     request 2   provider.complete(request)   → one model span (stream: false)
 *         │  (fail-soft fallback — src/run/helpers.ts streamToResponse)
 *         ▼
 *     logical outcome = whatever the fallback commits to (ERROR here)
 *
 * R6 ("2 physical streaming requests → 2 model spans per LOGICAL stream") plus
 * the fail-soft rule ("a mid-stream error on request 1 does NOT prevent request
 * 2 from being issued") is the invariant carved out by Task 17/Task 18 and left
 * for this task. Exactly-one-span-per-PHYSICAL-request is pinned by
 * tests/tracing/tracing-streaming-exactly-once.vitest.ts (Task 17, wrapper
 * surface, one physical request); this file adds the loop-level DELTA — a
 * mid-stream failure on request 1 must still issue request 2, each physical
 * request carrying its OWN model span, and the run must commit to the ERROR
 * outcome with the error attached to the span whose stream actually failed.
 *
 * The re-issue loop is read from production (src/run/helpers.ts:351-360):
 * `streamToResponse` runs a `for await` over `provider.stream(request)`; a
 * mid-stream throw is caught, and unless `provider.isRoutingAdapter` (the
 * routing adapter already made its fallback decision — post-commit failure is
 * final), the SAME request is sent again as a blocking
 * `provider.complete(request)`. The partial text streamed before the failure is
 * retained and prefixed onto the fallback block. Both physical calls are made
 * through the SAME `withProviderContracts`-wrapped adapter, so each begins and
 * ends its own model span (provider-contract-validation.ts complete()/stream()
 * overrides). Cardinality proven below by the scripted model's own call
 * counters: streamCalls === 1, completeCalls === 1.
 *
 * Logical-outcome contract: fail-soft is about RE-ISSUING request 2, not about
 * succeeding afterwards. When the fallback ALSO fails, the error propagates out
 * of streamToResponse → runTaskLoop rejects → the run root commits the ERROR
 * terminal. The 2nd span still exists and is a generation END (fail-soft = 2
 * ends at the SDK surface; fail-hard would abandon after request 1 = 1 end).
 *
 * Error mapping (honest, byte-precise to the adapter): both terminals carry
 * status "error" + level "ERROR" + statusMessage/alix.error (outcomeForError,
 * provider-contract-validation.ts:185-191; langfuse-client.ts endSpan). Partial
 * output on the error terminal is NOT captured — outcomeForError sets
 * status/error/endedAt only (pre-existing Task-11-approved behavior; the
 * capture-fidelity option stays open at Task 25). Asserted as `output`
 * undefined, exactly as the code does.
 *
 * Layers — identical to tests/tracing/tracing-e2e-wiring.vitest.ts (Task 16):
 *   - SDK:            vi.mock('langfuse') fake recorder (no network)
 *   - adapter:        REAL LangfuseTraceClient (via createTraceClient)
 *   - run root:       startRun → runTaskLoop → endRun (thin hand-made root,
 *                     runTaskCore/processTurn NOT invoked — T16 layering)
 *   - loop:           REAL runTaskLoop over a real ToolExecutor seam graph
 *   - provider seam:  REAL withProviderContracts around a scripted STREAMING
 *                     FakeModel (models.default.streaming: true so runTaskLoop
 *                     takes the streamToResponse branch, task-loop.ts:812)
 *   - model:          call N is guarded by isRoutingAdapter: false (the
 *                     production guard streamToResponse consults); stream yields
 *                     partial chunks then throws; complete() throws too, so the
 *                     logical stream commits to the ERROR path.
 *
 * Non-vacuity (proven this task, not committed): with `isRoutingAdapter: true`
 * the engine rethrows a mid-stream error WITHOUT issuing request 2
 * (helpers.ts:354) → exactly ONE generation/ONE end → the test fails on the
 * 2-span assertions. Restored after proof.
 *
 * Design: docs/superpowers/specs/2026-09-06-langfuse-tracing-design.md (§18, §20)
 * Task: Task 24 of
 *   docs/superpowers/plans/2026-09-06-langfuse-tracing-implementation-plan.md
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EventLog } from "../../src/events/event-log.js";
import { MemoryStore } from "../../src/utils/memory/store.js";
import { ScopeTracker } from "../../src/autonomy/scope-tracker.js";
import { TaskStateMachine, RunLimiter } from "../../src/autonomy/state-machine.js";
import { createContextBudget } from "../../src/config/context-budget.js";
import { ToolExecutor } from "../../src/tools/executor.js";
import { runTaskLoop, type TaskLoopDeps } from "../../src/run/task-loop.js";
import { withProviderContracts } from "../../src/providers/provider-contract-validation.js";
import { createTraceClient } from "../../src/tracing/client-factory.js";
import type { AlixConfig } from "../../src/config/schema.js";
import type { ExecutionContext } from "../../src/observability/execution-context.js";
import type { ModelAdapter, NormalizedResponse, StreamChunk, ToolDef } from "../../src/providers/types.js";

import { FakeLangfuse, fakeRecorder, type FakeLangfuseInstance } from "./fakes/langfuse-sdk.js";

vi.mock("langfuse", () => ({ default: FakeLangfuse }));

// ---------------------------------------------------------------------------
// Harness — the T16/T20 composed seam graph (real runTaskLoop + real
// ToolExecutor + real withProviderContracts + real memoized TraceClient).
// ---------------------------------------------------------------------------

function tracingConfig(): AlixConfig["tracing"] {
  return {
    enabled: true,
    langfuse: {
      baseUrl: "http://langfuse.test:3000",
      publicKey: "pk-lf-t24-public",
      secretKey: "sk-lf-t24-secret",
    },
    capture: {
      messages: "truncated",
      reasoning: "off",
      toolInput: "truncated",
      toolOutput: "truncated",
      maxMessageChars: 4000,
      maxToolOutputChars: 2000,
    },
    flushTimeoutMs: 2000,
  };
}

function makeConfig(tmpDir: string): AlixConfig {
  return {
    version: 1,
    model: { provider: "mock", name: "mock-model" },
    permissions: {
      default: "allow",
      tools: {},
      protectedPaths: [],
      allowNetworkDomains: [],
      denyCommands: [],
      sessionMode: "auto",
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
  } as unknown as AlixConfig;
}

const FILE_READ_TOOLS: ToolDef[] = [
  { name: "alix_file_read", description: "read", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "alix_dir_search", description: "search", input_schema: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] } },
  { name: "alix_file_exists", description: "exists", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
];

const SELECTED_TOOLS = [
  { name: "alix_file_read", execName: "file.read" },
  { name: "alix_dir_search", execName: "dir.search" },
  { name: "alix_file_exists", execName: "file.exists" },
];

/**
 * Scripted STREAMING model driving the fail-soft cardinality:
 *   - request 1 (`stream()`, report 1 physical stream call): yields partial
 *     chunks — one text delta (reaches the consumer path) + one reasoning delta
 *     (private trace) — then THROWS mid-stream.
 *   - request 2 (`complete()`, report 1 physical complete call): the fail-soft
 *     fallback ALSO throws, so the logical stream commits to the ERROR path.
 * `isRoutingAdapter: false` is set explicitly so the streamToResponse guard
 * (helpers.ts:354) is exercised on its real branch (a routing adapter would
 * rethrow request 1's error without issuing request 2).
 */
function failingStreamingModel(): ModelAdapter & {
  streamCalls: number;
  completeCalls: number;
} {
  let streamCalls = 0;
  let completeCalls = 0;
  return {
    id: "mock-stream",
    capabilities: {
      provider: "mock",
      model: "mock-stream-model",
      inputTokenLimit: 100000,
      outputTokenLimit: 16384,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: false,
      supportsVision: false,
      parallelToolCalls: false,
    },
    editFormatPreference: "structured_patch",
    longContextStrategy: "trimmed_context",
    isRoutingAdapter: false,
    async *stream(): AsyncGenerator<StreamChunk> {
      streamCalls++;
      yield { type: "text_delta", text: "partial answer so far" };
      yield { type: "reasoning_delta", text: "private reasoning trail" };
      throw new Error("mid-stream stream failure");
    },
    async complete(): Promise<NormalizedResponse> {
      completeCalls++;
      throw new Error("complete fallback failure");
    },
    get streamCalls() {
      return streamCalls;
    },
    get completeCalls() {
      return completeCalls;
    },
  } as ModelAdapter & { streamCalls: number; completeCalls: number };
}

async function makeTaskLoopHarness(opts: {
  tmpRoot: string;
  sessionId: string;
  provider: ModelAdapter;
  context: ExecutionContext;
  messages: { role: "user"; content: string }[];
  maxIterations?: number;
}): Promise<TaskLoopDeps> {
  const sessionDir = join(opts.tmpRoot, ".alix", "sessions", opts.sessionId);
  await mkdir(sessionDir, { recursive: true });
  const log = new EventLog(sessionDir);
  await log.init();
  const memoryStore = new MemoryStore(join(opts.tmpRoot, "memory"));
  await memoryStore.init();
  const config = makeConfig(opts.tmpRoot);
  const executor = new ToolExecutor(config, log, opts.tmpRoot);
  const maxIterations = opts.maxIterations ?? 1;
  const scope = new ScopeTracker();
  const stateMachine = new TaskStateMachine(
    new RunLimiter({ maxIterations, maxRepairs: 3, maxFileChanges: 100, maxShellCommands: 50, maxRuntimeMs: 60000 }),
  );
  const budget = createContextBudget({ contextWindowTokens: 100000 }, {});
  return {
    config: {
      models: { default: { provider: "mock", name: "mock-stream-model", streaming: true } },
      permissions: {},
      context: {},
    } as any,
    provider: opts.provider,
    providerTools: FILE_READ_TOOLS,
    mcpToolIndex: [],
    messages: opts.messages as never,
    sessionState: {
      created: new Set<string>(),
      deleted: new Set<string>(),
      changed: new Set<string>(),
      fatalErrors: [] as string[],
      pendingScopeExpansion: false,
    },
    stateMachine,
    scope,
    context: opts.context,
    session: { sessionId: opts.sessionId, actor: "system" },
    log,
    executor,
    mcpDiscovery: null,
    selectedTools: SELECTED_TOOLS,
    hooks: {},
    maxIterations,
    contextBudget: budget,
    tokenizer: "cl100k_base",
    task: "r6 fail-soft tracing test",
    taskType: "docs",
    depth: "quick",
    memoryStore,
    sessionId: opts.sessionId,
    sessionDir,
    systemPrompt: "You are a test assistant.",
    verbose: false,
  };
}

const tmpDirs: string[] = [];
async function makeTmpRoot(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function alix(record: { body: Record<string, unknown> }): Record<string, unknown> {
  const meta = record.body.metadata as { alix: Record<string, unknown> };
  return meta.alix;
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("T24 R6 loop-level fail-soft streaming (2 physical requests → 2 model spans)", () => {
  beforeEach(() => {
    fakeRecorder.instances.length = 0;
  });

  afterEach(async () => {
    await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it(
    "mid-stream error on request 1 → request 2 (complete fallback) still issues → 2 model spans, logical outcome ERROR",
    async () => {
      const tmp = await makeTmpRoot("t24-failsoft-");
      const sessionId = "t24-s";
      const runId = "run-t24failsoft";

      const client = await createTraceClient(tracingConfig());
      const sdk: FakeLangfuseInstance = fakeRecorder.instances[0]!;
      expect(fakeRecorder.instances).toHaveLength(1);

      const run = client.startRun({
        runId,
        sessionId,
        workflowId: "wf-t24",
        task: "fail-soft streaming: partial answer then error",
        actor: "agent",
        startedAt: Date.now(),
      });

      const model = failingStreamingModel();
      const wrapped = withProviderContracts(model);
      const context: ExecutionContext = { runId, sessionId, workflowId: "wf-t24" };
      const deps = await makeTaskLoopHarness({
        tmpRoot: tmp,
        sessionId,
        provider: wrapped,
        context,
        messages: [{ role: "user", content: "produce a partial answer, then fail" }],
        maxIterations: 1,
      });

      try {
        // The logical stream commits to the ERROR path: the fail-soft fallback
        // (request 2) fails too, so streamToResponse rethrows and the loop
        // rejects with the FALLBACK's error — mirroring runTaskCore's catch →
        // endRun(status: "error") terminal.
        await expect(runTaskLoop(deps)).rejects.toThrow("complete fallback failure");
      } finally {
        await client.endRun(run, {
          status: "error",
          error: "complete fallback failure",
          endedAt: Date.now(),
        });
      }

      // ── Cardinality: BOTH physical requests issued (the R6/§20 claim) ──
      expect(model.streamCalls).toBe(1);
      expect(model.completeCalls).toBe(1);

      // ── Exactly 2 model spans under the SAME trace/run, each ended once ──
      expect(sdk.calls.traces).toHaveLength(1);
      expect(sdk.calls.traces[0]!.id).toBe(runId);
      expect(sdk.calls.generations).toHaveLength(2);
      expect(sdk.calls.generationEnds).toHaveLength(2);
      // Unguarded SDK-level counter: fail-soft means BOTH ends fired at the SDK
      // surface (a fail-hard engine would stop at one generation/one end).
      expect(sdk.rawEndCalls.generation).toBe(2);
      // Balanced — no orphan span, no double-close.
      expect(sdk.calls.generationEnds.length).toBe(sdk.calls.generations.length);

      const [gen0, gen1] = sdk.calls.generations;
      const [end0, end1] = sdk.calls.generationEnds;
      expect(gen0!.traceId).toBe(runId);
      expect(gen1!.traceId).toBe(runId);
      expect(end0!.traceId).toBe(runId);
      expect(end1!.traceId).toBe(runId);
      // Both direct children of the trace root — no invented parent links.
      for (const rec of [gen0!, gen1!]) {
        expect("parentObservationId" in rec.body).toBe(false);
      }

      // ── Span 1 = the PHYSICAL stream request that failed mid-stream ──
      const g0 = alix({ body: gen0!.body });
      expect(g0).toMatchObject({ kind: "model", provider: "mock", model: "mock-stream-model", stream: true });
      expect(gen0!.body.name).toBe("mock-stream-model");
      // The error landed on the span whose stream actually failed.
      const g0End = alix({ body: end0!.body });
      expect(g0End.status).toBe("error");
      expect(end0!.body.level).toBe("ERROR");
      expect(String(end0!.body.statusMessage)).toContain("mid-stream stream failure");
      expect(String(g0End.error)).toContain("mid-stream stream failure");
      // Error terminal drops partial output (outcomeForError carries
      // status/error/endedAt only — Task-11-approved; capture-fidelity open T25).
      expect(end0!.body.output).toBeUndefined();

      // ── Span 2 = the PHYSICAL complete fallback request that also failed ──
      const g1 = alix({ body: gen1!.body });
      expect(g1).toMatchObject({ kind: "model", provider: "mock", model: "mock-stream-model", stream: false });
      expect(gen1!.body.name).toBe("mock-stream-model");
      const g1End = alix({ body: end1!.body });
      expect(g1End.status).toBe("error");
      expect(end1!.body.level).toBe("ERROR");
      expect(String(end1!.body.statusMessage)).toContain("complete fallback failure");
      expect(String(g1End.error)).toContain("complete fallback failure");
      expect(end1!.body.output).toBeUndefined();

      // ── Run terminal: the ERROR outcome the engine commits to ──
      expect(sdk.calls.traceUpdates).toHaveLength(1);
      expect(sdk.calls.traceUpdates[0]!.id).toBe(runId);
      expect(alix({ body: sdk.calls.traceUpdates[0]!.body })).toMatchObject({
        status: "error",
      });
      expect(String(alix({ body: sdk.calls.traceUpdates[0]!.body }).error)).toContain("complete fallback failure");

      // ── Timing bracket: request 2 starts only after request 1 ended (the
      //    T16-minor end→start bracket, folded in here where this file OWNS
      //    streaming timing) + per-span endedAt >= startedAt (T17 fold-in). ──
      const g0Start = g0.startedAtMs as number;
      const g0EndAt = g0End.endedAtMs as number;
      const g1Start = g1.startedAtMs as number;
      expect(g0EndAt).toBeGreaterThanOrEqual(g0Start);
      expect(g1Start).toBeGreaterThanOrEqual(g0EndAt);
      expect(g1).toMatchObject({ startedAtMs: expect.any(Number) });

      // ── Lifecycle: one bounded flush at endRun, no shutdown ──
      expect(sdk.flushCalls).toBe(1);
      expect(sdk.shutdownCalls).toBe(0);
    },
    30000,
  );
});