// src/providers/provider-contract-validation.ts
//
// P0.2 — Runtime contract validation at the LLM provider boundary.
// Wraps a ModelAdapter to validate NormalizedRequest before complete()
// and NormalizedResponse after complete(), using Effect Schema contracts.
//
// Wrapper preserves the full ModelAdapter interface.
// No streaming validation yet — stream() and negotiate() pass through.

import type { ModelAdapter, NormalizedRequest, NormalizedResponse } from "./types.js";
import { Either } from "effect";
import { decode, formatErrors } from "../contracts/helpers.js";
import { NormalizedRequestSchema, NormalizedResponseSchema } from "../contracts/llm-schemas.js";

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

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap a ModelAdapter with request/response contract validation.
 *
 * - Before complete(): validates NormalizedRequest
 * - After complete(): validates NormalizedResponse
 * - stream() and negotiate() pass through unchanged
 * - All non-function properties (id, capabilities, etc.) pass through
 */
export function withProviderContracts(adapter: ModelAdapter): ModelAdapter {
  return {
    // Forward all existing adapter properties (id, capabilities, stream,
    // negotiate, and any future ModelAdapter additions)
    ...adapter,

    // Override complete with request/response contract validation
    async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
      const validatedRequest = validateNormalizedRequest(request);
      const response = await adapter.complete(validatedRequest);
      return validateNormalizedResponse(response);
    },
  };
}
