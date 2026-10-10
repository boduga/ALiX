// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * run-contract.ts — the run result/opts contract, owned here (a leaf) so
 * consumers can import it without pulling the `src/run.ts` back-compat shim.
 *
 * `src/run.ts` re-exports `runTask` from `agent/agent-loop.js`, so importing
 * the shim drags agent-loop into the module graph and re-created the
 * task-loop ↔ run.ts ↔ agent-loop cycle. These types have no other home.
 */

import type { EventLog } from "../../runtime-state/events/event-log.js";
import type { NormalizedMessage } from "../../models/providers/types.js";
import type { ContextBudgetOverflowError } from "../../operations/config/context-budget.js";

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
  /**
   * Last model prose persisted as an agent.message event this run, if any.
   * Lets the TUI skip re-persisting an identical turn summary as
   * agent.response (write-time dedup of a known double-write). Absent when
   * no prose was persisted (direct routes, tool-only turns).
   */
  lastAgentProse?: string;
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
  /**
   * Durable approval store wired into the session's ToolExecutor so ask-mode
   * decisions mint resolvable pending approvals instead of the headless
   * fail-closed deny (R1.5). Mirrors `createAgentSession`/`createAgent`.
   */
  approvalStore?: import("../../governance/approvals/approval-store.js").ApprovalStore;
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
  planApprovalGate?: import("./plan-approval-gate.js").PlanApprovalGate;
  resumeSessionId?: string;
  planFilePath?: string;
  readOnly?: boolean;
  messages?: NormalizedMessage[];
  skipContext?: boolean;
  disableSkillFactory?: boolean;
  parentRunId?: string;
  /** External operator cancellation propagated through provider and tool calls. */
  signal?: AbortSignal;
  /** Invocation-local successful model-facing result evidence, before telemetry truncation. */
  onToolResult?: (toolName: string, content: string) => void;
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
