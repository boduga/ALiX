import { openaiBaseSpec } from "./_openai-base.js";
import type { ProviderSpec } from "../spec-types.js";

export const openaiSpec: ProviderSpec = {
  ...openaiBaseSpec,
  baseUrl: "https://api.openai.com/v1/chat/completions",
};
