import { openaiBaseSpec } from "./_openai-base.js";
import type { ProviderSpec } from "../spec-types.js";

/**
 * Default base URL for the FreeLLMAPI server (LAN host; override per install
 * via ModelConfig.freellmapiBaseUrl — server IPs move, so this is a default,
 * not a constant).
 */
export const DEFAULT_FREELLMAPI_BASE_URL = "http://10.1.1.12:3001";

export const freellmapiSpec: ProviderSpec = {
  ...openaiBaseSpec,
  baseUrl: `${DEFAULT_FREELLMAPI_BASE_URL}/v1/chat/completions`,
};
