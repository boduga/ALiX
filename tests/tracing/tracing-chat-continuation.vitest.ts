/**
 * Task 19 — chat continuation run-identity contract (design §17 chat
 * continuation invariant, §24.11 chat continuation test).
 *
 * Locks the synthetic-chat identity at the SHARED fake-recorder surface
 * (v5/OTel), driving the REAL production seam:
 *
 *     REAL processChat (session.ts:2106 wrapper)
 *         ├── startRun(run-<uuid8>)            ← ONE synthetic run id
 *         └── REAL processChatBody (session.ts:2141)
 *               ├── provider.complete #1       → REAL withProviderContracts
 *               │                                → gen span #1 (finishReason "length")
 *               └── truncation continuation loop
 *                     └── provider.complete #2 → gen span #2 (finishReason "stop")
 *         └── endRun → exactly one run-root terminal + one bounded flush
 *
 * Unlike the Task 10 chat-root tests (which record startRun/endRun against a
 * hand-rolled RecordingTraceClient whose getRun always returns null), this file
 * proves the invariant all the way down at the Langfuse v5/OTel surface: REAL
 * createTraceClient → REAL LangfuseTraceClient → vi.mock('@langfuse/otel')
 * shared recorder (the real @langfuse/tracing emits the spans; the fake
 * LangfuseSpanProcessor captures them).
 * The provider is the REAL withProviderContracts contract wrapper around a
 * scripted model injected as config.chatProvider, so "two provider calls" means
 * two physical complete() requests, each resolving its model span via
 * getRun(request.context.runId) — the span count is itself the runId-threading
 * proof (a fresh/mismatched runId would resolve to null → no span).
 *
 * Asserted (all at the shared fake-recorder surface):
 *   - one synthetic runId (alixOf(root).runId matches run-<uuid8>; a single root)
 *   - one run root observation per invocation (no second root at the
 *     continuation), all observations sharing ONE OTel trace id
 *   - two model generations parented to that same trace root, no orphan, no
 *     invented parent links (parentSpanId === root.spanId)
 *   - the continuation did NOT call startRun with a new id (a single run-kind
 *     root persists across provider call #2)
 *   - no leaks: 2 generations balanced against a 3-observation trace (root + 2),
 *     every observation ended exactly once (endTimeMs > 0), endRun awaited →
 *     flushCalls === 1, shutdownCalls === 0, one run-root terminal (success)
 *   - session metadata: the synthetic run's sessionId (asserted honestly — the
 *     chat seam threads `session?.sessionId ?? "chat"`, and processChat never
 *     runs session initialize(), so a fresh session carries the literal "chat"
 *     fallback; see report) — propagated onto EVERY observation (session.id)
 *   - per-invocation identity: a SECOND processChat on the same session starts
 *     a NEW synthetic run/root with its own OTel trace, and its continuation
 *     still stays within that single new trace (2 invocations → exactly 2 run
 *     roots, 4 generations partitioned 2/2 — would be 4 roots if any
 *     continuation re-called startRun)
 *
 * Design: docs/superpowers/specs/2026-09-06-langfuse-tracing-design.md (§17, §24.11)
 * Task: Task 19 of
 *   docs/superpowers/plans/2026-09-06-langfuse-tracing-implementation-plan.md
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAgentSession } from "../../src/agent/session.js";
import { createTraceClient } from "../../src/tracing/client-factory.js";
import { withProviderContracts } from "../../src/providers/provider-contract-validation.js";
import type { TraceClient } from "../../src/tracing/client.js";
import type { AlixConfig } from "../../src/config/schema.js";
import type { ModelAdapter, NormalizedRequest, NormalizedResponse } from "../../src/providers/types.js";

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RUN_ID_RE = /^run-[0-9a-f]{8}$/;
const CONTINUE_PROMPT =
  "Your previous response was cut off at the output token limit.";

function tracingConfig(): AlixConfig["tracing"] {
  return {
    enabled: true,
    langfuse: {
      baseUrl: "http://langfuse.test:3000",
      publicKey: "pk-lf-t19-public",
      secretKey: "sk-lf-t19-secret",
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

interface ChatModel extends ModelAdapter {
  invocations: number;
}

/**
 * Scripted chat model: call #1 finishes with `finishReason: "length"` (the
 * continuation trigger in processChatBody, session.ts:2213), call #2 (the
 * re-prompt continuation, session.ts:2226) finishes with "stop". Returns the
 * per-call request records for honest message-history assertion.
 */
