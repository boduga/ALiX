// src/contracts/tool-schemas.ts
//
// Effect Schema contracts for tool execution boundaries.
// Mirrors src/tools/types.ts ToolName, ToolCallRequest, ToolResult.
// ToolName is DERIVED from the manifest — see TOOL_NAME_EXECUTOR_IDS below.

import { Schema } from "effect";
import { ALIX_BUILTIN_EXECUTORS } from "../agents/tool-manifest.js";

// ---------------------------------------------------------------------------
// ToolName — literal union of INTERNAL executor ids
// ---------------------------------------------------------------------------

/**
 * Executor ids, derived from the manifest rather than hand-listed.
 *
 * This was a frozen 10-name literal that had drifted: it admitted
 * `dir.search`, which was never a manifest tool (the router dispatched it but no
 * surface ever offered it), and omitted 21 of the 31 real built-ins — so a
 * schema described as the tool-name contract rejected most valid names while
 * accepting one the model could not call. Both are gone: `dir.search` was
 * deleted as a literal-substring duplicate of `grep.search`.
 *
 * These are the internal dispatch ids, NOT the model-facing names: a
 * `ToolCallRequest` reaching the executor carries the resolved executor.
 */
export const TOOL_NAME_EXECUTOR_IDS = [
  ...new Set(Object.values(ALIX_BUILTIN_EXECUTORS)),
] as [string, ...string[]];

export const ToolNameSchema = Schema.Literal(...TOOL_NAME_EXECUTOR_IDS);
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
