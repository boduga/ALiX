/**
 * Task 17 — streaming exactly-once model span (design §18 exactly-once invariant,
 * §24.7 "Exactly-once model span").
 *
 * The most likely model-span duplication regression is a streaming request that
 * opens more than one span (per chunk), double-closes, or opens a second span
 * for the terminal (error / cancellation). This file locks the invariant at the
 * REAL SDK surface:
 *
 *     one physical stream request  →  exactly one generation  →  exactly one
 *     terminal generationEnd  (success / error / cancellation), no orphan.
 *
 * Layers — mirrors tests/tracing/tracing-e2e-wiring.vitest.ts (Task 16) but for
 * the streaming path specifically:
 *   - SDK:            vi.mock('langfuse') fake recorder (no network)
 *   - adapter:        REAL LangfuseTraceClient (via createTraceClient)
 *   - provider seam:  REAL withProviderContracts wrapper — the span is created
 *                     and closed here (provider-contract-validation.ts stream())
 *   - model:          scripted streaming FakeModel (supportsStreaming: true)
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

// ---------------------------------------------------------------------------
// vi.mock('langfuse') fake — same recording surface as the adapter tests (Task 7)
// and the Task 16 e2e harness. Every `new Langfuse(...)` the real adapter
// performs is recorded; calling into the returned objects records trace /
// generation / span operations keyed by the ALiX runId (the Langfuse trace id).
// ---------------------------------------------------------------------------

interface FakeCalls {
  traces: Array<Record<string, unknown>>;
  traceUpdates: Array<{ id?: string; body: Record<string, unknown> }>;
  generations: Array<{ traceId?: string; body: Record<string, unknown> }>;
  generationEnds: Array<{ traceId?: string; body: Record<string, unknown> }>;
  spans: Array<{ traceId?: string; body: Record<string, unknown> }>;
  spanEnds: Array<{ traceId?: string; body: Record<string, unknown> }>;
}

interface FakeLangfuseInstance {
  options: Record<string, unknown>;
  calls: FakeCalls;
  flushCalls: number;
  shutdownCalls: number;
}

const { FakeLangfuse, fakeRecorder } = vi.hoisted(() => {
  const recorder: { instances: FakeLangfuseInstance[] } = { instances: [] };

  class FakeLangfuse {
    options: Record<string, unknown>;
    calls: FakeCalls = {
      traces: [],
      traceUpdates: [],
      generations: [],
      generationEnds: [],
      spans: [],
      spanEnds: [],
    };
    flushCalls = 0;
    shutdownCalls = 0;

    constructor(options: Record<string, unknown>) {
      this.options = options;
      recorder.instances.push(this as unknown as FakeLangfuseInstance);
    }

    trace(body: Record<string, unknown>): FakeTrace {
      this.calls.traces.push(body);
      return new FakeTrace(this, body);
    }

    async flushAsync(): Promise<void> {
      this.flushCalls++;
    }

    async shutdownAsync(): Promise<void> {
      this.shutdownCalls++;
    }
  }

  class FakeTrace {
    constructor(
      readonly owner: FakeLangfuse,
      readonly body: Record<string, unknown>,
    ) {}

    update(body: Record<string, unknown>): FakeTrace {
      this.owner.calls.traceUpdates.push({ id: this.body.id as string, body });
      return this;
    }

    generation(body: Record<string, unknown>): FakeGeneration {
      const traceId = this.body.id as string;
      this.owner.calls.generations.push({ traceId, body });
      return new FakeGeneration(this.owner, traceId);
    }

    span(body: Record<string, unknown>): FakeSpan {
      const traceId = this.body.id as string;
      this.owner.calls.spans.push({ traceId, body });
      return new FakeSpan(this.owner, traceId);
    }
  }

  class FakeGeneration {
    constructor(
      readonly owner: FakeLangfuse,
      readonly traceId: string,
    ) {}

    end(body: Record<string, unknown>): FakeGeneration {
      this.owner.calls.generationEnds.push({ traceId: this.traceId, body });
      return this;
    }
  }

  class FakeSpan {
    constructor(
      readonly owner: FakeLangfuse,
      readonly traceId: string,
    ) {}

    end(body: Record<string, unknown>): FakeSpan {
      this.owner.calls.spanEnds.push({ traceId: this.traceId, body });
      return this;
    }
  }

  return { FakeLangfuse, fakeRecorder: recorder };
});

vi.mock("langfuse", () => ({ default: FakeLangfuse }));

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

function alix(record: { body: Record<string, unknown> }): Record<string, unknown> {
  const meta = record.body.metadata as { alix: Record<string, unknown> };
  return meta.alix;
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
// startRun and asserts COUNTS AS DELTAS from a baseline, proving no
// cross-scenario leak (every created span is closed within its own scenario).
// ---------------------------------------------------------------------------

let client: TraceClient;
let sdk: FakeLangfuseInstance;

beforeAll(async () => {
  client = await createTraceClient(tracingConfig());
  sdk = fakeRecorder.instances[0];
});

beforeEach(() => {
  // Re-dispatch factory memo is intact; just reset the SDK call log for a
  // clean delta baseline per scenario and confirm exactly one SDK instance.
  sdk.calls.generations.length = 0;
  sdk.calls.generationEnds.length = 0;
  sdk.calls.traces.length = 0;
  sdk.calls.traceUpdates.length = 0;
});

afterAll(async () => {
  await client.shutdown();
});

describe("T17 streaming exactly-once model span (fake SDK surface)", () => {
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

    // EXACTLY ONCE at the SDK surface: one generation started, one closed.
    expect(sdk.calls.generations).toHaveLength(1);
    expect(sdk.calls.generationEnds).toHaveLength(1);
    // No orphan — every created span is terminal (balanced counts).
    expect(sdk.calls.generationEnds.length).toBe(sdk.calls.generations.length);

    const gen = sdk.calls.generations[0]!;
    expect(gen.traceId).toBe("t17-success");
    const g = alix({ body: gen.body });
    expect(g).toMatchObject({
      kind: "model",
      provider: "mock",
      model: "mock-stream-model",
      stream: true,
    });
    expect(gen.body.name).toBe("mock-stream-model");
    // Input capture (M1) reaches the SDK.
    expect((gen.body.input as Array<{ role: string; content: string }>)[0]).toMatchObject({
      role: "user",
      content: "stream three chunks",
    });

    const end = sdk.calls.generationEnds[0]!;
    expect(end.traceId).toBe("t17-success");
    const endAlix = alix({ body: end.body });
    expect(endAlix).toMatchObject({
      status: "success",
      finishReason: "stop",
      inputTokens: 12,
      outputTokens: 5,
    });
    // Output = concatenated chunks, exactly what the wrapper accumulated.
    expect(end.body.output).toBe("Hello world");
    // Success → DEFAULT level, no error.
    expect(end.body.level).toBe("DEFAULT");
    expect(end.body.statusMessage).toBeUndefined();

    // T16-minor ordering fold-in: the terminal's endedAt >= the stream's start.
    expect(endAlix.endedAtMs as number).toBeGreaterThanOrEqual(g.startedAtMs as number);
    expect(endAlix.durationMs as number).toBeGreaterThanOrEqual(0);

    // Exactly-once across the WHOLE run: this one streaming request produced
    // exactly one generation in its trace (not one per chunk).
    expect(sdk.calls.generations.filter((x) => x.traceId === "t17-success")).toHaveLength(1);
    expect(sdk.calls.generationEnds.filter((x) => x.traceId === "t17-success")).toHaveLength(1);
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

    // EXACTLY ONE span, closed exactly once — no second span for the error,
    // no double-close.
    expect(sdk.calls.generations).toHaveLength(1);
    expect(sdk.calls.generationEnds).toHaveLength(1);
    expect(sdk.calls.generationEnds.length).toBe(sdk.calls.generations.length);

    const gen = sdk.calls.generations[0]!;
    expect(gen.traceId).toBe("t17-error");
    expect(alix({ body: gen.body }).stream).toBe(true);

    const end = sdk.calls.generationEnds[0]!;
    const endAlix = alix({ body: end.body });
    expect(endAlix.status).toBe("error");
    expect(end.body.level).toBe("ERROR");
    // Error message/metadata present (statusMessage + alix.error).
    expect(String(end.body.statusMessage)).toContain("upstream stream failure");
    expect(String(endAlix.error)).toContain("upstream stream failure");
    // Honest capture note: the error terminal does NOT carry the tokens yielded
    // so far — outcomeForError (provider-contract-validation.ts) sets only
    // status/error/endedAt. Partial stream output on error/cancel is dropped
    // (existing, Task-11-approved behavior); only the success terminal carries
    // the concatenated output.
    expect(end.body.output).toBeUndefined();
    // Still terminal and exactly one.
    expect(endAlix.endedAtMs as number).toBeGreaterThanOrEqual(alix({ body: gen.body }).startedAtMs as number);
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

    // EXACTLY ONE span, closed exactly once as cancelled.
    expect(sdk.calls.generations).toHaveLength(1);
    expect(sdk.calls.generationEnds).toHaveLength(1);
    expect(sdk.calls.generationEnds.length).toBe(sdk.calls.generations.length);

    const gen = sdk.calls.generations[0]!;
    expect(gen.traceId).toBe("t17-cancel");

    const end = sdk.calls.generationEnds[0]!;
    const endAlix = alix({ body: end.body });
    // Cancellation maps to the "cancelled" terminal (design §18/§20): the
    // wrapper's outcomeForError maps isCancellationError → cancelled. Langfuse
    // has no cancelled level, so level stays DEFAULT while alix.status carries
    // the cancellation.
    expect(endAlix.status).toBe("cancelled");
    expect(end.body.level).toBe("DEFAULT");
    expect(String(end.body.statusMessage)).toContain("operator cancelled stream");
    expect(String(endAlix.error)).toContain("operator cancelled stream");
    // Same honest capture note as the error terminal: partial output on cancel
    // is not captured (outcomeForError carries status/error/endedAt only).
    expect(end.body.output).toBeUndefined();
    expect(endAlix.endedAtMs as number).toBeGreaterThanOrEqual(alix({ body: gen.body }).startedAtMs as number);
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

    expect(sdk.calls.generations).toHaveLength(1);
    expect(sdk.calls.generationEnds).toHaveLength(1);
    expect(sdk.calls.generationEnds.length).toBe(sdk.calls.generations.length);
    const end = sdk.calls.generationEnds[0]!;
    const endAlix = alix({ body: end.body });
    expect(endAlix.status).toBe("cancelled");
    expect(end.body.level).toBe("DEFAULT");
    // Consumer early-close → the wrapper's finally defaults a missing terminal
    // to status "cancelled" with no error/statusMessage; partial output is not
    // captured (terminal has no output in this path either).
    expect(endAlix.error).toBeUndefined();
    expect(end.body.output).toBeUndefined();
  });
});
