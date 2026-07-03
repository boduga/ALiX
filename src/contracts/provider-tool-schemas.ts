// src/contracts/provider-tool-schemas.ts
//
// Effect Schema contracts for LLM provider tool definitions.
// Mirrors src/providers/types.ts ToolDef, ToolParam, NormalizedToolResult
// and src/mcp/tool-deferral.ts DeferredToolEntry.

import { Schema } from "effect";

// ---------------------------------------------------------------------------
// ToolParam — discriminated union
// ---------------------------------------------------------------------------

export const ToolParamBaseSchema = Schema.Struct({
  type: Schema.String,
  description: Schema.optional(Schema.String),
  enum: Schema.optional(Schema.Array(Schema.String)),
});

export const ToolParamArraySchema = Schema.Struct({
  type: Schema.Literal("array"),
  description: Schema.optional(Schema.String),
  items: Schema.Struct({ type: Schema.String }),
});

export const ToolParamSchema = Schema.Union(ToolParamBaseSchema, ToolParamArraySchema);
export type ToolParamFromSchema = typeof ToolParamSchema.Type;

// ---------------------------------------------------------------------------
// ToolDef
// ---------------------------------------------------------------------------

export const ToolInputSchemaSchema = Schema.Struct({
  type: Schema.Literal("object"),
  properties: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  required: Schema.optional(Schema.Array(Schema.String)),
});

export const ToolDefSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  input_schema: ToolInputSchemaSchema,
});
export type ToolDefFromSchema = typeof ToolDefSchema.Type;

// ---------------------------------------------------------------------------
// NormalizedToolResult
// ---------------------------------------------------------------------------

export const NormalizedToolResultSchema = Schema.Struct({
  toolUseId: Schema.String,
  content: Schema.String,
});
export type NormalizedToolResultFromSchema = typeof NormalizedToolResultSchema.Type;

// ---------------------------------------------------------------------------
// DeferredToolEntry (MCP tool deferral)
// ---------------------------------------------------------------------------

export const DeferredToolEntrySchema = Schema.Struct({
  name: Schema.String,
  execName: Schema.String,
  serverName: Schema.String,
  toolName: Schema.String,
  description: Schema.String,
  input_schema: Schema.optional(
    Schema.Struct({
      type: Schema.Literal("object"),
      properties: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
    }),
  ),
});
export type DeferredToolEntryFromSchema = typeof DeferredToolEntrySchema.Type;
