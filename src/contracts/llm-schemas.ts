// src/contracts/llm-schemas.ts
//
// Effect Schema contracts for LLM provider boundaries.
// Mirrors src/providers/types.ts ToolCall, NormalizedResponse, NormalizedRequest.

import { Schema } from "effect";
import { ToolDefSchema, NormalizedToolResultSchema, DeferredToolEntrySchema } from "./provider-tool-schemas.js";

// ---------------------------------------------------------------------------
// TokenUsage
// ---------------------------------------------------------------------------

export const TokenUsageSchema = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
});
export type TokenUsageFromSchema = typeof TokenUsageSchema.Type;

// ---------------------------------------------------------------------------
// ToolCall
// ---------------------------------------------------------------------------

export const ToolCallSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  args: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});
export type ToolCallFromSchema = typeof ToolCallSchema.Type;

// ---------------------------------------------------------------------------
// NormalizedResponse
// ---------------------------------------------------------------------------

export const NormalizedResponseSchema = Schema.Struct({
  text: Schema.String,
  toolCalls: Schema.Array(ToolCallSchema),
  usage: Schema.optional(TokenUsageSchema),
  finishReason: Schema.optional(Schema.String),
});
export type NormalizedResponseFromSchema = typeof NormalizedResponseSchema.Type;

// ---------------------------------------------------------------------------
// NormalizedMessage
// ---------------------------------------------------------------------------

export const TextPartSchema = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
});

export const ImagePartSchema = Schema.Struct({
  type: Schema.Literal("image"),
  source: Schema.String,
  mediaType: Schema.optional(Schema.String),
});

export const FilePartSchema = Schema.Struct({
  type: Schema.Literal("file"),
  source: Schema.String,
  mediaType: Schema.String,
  filename: Schema.String,
});

export const ContentPartSchema = Schema.Union(TextPartSchema, ImagePartSchema, FilePartSchema);

export const NormalizedMessageSchema = Schema.Struct({
  role: Schema.Literal("user", "assistant"),
  content: Schema.Union(Schema.String, Schema.Array(ContentPartSchema)),
});

// ---------------------------------------------------------------------------
// NormalizedRequest
// ---------------------------------------------------------------------------

export const NormalizedRequestSchema = Schema.Struct({
  systemPrompt: Schema.String,
  messages: Schema.Array(NormalizedMessageSchema),
  tools: Schema.optional(Schema.Array(Schema.Union(ToolDefSchema, DeferredToolEntrySchema))),
  toolResults: Schema.optional(Schema.Array(NormalizedToolResultSchema)),
  temperature: Schema.optional(Schema.Number),
  maxOutputTokens: Schema.optional(Schema.Number),
  stream: Schema.optional(Schema.Boolean),
  structuredOutputSchema: Schema.optional(Schema.Unknown),
});
export type NormalizedRequestFromSchema = typeof NormalizedRequestSchema.Type;
