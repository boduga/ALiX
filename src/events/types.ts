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
} as const;

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
} as const;

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
