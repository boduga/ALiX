// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * M1.4 — Runtime Tool Contract
 *
 * Defines the contract for tool call and result types in the ALiX system.
 * Every consumer of tool invocations, responses, or argument shapes MUST
 * adhere to these types.
 *
 * This contract mirrors the concrete types in
 * {@link ../../tools/types.ts}.  It exists as the single source of truth
 * that downstream consumers (runtime, governance, dashboards) depend on —
 * the implementation file is the reference, this contract is the interface
 * that must not drift.
 *
 * ─────────────── TOOL SAFETY BOUNDARY ───────────────
 *
 * Tool contracts expose capability.  They do not grant permission.
 *
 * The types in this contract define the shape and vocabulary of tool
 * invocation — what tools exist, how they are called, and what results
 * they produce.  They are purely descriptive: a {@link ToolCallRequest}
 * describes a request to use a capability; a {@link ToolResult} describes
 * the outcome.  Neither type authorises execution.
 *
 * Permission to invoke a tool is governed by a separate security layer
 * (PolicyGate, capability registry, etc.) that sits above this contract.
 * The contract's responsibility ends at structural fidelity — it ensures
 * that any component that speaks the tool protocol speaks it correctly.
 *
 * ─────────────── DISCRIMINATED UNION (kind) ───────────────
 *
 * {@link ToolResult} is a discriminated union on the `kind` property.
 * Consumers MUST narrow on `kind` before accessing variant-specific
 * fields.  Accessing `content` or `matches` on an error result is a
 * type error; accessing `message` on a success result is a type error.
 *
 * @module tool-contract
 */

import type {
  ToolCallRequest as SourceToolCallRequest,
  ToolResult as SourceToolResult,
  ToolName as SourceToolName,
  ToolArgs as SourceToolArgs,
  FileMatch as SourceFileMatch,
} from "../../tools/types.js";

// ─── Core Tool Types ────────────────────────────────────────────────

/**
 * Discriminated union of tool names.
 *
 * Matches {@link ToolName} in `src/tools/types.ts` exactly.
 * Each literal member corresponds to a registered tool capability.
 *
 * | Member         | Description                         |
 * |----------------|-------------------------------------|
 * | `file.read`    | Read file contents                  |
 * | `file.create`  | Create or overwrite a file          |
 * | `file.delete`  | Delete a file                       |
 * | `file.exists`  | Check if a file exists              |
 * | `dir.search`   | Search directory for files          |
 * | `shell.run`    | Execute a shell command             |
 * | `patch.apply`  | Apply a structured patch            |
 * | `done`         | Signal task complete                |
 */
export type ToolName = SourceToolName;

/**
 * A request to invoke a tool.
 *
 * Matches {@link ToolCallRequest} in `src/tools/types.ts` exactly.
 * Every tool invocation in the system produces exactly one
 * `ToolCallRequest` that flows through the runtime pipeline.
 *
 * @property toolCallId - Unique identifier for this invocation.
 * @property name      - The tool name (must match a registered capability).
 * @property args      - Tool-specific arguments (validated per ToolName).
 * @property agentId   - Optional: the agent that issued the request.
 * @property sessionId - Optional: the session context.
 */
export type ToolCallRequest = SourceToolCallRequest;

// ─── Tool Result Types ─────────────────────────────────────────────

/**
 * A single file match result.
 *
 * Matches {@link FileMatch} in `src/tools/types.ts` exactly.
 * Used by search tools to report individual findings.
 *
 * @property path       - Absolute or relative file path.
 * @property lineNumber - 1-based line number of the match.
 * @property line       - The matching line content.
 */
export type FileMatch = SourceFileMatch;

/**
 * Discriminated union of tool execution results.
 *
 * Matches {@link ToolResult} in `src/tools/types.ts` exactly.
 *
 * Narrow on `kind` before accessing variant-specific fields:
 *
 * ```ts
 * if (result.kind === "success") {
 *   // result.content, result.matches are available
 * } else {
 *   // result.message, result.retryable are available
 * }
 * ```
 *
 * **Success variant fields** (all optional):
 * - `content`       — Primary text response.
 * - `output`        — Raw output (shell stdout).
 * - `value`         — Single scalar value.
 * - `matches`       — File search matches ({@link FileMatch}[]).
 * - `changedFiles`  — Files mutated by the tool.
 * - `exitCode`      — Shell exit code.
 * - `createdPath`   — Path created by a create tool.
 * - `deletedPath`   — Path deleted by a delete tool.
 * - `exists`        — Boolean result from existence check.
 * - `completed`     — Boolean signal from completion tool.
 *
 * **Error variant fields:**
 * - `message`   — Human-readable error description (required).
 * - `retryable` — `true` = safe to retry; `false`/`undefined` = fatal.
 * - `hint`      — Short instruction for the model on how to recover.
 */
export type ToolResult = SourceToolResult;

// ─── Tool Arguments ───────────────────────────────────────────────

/**
 * Map of tool names to their argument shapes.
 *
 * Matches {@link ToolArgs} in `src/tools/types.ts` exactly.
 * Provides type-safe argument access per tool name:
 *
 * ```ts
 * const args: ToolArgs["file.read"] = { root: "/project", path: "readme.md" };
 * ```
 */
export type ToolArgs = SourceToolArgs;

// ─── Safety Boundary ──────────────────────────────────────────────

/**
 * Tool safety boundary invariants.
 *
 * The fundamental separation between capability description and
 * capability authorisation.  Every type in this contract is purely
 * descriptive — it defines the shape and protocol of tool invocation,
 * not the authority to execute.
 *
 * | Invariant                              | Meaning                                                    |
 * |----------------------------------------|------------------------------------------------------------|
 * | `contractDescribesCapability`          | This contract defines tool shapes, not permissions.        |
 * | `contractDoesNotGrantPermission`       | No type in this file conveys authorisation.                |
 * | `securityLayerGovernsPermission`       | A separate security layer (PolicyGate) grants permission.  |
 * | `discriminatedUnionNarrowedByKind`     | ToolResult must be narrowed on `kind` before use.          |
 * | `structuralFidelityOnly`               | This contract guarantees shape correctness, nothing more.  |
 */
export type ToolSafetyBoundary = {
  readonly contractDescribesCapability: true;
  readonly contractDoesNotGrantPermission: true;
  readonly securityLayerGovernsPermission: true;
  readonly discriminatedUnionNarrowedByKind: true;
  readonly structuralFidelityOnly: true;
};

/**
 * Singleton asserting all tool safety boundary invariants are active.
 *
 * Consumers that depend on the tool protocol can reference this value
 * as a documentary anchor and compile-time check.
 */
export const TOOL_SAFETY_BOUNDARY: ToolSafetyBoundary = {
  contractDescribesCapability: true,
  contractDoesNotGrantPermission: true,
  securityLayerGovernsPermission: true,
  discriminatedUnionNarrowedByKind: true,
  structuralFidelityOnly: true,
} as const;

// ─── (No runtime code in this file — pure type exports, re-exports,
//        and a const assertion that serves as documentary anchor.) ──
