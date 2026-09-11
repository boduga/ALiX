/**
 * Task 17 — streaming exactly-once model span (design §18 exactly-once invariant,
 * §24.7 "Exactly-once model span").
 *
 * The most likely model-span duplication regression is a streaming request that
 * opens more than one span (per chunk), double-closes, or opens a second span
 * for the terminal (error / cancellation). This file locks the invariant at the
 * REAL adapter surface:
 *
 *     one physical stream request  →  exactly one generation  →  exactly one
 *     terminal generationEnd  (success / error / cancellation), no orphan.
 *
 * Layers — mirrors tests/tracing/tracing-e2e-wiring.vitest.ts (Task 16) but for
 * the streaming path specifically:
 *   - recorder:      vi.mock('@langfuse/otel') shared fake span processor (no network)
 *   - adapter:       REAL LangfuseTraceClient (via createTraceClient)
 *   - provider seam: REAL withProviderContracts wrapper — the span is created
 *                     and closed here (provider-contract-validation.ts stream())
 *   - model:         scripted streaming FakeModel (supportsStreaming: true)
 *
 * Deliberately NOT driven through runTaskLoop/streamToResponse: a mid-stream
 * error there triggers the design's fail-soft blocking complete() fallback
 * (src/run/helpers.ts:351-360), which is R6's documented "2 physical requests →
 * 2 spans" behavior for a LOGICAL stream. That is a different invariant. This
 * test holds the exactly-once-per-PHYSICAL-request invariant by consuming the
 * wrapper's stream() async iterator directly (the seam that creates/closes the
 * span), letting the consumer surface the error/cancellation exactly as a real
 * caller does.
 *
 * The old v3 `rawEndCalls.generation` UNGUARDED end-call counter is gone in v5
 * (OTel Span.end() dedupes — the SDK never re-invokes onEnd). Exactly-once here
 * is locked via balanced per-run observation counts + every observation ended
 * (endTimeMs > 0); the adapter-side repeated-endSpan guard is pinned in
 * langfuse-client.vitest.ts (superset fake, someone else's scope).
 *
 * Design: docs/superpowers/specs/2026-09-06-langfuse-tracing-design.md (§18, §20, §24.7)
 * Task: Task 17 of
 *   docs/superpowers/plans/2026-09-06-langfuse-tracing-implementation-plan.md
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AlixConfig } from "../../src/config/schema.js";
import { createTraceClient } from "../../src/tracing/client-factory.js";
import type { TraceClient } from "../../src/tracing/client.js";
import { withProviderContracts } from "../../src/providers/provider-contract-validation.js";
import { ExecutionCancelledError } from "../../src/runtime/cancellation-token.js";
import type {
  ModelAdapter,
  NormalizedRequest,
  StreamChunk,
} from "../../src/providers/types.js";

import {
  FakeLangfuseSpanProcessor,
  fakeRecorder,
  resetFakeCalls,
  alixOf,
  attrOf,
  observationsOf,
  type FakeLangfuseSpanProcessorInstance,
} from "./fakes/langfuse-sdk.js";

vi.mock("@langfuse/otel", () => ({ LangfuseSpanProcessor: FakeLangfuseSpanProcessor }));

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function tracingConfig(): AlixConfig["tracing"] {
  return {
    enabled: true,
    langfuse: {
      baseUrl: "http://langfuse.test:3000",
      publicKey: "pk-lf-stream-public",
      secretKey: "sk-lf-stream-secret",
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

function streamReq(runId: string): NormalizedRequest {
  return {
    systemPrompt: "You are a streaming test assistant.",
    messages: [{ role: "user", content: "stream three chunks" }],
    stream: true,
    context: { runId, providerId: "mock", model: "mock-stream-model" },
  };
}

/** Base streaming fake — `script` fully controls what the physical stream yields. */
function streamingModel(script: () => AsyncGenerator<StreamChunk>): ModelAdapter {
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
    async complete() {
      throw new Error("streaming mock has no complete()");
    },
    stream() {
      return script();
    },
  };
}

async function* chunks(chunks: StreamChunk[]): AsyncGenerator<StreamChunk> {
  for (const c of chunks) yield c;
}

