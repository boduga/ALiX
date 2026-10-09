/**
 * P6.5b — LLMAdapter interface.
 *
 * Thin boundary between governance lenses and LLM providers.
 * Enables lens execution without depending on provider internals.
 *
 * @module
 */

export interface LLMCompletion {
  content: string;
  provider?: string;
  model?: string;
}

export interface LLMAdapter {
  /** Send a prompt and return the response.
   *  Throws on timeout, network error, or empty response.
   *  Caller owns retry/fallback logic. */
  complete(
    input: { system: string; user: string },
    options?: { timeoutMs?: number },
  ): Promise<LLMCompletion>;
}
