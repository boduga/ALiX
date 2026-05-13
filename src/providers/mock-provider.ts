import type { ModelAdapter, NormalizedRequest, NormalizedResponse } from "./types.js";

export class MockProvider implements ModelAdapter {
  id = "mock";
  capabilities = {
    provider: "mock",
    model: "mock-planner",
    inputTokenLimit: 32_000,
    outputTokenLimit: 4_000,
    supportsTools: false,
    supportsStreaming: false,
    supportsStructuredOutput: true,
    supportsVision: false
  };
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "trimmed_context" as const;

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    const last = request.messages.at(-1)?.content ?? "";
    return {
      text: `Plan:\n1. Inspect repository context.\n2. Prepare a safe patch for: ${last}\n3. Run verification.\n`,
      toolCalls: []
    };
  }
}
