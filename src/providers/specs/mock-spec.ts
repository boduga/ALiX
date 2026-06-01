import type { ProviderSpec } from "../spec-types.js";

export const mockSpec: ProviderSpec = {
  baseUrl: "mock://localhost",
  authHeader: () => ({}),
  toRequestBody: (req) => req,
  fromResponse: (res) => {
    const r = res as any;
    return { text: r.text ?? "mock response", toolCalls: [], finishReason: "stop" };
  },
  fromStreamChunk: () => null,
  toErrorMessage: (status) => `Mock error ${status}`,
};
