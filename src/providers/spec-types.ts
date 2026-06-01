// src/providers/spec-types.ts
import type { NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

/**
 * Pure-function specification for an LLM provider.
 *
 * Each provider translates between ALiX's normalized request/response format
 * and the provider's native API format. No I/O, no state — just functions.
 *
 * The dispatcher in `unified-complete.ts` uses these specs to handle HTTP,
 * retries, and streaming. Provider classes (e.g., `OpenAIProvider`) are
 * thin wrappers that delegate to the dispatcher.
 */
export type ProviderSpec = {
  /** API endpoint URL (no trailing slash) */
  baseUrl: string;

  /** Build auth headers from API key */
  authHeader: (apiKey: string) => Record<string, string>;

  /** Translate a normalized request into the provider's request body shape */
  toRequestBody: (req: NormalizedRequest & { model: string }) => unknown;

  /** Translate the provider's JSON response into a normalized response */
  fromResponse: (res: unknown) => NormalizedResponse;

  /** Parse a single SSE/NDJSON line into a stream chunk, or null if heartbeat */
  fromStreamChunk: (line: string) => StreamChunk | null;

  /** Format a provider error response into a human-readable message */
  toErrorMessage: (status: number, body: unknown) => string;
};
