/**
 * P4.5c — Workflow types: state machine definitions and shared contracts.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

export const WORKFLOW_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Workflow state
// ---------------------------------------------------------------------------

/**
 * All possible workflow states for issue execution.
 *
 * 12 states forming a directed acyclic graph (with BLOCKED as the only
 * self-loop-adjacent state since it returns to EXECUTING on unblock).
 */
export type WorkflowState =
  | "NEW"
  | "SELECTED"
  | "PLANNED"
  | "APPROVED_FOR_EXECUTION"
  | "EXECUTING"
  | "BLOCKED"
  | "UNDER_REVIEW"
  | "FIX_REQUIRED"
  | "PR_READY"
  | "AWAITING_HUMAN"
  | "MERGED"
  | "COMPLETE";

/** All valid state strings. */
export const WORKFLOW_STATES: ReadonlySet<string> = new Set<WorkflowState>([
  "NEW",
  "SELECTED",
  "PLANNED",
  "APPROVED_FOR_EXECUTION",
  "EXECUTING",
  "BLOCKED",
  "UNDER_REVIEW",
  "FIX_REQUIRED",
  "PR_READY",
  "AWAITING_HUMAN",
  "MERGED",
  "COMPLETE",
]);

// ---------------------------------------------------------------------------
// Agent names
// ---------------------------------------------------------------------------

/** Known agent identities in P4.5. */
export type AgentName =
  | "IssueIntakeAgent"
  | "PlanningAgent"
  | "ExecutionAgent"
  | "ReviewAgent"
  | "PRAgent";

// ---------------------------------------------------------------------------
// Transition map
// ---------------------------------------------------------------------------

/**
 * Allowed transitions keyed by current state.
 *
 * Derived from the SDS state machine diagram:
 *
 *   NEW → SELECTED → PLANNED → APPROVED_FOR_EXECUTION → EXECUTING → BLOCKED
 *   │     │           │          │                       │    │      │
 *   │     │           │          │                       v    │      v
 *   │     │           │          │                  UNDER_REVIEW │  EXECUTING
 *   │     │           │          │                   │       │   │
 *   │     │           │          │                   v       v   │
 *   │     │           │          │              FIX_REQUIRED     │
 *   │     │           │          │                   │           │
 *   │     │           │          └───────────────────┘           │
 *   │     │           │               │                          │
 *   │     │           │               v                          │
 *   │     │           │          PR_READY → AWAITING_HUMAN → MERGED → COMPLETE
 *   v     v           v
 *   └─────┴───────────┴── (rollback — handled by recover())
 */
export const ALLOWED_TRANSITIONS: Record<string, readonly WorkflowState[]> = {
  NEW: ["SELECTED"],
  SELECTED: ["PLANNED"],
  PLANNED: ["APPROVED_FOR_EXECUTION"],
  APPROVED_FOR_EXECUTION: ["EXECUTING"],
  EXECUTING: ["UNDER_REVIEW", "BLOCKED"],
  BLOCKED: ["EXECUTING"],
  UNDER_REVIEW: ["FIX_REQUIRED", "PR_READY"],
  FIX_REQUIRED: ["EXECUTING"],
  PR_READY: ["AWAITING_HUMAN"],
  AWAITING_HUMAN: ["MERGED", "PR_READY"],
  MERGED: ["COMPLETE"],
  COMPLETE: [],
};

// ---------------------------------------------------------------------------
// Workflow state entry (persisted in state.json)
// ---------------------------------------------------------------------------

export interface WorkflowStateEntry {
  issueNumber: number;
  state: WorkflowState;
  assignedAgent: AgentName | null;
  evidenceFingerprints: string[];
  startedAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  humanGateRequired: boolean;
  planFingerprint?: string;
  prNumber?: number;
  error?: string;
  blockReason?: string;
  blockingItem?: string;
  blockedAt?: string;
}

// ---------------------------------------------------------------------------
// History event (appended to history.jsonl)
// ---------------------------------------------------------------------------

export interface WorkflowHistoryEvent {
  timestamp: string;
  issueNumber: number;
  from: WorkflowState | null;
  to: WorkflowState;
  actor: AgentName | "human" | "system";
  evidenceFingerprint?: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Agent capability contract (P4.7 foundation)
// ---------------------------------------------------------------------------

export interface AgentCapability {
  agentId: AgentName;
  skills: string[];
  maxComplexity: "small" | "medium" | "large";
  allowedTools: string[];
  maxConcurrentIssues: number;
  requiresHumanGate: boolean;
}

// ---------------------------------------------------------------------------
// Coordinator config
// ---------------------------------------------------------------------------

export interface WorkflowCoordinatorConfig {
  /** Directory for workflow state files (.alix/workflow/). */
  workflowDir: string;
  /** Optional directory for evidence store (.alix/security/). */
  evidenceDir?: string;
  /** Lock acquisition timeout in ms. Default 5000. */
  lockTimeoutMs?: number;
  /** Stale threshold for detectStale() in ms. Default 300000 (5 min). */
  staleThresholdMs?: number;
}
