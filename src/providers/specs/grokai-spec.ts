import { openaiBaseSpec } from "./_openai-base.js";
import type { ProviderSpec } from "../spec-types.js";
export const grokaiSpec: ProviderSpec = { ...openaiBaseSpec, baseUrl: "https://api.x.ai/v1/chat/completions" };
