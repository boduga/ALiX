export type EventActor = "user" | "agent" | "system" | "tool" | "policy" | "verifier" | "subagent" | "authorization" | "coordination";

export type EventMeta = {
  workflowId?: string;
  graphId?: string;
  nodeId?: string;
  traceId?: string;
  spanId?: string;
  replayId?: string;
};

export type AlixEvent<TType extends string = string, TPayload = unknown> = {
  id: string;
  seq: number;
  version: 1;
  sessionId: string;
  runId?: string;
  parentEventId?: string;
  timestamp: string;
  type: TType;
  actor: EventActor;
  payload: TPayload;
  meta?: EventMeta;
};

export type NewEvent<TType extends string = string, TPayload = unknown> = Omit<
  AlixEvent<TType, TPayload>,
  "id" | "seq" | "version" | "timestamp"
>;

export type SessionProjection = {
  sessionId: string;
  eventCount: number;
  approvals: Record<string, unknown>;
  changedFiles: string[];
  summary?: string;
};

// Additional event type unions for full event coverage
export type ToolEventPayload =
  | { toolCallId: string; toolName: string; argsPreview: Record<string, unknown>; capability: string }
  | { toolCallId: string; toolName: string; status: "success" | "error" | "denied"; outputSize?: number; outputPreview?: string; error?: string }
  | { toolCallId: string; toolName: string };

// Standardized tool event payload types for lifecycle events
export type ToolRequestPayload = {
  toolCallId: string;
  toolName: string;
  capability: string;
  argsPreview: Record<string, unknown>;
  canonicalCapability: string;
  argumentHash: string;
};

export type ToolStartedPayload = {
  toolCallId: string;
  toolName: string;
  argumentHash: string;
};

export type ToolOutputPayload = {
  toolCallId: string;
  outputRef?: string;
  outputPreview?: string;
  outputSize: number;
};

export type ToolCompletedPayload = {
  toolCallId: string;
  toolName: string;
  status: "success" | "cancelled";
  durationMs: number;
  canonicalCapability: string;
  argumentHash: string;
};

export type ToolFailedPayload = {
  toolCallId: string;
  toolName: string;
  error: string;
  durationMs: number;
  canonicalCapability: string;
  argumentHash: string;
};

export const TOOL_EVENT_TYPES = {
  REQUESTED: "tool.requested",
  STARTED: "tool.started",
  OUTPUT: "tool.output",
  COMPLETED: "tool.completed",
  FAILED: "tool.failed",
} as const;

export type PatchProposalPayload = {
  proposalId: string;
  format: "structured_patch" | "unified_diff" | "search_replace" | "full_file";
  provider: string;
  model: string;
  files: Array<{ path: string; operation: "create" | "modify" | "delete" | "rename"; preimageHash?: string }>;
  requiresApproval: boolean;
};

export type PatchParsedPayload = {
  proposalId: string;
  validated: boolean;
  errors?: string[];
};

export type PatchRejectedPayload = {
  proposalId: string;
  reason: string;
};

export type PatchCheckpointCreatedPayload = {
  checkpointId: string;
  proposalId: string;
  files: string[];
};

export type PatchAppliedPayload = {
  proposalId: string;
  checkpointId: string;
  changedFiles: string[];
  diffRef?: string;
};

export type PatchRolledBackPayload = {
  proposalId: string;
  checkpointId: string;
  reason: string;
};

export const PATCH_EVENT_TYPES = {
  PROPOSED: "patch.proposed",
  PARSED: "patch.parsed",
  REJECTED: "patch.rejected",
  CHECKPOINT_CREATED: "patch.checkpoint_created",
  APPLIED: "patch.applied",
  ROLLED_BACK: "patch.rolled_back",
  CHANGED_FILES: "patch.changed_files",
  CREATED_PATH: "patch.created_path",
  DELETED_PATH: "patch.deleted_path",
} as const;

export const FILE_EVENT_TYPES = {
  CREATED: "file.created",
  DELETED: "file.deleted",
} as const;

export const AGENT_EVENT_TYPES = {
  MESSAGE: "agent.message",
  REASONING: "agent.reasoning",
  DECISION: "agent.decision",
  RESPONSE: "agent.response",
} as const;