function createContinuationModel(): ChatModel & {
  requests: Array<{ systemPrompt: string; messages: unknown; maxOutputTokens?: number }>;
} {
  let invocation = 0;
  const requests: Array<{
    systemPrompt: string;
    messages: unknown;
    maxOutputTokens?: number;
  }> = [];
  const responses: NormalizedResponse[] = [
    {
      text: "Part one.",
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 5 },
      finishReason: "length",
    },
    {
      text: "Part two.",
      toolCalls: [],
      usage: { inputTokens: 12, outputTokens: 7 },
      finishReason: "stop",
    },
  ];
  const model = {
    id: "mock-chat",
    capabilities: {
      provider: "mock",
      model: "mock-chat-model",
      inputTokenLimit: 100000,
      outputTokenLimit: 16384,
      supportsTools: false,
      supportsStreaming: false,
      supportsStructuredOutput: false,
      supportsVision: false,
      parallelToolCalls: false,
    },
    editFormatPreference: "structured_patch",
    longContextStrategy: "trimmed_context",
    async complete(req: NormalizedRequest): Promise<NormalizedResponse> {
      requests.push({
        systemPrompt: req.systemPrompt,
        messages: JSON.parse(JSON.stringify(req.messages)),
        maxOutputTokens: req.maxOutputTokens,
      });
      // Cyclic [length, stop] pair so EVERY invocation gets its own continuation
      // (call indices 0→1, 2→3, …) — the continuation trigger is per-call.
      return responses[invocation++ % responses.length];
    },
    get invocations() {
      return invocation;
    },
  };
  return Object.assign(model, { requests }) as unknown as ChatModel & {
    requests: Array<{ systemPrompt: string; messages: unknown; maxOutputTokens?: number }>;
  };
}

