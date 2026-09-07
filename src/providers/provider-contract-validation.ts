// src/providers/provider-contract-validation.ts
//
// P0.2 — Runtime contract validation at the LLM provider boundary.
// Wraps a ModelAdapter to validate NormalizedRequest before complete()
// and NormalizedResponse after complete(), using Effect Schema contracts.
//
// Wrapper preserves the full ModelAdapter interface.
// No streaming validation yet — stream() and negotiate() pass through.

import type { ModelAdapter, NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";
import type { ExecutionContext } from "../observability/execution-context.js";
import { Either } from "effect";
import { decode, formatErrors } from "../contracts/helpers.js";
import { NormalizedRequestSchema, NormalizedResponseSchema, StreamChunkSchema } from "../contracts/llm-schemas.js";
import { buildDiagnostic, formatDiagnostic, type ContractDiagnostic, type ContractBoundary } from "../contracts/contract-diagnostics.js";
import { withTimeout, SideEffectTimeoutError } from "../runtime/side-effect-timeout.js";
import { consoleSink, createMultiplexDiagnosticSink } from "../runtime/runtime-diagnostics.js";
import { createDiagnosticStoreSink, DiagnosticEventStore } from "../observability/diagnostic-event-store.js";
import { isCancellationError } from "../runtime/cancellation-token.js";
import { getProcessTraceClient } from "../tracing/client-factory.js";
import type { TraceClient } from "../tracing/client.js";
import type { ModelSpanInput, SpanOutcome, TraceRun, TraceSpan } from "../tracing/types.js";

const diagSink = createMultiplexDiagnosticSink(
  consoleSink,
  createDiagnosticStoreSink(new DiagnosticEventStore(process.cwd() + "/.alix/diagnostics")),
);

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class ContractValidationError extends Error {
  readonly code = "CONTRACT_VALIDATION_ERROR";
  constructor(message: string, public readonly details?: string) {
    super(message);
    this.name = "ContractValidationError";
  }
}

// ---------------------------------------------------------------------------
// Individual validators
// ---------------------------------------------------------------------------

/**
 * Validate an unknown input as a NormalizedRequest.
 * Returns the decoded request on success.
 * Throws ContractValidationError on failure.
 */
export function validateNormalizedRequest(input: unknown): NormalizedRequest {
  const result = decode(NormalizedRequestSchema, input);
  if (Either.isLeft(result)) {
    const formatted = formatErrors(result.left);
    throw new ContractValidationError(
      "NormalizedRequest validation failed",
      formatted,
    );
  }
  return result.right as unknown as NormalizedRequest;
}

/**
 * Validate an unknown input as a NormalizedResponse.
 * Returns the decoded response on success.
 * Throws ContractValidationError on failure.
 */
export function validateNormalizedResponse(input: unknown): NormalizedResponse {
  const result = decode(NormalizedResponseSchema, input);
  if (Either.isLeft(result)) {
    const formatted = formatErrors(result.left);
    throw new ContractValidationError(
      "NormalizedResponse validation failed",
      formatted,
    );
  }
  return result.right as unknown as NormalizedResponse;
}

/**
 * Validate an unknown input as a StreamChunk.
 * Returns the decoded chunk on success.
 * Throws ContractValidationError on failure.
 */
export function validateStreamChunk(input: unknown): StreamChunk {
  const result = decode(StreamChunkSchema, input);
  if (Either.isLeft(result)) {
    const formatted = formatErrors(result.left);
    throw new ContractValidationError(
      "StreamChunk validation failed",
      formatted,
    );
  }
  return result.right as unknown as StreamChunk;
}

// ---------------------------------------------------------------------------
// Diagnostics helpers
// ---------------------------------------------------------------------------

function diagProvider(
  boundary: ContractBoundary,
  schema: string,
  error: string,
  entityId?: string,
  context?: ExecutionContext,
): ContractDiagnostic {
  return buildDiagnostic("provider", boundary, schema, error, entityId, context);
}

// ---------------------------------------------------------------------------
// Model-span instrumentation (design §18-20; Task 11)
//
// Every PHYSICAL provider request produces exactly ONE model span (streaming is
// one span over its lifetime, never one per chunk). Spans are started here,
// immediately before the physical request, and ended exactly once on the
// request's terminal (success / error / cancellation / stream end). Capture
// (redaction + truncation per capture.messages/maxMessageChars — M1/M2) is the
// TraceClient adapter's job; this seam supplies raw normalized payloads only.
// A request without an active trace run yields no span and never throws.
// ---------------------------------------------------------------------------

/** An in-flight model span, or null when no active run exists for the request. */
type ModelSpanHandle = { client: TraceClient; span: TraceSpan } | null;

/**
 * Begin a model span for one physical provider request. Returns null when the
 * resolved request context has no runId, when tracing is disabled (Noop client
 * — getRun always null), or when the run is unknown/not started — always a
 * safe no-op, never a throw. Fail-open: any tracing error degrades to "no span"
 * and cannot affect the provider call.
 */
async function beginModelSpan(
  adapter: ModelAdapter,
  request: NormalizedRequest,
  callContext: ExecutionContext | undefined,
  stream: boolean,
): Promise<ModelSpanHandle> {
  const runId = callContext?.runId;
  if (typeof runId !== "string" || runId.length === 0) return null;

  let client: TraceClient;
  try {
    // Same process client the run roots use (factory is memoized per process);
    // the lazy-load fix keeps the Langfuse module graph off the disabled path.
    client = await getProcessTraceClient();
  } catch {
    return null;
  }
  let run: TraceRun | null = null;
  try {
    run = client.getRun(runId);
  } catch {
    return null;
  }
  if (run === null) return null;

  const caps = adapter.capabilities;
  const input: ModelSpanInput = {
    // Physical adapter labels first (per-physical fidelity for routed fallbacks),
    // falling back to the logical ExecutionContext and adapter id.
    provider: caps?.provider ?? callContext?.providerId ?? adapter.id,
    model: caps?.model ?? callContext?.model ?? adapter.id,
    messages: request.messages,
    systemPrompt: request.systemPrompt,
    stream,
    startedAt: Date.now(),
  };
  try {
    return { client, span: client.startModelSpan(run, input) };
  } catch {
    return null;
  }
}

/** End a model span exactly once; a no-op when no span was begun. Fail-open. */
function endModelSpan(handle: ModelSpanHandle, outcome: SpanOutcome): void {
  if (handle === null) return;
  try {
    handle.client.endSpan(handle.span, outcome);
  } catch {
    // Tracing must never change provider results.
  }
}

function outcomeForError(e: unknown, endedAt: number): SpanOutcome {
  return {
    status: isCancellationError(e) ? "cancelled" : "error",
    error: e instanceof Error ? e.message : String(e),
    endedAt,
  };
}

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap a ModelAdapter with request/response/stream contract validation.
 *
 * - Before complete(): validates NormalizedRequest
 * - After complete(): validates NormalizedResponse
 * - Before stream(): validates NormalizedRequest
 * - Each yielded chunk from stream() is validated against StreamChunkSchema
 * - negotiate() passes through unchanged
 * - All non-function properties (id, capabilities, etc.) pass through
 *
 * @param onDiagnostic Optional callback fired before throwing on validation
 *   failure. Receives a structured ContractDiagnostic for observability.
 *   The error is still thrown after the callback.
 */
export function withProviderContracts(
  adapter: ModelAdapter,
  onDiagnostic?: (diag: ContractDiagnostic) => void,
  timeoutMs?: number,
  streamIdleTimeoutMs?: number,
  defaultContext?: ExecutionContext,
): ModelAdapter {
  function emit(diag: ContractDiagnostic): void {
    onDiagnostic?.(diag);
  }

  /** Merge default context with per-request context. Per-request takes precedence. */
  function resolveContext(request: NormalizedRequest): ExecutionContext | undefined {
    if (request.context && defaultContext) {
      return { ...defaultContext, ...request.context };
    }
    return request.context ?? defaultContext;
  }

  return {
    // Forward all existing adapter properties (including getter-based capabilities)
    ...adapter,
    get capabilities() {
      return adapter.capabilities;
    },
    get id() {
      return adapter.id;
    },
    get editFormatPreference() {
      return adapter.editFormatPreference;
    },
    get longContextStrategy() {
      return adapter.longContextStrategy;
    },

    // Override complete with request/response contract validation + one model
    // span per physical request (Task 11).
    async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
      const callContext = resolveContext(request);
      // Started after request validation passes (a malformed request that never
      // reaches the provider produces no span); ended exactly once on success
      // or any throw.
      let span: ModelSpanHandle = null;
      try {
        const validatedRequest = validateNormalizedRequest(request);
        span = await beginModelSpan(adapter, request, callContext, false);
        const response = timeoutMs
          ? await withTimeout(
              `provider.complete:${adapter.id}`,
              timeoutMs,
              () => adapter.complete(validatedRequest),
              (d) => diagSink.emit(d),
            )
          : await adapter.complete(validatedRequest);
        const validated = validateNormalizedResponse(response);
        endModelSpan(span, {
          status: "success",
          output: validated.text,
          reasoning: validated.reasoning,
          inputTokens: validated.usage?.inputTokens,
          outputTokens: validated.usage?.outputTokens,
          finishReason: validated.finishReason,
          endedAt: Date.now(),
        });
        return validated;
      } catch (e: unknown) {
        endModelSpan(span, outcomeForError(e, Date.now()));
        if (e instanceof ContractValidationError && onDiagnostic) {
          const diag = diagProvider(
            e.message.includes("Request") ? "complete.request" : "complete.response",
            e.message.includes("Request") ? "NormalizedRequestSchema" : "NormalizedResponseSchema",
            e.details ?? e.message,
            (request as any).toolCalls?.[0]?.id,
            callContext,
          );
          emit(diag);
        }
        throw e;
      }
    },

    // Override stream with request and per-chunk validation, plus one model
    // span spanning the whole stream (Task 11).
    ...(adapter.stream
      ? {
          stream: async function* (
            request: NormalizedRequest,
          ): AsyncGenerator<StreamChunk> {
            const callContext = resolveContext(request);

            // Validate request before starting stream
            try {
              validateNormalizedRequest(request);
            } catch (e: unknown) {
              if (e instanceof ContractValidationError && onDiagnostic) {
                emit(diagProvider("stream.request", "NormalizedRequestSchema", e.details ?? e.message, undefined, callContext));
              }
              throw e;
            }

            // One span per physical stream request, started before the
            // underlying stream and ended exactly once on stream termination
            // (natural completion / error / cancellation / consumer early-close).
            const span = await beginModelSpan(adapter, request, callContext, true);

            const rawStream = adapter.stream!(request);

            // Wrap with idle timeout when configured
            const timedStream = streamIdleTimeoutMs
              ? withStreamIdleTimeout(rawStream, streamIdleTimeoutMs, onDiagnostic)
              : rawStream;

            let outputText = "";
            let reasoningText = "";
            let inputTokens: number | undefined;
            let outputTokens: number | undefined;
            let finishReason: string | undefined;

            // Set by the terminal branch. Undefined at the finally ⇒ the stream
            // ended without a natural completion (consumer break/return).
            let terminal: SpanOutcome | undefined;

            try {
              for await (const chunk of timedStream) {
                try {
                  const validated = validateStreamChunk(chunk);
                  // Accumulate from the RAW chunk: contract decode strips
                  // fields the schemas omit (e.g. done.finishReason), while
                  // the span should record what the provider actually emitted.
                  if (chunk.type === "text_delta") {
                    outputText += chunk.text;
                  } else if (chunk.type === "reasoning_delta") {
                    reasoningText += chunk.text;
                  } else if (chunk.type === "usage") {
                    inputTokens = chunk.usage.inputTokens;
                    outputTokens = chunk.usage.outputTokens;
                  } else if (chunk.type === "done" && chunk.finishReason !== undefined) {
                    finishReason = chunk.finishReason;
                  }
                  yield validated;
                } catch (e: unknown) {
                  if (e instanceof ContractValidationError && onDiagnostic) {
                    emit(diagProvider("stream.chunk", "StreamChunkSchema", e.details ?? e.message, undefined, callContext));
                  }
                  throw e;
                }
              }
              terminal = {
                status: "success",
                output: outputText,
                reasoning: reasoningText,
                inputTokens,
                outputTokens,
                finishReason,
                endedAt: Date.now(),
              };
              return;
            } catch (e: unknown) {
              terminal = outcomeForError(e, Date.now());
              throw e;
            } finally {
              if (terminal === undefined) {
                terminal = { status: "cancelled", endedAt: Date.now() };
              }
              endModelSpan(span, terminal);
            }
          },
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Stream idle timeout helper
// ---------------------------------------------------------------------------

/**
 * Wraps an AsyncGenerator with a per-chunk idle timeout.
 * Each yielded chunk resets the timer. Stalled streams (no chunk within
 * the idle window) reject with SideEffectTimeoutError.
 */
async function* withStreamIdleTimeout(
  stream: AsyncGenerator<StreamChunk>,
  idleTimeoutMs: number,
  onDiagnostic?: (diag: ContractDiagnostic) => void,
): AsyncGenerator<StreamChunk> {
  const iterator = stream[Symbol.asyncIterator]();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const startTimer = () => {
    timer = setTimeout(() => {
      timer = null;
    }, idleTimeoutMs);
  };

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  try {
    while (true) {
      // Wait for next chunk with idle timeout
      const result = await withTimeout(
        "stream.idle",
        idleTimeoutMs,
        () => iterator.next(),
        onDiagnostic ? (d) => consoleSink.emit(d) : undefined,
      );

      if (result.done) break;
      const chunk = result.value;

      clearTimer();
      yield chunk;
      startTimer(); // Reset timer for next chunk
    }
  } finally {
    clearTimer();
  }
}
