/**
 * Task 20 — disabled & misconfigured regression guards (design §24.5-24.6).
 *
 * Guards, at the RUN level (real composed `runTaskLoop` + real provider/tool
 * seams + real memoized factory), the two default-state contracts that the
 * factory unit tests (tests/tracing/client-factory.vitest.ts) and the T15
 * fail-open matrix assert one layer up. This file's new value is
 * behind-the-surface proof THROUGH a full composed run, not the factory-level
 * decision logic:
 *
 *   disabled (`enabled=false` / absent / `undefined` config)
 *     → `createTraceClient` resolves to the frozen `NOOP_TRACE_CLIENT`
 *       singleton (`instanceof NoopTraceClient`, not merely "zero instances"),
 *       and a FULL composed run:
 *       - constructs ZERO Langfuse SDK instances (shared fake recorder empty)
 *       - never EVALUATES the @langfuse/otel module graph (module-load probes)
 *       - never resolves a credential (resolveCredential spy + untouched refs)
 *       - performs ZERO tracing network activity (no SDK object exists to
 *         own a transport; the Noop is a pure local object)
 *
 *   misconfigured (`enabled=true` + leftover unresolved `cred://` refs — the
 *     exact shape `loadConfig` produces when the credential store lacks the
 *     keys; see tests/config/tracing.vitest.ts "fail-open: missing credential
 *     never fails config load")
 *     → the construction-failure `warnOnce` fires exactly once, the result
 *       falls back to the Noop singleton, and a FULL composed run completes
 *       with an outcome byte-identical to a no-tracing control.
 *
 *   enabled control (sanity — proves the probes are live, so the disabled
 *     asserts are NOT vacuous on a harness that disables everything)
 *     → the SAME assertions flipped: an enabled+good run DOES evaluate the SDK
 *       module graph (once), construct one instance, and emit a trace.
 *
 * Probes — the strongest observable at each seam (each documented honestly):
 *   - Module-evaluation counters inside per-scenario `vi.doMock` factories. The
 *     `@langfuse/otel` doMock factory runs exactly when the SDK's processor
 *     module is imported; the `langfuse-client` doMock factory runs when the
 *     adapter
 *     module is imported. Both stay 0 across importing the ENTIRE run-loop graph
 *     and running a full disabled run; both go to 1 exactly in the scenario
 *     where the enabled branch of `createTraceClient` fires its dynamic
 *     `import()`. Because `vi.doMock` factories re-run on every fresh import
 *     domain (unlike `vi.mock`, which caches the factory result per file), the
 *     counters are truthful PER SCENARIO even when the adapter was evaluated by
 *     an earlier scenario. This is the direct observable of the Task 10
 *     lazy-load guarantee (client-factory.ts has NO static import of the
 *     adapter; a T10 regression — any static import of `langfuse-client.js`
 *     anywhere in the harness graph — bumps the counters at loadSeams time,
 *     before any run starts).
 *       CEILING: a doMock factory counter counts module *evaluations per
 *     reset domain*, not per-branch dispatch. That is sufficient here: on the
 *     disabled path the only thing that could evaluate the SDK graph is a
 *     static import (the T10 regression), and the counters prove it stays
 *     unevaluated in every disabled domain.
 *   - Credential resolution: `resolveCredential`
 *     (src/security/credentials/credential-reference.ts) is the function the
 *     tracing keys would flow through, but resolution lives UPSTREAM of
 *     `createTraceClient` — in `loadConfig` (loader.ts resolveTracingCredentials,
 *     gated on `enabled === true`). That loader gate has its own coverage
 *     (tests/config/tracing.vitest.ts "does NOT resolve credentials when
 *     tracing is disabled"), which this file does NOT duplicate. Here we prove
 *     the run-level half: a disabled run seeded with `cred://` references never
 *     calls `resolveCredential` (spy) and never mutates the references. NOTE:
 *     the credential-reference module itself IS part of the run-loop graph
 *     (task-loop → skills/dispatcher → skills/factory → cli/helpers/api-keys),
 *     so a module-evaluation probe would be polluted by non-tracing harness
 *     machinery — a call-spy is the honest observable, not module absence.
 *   - Zero network: NoopTraceClient has no transport by construction
 *     (noop-client.ts). At run level the fake SDK recorder holds ZERO instances
 *     after the full run, so there is literally no transport object that
 *     flushAsync / shutdownAsync / generation / span could have executed on.
 *
 * NOT duplicated (reused instead): factory-level Noop/warn/cred-failure asserts
 * (tests/tracing/client-factory.vitest.ts — incl. the "never evaluates the
 * @langfuse/otel module graph" factory-scope probe), the E2E zero-instances
 * assert (tests/tracing/tracing-e2e-wiring.vitest.ts :441-454), the fail-open
 * matrix (T15: langfuse-client.vitest.ts + noop-client.vitest.ts + the run-CLI
 * outcome-unchanged test), and the loader credential gate
 * (tests/config/tracing.vitest.ts :224-250).
 *
 * Isolation: every scenario re-imports the seam graph fresh (vi.resetModules,
 * like client-factory.vitest.ts's loadFactory) so the module-level selection
 * memo and the warn-once registry are clean per scenario — the misconfigured
 * Noop-fallback memo can never poison the enabled control and vice versa. The
 * seam modules that statically import the factory
 * (provider-contract-validation.ts, tools/executor.ts) are re-imported with it
 * so their `getProcessTraceClient` observes the same fresh memo.
 *
 * Design: docs/superpowers/specs/2026-09-06-langfuse-tracing-design.md
 * Task: Task 20 of
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
import type { AlixConfig } from "../../src/config/schema.js";
import type { ExecutionContext } from "../../src/observability/execution-context.js";
import type {
  ModelAdapter,
  NormalizedRequest,
  NormalizedResponse,
  ToolCall,
  ToolDef,
} from "../../src/providers/types.js";
import type { RunResult } from "../../src/run.js";
import type { TaskLoopDeps } from "../../src/run/task-loop.js";
import type { TraceClient } from "../../src/tracing/client.js";
import type * as NoopNamespace from "../../src/tracing/noop-client.js";

import {
  FakeLangfuseSpanProcessor,
  alixOf,
  attrOf,
  fakeRecorder,
  observationsOf,
  resetFakeCalls,
  rootSpanOf,
} from "./fakes/langfuse-sdk.js";

// Hoisted module-evaluation probes. The probe object is shared with the
// per-scenario `vi.doMock` factories installed by installProbes() (see below);
// it cannot live in a normal binding because the factories resolve lazily.
const probe = vi.hoisted(() => ({
  otelModuleEvaluations: 0,
  adapterModuleEvaluations: 0,
}));

// Per-scenario probe installation. `vi.doMock` (unlike `vi.mock`) registers a
// factory SHARED across one test only — it is cleared at test teardown and,
// crucially, it re-runs every time the mocked module is (re)imported inside a
// fresh reset domain. This makes the counters per-scenario-truthful even when
// several reset domains happen in one test: the "langfuse" factory runs exactly
// when the SDK module graph is imported in THAT domain, the langfuse-client
// factory runs when the adapter module is imported in THAT domain, and a
// disabled domain (which never imports either) leaves both at 0 regardless of
// what earlier domains did.
function installProbes() {
  vi.doMock("@langfuse/otel", () => {
    probe.otelModuleEvaluations += 1;
    return { LangfuseSpanProcessor: FakeLangfuseSpanProcessor };
  });
  vi.doMock("../../src/tracing/langfuse-client.js", async (importOriginal) => {
    probe.adapterModuleEvaluations += 1;
    const actual =
      await importOriginal<typeof import("../../src/tracing/langfuse-client.js")>();
    return actual;
  });
}

// ---------------------------------------------------------------------------
// Fresh seam loading — one reset domain per scenario (fresh factory memo +
// fresh warn-once registry + fresh seams so getProcessTraceClient sees the memo)
// ---------------------------------------------------------------------------

const tracingFactory = () => import("../../src/tracing/client-factory.js");
const noopModule = () => import("../../src/tracing/noop-client.js");
const pcvModule = () => import("../../src/providers/provider-contract-validation.js");
const execModule = () => import("../../src/tools/executor.js");
const taskLoopModule = () => import("../../src/run/task-loop.js");

async function loadSeams() {
  vi.resetModules();
  installProbes();
  const factory = await tracingFactory();
  const noop = await noopModule();
  const pcv = await pcvModule();
  const exec = await execModule();
  const taskLoop = await taskLoopModule();
  return { factory, noop, pcv, exec, taskLoop };
}

type Seams = Awaited<ReturnType<typeof loadSeams>>;

// ---------------------------------------------------------------------------
// Fixtures + harness — mirrors tests/tracing/tracing-e2e-wiring.vitest.ts
// (real runTaskLoop + real ToolExecutor + real contract wrapper) so the trace
// wiring actually executes through the production seams.
// ---------------------------------------------------------------------------

function tracingConfig(over?: {
  enabled?: boolean;
  baseUrl?: string;
  publicKey?: string;
  secretKey?: string;
}): Exclude<AlixConfig["tracing"], undefined> {
  return {
    enabled: over?.enabled ?? true,
    langfuse: {
      baseUrl: over?.baseUrl ?? "https://cloud.langfuse.com",
      publicKey: over?.publicKey ?? "pk-lf-test-public-key",
      secretKey: over?.secretKey ?? "sk-lf-test-secret-key",
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

async function makeTaskLoopHarness(
  seams: Seams,
  opts: {
    tmpRoot: string;
    sessionId: string;
    provider: ModelAdapter;
    context: ExecutionContext;
    messages: { role: "user"; content: string }[];
    maxIterations?: number;
  },
): Promise<{ deps: TaskLoopDeps; log: EventLog }> {
  const sessionDir = join(opts.tmpRoot, ".alix", "sessions", opts.sessionId);
  await mkdir(sessionDir, { recursive: true });
  const log = new EventLog(sessionDir);
  await log.init();
  const memoryStore = new MemoryStore(join(opts.tmpRoot, "memory"));
  await memoryStore.init();
  const config = makeConfig(opts.tmpRoot);
  const executor = new seams.exec.ToolExecutor(config, log, opts.tmpRoot);
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
    task: "tracing regression test",
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

function stubWarn() {
  return vi.spyOn(console, "warn").mockImplementation(() => {});
}

/** Freshly import the credential-reference module in the CURRENT reset domain and spy on resolveCredential. */
async function spyResolveCredential() {
  const mod = await import("../../src/security/credentials/credential-reference.js");
  return { resolveSpy: vi.spyOn(mod, "resolveCredential") };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("T20 disabled + misconfigured regression guards", () => {
  beforeEach(() => {
    fakeRecorder.instances.length = 0;
    probe.otelModuleEvaluations = 0;
    probe.adapterModuleEvaluations = 0;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  // -------------------------------------------------------------------------
  // Disabled
  // -------------------------------------------------------------------------

  it("enabled=false: a full composed run resolves the Noop singleton with zero SDK construction, zero module evaluation, zero credential resolution, zero network", async () => {
    const seams = await loadSeams();
    const warn = stubWarn();
    const { resolveSpy } = await spyResolveCredential();

    // Even importing the ENTIRE run-loop seam graph evaluates neither the
    // adapter nor the @langfuse/otel module (Task 10 lazy-load guarantee).
    expect(probe.otelModuleEvaluations).toBe(0);
    expect(probe.adapterModuleEvaluations).toBe(0);

    // The disabled config still carries unresolved store refs (the loader
    // default shape). Factory must resolve to the Noop singleton WITHOUT
    // reading the keys, resolving a credential, or warning.
    const config = tracingConfig({
      enabled: false,
      publicKey: "cred://langfuse/publicKey",
      secretKey: "cred://langfuse/secretKey",
    });
    const client = await seams.factory.createTraceClient(config);

    expect(client).toBe(seams.noop.NOOP_TRACE_CLIENT);
    expect(client).toBeInstanceOf(seams.noop.NoopTraceClient);
    expect(warn).not.toHaveBeenCalled();
    // Credential resolution never fired, and the refs were left untouched.
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(config.langfuse.publicKey).toBe("cred://langfuse/publicKey");
    expect(config.langfuse.secretKey).toBe("cred://langfuse/secretKey");

    // ── Full composed run through the Noop (real runTaskLoop + real seams) ──
    const tmp = await makeTmpRoot("t20-disabled-");
    await writeFile(join(tmp, "a.txt"), "trace payload v1\n", "utf8");
    const sessionId = "t20-disabled";
    const runId = "run-t20disabled";
    const context: ExecutionContext = { runId, sessionId, workflowId: "wf-t20disabled" };
    const run = client.startRun({
      runId,
      sessionId,
      workflowId: "wf-t20disabled",
      task: "disabled regression run",
      actor: "agent",
      startedAt: Date.now(),
    });
    const model = createScriptedModel({
      toolCallsSequence: [[tc("alix_file_read", "tc-1", { path: "a.txt" })], []],
      responseTexts: ["", "Task complete."],
    });
    const wrapped = seams.pcv.withProviderContracts(model as ModelAdapter);
    const { deps } = await makeTaskLoopHarness(seams, {
      tmpRoot: tmp,
      sessionId,
      provider: wrapped,
      context,
      messages: [{ role: "user", content: "read a.txt" }],
      maxIterations: 2,
    });

    const result = await seams.taskLoop.runTaskLoop(deps);
    await client.endRun(run, { status: "success", endedAt: Date.now() });
    // Noop lifecycle is zero-cost: flush/shutdown resolve with no transport work.
    await client.flush();
    await client.shutdown();

    // The run genuinely executed (2 physical model requests + 1 tool call).
    expect(result).toBeDefined();
    expect(model.invocations).toBe(2);

    // ZERO SDK construction / module evaluation / credential resolution /
    // network activity across the entire run:
    expect(fakeRecorder.instances).toHaveLength(0);
    expect(probe.otelModuleEvaluations).toBe(0);
    expect(probe.adapterModuleEvaluations).toBe(0);
    expect(resolveSpy).not.toHaveBeenCalled();
    // The Noop has no transport by construction — no SDK object ever existed,
    // so flushAsync/shutdownAsync/generation/span could not have fired.
    expect(config.langfuse.publicKey).toBe("cred://langfuse/publicKey");
    expect(config.langfuse.secretKey).toBe("cred://langfuse/secretKey");
    // The factory's disabled path never warns.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  }, 30000); // flake headroom: full seam graph transforms+executes in this one test (T20 review)

  it("config absent / undefined / enabled not true all resolve the same frozen Noop singleton with zero SDK evaluation", async () => {
    const seams = await loadSeams();
    const warn = stubWarn();

    await expect(seams.factory.createTraceClient(undefined)).resolves.toBe(seams.noop.NOOP_TRACE_CLIENT);
    await expect(seams.factory.createTraceClient({} as AlixConfig["tracing"])).resolves.toBe(seams.noop.NOOP_TRACE_CLIENT);
    await expect(
      seams.factory.createTraceClient(tracingConfig({ enabled: false })),
    ).resolves.toBe(seams.noop.NOOP_TRACE_CLIENT);

    expect(probe.otelModuleEvaluations).toBe(0);
    expect(probe.adapterModuleEvaluations).toBe(0);
    expect(fakeRecorder.instances).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("disabled: the returned Noop IS a NoopTraceClient (instanceof) and callable as a pure local object", async () => {
    const seams = await loadSeams();

    const client = await seams.factory.createTraceClient(tracingConfig({ enabled: false }));
    expect(client).toBeInstanceOf(seams.noop.NoopTraceClient);

    const run = client.startRun({ runId: "run-noop", actor: "agent", startedAt: Date.now() });
    const span = client.startModelSpan(run, { provider: "mock", model: "m", stream: false } as never);
    client.endSpan(span, { status: "success", startedAtMs: 0, endedAtMs: 1 } as never);
    await client.endRun(run, { status: "success", endedAt: Date.now() });

    // Still nothing constructed or evaluated — the calls were pure local no-ops.
    expect(fakeRecorder.instances).toHaveLength(0);
    expect(probe.otelModuleEvaluations).toBe(0);
    expect(probe.adapterModuleEvaluations).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Misconfigured (enabled=true + bad credentials) — fail-open at the run level
  // -------------------------------------------------------------------------

  it("enabled=true + unresolved cred refs: warn once, Noop fallback, full run outcome byte-identical to a no-tracing control", async () => {
    // Two full composed runs (control + misconfigured) in one test: same seam-graph
    // transform/execute exposure as the disabled full-run scenario (flake headroom).
    // The two runs share IDENTICAL run identity (separate tmp dirs, no file
    // collision) so the outcome projection is comparable: the only variable is
    // the tracing config. The run's identity strings reach the tokenized system
    // prompt via the rotation supplement, so differing session/run ids would
    // corrupt the token-derived pressure numbers with run-identity noise.
    const sharedIdentity = "t20-outcome-control";
    // ── plain control: no tracing config at all ──
    const plain = await composeRegressionRun(undefined, sharedIdentity, sharedIdentity);
    // ── misconfigured: enabled=true with leftover cred:// refs (the exact
    //    loader-leaves-behind shape; store lacks the keys) ──
    const misconf = await composeRegressionRun(
      tracingConfig({
        enabled: true,
        baseUrl: "http://langfuse.test:4000",
        publicKey: "cred://langfuse/publicKey",
        secretKey: "cred://langfuse/secretKey",
      }),
      sharedIdentity,
      sharedIdentity,
    );

    // Construction-failure warn fired exactly once (warn-once key contract:
    // CONSTRUCTION_WARN_KEY in client-factory.ts dedupes across variants).
    expect(misconf.warnCalls).toHaveLength(1);
    expect(misconf.warnCalls[0]).toContain("Langfuse tracing disabled for this process");
    // Fail-open selected the Noop singleton (instanceof, not identity-only).
    expect(misconf.client).toBe(misconf.noop.NOOP_TRACE_CLIENT);
    expect(misconf.client).toBeInstanceOf(misconf.noop.NoopTraceClient);
    // Zero SDK objects were ever constructed on the misconfigured path.
    expect(fakeRecorder.instances).toHaveLength(0);

    // The agent outcome is byte-identical to the no-tracing control. RunResult
    // carries per-run identity (sessionId/runId), so compare the deterministic
    // outcome projection: summary, reason, pressure, and any overflow.
    expect(stableOutcome(misconf.result)).toEqual(stableOutcome(plain.result));
    expect(misconf.modelInvocations).toBe(plain.modelInvocations);

    // composeRegressionRun re-calls the factory with the same (memoized)
    // selection after the run: a single warn proves construction failure was
    // warned exactly once and the memo re-selects the Noop without re-warning.
    expect(misconf.warnCalls).toHaveLength(1);
  }, 30000); // flake headroom: two full composed runs in one test (T20 review)

  // -------------------------------------------------------------------------
  // Misconfigured (enabled=true + SDK construction throws) — fail-open
  // -------------------------------------------------------------------------

  it("enabled=true + LangfuseSpanProcessor construction throws: module-level @langfuse/otel doMock → Noop + warn once, repeated call does not re-warn", async () => {
    // Fresh import domain with @langfuse/otel mocked to throw AT MODULE
    // EVALUATION: the enabled branch's dynamic import() of the adapter then
    // fails before any LangfuseSpanProcessor can be constructed, exercising
    // the same factory construction-failure contract as the config-validation
    // throw (warn once → frozen Noop singleton, never rejects).
    // NOTE: installProbes' pass-through mock of the adapter must be unwound
    // FIRST — vitest keeps the transformed mock module across resetModules, so
    // without unmocking both probed ids the previous scenario's cached export
    // map silently shadows this throw re-mock and the "enabled" branch would
    // construct normally instead of failing.
    vi.doUnmock("../../src/tracing/langfuse-client.js");
    vi.doUnmock("@langfuse/otel");
    vi.resetModules();
    vi.doMock("@langfuse/otel", () => {
      throw new Error("boom");
    });
    const factory = await import("../../src/tracing/client-factory.js");
    const noop = await import("../../src/tracing/noop-client.js");
    const warn = stubWarn();

    const config = tracingConfig({ enabled: true });
    const first = await factory.createTraceClient(config);

    expect(first).toBe(noop.NOOP_TRACE_CLIENT);
    expect(first).toBeInstanceOf(noop.NoopTraceClient);
    expect(fakeRecorder.instances).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Langfuse tracing disabled for this process"),
    );

    // Memoized selection: repeated calls reuse the Noop fallback without a
    // re-warn or a re-attempt.
    const second = await factory.createTraceClient(config);
    expect(second).toBe(noop.NOOP_TRACE_CLIENT);
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
    vi.doUnmock("@langfuse/otel");
    vi.doUnmock("../../src/tracing/langfuse-client.js");
    vi.resetModules();
  });

  // -------------------------------------------------------------------------
  // Enabled control (sanity — proves the probes are live, asserts not vacuous)
  // -------------------------------------------------------------------------

  it("enabled+good control: the SAME probes flipped — SDK module evaluated once, one instance, one trace with model spans, one flush", async () => {
    const seams = await loadSeams();

    // Importing the seam graph alone still evaluates nothing.
    expect(probe.otelModuleEvaluations).toBe(0);
    expect(probe.adapterModuleEvaluations).toBe(0);
    expect(fakeRecorder.instances).toHaveLength(0);

    const config = tracingConfig({ enabled: true });
    const client = await seams.factory.createTraceClient(config);

    // The enabled branch fired the dynamic import exactly once.
    expect(probe.adapterModuleEvaluations).toBe(1);
    expect(probe.otelModuleEvaluations).toBe(1);
    expect(client).toBeInstanceOf((await import("../../src/tracing/langfuse-client.js")).LangfuseTraceClient);
    expect(fakeRecorder.instances).toHaveLength(1);
    const proc = fakeRecorder.instances[0]!;
    resetFakeCalls(proc);

    // ── full composed run ──
    const tmp = await makeTmpRoot("t20-enabled-");
    await writeFile(join(tmp, "a.txt"), "trace payload v1\n", "utf8");
    const sessionId = "t20-enabled";
    const runId = "run-t20enabled";
    const context: ExecutionContext = { runId, sessionId, workflowId: "wf-t20enabled" };
    const run = client.startRun({
      runId,
      sessionId,
      workflowId: "wf-t20enabled",
      task: "enabled control run",
      actor: "agent",
      startedAt: Date.now(),
    });
    const model = createScriptedModel({
      toolCallsSequence: [[tc("alix_file_read", "tc-1", { path: "a.txt" })], []],
      responseTexts: ["", "Task complete."],
    });
    const wrapped = seams.pcv.withProviderContracts(model as ModelAdapter);
    const { deps } = await makeTaskLoopHarness(seams, {
      tmpRoot: tmp,
      sessionId,
      provider: wrapped,
      context,
      messages: [{ role: "user", content: "read a.txt" }],
      maxIterations: 2,
    });

    const result = await seams.taskLoop.runTaskLoop(deps);
    await client.endRun(run, { status: "success", endedAt: Date.now() });

    expect(result).toBeDefined();
    expect(model.invocations).toBe(2);

    // The disabled asserts flipped: ONE processor instance, ONE trace (root +
    // 2 model generations + 1 tool span, every observation ended exactly once),
    // ONE bounded flush, no shutdown.
    const root = rootSpanOf(proc, runId);
    expect(root).toBeDefined();
    expect(root!.parentSpanId).toBe(undefined);
    expect((alixOf(root!) as { runId?: unknown }).runId).toBe(runId);
    expect((alixOf(root!) as { status?: unknown }).status).toBe("success");
    // OTel ended status: 1 = OK (2 = ERROR). The run carries no level attribute
    // (level/statusMessage live on model + tool observations), so the OTel
    // status.code is the root's ended-state observable.
    expect(root!.status.code).toBe(1);
    const all = observationsOf(proc, runId);
    expect(all).toHaveLength(4);
    expect(all.every((s) => s.endTimeMs > 0)).toBe(true);
    expect(all.filter((s) => attrOf(s, "type") === "generation")).toHaveLength(2);
    const toolSpans = all.filter(
      (s) => attrOf(s, "type") === "span" && s.parentSpanId !== undefined,
    );
    expect(toolSpans).toHaveLength(1);
    // Tool spans are named by the executed tool's execName (v5 convention,
    // matching tracing-e2e-wiring.vitest.ts :404).
    expect(toolSpans[0]!.name).toBe("file.read");
    expect(proc.flushCalls).toBe(1);
    expect(proc.shutdownCalls).toBe(0);
  }, 30000); // flake headroom: full seam graph transforms+executes in this one test (T20 review)
});

/**
 * Deterministic outcome projection of a RunResult. Excludes per-run identity
 * (sessionId/runId) AND the token-derived pressure bookkeeping
 * (remaining-token counts), which carry timing noise from the progress ledger
 * (elapsed-duration rendering) rather than outcome signal. The compared
 * structure — summary, streamed, reason, overflow, iteration counts, and which
 * context-pressure tiers dropped at which iteration — is the byte-identical
 * outcome the "fail-open changes nothing" contract promises; the token counts
 * would legitimately differ by a few tokens across two otherwise-identical
 * runs purely from ledger timestamps.
 */
function stableOutcome(r: RunResult) {
  const p = r.contextPressure;
  return {
    summary: r.summary,
    streamed: r.streamed,
    reason: r.reason,
    contextBudgetOverflow: r.contextBudgetOverflow,
    contextPressure: p && {
      aggregate: {
        tier4Dropped: p.aggregate.tier4Dropped,
        tier5Dropped: p.aggregate.tier5Dropped,
        tier6Dropped: p.aggregate.tier6Dropped,
      },
      peak: {
        iteration: p.peak.iteration,
        tier4Dropped: p.peak.tier4Dropped,
        tier5Dropped: p.peak.tier5Dropped,
        tier6Dropped: p.peak.tier6Dropped,
      },
      totalIterations: p.totalIterations,
    },
  };
}

/**
 * One full composed regression run: fresh seams, scripted model (tool_calls →
 * final answer), real runTaskLoop. Returns the RunResult + the trace-client +
 * warn observations for outcome-unchanged comparisons.
 */
async function composeRegressionRun(
  tracing: AlixConfig["tracing"] | undefined,
  sessionId: string,
  runId: string,
): Promise<{
  client: TraceClient;
  noop: typeof NoopNamespace;
  result: RunResult;
  modelInvocations: number;
  warnCalls: string[];
}> {
  const seams = await loadSeams();
  const warn = stubWarn();
  const warnCalls: string[] = [];
  const recordWarns = () => {
    warnCalls.push(...warn.mock.calls.map((c) => String(c[0])));
    warn.mockClear();
  };

  const config = tracing;
  const client = await seams.factory.createTraceClient(config);
  recordWarns();
  const run = client.startRun({
    runId,
    sessionId,
    workflowId: `wf-${sessionId}`,
    task: "regression control",
    actor: "agent",
    startedAt: Date.now(),
  });
  const context: ExecutionContext = { runId, sessionId, workflowId: `wf-${sessionId}` };

  const tmp = await makeTmpRoot(sessionId.includes("-") ? `t20-${sessionId.replace(/^t20-/, "")}-` : "t20-run-");
  await writeFile(join(tmp, "a.txt"), "trace payload v1\n", "utf8");
  const model = createScriptedModel({
    toolCallsSequence: [[tc("alix_file_read", "tc-1", { path: "a.txt" })], []],
    responseTexts: ["", "Task complete."],
  });
  const wrapped = seams.pcv.withProviderContracts(model as ModelAdapter);
  const { deps } = await makeTaskLoopHarness(seams, {
    tmpRoot: tmp,
    sessionId,
    provider: wrapped,
    context,
    messages: [{ role: "user", content: "read a.txt" }],
    maxIterations: 2,
  });
  const result = await seams.taskLoop.runTaskLoop(deps);
  await client.endRun(run, { status: "success", endedAt: Date.now() });
  recordWarns();

  // Re-call the factory with the same config in the same reset domain to prove
  // the memoized selection does not re-warn or re-attempt construction.
  await seams.factory.createTraceClient(config);
  recordWarns();
  warn.mockRestore();

  return {
    client,
    noop: seams.noop,
    result,
    modelInvocations: model.invocations,
    warnCalls,
  };
}