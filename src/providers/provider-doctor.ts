/**
 * provider-doctor.ts — Run a test completion and streaming round-trip
 * for a provider. Verifies that the provider responds, returns valid
 * output, and (if supported) streams text deltas.
 */

import { complete, stream } from "./unified-complete.js";
import type { NormalizedRequest } from "./types.js";

export type ProviderHealthResult = {
  provider: string;
  model: string;
  hasApiKey: boolean;
  completeOk: boolean;
  streamOk: boolean;
  durationMs: number;
  error?: string;
};

const TEST_PROMPT = 'Respond with exactly one word: "ok"';

const TEST_REQUEST: NormalizedRequest = {
  systemPrompt: "",
  messages: [{ role: "user", content: TEST_PROMPT }],
};

export async function checkProvider(
  provider: string,
  model: string,
  apiKey: string,
): Promise<ProviderHealthResult> {
  const start = Date.now();
  const result: ProviderHealthResult = { provider, model, hasApiKey: !!apiKey, completeOk: false, streamOk: false, durationMs: 0 };

  if (!apiKey) {
    result.completeOk = false;
    result.streamOk = false;
    result.durationMs = Date.now() - start;
    result.error = "No API key configured";
    return result;
  }

  const opts = { apiKey };

  try {
    const response = await complete(provider, model, TEST_REQUEST, opts);
    result.completeOk = !!response.text;
  } catch (e: any) {
    result.completeOk = false;
    if (!result.error) result.error = `Complete failed: ${e.message}`;
  }

  try {
    let sawText = false;
    for await (const chunk of stream(provider, model, TEST_REQUEST, opts)) {
      if (chunk.type === "text_delta" && chunk.text) sawText = true;
      if (chunk.type === "error") throw new Error(chunk.error);
    }
    result.streamOk = sawText;
  } catch (e: any) {
    result.streamOk = false;
    if (!result.error) result.error = `Stream failed: ${e.message}`;
  }

  result.durationMs = Date.now() - start;
  return result;
}
