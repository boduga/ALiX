/**
 * model-span-wiring.vitest.ts — Task 11
 *
 * Verifies withProviderContracts emits exactly ONE model span per PHYSICAL
 * provider request when tracing is enabled, and zero span work with identical
 * results when tracing is disabled / the run is unknown / the request context
 * has no runId.
 *
 * The wrapper reaches the TraceClient through `getProcessTraceClient()`
 * (client-factory), which is mocked here to inject a recording fake client (no
 * Langfuse SDK). A run is registered on the fake via startRun(runId) — exactly
 * how a run root establishes the active trace before any provider request — so
 * getRun(context.runId) resolves for traced requests only.
 *
 * Covers:
 *   - complete(): success → 1 span (success), throw → 1 span (error/cancelled),
 *     request-validation error → 0 spans, response-validation error → 1 span
 *     (error), fail-open when startModelSpan throws.
 *   - stream(): one span over the whole stream (never per chunk) across success,
 *     mid-stream error, consumer early-close (cancelled), and empty streams.
 *   - disabled (Noop client) / unknown runId / absent runId → no span, no throw,
 *     results identical.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ModelAdapter, NormalizedRequest, NormalizedResponse, StreamChunk } from "../../src/providers/types.js";
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

import { withProviderContracts } from "../../src/providers/provider-contract-validation.js";

// ---------------------------------------------------------------------------
// Recording fake TraceClient
// ---------------------------------------------------------------------------

class RecordingTraceClient implements TraceClient {
  started: ModelSpanInput[] = [];
  ended: { input: ModelSpanInput | undefined; outcome: SpanOutcome }[] = [];
  private runs = new Map<string, TraceRun>();
  failStartModelSpan = false;

  startRun(input: TraceRunInput): TraceRun {
    const handle = { runId: input.runId } as TraceRun;
    this.runs.set(input.runId, handle);
    return handle;
  }

  getRun(runId: string): TraceRun | null {
    return this.runs.get(runId) ?? null;
  }

  startModelSpan(run: TraceRun, input: ModelSpanInput): TraceSpan {
    if (this.failStartModelSpan) throw new Error("startModelSpan boom");
    this.started.push(input);
    return { idx: this.started.length - 1 } as unknown as TraceSpan;
  }

  startToolSpan(_run: TraceRun, _input: ToolSpanInput): TraceSpan {
    return {} as TraceSpan;
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

const RUN_ID = "run-wired000";

function fakeAdapter(overrides?: Partial<ModelAdapter>): ModelAdapter {
  return {
    id: "openrouter",
    capabilities: {
      provider: "openrouter",
      model: "openai/gpt-4o",
      inputTokenLimit: 1000,
      outputTokenLimit: 1000,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: false,
      supportsVision: false,
      parallelToolCalls: false,
    },
    editFormatPreference: "structured_patch",
    longContextStrategy: "expanded_context",
    complete: async () => ({
      text: "Hello from fake adapter",
      toolCalls: [],
    }),
    ...overrides,
  };
}

function request(overrides?: Partial<NormalizedRequest>): NormalizedRequest {
  return {
    systemPrompt: "You are a helper",
    messages: [{ role: "user", content: "Hi" }],
    context: { runId: RUN_ID, providerId: "openrouter", model: "openai/gpt-4o" },
    ...overrides,
  };
}

function chunkFixture(): StreamChunk[] {
  return [
    { type: "text_delta", text: "Hello " },
    { type: "reasoning_delta", text: "(thinking)" },
    { type: "text_delta", text: "world" },
    { type: "usage", usage: { inputTokens: 12, outputTokens: 3 } },
    { type: "done", finishReason: "stop" },
  ];
}

async function* fromChunks(chunks: StreamChunk[]): AsyncGenerator<StreamChunk> {
  for (const chunk of chunks) yield chunk;
}

function collect(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  return (async () => {
    const out: StreamChunk[] = [];
    for await (const c of gen) out.push(c);
    return out;
  })();
}

beforeEach(() => {
  mocks.getProcessTraceClient.mockReset();
  mocks.getProcessTraceClient.mockResolvedValue(NOOP_TRACE_CLIENT);
});

function enable(client: RecordingTraceClient, runId: string = RUN_ID): void {
  mocks.getProcessTraceClient.mockResolvedValue(client);
  client.startRun({ runId });
}

// ---------------------------------------------------------------------------
// complete()
// ---------------------------------------------------------------------------

describe("withProviderContracts model spans — complete()", () => {
  it("emits exactly one success span per physical complete()", async () => {
    const recorder = new RecordingTraceClient();
    enable(recorder);
    const wrapped = withProviderContracts(fakeAdapter());

    const response = await wrapped.complete(request());

    expect(response.text).toBe("Hello from fake adapter");
    expect(recorder.started).toHaveLength(1);
    expect(recorder.ended).toHaveLength(1);

    const input = recorder.started[0]!;
    expect(input.provider).toBe("openrouter");
    expect(input.model).toBe("openai/gpt-4o");
    expect(input.stream).toBe(false);
    expect(input.systemPrompt).toBe("You are a helper");
    expect(input.messages).toHaveLength(1);
    expect(input.startedAt).toBeTypeOf("number");

    const end = recorder.ended[0]!;
    expect(end.outcome.status).toBe("success");
    expect(end.outcome.output).toBe("Hello from fake adapter");
    expect(end.outcome.inputTokens).toBeUndefined();
    expect(end.outcome.finishReason).toBeUndefined();
  });

  it("captures output text, usage tokens and finishReason from the response", async () => {
    const recorder = new RecordingTraceClient();
    enable(recorder);
    const wrapped = withProviderContracts(
      fakeAdapter({
        complete: async () =>
          ({
            text: "answer",
            toolCalls: [],
            usage: { inputTokens: 10, outputTokens: 5 },
            finishReason: "stop",
            resolvedModel: "openai/gpt-4o:free",
          }) satisfies NormalizedResponse,
      }),
    );

    await wrapped.complete(request());

    expect(recorder.ended[0]!.outcome).toMatchObject({
      status: "success",
      output: "answer",
      inputTokens: 10,
      outputTokens: 5,
      finishReason: "stop",
    });
  });

  it("captures reasoning text when the response carries it", async () => {
    const recorder = new RecordingTraceClient();
    enable(recorder);
    const wrapped = withProviderContracts(
      fakeAdapter({
        complete: async () =>
          ({ text: "answer", reasoning: "deep thought", toolCalls: [] }) satisfies NormalizedResponse,
      }),
    );

    await wrapped.complete(request());
    expect(recorder.ended[0]!.outcome.reasoning).toBe("deep thought");
  });

  it("emits one error span and rethrows when the physical call throws", async () => {
    const recorder = new RecordingTraceClient();
    enable(recorder);
    const wrapped = withProviderContracts(
      fakeAdapter({
        complete: async () => {
          throw new Error("upstream down");
        },
      }),
    );

    await expect(wrapped.complete(request())).rejects.toThrow("upstream down");
    expect(recorder.started).toHaveLength(1);
    expect(recorder.ended).toHaveLength(1);
    expect(recorder.ended[0]!.outcome).toMatchObject({ status: "error", error: "upstream down" });
  });

  it("maps a cancelled error to a cancelled span and rethrows", async () => {
    const recorder = new RecordingTraceClient();
    enable(recorder);
    const wrapped = withProviderContracts(
      fakeAdapter({
        complete: async () => {
          throw new ExecutionCancelledError("operator cancel");
        },
      }),
    );

    await expect(wrapped.complete(request())).rejects.toBeInstanceOf(ExecutionCancelledError);
    expect(recorder.ended[0]!.outcome.status).toBe("cancelled");
  });

  it("emits NO span when request validation fails (no physical request)", async () => {
    const recorder = new RecordingTraceClient();
    enable(recorder);
    const wrapped = withProviderContracts(fakeAdapter());

    await expect(wrapped.complete(request({ systemPrompt: undefined } as any))).rejects.toThrow();
    expect(recorder.started).toHaveLength(0);
    expect(recorder.ended).toHaveLength(0);
  });

  it("emits one error span when the RESPONSE fails validation (physical request happened)", async () => {
    const recorder = new RecordingTraceClient();
    enable(recorder);
    const wrapped = withProviderContracts(
      fakeAdapter({ complete: async () => ({ text: 42 }) as any }),
    );

    await expect(wrapped.complete(request())).rejects.toThrow();
    expect(recorder.started).toHaveLength(1);
    expect(recorder.ended).toHaveLength(1);
    expect(recorder.ended[0]!.outcome.status).toBe("error");
  });

  it("fails open when startModelSpan throws — provider result is unaffected", async () => {
    const recorder = new RecordingTraceClient();
    recorder.failStartModelSpan = true;
    enable(recorder);
    const wrapped = withProviderContracts(fakeAdapter());

    const response = await wrapped.complete(request());
    expect(response.text).toBe("Hello from fake adapter");
    expect(recorder.ended).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// stream()
// ---------------------------------------------------------------------------

describe("withProviderContracts model spans — stream()", () => {
  it("emits ONE span across many chunks (never per chunk)", async () => {
    const recorder = new RecordingTraceClient();
    enable(recorder);
    const wrapped = withProviderContracts(
      fakeAdapter({ stream: () => fromChunks(chunkFixture()) }),
    );

    const chunks = await collect(wrapped.stream!(request()));

    expect(chunks.map((c) => c.type)).toEqual(["text_delta", "reasoning_delta", "text_delta", "usage", "done"]);
    expect(recorder.started).toHaveLength(1);
    expect(recorder.ended).toHaveLength(1);
    expect(recorder.started[0]!.stream).toBe(true);

    const end = recorder.ended[0]!;
    expect(end.outcome.status).toBe("success");
    expect(end.outcome.output).toBe("Hello world");
    expect(end.outcome.reasoning).toBe("(thinking)");
    expect(end.outcome.inputTokens).toBe(12);
    expect(end.outcome.outputTokens).toBe(3);
    expect(end.outcome.finishReason).toBe("stop");
  });

  it("emits one error span and propagates on mid-stream failure", async () => {
    const recorder = new RecordingTraceClient();
    enable(recorder);
    async function* failing(): AsyncGenerator<StreamChunk> {
      yield { type: "text_delta", text: "partial" };
      throw new Error("stream broke");
    }
    const wrapped = withProviderContracts(fakeAdapter({ stream: () => failing() }));

    await expect(collect(wrapped.stream!(request()))).rejects.toThrow("stream broke");
    expect(recorder.started).toHaveLength(1);
    expect(recorder.ended).toHaveLength(1);
    expect(recorder.ended[0]!.outcome).toMatchObject({ status: "error", error: "stream broke" });
  });

  it("ends one span as cancelled when the consumer closes the stream early", async () => {
    const recorder = new RecordingTraceClient();
    enable(recorder);
    const wrapped = withProviderContracts(
      fakeAdapter({ stream: () => fromChunks(chunkFixture()) }),
    );

    const iterator = wrapped.stream!(request())[Symbol.asyncIterator]();
    await iterator.next(); // consumer receives first chunk, then abandons
    await iterator.return?.(undefined);

    expect(recorder.started).toHaveLength(1);
    expect(recorder.ended).toHaveLength(1);
    expect(recorder.ended[0]!.outcome.status).toBe("cancelled");
  });

  it("emits one success span for an empty (completed) stream", async () => {
    const recorder = new RecordingTraceClient();
    enable(recorder);
    const wrapped = withProviderContracts(
      fakeAdapter({ stream: () => fromChunks([]) }),
    );

    const chunks = await collect(wrapped.stream!(request()));
    expect(chunks).toHaveLength(0);
    expect(recorder.started).toHaveLength(1);
    expect(recorder.ended).toHaveLength(1);
    expect(recorder.ended[0]!.outcome).toMatchObject({ status: "success", output: "" });
  });

  it("emits NO span when the stream request fails validation", async () => {
    const recorder = new RecordingTraceClient();
    enable(recorder);
    const wrapped = withProviderContracts(
      fakeAdapter({ stream: () => fromChunks([{ type: "text_delta", text: "x" }]) }),
    );

    await expect(
      collect(wrapped.stream!({ systemPrompt: "x", context: { runId: RUN_ID } } as any)),
    ).rejects.toThrow();
    expect(recorder.started).toHaveLength(0);
    expect(recorder.ended).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Disabled / unknown / absent run
// ---------------------------------------------------------------------------

describe("withProviderContracts model spans — disabled & unresolvable runs", () => {
  it("produces no span work and identical results when tracing is disabled (Noop)", async () => {
    // Default: getProcessTraceClient resolves to NOOP_TRACE_CLIENT.
    const wrapped = withProviderContracts(
      fakeAdapter({ stream: () => fromChunks(chunkFixture()) }),
    );

    const response = await wrapped.complete(request());
    expect(response.text).toBe("Hello from fake adapter");

    const streamed = await collect(wrapped.stream!(request()));
    expect(streamed.map((c) => c.type)).toEqual(["text_delta", "reasoning_delta", "text_delta", "usage", "done"]);
  });

  it("produces no span when the runId is unknown to the client (no throw)", async () => {
    const recorder = new RecordingTraceClient();
    mocks.getProcessTraceClient.mockResolvedValue(recorder);
    // No startRun → getRun returns null.
    const wrapped = withProviderContracts(fakeAdapter());

    const response = await wrapped.complete(request());
    expect(response.text).toBe("Hello from fake adapter");
    expect(recorder.started).toHaveLength(0);
    expect(recorder.ended).toHaveLength(0);
  });

  it("produces no span when the request context has no runId (no throw)", async () => {
    const recorder = new RecordingTraceClient();
    enable(recorder);
    const wrapped = withProviderContracts(fakeAdapter());

    // Mirrors classifier/direct-gen/plan calls that carry no runId.
    const response = await wrapped.complete(request({ context: { providerId: "openrouter", model: "openai/gpt-4o" } }));
    expect(response.text).toBe("Hello from fake adapter");
    expect(recorder.started).toHaveLength(0);
    expect(recorder.ended).toHaveLength(0);
  });
});
