/**
 * P6.5b — ProviderCatalogAdapter: LLMAdapter backed by an ALiX ModelAdapter.
 *
 * Wraps ModelAdapter.complete() to match the LLMAdapter interface.
 * Thin — no retry, no fallback, no prompt shaping.
 *
 * @module
 */

import type { LLMAdapter, LLMCompletion } from "./llm-adapter.js";
import type { ModelAdapter } from "../providers/types.js";

export class ProviderCatalogAdapter implements LLMAdapter {
  constructor(
    private adapter: ModelAdapter,
    private providerInfo: { provider: string; model?: string },
  ) {}

  async complete(
    input: { system: string; user: string },
    options?: { timeoutMs?: number },
  ): Promise<LLMCompletion> {
    const result = await this.adapter.complete({
      systemPrompt: input.system,
      messages: [{ role: "user" as const, content: input.user }],
      temperature: 0,
      maxOutputTokens: 512,
    });
    if (!result.text) throw new Error("Empty response from provider");
    return {
      content: result.text,
      provider: this.providerInfo.provider,
      model: this.providerInfo.model,
    };
  }
}
