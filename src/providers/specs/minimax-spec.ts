import { openaiBaseSpec } from "./_openai-base.js";
import type { ProviderSpec } from "../spec-types.js";
export const minimaxSpec: ProviderSpec = { ...openaiBaseSpec, baseUrl: "https://api.minimax.chat/v1/text/chatcompletion_v2" };
