import { openaiBaseSpec } from "./_openai-base.js";
import type { ProviderSpec } from "../spec-types.js";
export const deepseekSpec: ProviderSpec = { ...openaiBaseSpec, baseUrl: "https://api.deepseek.com/v1/chat/completions" };