/** Timeline projection payload (Phase 6 D7/D8): narrative entries carry
 *  optional display `text` and a longer `detail`. The typed home for the
 *  `payload` of the chat.* / agent.* timeline kinds so consumers read a
 *  named shape instead of an untyped record.
 *  Stage-attribution fields:
 *    - `phase` carries the phase name on `agent.session.phase_changed`
 *      events (TimelineBuilder extracts it into `text` for the line builder).
 *    - `turn` carries the turn number on `agent.session.turn.completed`
 *      events (TimelineBuilder extracts it as `text: \`turn ${n}\``). */
export type TimelinePayload = {
  text?: string;
  // #434 — tool lifecycle events project their name and outcome:
  //   - `toolName` on every `tool.*` event (the projection extracts it
  //     into `text` so the scrollback line builder can read it like
  //     a stage name).
  //   - `error` on `tool.failed` events (the projection extracts it
  //     into `detail` for the result line).
  //   - `outputPreview` on `tool.completed` events (same path).
  //   These fields are optional on the timeline payload type because
  //  they are absent on non-tool events; the `build()` method reads
  //  them only when the kind matches.
  toolName?: string;
  error?: string;
  outputPreview?: string;
  detail?: string;
  phase?: string;
  turn?: number;
  // #436 — `prompt` on `approval.requested` events (TimelineBuilder
  // extracts it into `text` so the inline approval line in the agent
  // scrollback can carry the human-readable prompt).
  prompt?: string;
};

export const MCP_EVENT_TYPES = {
  TOOL_INVOKED: "mcp.tool_invoked",
} as const;

export const OWNERSHIP_EVENT_TYPES = {
  ACQUIRED: "ownership.acquired",
  RELEASED: "ownership.released",
  RENEWED: "ownership.renewed",
  EXPIRED: "ownership.expired",
  CONFLICT: "ownership.conflict",
  REVOKED: "ownership.revoked",
  DENIED: "ownership.denied",
  LOCK_FAILED: "ownership.lock_failed",
} as const;

export const COORDINATION_EVENT_TYPES = {
  AGGREGATE_STARTED: "coordination.aggregate.started",
  AGGREGATE_COMPLETED: "coordination.aggregate.completed",
  AGGREGATE_FAILED: "coordination.aggregate.failed",
  AGGREGATE_STALE: "coordination.aggregate.stale",
  SYNTHESIS_STARTED: "coordination.synthesis.started",
  SYNTHESIS_COMPLETED: "coordination.synthesis.completed",
  SYNTHESIS_FAILED: "coordination.synthesis.failed",
  FAILURE_PROPAGATED: "coordination.failure.propagated",
} as const;

export const COLLABORATION_EVENT_TYPES = {
  FINDING_PUBLISHED: "collaboration.finding.published",
  FINDING_SUPERSEDED: "collaboration.finding.superseded",
  FINDING_INVALIDATED: "collaboration.finding.invalidated",
  ARTIFACT_PUBLISHED: "collaboration.artifact.published",
  CONTEXT_BUILD_STARTED: "collaboration.context.build.started",
  CONTEXT_BUILD_COMPLETED: "collaboration.context.build.completed",
  CONTEXT_BUILD_DEGRADED: "collaboration.context.build.degraded",
  CONTEXT_BUILD_FAILED: "collaboration.context.build.failed",
  MANIFEST_PERSISTED: "collaboration.manifest.persisted",
  TOOL_CALLED: "collaboration.tool.called",
} as const;

export const CONFLICT_EVENT_TYPES = {
  DETECTED: "collaboration.conflict.detected",
  UPDATED: "collaboration.conflict.updated",
  REPORTED: "collaboration.conflict.reported",
  UNDER_REVIEW: "collaboration.conflict.under_review",
  RESOLVED: "collaboration.conflict.resolved",
  ACCEPTED_DIVERGENCE: "collaboration.conflict.accepted_divergence",
  DISMISSED: "collaboration.conflict.dismissed",
  SUPERSEDED: "collaboration.conflict.superseded",
  MODEL_FAILED: "collaboration.conflict.model_comparison_failed",
} as const;

export type SubagentStartedPayload = {
  role: string;
  taskId: string;
  prompt: string;
};

export type SubagentResultPayload = {
  role: string;
  taskId: string;
  status: string;
  findings: string[];
};

export const SUBAGENT_EVENT_TYPES = {
  STARTED: "subagent.started",
  RESULT: "subagent.result",
} as const;

