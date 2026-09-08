/**
 * Task 19 — chat continuation run-identity contract (design §17 chat
 * continuation invariant, §24.11 chat continuation test).
 *
 * Locks the synthetic-chat identity at the SHARED fake-SDK surface, driving the
 * REAL production seam:
 *
 *     REAL processChat (session.ts:2102 wrapper)
 *         ├── startRun(run-<uuid8>)            ← ONE synthetic run id
 *         └── REAL processChatBody (session.ts:2160)
 *               ├── provider.complete #1       → REAL withProviderContracts
 *               │                                → gen span #1 (finishReason "length")
 *               └── truncation continuation loop
 *                     └── provider.complete #2 → gen span #2 (finishReason "stop")
 *         └── endRun → exactly one trace finalize (update) + one bounded flush
 *
 * Unlike the Task 10 chat-root tests (which record startRun/endRun against a
 * hand-rolled RecordingTraceClient whose getRun always returns null), this file
 * proves the invariant all the way down at the Langfuse SDK surface: REAL
 * createTraceClient → REAL LangfuseTraceClient → vi.mock('langfuse') fake SDK.
 * The provider is the REAL withProviderContracts contract wrapper around a
 * scripted model injected as config.chatProvider, so "two provider calls" means
 * two physical complete() requests, each resolving its model span via
 * getRun(request.context.runId) — the span count is itself the runId-threading
 * proof (a fresh/mismatched runId would resolve to null → no span).
 *
 * Asserted (all at the fake-SDK recorder surface):
 *   - one synthetic runId  (trace.id matches run-<uuid8>; a single value)
 *   - one Langfuse trace per invocation (no second trace at the continuation)
 *   - two model generations parented to that same trace, no orphan, no
 *     parentObservationId
 *   - the continuation did NOT call startRun with a new id (traceCount stays 1
 *     across provider call #2)
 *   - no leaks: 2 gen / 2 genEnd balanced, UNGUARDED rawEndCalls.generation ===
 *     2, every span closed, endRun awaited → flushCalls === 1, shutdownCalls ===
 *     0, one finalizing traceUpdate
 *   - session metadata: the synthetic run's sessionId (asserted honestly — the
 *     chat seam threads `session?.sessionId ?? "chat"`, and processChat never
 *     runs session initialize(), so a fresh session carries the literal "chat"
 *     fallback; see report)
 *   - per-invocation identity: a SECOND processChat on the same session starts
 *     a NEW synthetic run/trace, and its continuation still stays within that
 *     single new trace (2 invocations → exactly 2 traces, 4 generations
 *     partitioned 2/2 — would be 4 traces if any continuation re-called
 *     startRun)
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
  FakeLangfuse,
  fakeRecorder,
  resetFakeCalls,
  type FakeLangfuseInstance,
} from "./fakes/langfuse-sdk.js";

vi.mock("langfuse", () => ({ default: FakeLangfuse }));

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

function alix(record: { body: Record<string, unknown> }): Record<string, unknown> {
  const meta = record.body.metadata as { alix: Record<string, unknown> };
  return meta.alix;
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
  let sdk: FakeLangfuseInstance;

  beforeAll(async () => {
    // Real memoized enabled client, shared by the session root (threaded as
    // AgentSessionConfig.traceClient) AND the provider seam (withProviderContracts
    // via getProcessTraceClient) — the same process instance, like production.
    client = await createTraceClient(tracingConfig());
    sdk = fakeRecorder.instances[0];
  });

  beforeEach(() => {
    // Per-scenario delta baseline: the SDK instance persists across scenarios
    // (factory memoization), its recorded calls are wiped per test.
    resetFakeCalls(sdk);
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

    // ── 1 + 3. One synthetic runId, one trace, two model spans in it, no leak ──
    expect(sdk.calls.traces).toHaveLength(1);
    const [trace] = sdk.calls.traces;
    const runId = trace.id as string;
    expect(runId).toMatch(RUN_ID_RE);
    expect(trace.id).toBe(runId); // the runId IS the Langfuse trace id (§14)

    expect(sdk.calls.generations).toHaveLength(2);
    expect(sdk.calls.generationEnds).toHaveLength(2);
    // Unguarded double-end counter: a terminated-then-ended-again span would
    // fail here even though the adapter's endSpan guard swallows the second end.
    expect(sdk.rawEndCalls.generation).toBe(2);
    expect(sdk.calls.spans).toHaveLength(0); // chat path has no tools
    expect(sdk.calls.spanEnds).toHaveLength(0);

    const [gen0, gen1] = sdk.calls.generations;
    for (const rec of [gen0, gen1]) {
      expect(rec.traceId).toBe(runId); // BOTH spans parent to the SAME trace
      expect("parentObservationId" in rec.body).toBe(false); // no orphan links
    }
    // Same run id on both physical calls — a fresh/random id per provider call
    // would resolve getRun → null and produce NO span at all, so even the
    // existence of two spans THREADED TO THIS TRACE is the runId proof.
    expect(sdk.calls.generationEnds[0].traceId).toBe(runId);
    expect(sdk.calls.generationEnds[1].traceId).toBe(runId);

    // ── 4. Continuation did NOT call startRun with a new id ──
    // traceCount is still 1 AFTER provider call #2 finished. A regression that
    // called startRun in the continuation loop would have minted trace #2 here.
    expect(sdk.calls.traces).toHaveLength(1);

    // ── 5. No leaks: one endRun (finalizing update), one bounded flush ──
    expect(sdk.calls.traceUpdates).toHaveLength(1);
    expect(sdk.calls.traceUpdates[0].id).toBe(runId);
    expect(alix({ body: sdk.calls.traceUpdates[0].body })).toMatchObject({
      kind: "run",
      runId,
      status: "success",
    });
    expect(sdk.flushCalls).toBe(1); // endRun awaited the bounded flush (T13)
    expect(sdk.shutdownCalls).toBe(0); // no premature shutdown

    // ── 6. Session metadata crosses the synthetic run (R3, §17) ──
    expect(trace.sessionId).toBe("chat"); // honest: fresh chat session → "chat" fallback
    expect(alix({ body: trace })).toMatchObject({
      kind: "run",
      runId,
      sessionId: "chat",
      actor: "chat",
      task: "long answer please",
    });
    expect(trace.name).toBe("long answer please");

    // ── 2. The continuation is a REAL truncation re-prompt, not a 2nd root ──
    const gen0End = alix({ body: sdk.calls.generationEnds[0].body });
    const gen1End = alix({ body: sdk.calls.generationEnds[1].body });
    expect(gen0End).toMatchObject({
      kind: "model",
      status: "success",
      finishReason: "length",
      provider: "mock",
      model: "mock-chat-model",
      stream: false,
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(sdk.calls.generationEnds[0].body.output).toBe("Part one.");
    expect(gen1End).toMatchObject({ status: "success", finishReason: "stop" });
    expect(sdk.calls.generationEnds[1].body.output).toBe("Part two.");
    expect(sdk.calls.generationEnds[1].body.usage).toMatchObject({
      input: 12,
      output: 7,
      unit: "TOKENS",
    });
    // Both ends closed after their start (T16-minor end→start bracket).
    const gen0Start = alix({ body: gen0.body }).startedAtMs as number;
    const gen1Start = alix({ body: gen1.body }).startedAtMs as number;
    expect(gen1Start).toBeGreaterThanOrEqual(gen0Start);

    // Messages threading the continuation: call #2 carries [user, assistant
    // "Part one.", user cut-off re-prompt] — the re-prompter drove the complete.
    const gen0Input = gen0.body.input as Array<{ role: string; content: string }>;
    const gen1Input = gen1.body.input as Array<{ role: string; content: string }>;
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

    // Two invocations → exactly two traces, distinct synthetic run ids — the
    // identity is per-invocation, never a shared/reused run across turns.
    expect(sdk.calls.traces).toHaveLength(2);
    const [traceA, traceB] = sdk.calls.traces;
    const runA = traceA.id as string;
    const runB = traceB.id as string;
    expect(runA).toMatch(RUN_ID_RE);
    expect(runB).toMatch(RUN_ID_RE);
    expect(runA).not.toBe(runB);

    // Each invocation did its own continuation (2 physical calls each) yet each
    // produced EXACTLY ONE trace — had either continuation re-called startRun
    // with a new id, this would be 4 traces.
    expect(model.invocations).toBe(4);
    expect(sdk.calls.generations).toHaveLength(4);
    expect(sdk.calls.generationEnds).toHaveLength(4);
    expect(sdk.rawEndCalls.generation).toBe(4);

    const genTraces = sdk.calls.generations.map((g) => g.traceId);
    expect(genTraces.filter((id) => id === runA)).toHaveLength(2);
    expect(genTraces.filter((id) => id === runB)).toHaveLength(2);
    for (const id of genTraces) {
      expect([runA, runB]).toContain(id);
    }

    // Each run finalized/ended exactly once (2 updates, ids match the traces).
    expect(sdk.calls.traceUpdates).toHaveLength(2);
    expect(
      sdk.calls.traceUpdates.map((u) => u.id).sort(),
    ).toEqual([runA, runB].sort());
    expect(sdk.flushCalls).toBe(2); // each endRun awaited its bounded flush
    expect(sdk.shutdownCalls).toBe(0);
  });
});