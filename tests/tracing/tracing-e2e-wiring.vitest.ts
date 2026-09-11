/**
 * Task 16 — end-to-end trace wiring (design §24.4, §18, §19, §21, §24.7, §24.8).
 *
 * The full trace-wiring run against a vi.mock('@langfuse/otel') shared recorder — no network:
 *
 *     startRun → runTaskLoop [ model request → alix_file_read → model request ] → endRun
 *
 * Seams are the REAL production seams composed exactly like runTaskCore paths (R1/R3):
 *   - run root: real `createTraceClient(enabled)` → real `LangfuseTraceClient`
 *     (single memoized adapter construction), `startRun` with run/session/workflow identity
 *   - model spans: real `withProviderContracts` wrapper (design §18) around a scripted
 *     MockModel; every physical `complete()` → exactly one generation
 *   - tool span: real `ToolExecutor` (design §21); the executed tool call → exactly one span
 *   - loop: REAL `runTaskLoop` (real event-handlers + real T5 correlation)
 *
 * Assertion surface is the shared fake recorder (§24.4 "Enabled wiring test"):
 *   - exactly ONE root observation (run) with session/workflow/task metadata
 *   - exactly TWO generation observations + ONE span observation, all children of the root
 *     (parentSpanId === root.spanId on every child; no invented parent links)
 *   - identity: tool span carries toolCallId / invocationId / executionId
 *     (executionId === workflowId — T5 run-level correlation root); model spans carry
 *     provider/model/stream only — invocationId is intentionally NOT threaded at the
 *     provider seam (plan R5; Task 12 note), asserted explicitly so the gap stays visible
 *   - capture policy (truncated): model input/output + tool input/output + trace-level
 *     task reach the recorder, redaction before SDK (sk-proj key never escapes)
 *   - ordering: tool span strictly bracketed by the two model spans
 *   - exactly one bounded flush at endRun; no premature shutdown
 *   - disabled tracing → zero SDK calls end-to-end (Noop everywhere, no adapter ctor)
 *
 * Ordering constraint: the disabled scenario MUST run before the enabled one — the
 * factory memoizes the first enabled client per process; running enabled first would
 * poison the disabled scenario's "zero SDK construction" claim.
 *
 * Design: docs/superpowers/specs/2026-09-06-langfuse-tracing-design.md
 * Task: Task 16 of
 *   docs/superpowers/plans/2026-09-06-langfuse-tracing-implementation-plan.md
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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
import type {
  ModelAdapter,
  NormalizedRequest,
  NormalizedResponse,
  ToolCall,
  ToolDef,
} from "../../src/providers/types.js";

import {
  FakeLangfuseSpanProcessor,
  fakeRecorder,
  resetFakeCalls,
  alixOf,
  attrOf,
  observationsOf,
  rootSpanOf,
} from "./fakes/langfuse-sdk.js";

vi.mock("@langfuse/otel", () => ({ LangfuseSpanProcessor: FakeLangfuseSpanProcessor }));

// ---------------------------------------------------------------------------
// Harness — mirrors tests/runtime/parallel-tool-execution.vitest.ts (real
// runTaskLoop + real ToolExecutor) plus the real contract wrapper + trace root.
// ---------------------------------------------------------------------------

const SK_PROJ_KEY = `sk-proj-${"A".repeat(40)}`;

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

function tc(name: string, id: string, args: Record<string, unknown> = {}): ToolCall {
  return { id, name, args };
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

/** Scripted model: invocation 1 → one alix_file_read tool call; invocation 2 → done. */
function createScriptedModel(opts: {
  toolCallsSequence: ToolCall[][];
  responseTexts?: string[];
}): ModelAdapter & { invocations: number } {
  let invocation = 0;
  return {
    id: "mock-e2e",
    capabilities: {
      provider: "mock",
      model: "mock-e2e-model",
      inputTokenLimit: 100000,
      outputTokenLimit: 16384,
      supportsTools: true,
      supportsStreaming: false,
      supportsStructuredOutput: false,
      supportsVision: false,
      parallelToolCalls: false,
    },
    editFormatPreference: "structured_patch",
    longContextStrategy: "trimmed_context",
    async complete(req: NormalizedRequest): Promise<NormalizedResponse> {
      const idx = invocation++;
      const tcs = opts.toolCallsSequence[idx] ?? [];
      const text = opts.responseTexts?.[idx] ?? (tcs.length === 0 ? "done. Task completed." : "");
      return {
        text,
        toolCalls: tcs,
        usage: { inputTokens: 120, outputTokens: 40 },
        finishReason: tcs.length > 0 ? "tool_calls" : "stop",
      };
    },
    get invocations() {
      return invocation;
    },
  } as ModelAdapter & { invocations: number };
}