export type VerificationEventPayload =
  | { command: string; reason: string }
  | { command: string; status: "passed" | "failed"; output?: string }
  | { status: string; results: unknown[] };

export type InspectorContextItem = {
  path: string;
  kind: string;
  symbolName?: string;
  lineStart?: number;
  lineEnd?: number;
  score?: number;
  tokenEstimate?: number;
  reason?: string;
};

export type InspectorSnapshot = {
  sessionId: string;
  workflowId?: string;
  graphId?: string;
  nodeId?: string;
  summary: {
    eventCount: number;
    status: "running" | "completed" | "failed" | "unknown";
    reason?: string;
    latestSeq?: number;
    startedAt?: string;
    endedAt?: string;
  };
  timeline: AlixEvent[];
  context?: {
    taskType?: string;
    budget?: { maxTokens: number; usedTokens: number };
    primaryFiles: InspectorContextItem[];
    tests: InspectorContextItem[];
    supportingFiles: InspectorContextItem[];
    pinned: InspectorContextItem[];
  };
  diffs: Array<{
    toolCallId?: string;
    changedFiles: string[];
    checkpointFiles: string[];
    rolledBack: boolean;
    status: "applied" | "failed" | "rolled_back" | "checkpointed";
  }>;
  terminal: Array<{
    toolCallId?: string;
    command: string;
    status?: string;
    outputPreview?: string;
    error?: string;
  }>;
  approvals: Array<{
    toolCallId?: string;
    toolName?: string;
    paths: string[];
    status: "pending" | "approved" | "denied" | "auto_approved" | "skipped";
  }>;
  verification: Array<{
    command: string;
    reason?: string;
    status?: "passed" | "failed" | "skipped" | string;
    output?: string;
  }>;
  tokens: {
    totalInputTokens: number;
    totalOutputTokens: number;
    entries: Array<{ provider?: string; model?: string; inputTokens: number; outputTokens: number; cost?: number }>;
  };
};

export type InspectorComparison = {
  leftSessionId: string;
  rightSessionId: string;
  changedFilesOnlyLeft: string[];
  changedFilesOnlyRight: string[];
  changedFilesBoth: string[];
  verificationStatus: { left: string; right: string };
  tokenDelta: { inputTokens: number; outputTokens: number };
};

// Context event payload types
export type ContextItemRef = {
  path: string;
  kind: string;
  score: number;
  reason: string;
  symbolName?: string;
  lineStart?: number;
  lineEnd?: number;
};

export type RepoMapCreatedPayload = {
  sourceFileCount: number;
  testFileCount: number;
  symbolCount: number;
  dependencyCount: number;
};

export type ContextBundleCreatedPayload = {
  bundleId: string;
  taskType: string;
  usedTokens: number;
  maxTokens: number;
  primaryFiles: ContextItemRef[];
  supportingFiles: ContextItemRef[];
  tests: ContextItemRef[];
  omittedCount: number;
};

export type FilePinnedPayload = {
  path: string;
  reason: string;
};

export type FileUnpinnedPayload = {
  path: string;
};

export type PatternEvaluatedPayload = {
  taskType: string;
  success: boolean;
  iterations: number;
  tokenUsage: number;
};

export const CONTEXT_EVENT_TYPES = {
  REPO_MAP_CREATED: "context.repo_map_created",
  BUNDLE_CREATED: "context.bundle_created",
  FILE_PINNED: "context.file_pinned",
  FILE_UNPINNED: "context.file_unpinned",
  PATTERN_EVALUATED: "context.pattern_evaluated",
  // T6 — C1 observability: five lifecycle events for the context budget path.
  SNAPSHOT_CREATED: "context.snapshot.created",
  BUDGET_COMPUTED: "context.budget.computed",
  ASSEMBLED: "context.assembled",
  PREFLIGHT_FAILED: "context.preflight.failed",
  IRREDUCIBLE: "context.irreducible",
  // §1 — estimated vs actual token calibration (per model-facing request).
  TOKEN_CALIBRATION: "token.calibration",
  // §2 — tool-scoping admission-control events
  TOOLING_SCOPE_FALLBACK_FULL: "tooling.scope.fallback_full",
  TOOLING_SCOPE_REINTRODUCED: "tooling.scope.reintroduced",
  // §2 — irreducible overflow uses the existing `context.irreducible` event
  // with a `kind: "tooling" | "content"` field on the payload (see Task 8).
  // §6 — context-rot threshold advisory (Task 9). Mechanism only: fires when
  // configured threshold crossed. Threshold UNSET this cycle → never emitted
  // by default. Advisory only, never a hard gate (spec §6).
  ROT_RISK: "context.rot_risk",
} as const;

