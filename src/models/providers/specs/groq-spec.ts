import { openaiBaseSpec } from "./_openai-base.js";
import type { ProviderSpec } from "../spec-types.js";
export const groqSpec: ProviderSpec = { ...openaiBaseSpec, baseUrl: "https://api.groq.com/openai/v1/chat/completions" };
