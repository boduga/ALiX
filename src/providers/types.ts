// Message content parts
import type { DeferredToolEntry } from "../mcp/tool-deferral.js";
import type { ExecutionContext } from "../observability/execution-context.js";

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
  /**
   * Whether the model can emit multiple tool calls in a single turn (parallel_tool_calls).
   * Source-explicit: resolved from provider + model + transport/configuration, not a global flag.
   * Fail-closed: unknown provider/model → false (serial fallback).
   * Boolean for POC; downstream layers gate on this single source.
   */
  parallelToolCalls: boolean;
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

// Tool results (returned from tool executions)
// T5 hierarchy: executionId → invocationId → toolUseId (toolCallId)
// NormalizedToolResult now requires correlation for T5 proof; backward compat via Partial for reads.
export type NormalizedToolResult = {
  toolUseId: string;
  content: string;
  invocationId: string;
  executionId: string;
};

/** Correlated tool result — parallel path requires full hierarchy (T5). Alias for NormalizedToolResult. */
export type CorrelatedNormalizedToolResult = NormalizedToolResult;

/**
 * Assert a NormalizedToolResult carries full correlation (parallel path).
 * Throws if invocationId or executionId missing — no silent omission.
 */
export function assertCorrelatedToolResult(
  result: NormalizedToolResult,
): asserts result is CorrelatedNormalizedToolResult {
  if (typeof result.invocationId !== "string" || result.invocationId.length === 0 ||
      typeof result.executionId !== "string" || result.executionId.length === 0) {
    throw new Error(
      `Missing correlation for parallel tool result toolUseId=${result.toolUseId}: invocationId=${(result as any).invocationId} executionId=${(result as any).executionId}`,
    );
  }
}

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
  /** Execution context for diagnostic correlation. Set by the agent loop. */
  context?: ExecutionContext;
  /**
   * Capability-negotiated parallelToolCalls flag (T2).
   * When present, _openai-base gates parallel_tool_calls on this single source
   * (ModelCapabilities.parallelToolCalls via resolver, fail-closed), not merely tools.length>1.
   * Optional for backward compat; absent → fail-closed (no flag).
   */
  capabilities?: Pick<ModelCapabilities, "parallelToolCalls">;
};

export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  summary?: string;
};

export type NormalizedResponse = {
  text: string;
  /** Model's private reasoning trace (e.g. DeepSeek reasoning_content). Not final output. */
  reasoning?: string;
  toolCalls: ToolCall[];
  usage?: TokenUsage;
  finishReason?: string;
  /** Provider-reported model actually served (e.g. `openrouter/free` → concrete free id). */
  resolvedModel?: string;
};

// Streaming chunks
export type StreamChunk =
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "usage"; usage: TokenUsage }
  | { type: "done"; resolvedModel?: string; finishReason?: string }
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
  /** True for routing adapters that own their own fallback/committed-stream decision. */
  isRoutingAdapter?: boolean;
  complete(request: NormalizedRequest): Promise<NormalizedResponse>;
  stream?(request: NormalizedRequest): AsyncGenerator<StreamChunk>;
  negotiate?(request: NormalizedRequest): Promise<NegotiatedCapabilities>;
};