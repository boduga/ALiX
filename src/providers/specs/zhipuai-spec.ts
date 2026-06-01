import { openaiBaseSpec } from "./_openai-base.js";
import type { ProviderSpec } from "../spec-types.js";
export const zhipuaiSpec: ProviderSpec = { ...openaiBaseSpec, baseUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions" };