// T6 — C1 observability: payload types for the five lifecycle events.

export type ContextSnapshotCreatedPayload = {
  invocationId: string;
  /** Approximate candidate token count at snapshot time (from the projection or
   *  classified candidate). Observability metadata — NOT an admission figure. */
  candidateTokens?: number;
};

export type ContextBudgetComputedPayload = {
  invocationId: string;
  contextWindowTokens: number;
  availableInputTokens: number;
  /** §5: safety-margin reservation (feeds availableInputTokens). */
  budgetReservation: number;
  /** §5: maxOutputTokens sent to the provider (≤ budgetReservation). */
  requestedMaxOutputTokens: number;
  policyReservation: number;
};

export type ContextAssembledPayload = {
  invocationId: string;
  admittedItems: number;
  droppedItems: number;
  admittedTokens: number;
  droppedTokens: number;
  /** Token tally by ContextCategory for admitted items. */
  admittedByCategory: Record<string, number>;
  /** Drop reasons for each dropped item (pairing reason with kind). */
  droppedReasons: Array<{ kind: string; reason: string }>;
};

export type ContextPreflightFailedPayload = {
  invocationId: string;
  overageTokens: number;
  byCategory: Record<string, number>;
};

export type TokenCalibrationPayload = {
  invocationId: string;
  provider: string;
  model: string;
  /** Unpadded base tokenizer estimate of the admitted request. */
  estimatedRaw: number;
  /** Padded budget-admission estimate of the admitted request. */
  estimatedPadded: number;
  /** Actual provider-reported input tokens (usage.inputTokens). */
  actual: number;
};

export type ContextIrreduciblePayload = {
  invocationId: string;
  overageTokens: number;
  byCategory: Record<string, number>;
  availableInputTokens: number;
  mandatoryTokens: number;
  contextWindowTokens: number;
  /**
   * §2 — overflow kind. `tooling` when the irreducible overflow is dominated
   * by T1a/T1b tool-schema tokens (post-scoping, tool bloat); `content`
   * otherwise (content bloat / mixed). Distinguishes actionable tool-bloat
   * overflows from generic content overflows so downstream consumers can
   * route appropriately.
   */
  kind?: "tooling" | "content";
};

// §2 — Tool-scoping event payload types
export type ToolingScopeFallbackFullPayload = {
  provider: string;
  model: string;
  reason: string;
};

export type ToolingScopeReintroducedPayload = {
  invocationId: string;
  toolName: string;
  reason: "shed_tool_called";
};

/**
 * §6 — `context.rot_risk` advisory payload (Task 9).
 *
 * Emitted only when `calibration.contextRotThreshold` is configured AND
 * the run's realized `contextPressure` crosses the threshold. Advisory
 * only — never a hard gate (spec §6: "warning only — never hard failure,
 * never another overflow gate").
 *
 * - `metric`: which `ContextRotThreshold.metric` was evaluated.
 * - `measured`: the realized value of that metric at run-end.
 * - `threshold`: the configured threshold value (for ratio computation
 *   downstream).
 * - `contextPressure`: the full pressure snapshot (aggregate + peak) so
 *   consumers can render either side of the comparison.
 */
export type ContextRotRiskPayload = {
  invocationId: string;
  metric: "tier5Dropped" | "remainingTokensPct";
  measured: number;
  threshold: number;
  contextPressure: import("../run.js").ContextPressure;
};

// Policy event payload types
export type PolicyDecisionPayload = {
  toolCallId: string;
  capability: string;
  decision: "allow" | "ask" | "deny";
  reason: string;
  matchedRuleId?: string;
};

export type ApprovalRequestedPayload = {
  approvalId: string;
  toolCallId?: string;
  patchProposalId?: string;
  prompt: string;
  choices: Array<"approve" | "deny" | "edit">;
};

export type ApprovalResolvedPayload = {
  approvalId: string;
  decision: "approved" | "denied" | "edited";
  reason?: string;
};

export const POLICY_EVENT_TYPES = {
  DECISION: "policy.decision",
  APPROVAL_REQUESTED: "approval.requested",
  APPROVAL_RESOLVED: "approval.resolved",
} as const;

