// src/providers/provider-contract-validation.ts
//
// P0.2 — Runtime contract validation at the LLM provider boundary.
// Wraps a ModelAdapter to validate NormalizedRequest before complete()
// and NormalizedResponse after complete(), using Effect Schema contracts.
//
// Wrapper preserves the full ModelAdapter interface.
// No streaming validation yet — stream() and negotiate() pass through.

import type { ModelAdapter, NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";
import { Either } from "effect";
import { decode, formatErrors } from "../contracts/helpers.js";
import { NormalizedRequestSchema, NormalizedResponseSchema, StreamChunkSchema } from "../contracts/llm-schemas.js";
import { buildDiagnostic, formatDiagnostic, type ContractDiagnostic, type ContractBoundary } from "../contracts/contract-diagnostics.js";
import { withTimeout, SideEffectTimeoutError } from "../runtime/side-effect-timeout.js";
import { consoleSink } from "../runtime/runtime-diagnostics.js";

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
): ContractDiagnostic {
  return buildDiagnostic("provider", boundary, schema, error, entityId);
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
): ModelAdapter {
  function emit(diag: ContractDiagnostic): void {
    onDiagnostic?.(diag);
  }

  return {
    // Forward all existing adapter properties
    ...adapter,

    // Override complete with request/response contract validation
    async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
      try {
        const validatedRequest = validateNormalizedRequest(request);
        const response = timeoutMs
          ? await withTimeout(
              `provider.complete:${adapter.id}`,
              timeoutMs,
              () => adapter.complete(validatedRequest),
              (d) => consoleSink.emit(d),
            )
          : await adapter.complete(validatedRequest);
        return validateNormalizedResponse(response);
      } catch (e: unknown) {
        if (e instanceof ContractValidationError && onDiagnostic) {
          const diag = diagProvider(
            e.message.includes("Request") ? "complete.request" : "complete.response",
            e.message.includes("Request") ? "NormalizedRequestSchema" : "NormalizedResponseSchema",
            e.details ?? e.message,
            (request as any).toolCalls?.[0]?.id,
          );
          emit(diag);
        }
        throw e;
      }
    },

    // Override stream with request and per-chunk validation
    ...(adapter.stream
      ? {
          stream: async function* (
            request: NormalizedRequest,
          ): AsyncGenerator<StreamChunk> {
            // Validate request before starting stream
            try {
              validateNormalizedRequest(request);
            } catch (e: unknown) {
              if (e instanceof ContractValidationError && onDiagnostic) {
                emit(diagProvider("stream.request", "NormalizedRequestSchema", e.details ?? e.message));
              }
              throw e;
            }

            const rawStream = adapter.stream!(request);

            // Wrap with idle timeout when configured
            const timedStream = streamIdleTimeoutMs
              ? withStreamIdleTimeout(rawStream, streamIdleTimeoutMs, onDiagnostic)
              : rawStream;

            for await (const chunk of timedStream) {
              try {
                yield validateStreamChunk(chunk);
              } catch (e: unknown) {
                if (e instanceof ContractValidationError && onDiagnostic) {
                  emit(diagProvider("stream.chunk", "StreamChunkSchema", e.details ?? e.message));
                }
                throw e;
              }
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
