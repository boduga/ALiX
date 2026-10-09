import { openaiBaseSpec } from "./_openai-base.js";
import type { ProviderSpec } from "../spec-types.js";
export const openrouterSpec: ProviderSpec = {
  ...openaiBaseSpec,
  baseUrl: "https://openrouter.ai/api/v1/chat/completions",
  resolveModel: (res) => {
    const r = res as { model?: unknown };
    return typeof r.model === "string" ? r.model : undefined;
  },
};
