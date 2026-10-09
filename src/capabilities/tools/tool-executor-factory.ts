/**
 * tool-executor-factory.ts — R5.3b sanctioned construction seam for
 * `ToolExecutor` (options-object form since the R1 review: the positional
 * constructor takes 11 mostly-optional deps, which invited bare-`undefined`
 * clumps at every call site).
 *
 * The `ToolExecutor` implementation lives in `executor.ts` and is protected by
 * the R1 `direct-tool-dispatch` freeze; this module is the single authorized
 * importer and construction seam.
 */

import { ToolExecutor } from "./executor.js";
import type { AlixConfig } from "../../operations/config/schema.js";
import type { EventLog } from "../../runtime-state/events/event-log.js";
import type { McpManager } from "../mcp/manager.js";
import type { EditFormatPolicy } from "../../execution/patch/edit-format-policy.js";
import type { CheckpointManager } from "../../execution/patch/checkpoint.js";
import type { ToolCallRequest, ToolResult } from "./types.js";

export type { ToolExecutor } from "./executor.js";

/** Named construction options — one field per `ToolExecutor` constructor arg. */
export interface ToolExecutorOptions {
  config: AlixConfig;
  log: EventLog;
  root: string;
  mcpManager?: McpManager;
  editFormatPolicy?: EditFormatPolicy;
  extraHandlers?: Record<
    string,
    (args: Record<string, unknown>, request?: ToolCallRequest) => Promise<ToolResult>
  >;
  checkpointManager?: CheckpointManager;
  approvalStore?: unknown;
  workspacePathResolver?: unknown;
  ownershipRegistry?: unknown;
  ownedPaths?: string[];
}

/** Construct a `ToolExecutor` from named options. */
export function createToolExecutor(options: ToolExecutorOptions): ToolExecutor {
  return new ToolExecutor(
    options.config,
    options.log,
    options.root,
    options.mcpManager,
    options.editFormatPolicy,
    options.extraHandlers,
    options.checkpointManager,
    options.approvalStore,
    options.workspacePathResolver,
    options.ownershipRegistry,
    options.ownedPaths,
  );
}
