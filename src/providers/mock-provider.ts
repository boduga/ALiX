import type { ModelAdapter, ModelCallOptions, NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export class MockProvider implements ModelAdapter {
  id = "mock";
  capabilities = {
    provider: "mock",
    model: "mock-model",
    inputTokenLimit: 32_000,
    outputTokenLimit: 4_000,
    supportsTools: false,
    supportsStreaming: true,
    supportsStructuredOutput: true,
    supportsVision: false,
    parallelToolCalls: false,
  };
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "trimmed_context" as const;

  /** Last per-call options received (test seam for signal propagation). */
  lastOptions: ModelCallOptions | undefined;

  async complete(request: NormalizedRequest, options?: ModelCallOptions): Promise<NormalizedResponse> {
    this.lastOptions = options;
    const last = request.messages.at(-1)?.content ?? "";
    return {
      text: `Plan:\n1. Inspect repository context.\n2. Prepare a safe patch for: ${last}\n3. Run verification.\n`,
      toolCalls: []
    };
  }

  async *stream(request: NormalizedRequest, options?: ModelCallOptions): AsyncGenerator<StreamChunk> {
    this.lastOptions = options;
    const response = await this.complete(request);
    yield { type: "text_delta", text: response.text };
    yield { type: "done" };
  }
}
