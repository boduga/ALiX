// Back-compat shim - prefer importing from src/agent/ directly
export { shouldAutoDisableStreaming, type StreamHandler } from "./agent/stream.js";
export { buildErrorMessage, buildToolsForProvider, buildContextBundleEventPayload, buildModelUsageEventPayload, renderContextBundleForPrompt } from "./agent/messages.js";
export { extractMutationPaths, validMutationPaths, recordMutationInSessionState, type MutationSessionState } from "./agent/mutations.js";

import type { EventLog } from "./events/event-log.js";
import type { NormalizedMessage } from "./providers/types.js";
import type { ContextBudgetOverflowError } from "./config/context-budget.js";
export interface SharedSession {
  sessionId: string;
  sessionDir: string;
  eventLog: EventLog;
}

export type RunResult = {
  sessionId: string;
  summary: string;
  streamed?: boolean;
  reason?: "completed" | "completed_unverified" | "max_repairs" | "max_iterations" | "rejected_scope_expansion" | "context_budget_overflow";
  /** Unique run identifier for diagnostic correlation. */
  runId?: string;
  /**
   * Diagnostic data for an irreducible context-budget overflow (C2 #18).
   * In-process only — consumers must read the typed readonly fields and must
   * NOT depend on Error methods, stack traces, or instanceof. This field is
   * intentionally NOT a serializable wire contract.
   */
  contextBudgetOverflow?: ContextBudgetOverflowError;
  /**
   * Aggregate + peak context pressure observed across the task run (spec §3).
   * Pure observability — optional, absent on non-terminal/legacy returns.
   * iterationsSincePeak is derivable as totalIterations − peak.iteration.
   */
  contextPressure?: ContextPressure;
};

/**
 * Aggregate + peak context pressure for a run (spec §3, peak-variant).
 * aggregate = summed T4/T5/T6 drops + min remainingTokens across all
 * iterations; peak = the single highest-drop iteration (tie → first reach)
 * with its iteration index. Chosen over "final iteration" because for a
 * stuck_repeating_tools run the final iteration is often cleanest.
 */
export type ContextPressure = {
  aggregate: {
    tier4Dropped: number;
    tier5Dropped: number;
    tier6Dropped: number;
    minRemainingTokens: number;
  };
  peak: {
    iteration: number;
    tier4Dropped: number;
    tier5Dropped: number;
    tier6Dropped: number;
    remainingTokens: number;
  };
  totalIterations: number; // enables iterationsSincePeak = totalIterations − peak.iteration
};

export type RunOpts = {
  streaming?: boolean;
  sessionMode?: "auto" | "ask" | "bypass";
  sharedSession?: SharedSession;
  planMode?: boolean;
  /**
   * Controls whether plan generation prompts interactively or defers
   * to the caller for display/approval.
   * - "interactive" (default): print plan to stdout and prompt terminal.
   * - "deferred": generate plan and return it as approved without printing
   *   or prompting — the caller (TUI, Web UI, API) handles display.
   */
  planApprovalMode?: "interactive" | "deferred";
  /**
   * Optional gate that owns the plan-approval decision. When provided
   * alongside `planApprovalMode: "interactive"`, `runPlanPhase` routes
   * the operator's approve/reject/edit/detail decision through this gate
   * instead of the legacy TTY prompt. The TUI owns the gate.
   */
  planApprovalGate?: import("./run/plan-approval-gate.js").PlanApprovalGate;
  resumeSessionId?: string;
  planFilePath?: string;
  readOnly?: boolean;
  messages?: NormalizedMessage[];
  skipContext?: boolean;
  disableSkillFactory?: boolean;
  parentRunId?: string;
  injectedContext?: {
    kind: string;
    content: string;
    metadata?: Record<string, unknown>;
  };
  boundTools?: Array<{
    definition: { name: string; description: string; inputSchema: Record<string, unknown> };
    handler: (args: Record<string, unknown>) => Promise<string>;
  }>;
};

export const EXIT_CODES = {
  REJECTED_SCOPE_EXPANSION: 3,
} as const;

// Re-export runTask last to avoid circular import issues
export { runTask } from "./agent/agent-loop.js";