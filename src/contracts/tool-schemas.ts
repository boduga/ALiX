// src/contracts/tool-schemas.ts
//
// Effect Schema contracts for tool execution boundaries.
// Mirrors src/tools/types.ts ToolName, ToolCallRequest, ToolResult.

import { Schema } from "effect";

// ---------------------------------------------------------------------------
// ToolName — literal union
// ---------------------------------------------------------------------------

export const ToolNameSchema = Schema.Literal(
  "file.read",
  "file.create",
  "file.delete",
  "file.exists",
  "dir.search",
  "shell.run",
  "patch.apply",
  "done",
);
export type ToolNameFromSchema = typeof ToolNameSchema.Type;

// ---------------------------------------------------------------------------
// FileMatch
// ---------------------------------------------------------------------------

export const FileMatchSchema = Schema.Struct({
  path: Schema.String,
  lineNumber: Schema.Number,
  line: Schema.String,
});
export type FileMatchFromSchema = typeof FileMatchSchema.Type;

// ---------------------------------------------------------------------------
// ToolCallRequest
// ---------------------------------------------------------------------------

export const ToolCallRequestSchema = Schema.Struct({
  toolCallId: Schema.String,
  name: Schema.String,
  args: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  agentId: Schema.optional(Schema.String),
  sessionId: Schema.optional(Schema.String),
  replayId: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
});
export type ToolCallRequestFromSchema = typeof ToolCallRequestSchema.Type;

// ---------------------------------------------------------------------------
// ToolResult — discriminated union
// ---------------------------------------------------------------------------

export const ToolResultSuccessSchema = Schema.Struct({
  kind: Schema.Literal("success"),
  content: Schema.optional(Schema.String),
  output: Schema.optional(Schema.String),
  value: Schema.optional(Schema.String),
  matches: Schema.optional(Schema.Array(FileMatchSchema)),
  changedFiles: Schema.optional(Schema.Array(Schema.String)),
  exitCode: Schema.optional(Schema.Number),
  createdPath: Schema.optional(Schema.String),
  deletedPath: Schema.optional(Schema.String),
  exists: Schema.optional(Schema.Boolean),
  completed: Schema.optional(Schema.Boolean),
});

export const ToolResultErrorSchema = Schema.Struct({
  kind: Schema.Literal("error"),
  message: Schema.String,
  retryable: Schema.optional(Schema.Boolean),
  hint: Schema.optional(Schema.String),
});

export const ToolResultSchema = Schema.Union(
  ToolResultSuccessSchema,
  ToolResultErrorSchema,
);
export type ToolResultFromSchema = typeof ToolResultSchema.Type;