export type ArtifactCreatedPayload = {
  artifactId: string;
  toolCallId: string;
  path: string;
  mimeType: string;
  size: number;
  retention: "session";
};

export const ARTIFACT_EVENT_TYPES = {
  CREATED: "artifact.created",
} as const;

// ─── Approval lifecycle event types ─────────────────────────

export const APPROVAL_EVENT_TYPES = {
  CREATED: "approval.created",
  REUSED: "approval.reused",
  RESOLVED: "approval.resolved",
  RESUMED: "approval.resumed",
  RESUME_FAILED: "approval.resume.failed",
  CONTINUATION_CREATED: "continuation.created",
  CONTINUATION_CONSUMED: "continuation.consumed",

  // Lifecycle event types
  CONSUMED: "approval.consumed",
  EXPIRED: "approval.expired",
  REVOKED: "approval.revoked",
  INVALIDATED: "approval.invalidated",
  GROUP_RESOLVED: "approval.group.resolved",
} as const;

// ─── Replay lifecycle event types ───────────────────────────

export const REPLAY_EVENT_TYPES = {
  PLAN_CREATED: "replay.plan.created",
  STARTED: "replay.started",
  STEP_STARTED: "replay.step.started",
  STEP_COMPLETED: "replay.step.completed",
  STEP_SKIPPED: "replay.step.skipped",
  STEP_BLOCKED: "replay.step.blocked",
  COMPLETED: "replay.completed",
  FAILED: "replay.failed",
  DIFF_RECORDED: "replay.diff.recorded",
} as const;

export type ReplayPlanCreatedPayload = {
  mode: string;
  stepCount: number;
  toolCount: number;
  blockedSteps: number;
};

export type ReplayStartedPayload = {
  mode: string;
  sessionId: string;
};

export type ReplayStepPayload = {
  stepIndex: number;
  traceId: string;
  action: string;
  toolName?: string;
  status?: "completed" | "skipped" | "blocked" | "failed";
  outputPreview?: string;
  blockReason?: string;
  error?: string;
  durationMs?: number;
};

export type ReplayCompletedPayload = {
  mode: string;
  stepCount: number;
  successCount: number;
  blockedCount: number;
  skippedCount: number;
  failedCount: number;
  totalDurationMs: number;
};

export type ReplayFailedPayload = {
  mode: string;
  reason: string;
  stepIndex?: number;
};

export type ReplayDiffRecordedPayload = {
  replayId: string;
  filePath: string;
  changeType: "created" | "modified" | "deleted";
  diffPreview: string;
  diffSize: number;
  rollbackable: boolean;
};

// ─── Rollback lifecycle event types ──────────────────────────

export const ROLLBACK_EVENT_TYPES = {
  PLAN_CREATED: "rollback.plan.created",
  STARTED: "rollback.started",
  STEP_STARTED: "rollback.step.started",
  STEP_COMPLETED: "rollback.step.completed",
  STEP_SKIPPED: "rollback.step.skipped",
  STEP_BLOCKED: "rollback.step.blocked",
  COMPLETED: "rollback.completed",
  FAILED: "rollback.failed",
} as const;

export type RollbackEventPayload = {
  rollbackId: string;
  replayId: string;
  path?: string;
  action?: "restore" | "delete-created" | "skip";
  approvalId?: string;
  reason?: string;
  status?: string;
  outputPreview?: string;
};

export type RollbackPlanCreatedPayload = {
  rollbackId: string;
  replayId: string;
  mode: string;
  stepCount: number;
};

export type RollbackCompletedPayload = {
  rollbackId: string;
  replayId: string;
  mode: string;
  stepCount: number;
  successCount: number;
  blockedCount: number;
  skippedCount: number;
  totalDurationMs: number;
};

export type RollbackFailedPayload = {
  rollbackId: string;
  replayId: string;
  reason: string;
  stepIndex?: number;
};

/**
 * Stable payload shape for all approval lifecycle events.
 * This is the audit contract — every approval event carries these fields.
 */
export type ApprovalLifecyclePayload = {
  approvalId: string;
  continuationId?: string;
  requestId?: string;
  sessionId?: string;
  taskId?: string;
  capability?: string;
  toolName?: string;
  status: "pending" | "approved" | "denied" | "resumed" | "failed" | "reused";
  reason?: string;
  cwd?: string;
  argsHash?: string;
  previousApprovalId?: string;
};
