export type ModelCapabilities = {
  provider: string;
  model: string;
  inputTokenLimit: number;
  outputTokenLimit: number;
  effectiveContextBudget?: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsStructuredOutput: boolean;
  supportsVision: boolean;
};

export type NormalizedMessage = {
  role: "user" | "assistant";
  content: string;
};

export type NormalizedRequest = {
  systemPrompt: string;
  messages: NormalizedMessage[];
};

export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type NormalizedResponse = {
  text: string;
  toolCalls: ToolCall[];
};

export type ModelAdapter = {
  id: string;
  capabilities: ModelCapabilities;
  editFormatPreference: "structured_patch" | "unified_diff" | "search_replace" | "full_file";
  longContextStrategy: "expanded_context" | "trimmed_context";
  complete(request: NormalizedRequest): Promise<NormalizedResponse>;
};
