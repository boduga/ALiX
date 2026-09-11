/**
 * Tracing coverage for the provider-call seams NOT exercised by T16-T24:
 * plan-phase generation, the model task classifier, and grounded-chat (both
 * provider calls + the tool-call runId drill). No new implementation code —
 * this locks the review-fixed `ExecutionContext.runId` threading (R1/§18) at
 * the three call sites that once emitted no model spans:
 *
 *   runPlanPhase opts.context        → generatePlan  → provider.complete
 *   modelClassifyAction(..., context)→ classifier   → provider.complete
 *   ExecutionDeps.context            → grounded-chat → provider.complete ×2
 *                                                      + executor.execute runId
 *
 * Same real-seam harness as T16/T18: real memoized `createTraceClient(enabled)`
 * (shared recorder surface via the @langfuse/otel LangfuseSpanProcessor fake),
 * real `withProviderContracts` around scripted models, `startRun`/`endRun` per
 * scenario. A generation only exists for a complete() whose
 * `request.context.runId` resolves via `client.getRun` — so the generation
 * counts below are themselves the threading proof for each seam.
 *
 * Constraints (see fakes/langfuse-sdk.ts): never static-import
 * langfuse-client.js (hoisting TDZ); keep the vi.mock factory shape; use
 * `resetFakeCalls` per scenario so the memoized instance is a clean delta basis.
 *
 * Design: docs/superpowers/specs/2026-09-06-langfuse-tracing-design.md
 * Review: PR #656 two-axis review — Spec findings #3 (plan-phase/classifier)
 * and #4 (direct/grounded-chat model spans).
 * Migrated: v3 fake-SDK surface → v5/OTel shared recorder surface.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EventLog } from "../../src/events/event-log.js";
import { runPlanPhase } from "../../src/run/plan-phase.js";
import { modelClassifyAction } from "../../src/runtime/action-classifier.js";
import { executeGroundedChatBehavior } from "../../src/runtime/route-execution.js";
import { withProviderContracts } from "../../src/providers/provider-contract-validation.js";
import { createTraceClient } from "../../src/tracing/client-factory.js";
import type { AlixConfig } from "../../src/config/schema.js";
import type { ExecutionContext } from "../../src/observability/execution-context.js";
import type {
  ModelAdapter,
  NormalizedResponse,
  ToolCall,
} from "../../src/providers/types.js";

import {
  FakeLangfuseSpanProcessor,
  fakeRecorder,
  resetFakeCalls,
  alixOf,
  attrOf,
  observationsOf,
  rootSpanOf,
  type FakeLangfuseSpanProcessorInstance,
} from "./fakes/langfuse-sdk.js";

vi.mock("@langfuse/otel", () => ({ LangfuseSpanProcessor: FakeLangfuseSpanProcessor }));

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

/** Scripted model: call i returns responseTexts[i] and toolCalls i from toolCallsSequence. */
function scriptedModel(opts: {
  responseTexts: string[];
  toolCallsSequence?: ToolCall[][];
}): ModelAdapter & { invocations: number } {
  let invocation = 0;
  return {
    id: "mock-seam",
    capabilities: {
      provider: "mock",
      model: "mock-seam-model",
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
    async complete(): Promise<NormalizedResponse> {
      const idx = invocation;
      invocation += 1;
      const tcs = opts.toolCallsSequence?.[idx] ?? [];
      return {
        text: opts.responseTexts[idx] ?? "",
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

/**
 * Enable the memoized client and return { client, proc } with a clean recorder
 * delta baseline. Reuses the one per-process instance across every scenario.
 * The guard throws if the enabled-branch shrank back to NOOP_TRACE_CLIENT (no
 * processor instance would exist and no span could ever be recorded).
 */
async function tracedHarness() {
  const client = await createTraceClient(tracingConfig());
  const proc: FakeLangfuseSpanProcessorInstance =
    fakeRecorder.instances[fakeRecorder.instances.length - 1]!;
  if (!proc || !Array.isArray(proc.spans)) {
    throw new Error("no fake SDK instance constructed for enabled tracing");
  }
  resetFakeCalls(proc);
  return { client, proc };
}

describe("previously-uncovered seams: plan-phase / classifier / grounded-chat model spans", () => {
  afterEach(async () => {
    await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it("runPlanPhase (deferred) emits a model span for the plan-generation request under runId", async () => {
    const { client, proc } = await tracedHarness();
    const tmp = await makeTmpRoot("seams-plan-");
    const context: ExecutionContext = { runId: "run-plan", sessionId: "seams-plan", workflowId: "wf-plan" };
    const run = client.startRun({ runId: "run-plan", sessionId: "seams-plan", workflowId: "wf-plan", task: "plan seam", actor: "agent", startedAt: Date.now() });

    try {
      const model = scriptedModel({
        responseTexts: [
          "## Summary\nAdd a dashboard widget\n\n## Changes\n- add widget\n\n## Verification\n- run tests",
        ],
      });
      const wrapped = withProviderContracts(model);
      const mockCtx: any = {
        sessionId: "seams-plan",
        config: { projectRoot: tmp },
        provider: wrapped,
        log: { append: async () => {} },
      };
      const mockBundle: any = { primaryFiles: [], tests: [], supportingFiles: [] };

      const result = await runPlanPhase(mockCtx, mockBundle, "add a new dashboard panel widget", undefined, {
        approvalMode: "deferred",
        context,
      });

      expect(result.action).toBe("approved");
      expect(model.invocations).toBe(1);
    } finally {
      await client.endRun(run, { status: "success", endedAt: Date.now() });
    }

    // One run root + exactly ONE generation (the invocations count proves the
    // single complete), both ended exactly once, threaded to the runId trace.
    const root = rootSpanOf(proc, "run-plan")!;
    expect(root).toBeDefined();
    expect(alixOf(root)).toMatchObject({ kind: "run", runId: "run-plan", status: "success" });
    expect(root.endTimeMs).toBeGreaterThan(0);

    const obs = observationsOf(proc, "run-plan");
    expect(obs).toHaveLength(2); // root + 1 generation
    const gen = obs.find((s) => attrOf(s, "type") === "generation");
    expect(gen).toBeDefined();
    expect(gen!.traceId).toBe(root.traceId); // generation resolves under the runId thread
    expect(gen!.parentSpanId).toBe(root.spanId);
    expect(gen!.name).toContain("mock-seam-model");
    expect(gen!.endTimeMs).toBeGreaterThan(0); // ended exactly once
  });

  it("modelClassifyAction threads context into the classifier request → model span under runId", async () => {
    const { client, proc } = await tracedHarness();
    const context: ExecutionContext = { runId: "run-classifier", sessionId: "seams-classifier" };
    const run = client.startRun({ runId: "run-classifier", sessionId: "seams-classifier", task: "classify seam", actor: "agent", startedAt: Date.now() });

    try {
      const model = scriptedModel({
        responseTexts: ['{"intent": "generation", "confidence": 0.95}'],
      });
      const wrapped = withProviderContracts(model);

      const classification = await modelClassifyAction("write a haiku about the moon", wrapped, context);

      expect(classification.intent).toBe("generation");
      expect(model.invocations).toBe(1);
    } finally {
      await client.endRun(run, { status: "success", endedAt: Date.now() });
    }

    const root = rootSpanOf(proc, "run-classifier")!;
    expect(root).toBeDefined();
    const obs = observationsOf(proc, "run-classifier");
    expect(obs).toHaveLength(2); // root + 1 generation
    const gen = obs.find((s) => attrOf(s, "type") === "generation");
    expect(gen).toBeDefined();
    expect(gen!.traceId).toBe(root.traceId);
    expect(gen!.parentSpanId).toBe(root.spanId);
    expect(gen!.endTimeMs).toBeGreaterThan(0); // exactly one end
  });

  it("grounded-chat threads context into BOTH provider calls and runId into the tool call", async () => {
    const { client, proc } = await tracedHarness();
    const tmp = await makeTmpRoot("seams-grounded-");
    const sessionId = "seams-grounded";
    const sessionDir = join(tmp, ".alix", "sessions", sessionId);
    await mkdir(sessionDir, { recursive: true });
    const log = new EventLog(sessionDir);
    await log.init();

    const context: ExecutionContext = { runId: "run-grounded", sessionId, workflowId: "wf-grounded" };
    const run = client.startRun({ runId: "run-grounded", sessionId, workflowId: "wf-grounded", task: "grounded seam", actor: "agent", startedAt: Date.now() });

    // web_search is allowlisted on the route but DENIED by policy: the tool is
    // executed (real executor.execute, real permission check) with no network
    // from the web-search tool, then the synthesis call runs.
    const route = {
      kind: "grounded_chat" as const,
      prompt: "what is the latest?",
      allowedTools: ["web_search"],
      diagnostic: { classification: "external_retrieval" as const, route: "grounded_chat" as const, reason: "seam test" },
    };
    const config: AlixConfig = {
      version: 1,
      model: { provider: "mock", name: "mock-seam-model" },
      permissions: {
        default: "deny",
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
    } as unknown as AlixConfig;

    try {
      const model = scriptedModel({
        responseTexts: ["", "The latest is v2."],
        toolCallsSequence: [[{ id: "tc-g", name: "web_search", args: { query: "latest" } }], []],
      });
      const wrapped = withProviderContracts(model);
      const result = await executeGroundedChatBehavior(route, config, {
        eventLog: log,
        cwd: tmp,
        providerFactory: async () => wrapped,
        context,
      });

      expect(result).toContain("v2");
      expect(model.invocations).toBe(2);
    } finally {
      await client.endRun(run, { status: "success", endedAt: Date.now() });
    }

    // Both provider calls (2 generations) + the executed (denied) web_search
    // tool call (1 span-kind child) all resolve under the runId-threaded trace,
    // each observation ended exactly once.
    const root = rootSpanOf(proc, "run-grounded")!;
    expect(root).toBeDefined();
    expect(alixOf(root)).toMatchObject({ kind: "run", runId: "run-grounded", status: "success" });

    const obs = observationsOf(proc, "run-grounded");
    expect(obs).toHaveLength(4); // root + 2 generations + 1 tool span
    const gens = obs.filter((s) => attrOf(s, "type") === "generation");
    expect(gens).toHaveLength(2);
    for (const gen of gens) {
      expect(gen.traceId).toBe(root.traceId);
      expect(gen.parentSpanId).toBe(root.spanId);
      expect(gen.endTimeMs).toBeGreaterThan(0);
    }
    const tool = obs.find((s) => attrOf(s, "type") === "span" && s.parentSpanId !== undefined);
    expect(tool).toBeDefined();
    expect(tool!.traceId).toBe(root.traceId);
    expect(tool!.parentSpanId).toBe(root.spanId);
    expect(tool!.name).toBe("web_search");
    expect(alixOf(tool!)).toMatchObject({ kind: "tool", toolName: "web_search" });
    expect(tool!.endTimeMs).toBeGreaterThan(0); // exactly one end
  });
});