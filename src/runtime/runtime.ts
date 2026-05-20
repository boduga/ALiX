import type { EventLog } from "../events/event-log.js";
import type { PolicyEngine } from "../policy/policy-engine.js";
import type { ToolExecutor } from "../tools/executor.js";

export interface Runtime {
  /** Close all resources held by the runtime */
  close(): Promise<void>;

  /** Event log for session */
  eventLog: EventLog;

  /** Policy engine for tool call decisions */
  policyEngine: PolicyEngine;

  /** Tool executor for running tools */
  toolExecutor: ToolExecutor;
}