async function makeTaskLoopHarness(opts: {
  tmpRoot: string;
  sessionId: string;
  provider: ModelAdapter;
  context: ExecutionContext;
  messages: { role: "user"; content: string }[];
  maxIterations?: number;
}): Promise<{ deps: TaskLoopDeps; log: EventLog }> {
  const sessionDir = join(opts.tmpRoot, ".alix", "sessions", opts.sessionId);
  await mkdir(sessionDir, { recursive: true });
  const log = new EventLog(sessionDir);
  await log.init();
  const memoryStore = new MemoryStore(join(opts.tmpRoot, "memory"));
  await memoryStore.init();
  const config = makeConfig(opts.tmpRoot);
  const executor = new ToolExecutor(config, log, opts.tmpRoot);
  const maxIterations = opts.maxIterations ?? 3;
  const scope = new ScopeTracker();
  const stateMachine = new TaskStateMachine(
    new RunLimiter({ maxIterations, maxRepairs: 3, maxFileChanges: 100, maxShellCommands: 50, maxRuntimeMs: 60000 }),
  );
  const budget = createContextBudget({ contextWindowTokens: 100000 }, {});
  const deps: TaskLoopDeps = {
    config: { models: { default: { provider: "mock", name: "mock-e2e-model" } }, permissions: {}, context: {} } as any,
    provider: opts.provider,
    providerTools: FILE_READ_TOOLS,
    mcpToolIndex: [],
    messages: opts.messages as any,
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
    task: "trace wiring test",
    taskType: "docs",
    depth: "quick",
    memoryStore,
    sessionId: opts.sessionId,
    sessionDir,
    systemPrompt: "You are a test assistant.",
    verbose: false,
  };
  return { deps, log };
}

