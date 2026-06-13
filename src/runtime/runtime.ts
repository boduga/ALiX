import type { EventLog } from "../events/event-log.js";
import type { ToolExecutor } from "../tools/executor.js";
import type { ContextCompiler } from "../repomap/context-compiler.js";
import type { ScopeTracker } from "../autonomy/scope-tracker.js";
import type { SubagentManager } from "../agents/subagent-manager.js";

export interface Runtime {
  /** Close all resources held by the runtime */
  close(): Promise<void>;

  /** Event log for session */
  eventLog: EventLog;

  /** Tool executor for running tools */
  toolExecutor: ToolExecutor;

  /** Context compiler for building context bundles */
  contextCompiler: ContextCompiler;

  /** Scope tracker for file mutation boundaries */
  scopeTracker: ScopeTracker;

  /** Subagent manager for spawning child processes (optional) */
  subagentManager?: SubagentManager;
}