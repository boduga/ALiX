import { openaiBaseSpec } from "./_openai-base.js";
import type { ProviderSpec } from "../spec-types.js";

/**
 * Default base URL for a local FreeLLMAPI server (docker/desktop default).
 * FreeLLMAPI aggregates free LLM tiers behind a single OpenAI-compatible
 * `/v1` endpoint; auth is a unified `freellmapi-…` Bearer token.
 */
export const DEFAULT_FREELLMAPI_BASE_URL = "http://localhost:3001";

export const freellmapiSpec: ProviderSpec = {
  ...openaiBaseSpec,
  baseUrl: `${DEFAULT_FREELLMAPI_BASE_URL}/v1/chat/completions`,
};