const tmpDirs: string[] = [];
async function makeTmpRoot(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function tracingConfig(): AlixConfig["tracing"] {
  return {
    enabled: true,
    langfuse: {
      baseUrl: "http://langfuse.test:3000",
      publicKey: "pk-lf-test-public",
      secretKey: "sk-lf-test-secret",
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("T16 end-to-end trace wiring", () => {
  beforeEach(() => {
    fakeRecorder.instances.length = 0;
  });

  afterEach(async () => {
    await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  // MUST run before the enabled scenario (factory memoizes the first enabled client).
  it("disabled tracing → zero SDK construction and zero SDK calls across every seam", async () => {
    const tmp = await makeTmpRoot("t16-disabled-");
    await writeFile(join(tmp, "a.txt"), "hello a", "utf8");
    const sessionId = "t16-disabled";
    const context: ExecutionContext = { runId: "run-disabled", sessionId, workflowId: "wf-disabled" };

    const client = await createTraceClient(undefined);
    const run = client.startRun({ runId: "run-disabled", sessionId, workflowId: "wf-disabled", task: "no-op", actor: "agent", startedAt: Date.now() });

    const model = createScriptedModel({ toolCallsSequence: [[tc("alix_file_read", "tc-1", { path: "a.txt" })], []], responseTexts: ["", "done"] });
    const wrapped = withProviderContracts(model);
    const { deps } = await makeTaskLoopHarness({ tmpRoot: tmp, sessionId, provider: wrapped, context, messages: [{ role: "user", content: "read a.txt" }] });

    await runTaskLoop(deps);
    await client.endRun(run, { status: "success", endedAt: Date.now() });

    // The disabled path never constructs the adapter — the Langfuse module graph
    // stays un-evaluated (factory lazy-load) and every seam resolves the Noop.
    expect(fakeRecorder.instances).toHaveLength(0);
    expect(model.invocations).toBeGreaterThanOrEqual(1);
  });

  it("one run → exactly one trace with two model spans + one tool span in the same trace, correct identity + capture + ordering", async () => {
    const tmp = await makeTmpRoot("t16-wiring-");
    // File whose content the tool will read back; carries a fake secret to prove
    // mandatory redaction reaches the SDK at the tool-output seam.
    await writeFile(join(tmp, "a.txt"), `trace payload v1\n${SK_PROJ_KEY}\n`, "utf8");

    const sessionId = "e2e-trace";
    const workflowId = "wf-e2e-trace";
    const task = `Read a.txt and report the payload facts. Auth: ${SK_PROJ_KEY}`;
    const context: ExecutionContext = { runId: "run-t16e2e", sessionId, workflowId };

    // ── Run root (mirrors runTaskCore: createTraceClient -> startRun -> loops -> endRun) ──
    const client = await createTraceClient(tracingConfig());
    const run = client.startRun({
      runId: "run-t16e2e",
      sessionId,
      workflowId,
      task,
      actor: "agent",
      startedAt: Date.now(),
    });

    // Scenario delta baseline — the memoized adapter is one shared instance.
    const proc = fakeRecorder.instances[fakeRecorder.instances.length - 1]!;
    resetFakeCalls(proc);

    try {
      const model = createScriptedModel({
        toolCallsSequence: [[tc("alix_file_read", "tc-e2e", { path: "a.txt" })], []],
        responseTexts: ["", "Task complete. Final answer: the payload is trace payload v1."],
      });
      const wrapped = withProviderContracts(model);
      const { deps } = await makeTaskLoopHarness({
        tmpRoot: tmp,
        sessionId,
        provider: wrapped,
        context,
        messages: [{ role: "user", content: task }],
        // Two model requests total (**the §24.4 scenario**): the loop forces a
        // synthesis re-prompt after tool use only while i < maxIterations-1, so a
        // 3-iteration harness would add a third complete() call. With 2, the
        // done-signaling final answer terminates the loop on its own iteration.
        maxIterations: 2,
      });

      await runTaskLoop(deps);
      expect(model.invocations).toBe(2);
    } finally {
      await client.endRun(run, { status: "success", endedAt: Date.now() });
    }

    // ── 1. Exactly ONE root observation (design §14: one runId → one trace) ──
    const root = rootSpanOf(proc, "run-t16e2e")!;
    expect(root).toBeDefined();
    // Trace-level task capture (M1) — the adapter names the root with the
    // captured (redacted) task before it reaches the SDK.
    expect(String(root.name)).toContain("<redacted>");
    expect(String(root.name)).not.toContain(SK_PROJ_KEY);
    expect(String(alixOf(root).task)).toContain("<redacted>");
    expect(String(alixOf(root).task)).not.toContain(SK_PROJ_KEY);
    expect(alixOf(root).sessionId).toBe(sessionId);
    expect(alixOf(root)).toMatchObject({
      kind: "run",
      runId: "run-t16e2e",
      sessionId,
      workflowId,
      actor: "agent",
    });

    // ── 2. Exactly two generations + one span, all children of the root ──
    const obs = observationsOf(proc, "run-t16e2e");
    const generations = obs.filter((s) => alixOf(s).kind === "model");
    const toolSpans = obs.filter((s) => alixOf(s).kind === "tool");
    expect(generations).toHaveLength(2);
    expect(toolSpans).toHaveLength(1);
    // root + 2 generations + 1 tool span
    expect(obs).toHaveLength(4);
    // Every child is a direct child of the root — no invented parent links,
    // no cross-span parentage (design §21: parent never inferred from order).
    for (const child of obs.filter((s) => s !== root)) {
      expect(child.parentSpanId).toBe(root.spanId);
    }
    // endRun finalized the run exactly once; one bounded flush (T13), zero shutdown.
    expect(alixOf(root)).toMatchObject({ kind: "run", runId: "run-t16e2e", status: "success" });
    expect(proc.flushCalls).toBe(1);
    expect(proc.shutdownCalls).toBe(0);

    // ── 3. Generations: provider/model labels, capture, status ──
    const [gen0, gen1] = generations;
    for (const gen of generations) {
      expect(gen.name).toBe("mock-e2e-model");
      expect(attrOf(gen, "model.name")).toBe("mock-e2e-model");
      const g = alixOf(gen);
      expect(g).toMatchObject({ kind: "model", provider: "mock", stream: false });
      // Model-input capture (M1) — the user message (task) is captured, redacted.
      const input = attrOf(gen, "input") as Array<{ role: string; content: string }>;
      expect(input[0]).toMatchObject({ role: "user" });
      const firstContent = (input[0] as { content: string }).content;
      expect(firstContent).toContain("<redacted>");
      expect(firstContent).not.toContain(SK_PROJ_KEY);
      // invocationId is NOT threaded at the provider seam (plan R5 — left unset by
      // Task 11; model spans carry provider/model/stream only). Asserted explicitly
      // so this plan-sanctioned gap stays visible rather than silently drifting.
      expect(alixOf(gen).invocationId).toBeUndefined();
    }
    // Generation output + per-span terminal status.
    expect(attrOf(gen0, "output")).toBe("");
    expect(String(attrOf(gen1, "output"))).toContain("Final answer");
    expect(alixOf(gen0)).toMatchObject({ status: "success", finishReason: "tool_calls" });
    expect(alixOf(gen1)).toMatchObject({ status: "success", finishReason: "stop" });
    // usage reached the recorder (inputTokens/outputTokens from the normalized response).
    expect(attrOf(gen0, "usage_details")).toMatchObject({ input: 120, output: 40 });
    // reasoning capture is off → no reasoning field.
    expect(alixOf(gen0).reasoning).toBeUndefined();

    // ── 4. Tool span: identity + capture ──
    const span = toolSpans[0]!;
    expect(span.name).toBe("file.read");
    const spanInput = attrOf(span, "input") as Record<string, unknown>;
    expect(spanInput).toEqual({ path: "a.txt" });
    expect(alixOf(span)).toMatchObject({
      kind: "tool",
      toolName: "file.read",
      capability: "file.read",
      toolCallId: "tc-e2e",
    });
    expect(alixOf(span).invocationId).toMatch(/^inv-/);
    // T5 run-level correlation root: executionId === workflowId (deps.context).
    expect(alixOf(span).executionId).toBe(workflowId);
    // Tool-output capture (M2), real file read result, redacted before the SDK.
    expect(alixOf(span).status).toBe("success");
    const spanOutput = String(attrOf(span, "output"));
    expect(spanOutput).toContain("trace payload v1");
    expect(spanOutput).toContain("<redacted>");
    expect(spanOutput).not.toContain(SK_PROJ_KEY);

    // ── 5. Ordering: tool span strictly bracketed by the two model spans ──
    expect(span.startTimeMs).toBeGreaterThanOrEqual(gen0.startTimeMs);
    expect(gen1.startTimeMs).toBeGreaterThanOrEqual(span.startTimeMs);
    expect(gen1.startTimeMs).toBeGreaterThanOrEqual(gen0.startTimeMs);

    // ── 6. Every observation ended (exactly-once invariant proof) ──
    for (const s of obs) {
      expect(s.endTimeMs).toBeGreaterThan(0);
    }
  });
});
