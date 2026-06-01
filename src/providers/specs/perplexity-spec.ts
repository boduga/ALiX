import { openaiBaseSpec } from "./_openai-base.js";
import type { ProviderSpec } from "../spec-types.js";
export const perplexitySpec: ProviderSpec = { ...openaiBaseSpec, baseUrl: "https://api.perplexity.ai/v1/chat/completions" };