const tmpDirs: string[] = [];
async function makeTmpRoot(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("T19 chat continuation run identity (design §17 / §24.11)", () => {
  let client: TraceClient;
  let proc: FakeLangfuseSpanProcessorInstance;

  beforeAll(async () => {
    // Real memoized enabled client, shared by the session root (threaded as
    // AgentSessionConfig.traceClient) AND the provider seam (withProviderContracts
    // via getProcessTraceClient) — the same process instance, like production.
    client = await createTraceClient(tracingConfig());
    proc = fakeRecorder.instances[fakeRecorder.instances.length - 1]!;
    expect(fakeRecorder.instances).toHaveLength(1);
  });

  beforeEach(() => {
    // Per-scenario delta baseline: the one memoized processor lives across
    // scenarios (factory memoization), its recorded spans + transport counters
    // are wiped per test.
    resetFakeCalls(proc);
  });

  afterAll(async () => {
    await client.shutdown();
  });

  afterEach(async () => {
    await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it("one synthetic runId → one trace → two model spans; continuation does NOT re-call startRun", async () => {
    const cwd = await makeTmpRoot("t19-cont-");
    const model = createContinuationModel();

    const session = createAgentSession({
      cwd,
      task: "",
      sessionId: "chat-session",
      chatProvider: withProviderContracts(model),
      traceClient: client,
    });

    const result = await session.processChat("long answer please");

    // ── The logical turn really did two physical provider calls ──
    expect(model.invocations).toBe(2);
    expect(result.summary).toBe("Part one.Part two.");
    expect(result.reason).toBe("chat");

    expect(fakeRecorder.instances).toHaveLength(1);

    // ── 1 + 3. One synthetic runId, one run root / trace, two model spans ──
    const roots = proc.spans.filter(
      (s) => !s.parentSpanId && (alixOf(s) as Record<string, unknown>).kind === "run",
    );
    expect(roots).toHaveLength(1); // the runId IS the identity — never a second root
    const root = roots[0]!;
    const runId = alixOf(root).runId as string;
    expect(runId).toMatch(RUN_ID_RE);
    const traceId = root.traceId;

    const obs = observationsOf(proc, runId);
    const generations = obs.filter((s) => attrOf(s, "type") === "generation");
    // chat path has no tools: the only "span"-typed observation is the run root.
    const toolChildSpans = obs.filter(
      (s) => s.parentSpanId !== undefined && attrOf(s, "type") === "span",
    );
    expect(toolChildSpans).toHaveLength(0);
    // Balanced: root + exactly 2 generations, every observation ended exactly
    // once (v5 OTel spans dedupe their own end() — no orphan, no double-close).
    expect(obs).toHaveLength(3);
    expect(generations).toHaveLength(2);
    for (const s of obs) {
      expect(s.endTimeMs).toBeGreaterThan(0);
    }

    const [gen0, gen1] = generations;
    for (const gen of [gen0, gen1]) {
      expect(gen.traceId).toBe(traceId); // BOTH spans parent to the SAME trace
      expect(gen.parentSpanId).toBe(root.spanId); // direct children, no orphan links
    }
    // Same run id on both physical calls — a fresh/random id per provider call
    // would resolve getRun → null and produce NO span at all (and would never
    // group under this trace), so even the existence of two spans THREADED TO
    // THIS ROOT is the runId proof.
    const gen0Start = alixOf(gen0).startedAtMs as number;
    const gen1Start = alixOf(gen1).startedAtMs as number;

    // ── 4. Continuation did NOT call startRun with a new id ──
    // Exactly one run-kind root STILL after provider call #2 finished. A
    // regression that called startRun in the continuation loop would have
    // minted root #2 here.
    expect(
      proc.spans.filter((s) => (alixOf(s) as Record<string, unknown>).kind === "run"),
    ).toHaveLength(1);

    // ── 5. No leaks: one run-root terminal, one bounded flush ──
    expect(alixOf(root)).toMatchObject({ kind: "run", runId, status: "success" });
    expect(root.status.code).toBe(1); // SpanStatusCode.OK — success terminal
    expect(proc.flushCalls).toBe(1); // endRun awaited the bounded flush (T13)
    expect(proc.shutdownCalls).toBe(0); // no premature shutdown

    // ── 6. Session metadata crosses the synthetic run (R3, §17) ──
    expect(root.propagated["session.id"]).toBe("chat"); // honest: fresh chat session → "chat" fallback
    expect(root.propagated["langfuse.trace.name"]).toBe("long answer please");
    // Every observation self-describes its session (v3 parity — the adapter
    // re-propagates session.id onto each child).
    for (const s of obs) {
      expect(s.propagated["session.id"]).toBe("chat");
    }
    expect(alixOf(root)).toMatchObject({
      kind: "run",
      runId,
      sessionId: "chat",
      actor: "chat",
      task: "long answer please",
    });
    expect(root.name).toBe("long answer please");

    // ── 2. The continuation is a REAL truncation re-prompt, not a 2nd root ──
    expect(alixOf(gen0)).toMatchObject({
      kind: "model",
      status: "success",
      finishReason: "length",
      provider: "mock",
      model: "mock-chat-model",
      stream: false,
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(attrOf(gen0, "output")).toBe("Part one.");
    expect(attrOf(gen0, "level")).toBe("DEFAULT");
    expect(gen0.status.code).toBe(1);
    expect(attrOf(gen0, "status_message")).toBeUndefined(); // present only on error
    expect(alixOf(gen1)).toMatchObject({ status: "success", finishReason: "stop" });
    expect(attrOf(gen1, "output")).toBe("Part two.");
    expect(attrOf(gen1, "usage_details")).toMatchObject({ input: 12, output: 7 });
    // Both ends closed after their start (T16-minor end→start bracket).
    expect(gen1Start).toBeGreaterThanOrEqual(gen0Start);

    // Messages threading the continuation: call #2 carries [user, assistant
    // "Part one.", user cut-off re-prompt] — the re-prompter drove the complete.
    const gen0Input = attrOf(gen0, "input") as Array<{ role: string; content: string }>;
    const gen1Input = attrOf(gen1, "input") as Array<{ role: string; content: string }>;
    expect(gen0Input).toHaveLength(1);
    expect(gen0Input[0]).toMatchObject({ role: "user", content: "long answer please" });
    expect(gen1Input).toHaveLength(3);
    expect(gen1Input[0]).toMatchObject({ role: "user", content: "long answer please" });
    expect(gen1Input[1]).toMatchObject({ role: "assistant", content: "Part one." });
    expect(gen1Input[2]).toMatchObject({ role: "user" });
    expect(String(gen1Input[2].content)).toContain(CONTINUE_PROMPT);
  });

  it("a second processChat invocation starts a NEW synthetic run/trace; its continuation still stays within that single trace", async () => {
    const cwd = await makeTmpRoot("t19-two-");
    const model = createContinuationModel();
    const session = createAgentSession({
      cwd,
      task: "",
      sessionId: "chat-session",
      chatProvider: withProviderContracts(model),
      traceClient: client,
    });

    await session.processChat("first message");
    await session.processChat("second message");

    expect(fakeRecorder.instances).toHaveLength(1);

    // Two invocations → exactly two run roots, each with its own OTel trace —
    // the identity is per-invocation, never a shared/reused run across turns.
    const roots = proc.spans.filter(
      (s) => !s.parentSpanId && (alixOf(s) as Record<string, unknown>).kind === "run",
    );
    expect(roots).toHaveLength(2);
    const rootA = roots[0]!;
    const rootB = roots[1]!;
    const runA = alixOf(rootA).runId as string;
    const runB = alixOf(rootB).runId as string;
    expect(runA).toMatch(RUN_ID_RE);
    expect(runB).toMatch(RUN_ID_RE);
    expect(runA).not.toBe(runB);
    expect(rootA.traceId).not.toBe(rootB.traceId);

    // Each invocation did its own continuation (2 physical calls each) yet each
    // produced EXACTLY ONE trace (root + 2 generations) — had either
    // continuation re-called startRun with a new id, this would be 4 roots.
    expect(model.invocations).toBe(4);
    const obsA = observationsOf(proc, runA);
    const obsB = observationsOf(proc, runB);
    expect(obsA).toHaveLength(3);
    expect(obsB).toHaveLength(3);
    expect(obsA.filter((s) => attrOf(s, "type") === "generation")).toHaveLength(2);
    expect(obsB.filter((s) => attrOf(s, "type") === "generation")).toHaveLength(2);
    for (const s of [...obsA, ...obsB]) {
      expect(s.endTimeMs).toBeGreaterThan(0);
      if (attrOf(s, "type") === "generation") {
        expect([rootA.traceId, rootB.traceId]).toContain(s.traceId);
      }
    }

    // Each run finalized/ended exactly once (both root terminals success), one
    // bounded flush per endRun, zero shutdown.
    expect(alixOf(rootA)).toMatchObject({ kind: "run", runId: runA, status: "success" });
    expect(alixOf(rootB)).toMatchObject({ kind: "run", runId: runB, status: "success" });
    expect(proc.flushCalls).toBe(2); // each endRun awaited its bounded flush
    expect(proc.shutdownCalls).toBe(0);
  });
});