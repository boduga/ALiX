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
 * (shared SDK surface via the fake recorder), real `withProviderContracts`
 * around scripted models, `startRun`/`endRun` per scenario. A generation only
 * exists for a complete() whose `request.context.runId` resolves via
 * `client.getRun` — so the generation counts below are themselves the threading
 * proof for each seam.
 *
 * Constraints (see fakes/langfuse-sdk.ts): never static-import
 * langfuse-client.js (hoisting TDZ); keep the vi.mock factory shape; use
 * `resetFakeCalls` per scenario so the memoized instance is a clean delta basis.
 *
 * Design: docs/superpowers/specs/2026-09-06-langfuse-tracing-design.md
 * Review: PR #656 two-axis review — Spec findings #3 (plan-phase/classifier)
 * and #4 (direct/grounded-chat model spans).
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

import { FakeLangfuse, fakeRecorder, resetFakeCalls } from "./fakes/langfuse-sdk.js";

vi.mock("langfuse", () => ({ default: FakeLangfuse }));

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
 * Enable the memoized client and return { client, sdk } with a clean fake-SDK
 * delta baseline. Reuses the one per-process instance across every scenario.
 */
async function tracedHarness() {
  const client = await createTraceClient(tracingConfig());
  const sdk = fakeRecorder.instances[fakeRecorder.instances.length - 1];
  if (!sdk) throw new Error("no fake SDK instance constructed for enabled tracing");
  resetFakeCalls(sdk);
  return { client, sdk };
}

describe("previously-uncovered seams: plan-phase / classifier / grounded-chat model spans", () => {
  afterEach(async () => {
    await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it("runPlanPhase (deferred) emits a model span for the plan-generation request under runId", async () => {
    const { client, sdk } = await tracedHarness();
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

    expect(sdk.calls.traces).toHaveLength(1);
    expect(sdk.calls.traces[0].id).toBe("run-plan");
    expect(sdk.calls.generations).toHaveLength(1);
    expect(sdk.calls.generations[0].traceId).toBe("run-plan");
    expect(sdk.calls.generationEnds).toHaveLength(1);
    expect(sdk.rawEndCalls.generation).toBe(1);
    expect(sdk.calls.generations[0].body.name).toContain("mock-seam-model");
  });

  it("modelClassifyAction threads context into the classifier request → model span under runId", async () => {
    const { client, sdk } = await tracedHarness();
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

    expect(sdk.calls.generations).toHaveLength(1);
    expect(sdk.calls.generations[0].traceId).toBe("run-classifier");
    expect(sdk.calls.generationEnds).toHaveLength(1);
    expect(sdk.rawEndCalls.generation).toBe(1);
  });

  it("grounded-chat threads context into BOTH provider calls and runId into the tool call", async () => {
    const { client, sdk } = await tracedHarness();
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

    // Both provider calls + the executed (denied) tool call all resolve under
    // the runId-threaded trace.
    expect(sdk.calls.generations).toHaveLength(2);
    for (const g of sdk.calls.generations) expect(g.traceId).toBe("run-grounded");
    expect(sdk.calls.generationEnds).toHaveLength(2);
    expect(sdk.rawEndCalls.generation).toBe(2);
    expect(sdk.calls.spans).toHaveLength(1);
    expect(sdk.calls.spans[0].traceId).toBe("run-grounded");
    expect(sdk.calls.spanEnds).toHaveLength(1);
    expect(sdk.rawEndCalls.span).toBe(1);
  });
});