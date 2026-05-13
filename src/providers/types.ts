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

export type ToolParamBase = {
  type: string;
  description?: string;
  enum?: string[];
};

export type ToolParam = ToolParamBase | {
  type: "array";
  description?: string;
  items: { type: string; description?: string };
};

export type ToolDef = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, ToolParam>;
    required?: string[];
  };
};

export type NormalizedRequest = {
  systemPrompt: string;
  messages: NormalizedMessage[];
  tools?: ToolDef[];
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
