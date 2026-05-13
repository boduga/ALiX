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

export type ContentPart = { text: string };

export type NormalizedMessage = {
  role: "user" | "assistant";
  content: string | ContentPart[];
};

export type ToolParamBase = {
  type: string;
  description?: string;
  enum?: string[];
};

export type ToolParam = ToolParamBase | {
  type: "array";
  description?: string;
  items: { type: string };
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

export type ToolResult = {
  toolUseId: string;
  content: string;
};

export type NormalizedRequest = {
  systemPrompt: string;
  messages: NormalizedMessage[];
  tools?: ToolDef[];
  toolResults?: ToolResult[];
};

export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type NormalizedResponse = {
  text: string;
  toolCalls: ToolCall[];
  usage?: TokenUsage;
  finishReason?: string;
};

export type ModelAdapter = {
  id: string;
  capabilities: ModelCapabilities;
  editFormatPreference: "structured_patch" | "unified_diff" | "search_replace" | "full_file";
  longContextStrategy: "expanded_context" | "trimmed_context";
  complete(request: NormalizedRequest): Promise<NormalizedResponse>;
};