async function collect(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

// ---------------------------------------------------------------------------
// Shared real adapter. The factory memoizes the first enabled client per
// process (per vitest fork), so ONE real LangfuseTraceClient is created and
// shared across all scenarios; each scenario registers its own run via
// startRun and asserts counts as per-scenario deltas (resetFakeCalls), proving
// no cross-scenario leak (every created span is closed within its own scenario).
// ---------------------------------------------------------------------------

let client: TraceClient;
let proc: FakeLangfuseSpanProcessorInstance;

beforeAll(async () => {
  client = await createTraceClient(tracingConfig());
  proc = fakeRecorder.instances[fakeRecorder.instances.length - 1]!;
});

beforeEach(() => {
  // The factory memo is intact; just reset the recorder deltas per scenario and
  // confirm exactly one processor (the memoized adapter's) was ever constructed.
  expect(fakeRecorder.instances).toHaveLength(1);
  resetFakeCalls(proc);
});

afterAll(async () => {
  await client.shutdown();
  // The memoized adapter's processor got one shutdown at teardown.
  expect(proc.shutdownCalls).toBeGreaterThanOrEqual(1);
});

describe("T17 streaming exactly-once model span (shared recorder surface)", () => {
  it("scenario 1 — success: chunk1..chunk3 → completion → exactly ONE terminal model span", async () => {
    const run = client.startRun({
      runId: "t17-success",
      sessionId: "t17-s",
      task: "streaming exactly-once success",
      actor: "agent",
      startedAt: Date.now(),
    });

    const model = streamingModel(() =>
      chunks([
        { type: "text_delta", text: "Hel" },
        { type: "text_delta", text: "lo " },
        { type: "text_delta", text: "world" },
        { type: "usage", usage: { inputTokens: 12, outputTokens: 5 } },
        { type: "done", finishReason: "stop" },
      ]),
    );
    const wrapped = withProviderContracts(model);

    // ONE physical stream request.
    const yieldedTypes = (await collect(wrapped.stream!(streamReq(run.runId)))).map((c) => c.type);

    expect(yieldedTypes).toEqual(["text_delta", "text_delta", "text_delta", "usage", "done"]);
    await client.endRun(run, { status: "success", endedAt: Date.now() });

    // EXACTLY ONCE at the recorder surface: one generation observation in the run's
    // trace, and it is terminal (ended, endTimeMs > 0).
    const obs = observationsOf(proc, "t17-success");
    const generations = obs.filter((s) => attrOf(s, "type") === "generation");
    expect(generations).toHaveLength(1);
    // No orphan — every observation is an ended span (balanced, no double-close).
    for (const s of obs) expect(s.endTimeMs).toBeGreaterThan(0);
    expect(obs).toHaveLength(2); // root + one generation

    const gen = generations[0]!;
    expect(gen.name).toBe("mock-stream-model");
    const g = alixOf(gen);
    expect(g).toMatchObject({
      kind: "model",
      provider: "mock",
      model: "mock-stream-model",
      stream: true,
    });
    // Input capture (M1) reaches the recorder.
    const input = attrOf(gen, "input") as Array<{ role: string; content: string }>;
    expect(input[0]).toMatchObject({
      role: "user",
      content: "stream three chunks",
    });

    // Terminal state on the SAME observation (v5: update + end coalesce on one span).
    expect(alixOf(gen)).toMatchObject({
      status: "success",
      finishReason: "stop",
      inputTokens: 12,
      outputTokens: 5,
    });
    // Output = concatenated chunks, exactly what the wrapper accumulated.
    expect(attrOf(gen, "output")).toBe("Hello world");
    // Success → OTel OK status, DEFAULT level, no error.
    expect(gen.status.code).toBe(1);
    expect(attrOf(gen, "level")).toBe("DEFAULT");
    expect(attrOf(gen, "status_message")).toBeUndefined();
    expect(alixOf(gen).error).toBeUndefined();

    // T16-minor ordering fold-in: the terminal's endedAt >= the stream's start.
    // Stub timestamps can make endTimeMs === startTimeMs (zero-width span),
    // so only the non-negative ordering is asserted strictly.
    expect(gen.endTimeMs).toBeGreaterThanOrEqual(gen.startTimeMs);
    expect((alixOf(gen).durationMs as number) ?? 0).toBeGreaterThanOrEqual(0);

    // Exactly-once across the WHOLE run: this one streaming request produced
    // exactly one generation in its trace (not one per chunk).
    expect(obs.filter((s) => attrOf(s, "type") === "generation")).toHaveLength(1);
  });

  it("scenario 2 — error mid-stream: chunk1, chunk2 → error → exactly ONE terminal error span", async () => {
    const run = client.startRun({
      runId: "t17-error",
      sessionId: "t17-s",
      task: "streaming exactly-once error",
      actor: "agent",
      startedAt: Date.now(),
    });

    async function* failing(): AsyncGenerator<StreamChunk> {
      yield { type: "text_delta", text: "partial" };
      yield { type: "text_delta", text: " answer" };
      throw new Error("upstream stream failure");
    }
    const model = streamingModel(failing);
    const wrapped = withProviderContracts(model);

    // The mid-stream error propagates to the consumer.
    await expect(collect(wrapped.stream!(streamReq(run.runId)))).rejects.toThrow("upstream stream failure");
    await client.endRun(run, { status: "error", endedAt: Date.now() });

    // EXACTLY ONE generation, closed exactly once — no second span for the error,
    // no double-close.
    const obs = observationsOf(proc, "t17-error");
    const generations = obs.filter((s) => attrOf(s, "type") === "generation");
    expect(generations).toHaveLength(1);
    for (const s of obs) expect(s.endTimeMs).toBeGreaterThan(0);
    expect(obs).toHaveLength(2); // root + one generation

    const gen = generations[0]!;
    expect(alixOf(gen).stream).toBe(true);

    const endAlix = alixOf(gen);
    expect(endAlix.status).toBe("error");
    expect(endAlix.kind).toBe("model");
    expect(attrOf(gen, "level")).toBe("ERROR");
    expect(gen.status.code).toBe(2);
    // Error message/metadata present (statusMessage + alix.error).
    expect(String(attrOf(gen, "status_message"))).toContain("upstream stream failure");
    expect(String(endAlix.error)).toContain("upstream stream failure");
    // Honest capture note: the error terminal does NOT carry the tokens yielded
    // so far — outcomeForError (provider-contract-validation.ts) sets only
    // status/error/endedAt. Partial stream output on error/cancel is dropped
    // (existing, Task-11-approved behavior); only the success terminal carries
    // the concatenated output.
    expect(attrOf(gen, "output")).toBeUndefined();
    // Still terminal and exactly one.
    expect(gen.endTimeMs).toBeGreaterThanOrEqual(gen.startTimeMs);
  });

  it("scenario 3 — cancel mid-stream: chunk1 → cancel → exactly ONE terminal cancelled span", async () => {
    const run = client.startRun({
      runId: "t17-cancel",
      sessionId: "t17-s",
      task: "streaming exactly-once cancellation",
      actor: "agent",
      startedAt: Date.now(),
    });

    async function* cancelling(): AsyncGenerator<StreamChunk> {
      yield { type: "text_delta", text: "tok" };
      throw new ExecutionCancelledError("operator cancelled stream");
    }
    const model = streamingModel(cancelling);
    const wrapped = withProviderContracts(model);

    await expect(collect(wrapped.stream!(streamReq(run.runId)))).rejects.toBeInstanceOf(
      ExecutionCancelledError,
    );
    await client.endRun(run, { status: "cancelled", endedAt: Date.now() });

    // EXACTLY ONE generation, closed exactly once as cancelled.
    const obs = observationsOf(proc, "t17-cancel");
    const generations = obs.filter((s) => attrOf(s, "type") === "generation");
    expect(generations).toHaveLength(1);
    for (const s of obs) expect(s.endTimeMs).toBeGreaterThan(0);
    expect(obs).toHaveLength(2);

    const gen = generations[0]!;
    const endAlix = alixOf(gen);
    // Cancellation maps to the "cancelled" terminal (design §18/§20): the
    // wrapper's outcomeForError maps isCancellationError → cancelled. Langfuse
    // has no cancelled level, so level stays DEFAULT while alix.status carries
    // the cancellation.
    expect(endAlix.status).toBe("cancelled");
    expect(attrOf(gen, "level")).toBe("DEFAULT");
    expect(gen.status.code).toBe(1);
    expect(String(attrOf(gen, "status_message"))).toContain("operator cancelled stream");
    expect(String(endAlix.error)).toContain("operator cancelled stream");
    // Same honest capture note as the error terminal: partial output on cancel
    // is not captured (outcomeForError carries status/error/endedAt only).
    expect(attrOf(gen, "output")).toBeUndefined();
    expect(gen.endTimeMs).toBeGreaterThanOrEqual(gen.startTimeMs);
  });

  it("cancel via consumer early-close: exactly ONE terminal cancelled span (no orphan)", async () => {
    // The wrapper's stream() finally closes the span as cancelled when the
    // async iterator is abandoned without a natural completion (terminal
    // undefined → status "cancelled"). This is the OTHER cancellation surface
    // — a real caller that breaks out of the stream loop.
    const run = client.startRun({
      runId: "t17-earlyclose",
      sessionId: "t17-s",
      task: "streaming exactly-once early close",
      actor: "agent",
      startedAt: Date.now(),
    });

    const model = streamingModel(() =>
      chunks([
        { type: "text_delta", text: "one" },
        { type: "text_delta", text: " two" },
        { type: "text_delta", text: " three" },
        { type: "done", finishReason: "stop" },
      ]),
    );
    const wrapped = withProviderContracts(model);

    const iterator = wrapped.stream!(streamReq(run.runId))[Symbol.asyncIterator]();
    await iterator.next(); // consumer receives the first chunk, then abandons.
    await iterator.return?.(undefined);
    await client.endRun(run, { status: "cancelled", endedAt: Date.now() });

    const obs = observationsOf(proc, "t17-earlyclose");
    const generations = obs.filter((s) => attrOf(s, "type") === "generation");
    expect(generations).toHaveLength(1);
    for (const s of obs) expect(s.endTimeMs).toBeGreaterThan(0);
    expect(obs).toHaveLength(2);
    const gen = generations[0]!;
    const endAlix = alixOf(gen);
    expect(endAlix.status).toBe("cancelled");
    expect(attrOf(gen, "level")).toBe("DEFAULT");
    // Consumer early-close → the wrapper's finally defaults a missing terminal
    // to status "cancelled" with no error/statusMessage; partial output is not
    // captured (terminal has no output in this path either).
    expect(endAlix.error).toBeUndefined();
    expect(attrOf(gen, "output")).toBeUndefined();
  });
});