// Message content parts
export type TextPart = {
  type: "text";
  text: string;
};

export type ImagePart = {
  type: "image";
  source: string; // base64 or URL
  mediaType?: string;
};

export type FilePart = {
  type: "file";
  source: string; // base64 or URL
  mediaType: string;
  filename: string;
};

export type ContentPart = TextPart | ImagePart | FilePart;

// Messages
export type NormalizedMessage = {
  role: "user" | "assistant";
  content: string | ContentPart[];
};

// Token usage
export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

// Cost profile
export type CostTier = {
  maxTokens: number;
  pricePerMillion: number;
};

export type CostProfile = {
  currency: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  inputTiers?: CostTier[];
  outputTiers?: CostTier[];
};

// Model capabilities
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
  costProfile?: CostProfile;
};

// Tool definitions
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

/**
 * A lightweight tool entry used for deferred tool descovery.
 * Only name + description are sent to the model at session start — no input_schema.
 */
export type DeferredToolEntry = {
  name: string;
  description: string;
  input_schema?: {
    type: "object";
    properties: Record<string, ToolParam>;
    required?: string[];
  };
};

// Tool results (returned from tool executions)
export type NormalizedToolResult = {
  toolUseId: string;
  content: string;
};

// Request and response
export type NormalizedRequest = {
  systemPrompt: string;
  messages: NormalizedMessage[];
  tools?: (ToolDef | DeferredToolEntry)[];
  toolResults?: NormalizedToolResult[];
  temperature?: number;
  maxOutputTokens?: number;
  stream?: boolean;  // when true, provider may use streaming response
  structuredOutputSchema?: {
    name: string;
    description?: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type NormalizedResponse = {
  text: string;
  toolCalls: ToolCall[];
  usage?: TokenUsage;
  finishReason?: string;
};

// Streaming chunks
export type StreamChunk =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "usage"; usage: TokenUsage }
  | { type: "done" }
  | { type: "error"; error: string };

// Negotiated capabilities (result of capability negotiation)
export type NegotiatedCapabilities = {
  contextBudget: number;
  outputBudget: number;
  editFormat: "structured_patch" | "unified_diff" | "search_replace" | "full_file";
  toolsEnabled: boolean;
  structuredOutputEnabled: boolean;
  visionEnabled: boolean;
};

// Model adapter interface
export type ModelAdapter = {
  id: string;
  capabilities: ModelCapabilities;
  editFormatPreference: "structured_patch" | "unified_diff" | "search_replace" | "full_file";
  longContextStrategy: "expanded_context" | "trimmed_context";
  complete(request: NormalizedRequest): Promise<NormalizedResponse>;
  stream?(request: NormalizedRequest): AsyncGenerator<StreamChunk>;
  negotiate?(request: NormalizedRequest): Promise<NegotiatedCapabilities>;
};