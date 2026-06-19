/**
 * P4.5d — Evidence Event Writer: typed wrapper around EvidenceStore for workflow events.
 *
 * Provides one method per workflow event type. Each method:
 *   - Builds the correct payload per the SDS event table
 *   - Appends to the EvidenceStore
 *   - Returns the recorded EvidenceRecord (for fingerprint linking)
 *
 * All methods are best-effort — they never throw. Callers should use the
 * return value (null if recording failed) to decide whether to link evidence.
 *
 * @module
 */

import type { EvidenceRecord, EvidenceType } from "../security/evidence/evidence-types.js";
import type { WorkflowState, AgentName } from "./types.js";

// ---------------------------------------------------------------------------
// Event-specific payload types
// ---------------------------------------------------------------------------

export interface IssueSelectedPayload {
  priority: "low" | "medium" | "high" | "critical";
  complexity: "small" | "medium" | "large" | "unknown";
  labels: string[];
}

export interface PlanGeneratedPayload {
  subtaskCount: number;
  estimatedFiles: string[];
}

export interface PlanApprovedPayload {
  planFingerprint: string;
}

export interface PlanRejectedPayload {
  reason: string;
}

export interface ExecutionStartedPayload {
  branchName: string;
  subtaskId?: string;
}

export interface ExecutionCompletedPayload {
  commitSha: string;
  filesChanged: number;
}

export interface ReviewStartedPayload {
  commitSha: string;
}

export interface ReviewCompletedPayload {
  verdict: "approve" | "changes_requested" | "reject";
  findingCount: number;
}

export interface PrCreatedPayload {
  prUrl: string;
  prNumber: number;
  branchName: string;
}

export interface MergeCompletedPayload {
  mergeCommitSha: string;
}

export interface WorkflowBlockedPayload {
  reason: string;
  blockingItem?: string;
}

export interface WorkflowUnblockedPayload {
  blockedDurationMs?: number;
}

export interface WorkflowAbortedPayload {
  reason: string;
  forcedState?: WorkflowState;
  rollbackState?: WorkflowState;
}

// ---------------------------------------------------------------------------
// EvidenceEventWriter
// ---------------------------------------------------------------------------

export class EvidenceEventWriter {
  constructor(
    private readonly append: (
      type: EvidenceType,
      payload: Record<string, unknown>,
    ) => Promise<EvidenceRecord>,
  ) {}

  // -----------------------------------------------------------------------
  // Issue lifecycle
  // -----------------------------------------------------------------------

  /**
   * Record that an issue was selected for execution.
   * Writer: IssueIntakeAgent
   */
  async recordIssueSelected(
    issueNumber: number,
    payload: IssueSelectedPayload,
    context?: { actor?: AgentName; from?: WorkflowState; to?: WorkflowState },
  ): Promise<EvidenceRecord | null> {
    return this.record("issue_selected", issueNumber, payload as unknown as Record<string, unknown>, context);
  }

  /**
   * Record that a plan was generated for an issue.
   * Writer: PlanningAgent
   */
  async recordPlanGenerated(
    issueNumber: number,
    payload: PlanGeneratedPayload,
    context?: { actor?: AgentName; from?: WorkflowState; to?: WorkflowState },
  ): Promise<EvidenceRecord | null> {
    return this.record("plan_generated", issueNumber, payload as unknown as Record<string, unknown>, context);
  }

  /**
   * Record that a plan was approved by a human.
   * Writer: System (CLI)
   */
  async recordPlanApproved(
    issueNumber: number,
    payload: PlanApprovedPayload,
    context?: { actor?: AgentName; from?: WorkflowState; to?: WorkflowState },
  ): Promise<EvidenceRecord | null> {
    return this.record("plan_approved", issueNumber, payload as unknown as Record<string, unknown>, context);
  }

  /**
   * Record that a plan was rejected by a human.
   * Writer: System (CLI)
   */
  async recordPlanRejected(
    issueNumber: number,
    payload: PlanRejectedPayload,
    context?: { actor?: AgentName; from?: WorkflowState; to?: WorkflowState },
  ): Promise<EvidenceRecord | null> {
    return this.record("plan_rejected", issueNumber, payload as unknown as Record<string, unknown>, context);
  }

  // -----------------------------------------------------------------------
  // Execution
  // -----------------------------------------------------------------------

  /**
   * Record that execution has started on an issue.
   * Writer: ExecutionAgent
   */
  async recordExecutionStarted(
    issueNumber: number,
    payload: ExecutionStartedPayload,
    context?: { actor?: AgentName; from?: WorkflowState; to?: WorkflowState },
  ): Promise<EvidenceRecord | null> {
    return this.record("execution_started", issueNumber, payload as unknown as Record<string, unknown>, context);
  }

  /**
   * Record that execution has completed on an issue.
   * Writer: ExecutionAgent
   */
  async recordExecutionCompleted(
    issueNumber: number,
    payload: ExecutionCompletedPayload,
    context?: { actor?: AgentName; from?: WorkflowState; to?: WorkflowState },
  ): Promise<EvidenceRecord | null> {
    return this.record("execution_completed", issueNumber, payload as unknown as Record<string, unknown>, context);
  }

  // -----------------------------------------------------------------------
  // Review
  // -----------------------------------------------------------------------

  /**
   * Record that a review has started.
   * Writer: ReviewAgent
   */
  async recordReviewStarted(
    issueNumber: number,
    payload: ReviewStartedPayload,
    context?: { actor?: AgentName; from?: WorkflowState; to?: WorkflowState },
  ): Promise<EvidenceRecord | null> {
    return this.record("review_started", issueNumber, payload as unknown as Record<string, unknown>, context);
  }

  /**
   * Record that a review has completed.
   * Writer: ReviewAgent
   */
  async recordReviewCompleted(
    issueNumber: number,
    payload: ReviewCompletedPayload,
    context?: { actor?: AgentName; from?: WorkflowState; to?: WorkflowState },
  ): Promise<EvidenceRecord | null> {
    return this.record("review_completed", issueNumber, payload as unknown as Record<string, unknown>, context);
  }

  // -----------------------------------------------------------------------
  // PR
  // -----------------------------------------------------------------------

  /**
   * Record that a PR was created for an issue.
   * Writer: PRAgent
   */
  async recordPrCreated(
    issueNumber: number,
    payload: PrCreatedPayload,
    context?: { actor?: AgentName; from?: WorkflowState; to?: WorkflowState },
  ): Promise<EvidenceRecord | null> {
    return this.record("pr_created", issueNumber, payload as unknown as Record<string, unknown>, context);
  }

  /**
   * Record that a PR was merged.
   * Writer: System (webhook)
   */
  async recordMergeCompleted(
    issueNumber: number,
    payload: MergeCompletedPayload,
    context?: { actor?: AgentName; from?: WorkflowState; to?: WorkflowState },
  ): Promise<EvidenceRecord | null> {
    return this.record("merge_completed", issueNumber, payload as unknown as Record<string, unknown>, context);
  }

  // -----------------------------------------------------------------------
  // Workflow coordination
  // -----------------------------------------------------------------------

  /**
   * Record that a workflow was blocked.
   * Writer: WorkflowCoordinator
   */
  async recordBlocked(
    issueNumber: number,
    payload: WorkflowBlockedPayload,
    context?: { actor?: AgentName; from?: WorkflowState; to?: WorkflowState },
  ): Promise<EvidenceRecord | null> {
    return this.record("workflow_blocked", issueNumber, payload as unknown as Record<string, unknown>, context);
  }

  /**
   * Record that a workflow was unblocked.
   * Writer: WorkflowCoordinator
   */
  async recordUnblocked(
    issueNumber: number,
    payload: WorkflowUnblockedPayload,
    context?: { actor?: AgentName; from?: WorkflowState; to?: WorkflowState },
  ): Promise<EvidenceRecord | null> {
    return this.record("workflow_unblocked", issueNumber, payload as unknown as Record<string, unknown>, context);
  }

  /**
   * Record that a workflow was aborted (rollback or recovery).
   * Writer: WorkflowCoordinator
   */
  async recordAborted(
    issueNumber: number,
    payload: WorkflowAbortedPayload,
    context?: { actor?: AgentName; from?: WorkflowState; to?: WorkflowState },
  ): Promise<EvidenceRecord | null> {
    return this.record("workflow_aborted", issueNumber, payload as unknown as Record<string, unknown>, context);
  }

  // -----------------------------------------------------------------------
  // Execution
  // -----------------------------------------------------------------------

  /**
   * Record that a subtask started execution.
   * Writer: ExecutionAgent
   */
  async recordSubtaskStarted(
    issueNumber: number,
    payload: { subtaskId: string; files: string[] },
    context?: { actor?: AgentName; from?: WorkflowState; to?: WorkflowState },
  ): Promise<EvidenceRecord | null> {
    return this.record("execution_subtask_started", issueNumber, payload as unknown as Record<string, unknown>, context);
  }

  /**
   * Record that a subtask completed execution.
   * Writer: ExecutionAgent
   */
  async recordSubtaskCompleted(
    issueNumber: number,
    payload: { subtaskId: string; commitSha: string; filesChanged: number },
    context?: { actor?: AgentName; from?: WorkflowState; to?: WorkflowState },
  ): Promise<EvidenceRecord | null> {
    return this.record("execution_subtask_completed", issueNumber, payload as unknown as Record<string, unknown>, context);
  }

  /**
   * Record that tests passed for a subtask.
   * Writer: ExecutionAgent
   */
  async recordTestPassed(
    issueNumber: number,
    payload: { subtaskId: string; testFiles: string[]; durationMs: number },
    context?: { actor?: AgentName; from?: WorkflowState; to?: WorkflowState },
  ): Promise<EvidenceRecord | null> {
    return this.record("execution_test_passed", issueNumber, payload as unknown as Record<string, unknown>, context);
  }

  /**
   * Record that tests failed for a subtask.
   * Writer: ExecutionAgent
   */
  async recordTestFailed(
    issueNumber: number,
    payload: { subtaskId: string; testFiles: string[]; error: string },
    context?: { actor?: AgentName; from?: WorkflowState; to?: WorkflowState },
  ): Promise<EvidenceRecord | null> {
    return this.record("execution_test_failed", issueNumber, payload as unknown as Record<string, unknown>, context);
  }

  /**
   * Record that a commit was created for a subtask.
   * Writer: ExecutionAgent
   */
  async recordCommitCreated(
    issueNumber: number,
    payload: { subtaskId: string; commitSha: string; files: string[] },
    context?: { actor?: AgentName; from?: WorkflowState; to?: WorkflowState },
  ): Promise<EvidenceRecord | null> {
    return this.record("execution_commit_created", issueNumber, payload as unknown as Record<string, unknown>, context);
  }

  // -----------------------------------------------------------------------
  // Capability routing
  // -----------------------------------------------------------------------

  async recordAgentResolved(
    issueNumber: number,
    payload: { capability: string; agentId: string; step: string },
    context?: { actor?: AgentName; from?: WorkflowState; to?: WorkflowState },
  ): Promise<EvidenceRecord | null> {
    return this.record("agent_resolved", issueNumber, payload as unknown as Record<string, unknown>, context);
  }

  async recordCapabilityRouted(
    issueNumber: number,
    payload: { capability: string; resolvedAgent: string; candidates: number; candidateAgentIds?: string[] },
    context?: { actor?: AgentName; from?: WorkflowState; to?: WorkflowState },
  ): Promise<EvidenceRecord | null> {
    return this.record("capability_routed", issueNumber, payload as unknown as Record<string, unknown>, context);
  }

  // -----------------------------------------------------------------------
  // Adaptation (P5.1)
  // -----------------------------------------------------------------------

  /**
   * Record that an AdaptationProposal was proposed (created from a reflection
   * recommendation). Writer: adaptation CLI (`alix adaptation propose`).
   *
   * Unlike the approve/reject/apply/failed events — which the ApprovalGate
   * owns — the "proposed" event is emitted at proposal creation time, before
   * any gate involvement. That is why the CLI records it directly rather than
   * the converter (which is a pure function) or the gate.
   *
   * `payload` and `reason` are optional extensions for the auto-generation
   * path (P5.2c.4): the effectiveness-revert generator threads the source
   * proposal's payload and a top-level reason through this event so the audit
   * trail preserves what triggered the auto-generated proposal. They are
   * optional so the P5.1g CLI call site (which omits both) continues to
   * compile and behave identically.
   */
  async recordAdaptationProposed(
    proposalId: string,
    payload: {
      createdAt: string;
      action: string;
      target: Record<string, unknown>;
      sourceRecommendationType: string;
      sourceConfidence: number;
      provenance?: "auto" | "manual";
      payload?: Record<string, unknown>;
      reason?: string;
    },
  ): Promise<EvidenceRecord | null> {
    return this.appendEvent("adaptation_proposed", { proposalId, ...payload });
  }

  /**
   * Record that an AdaptationProposal was approved by a human.
   * Writer: ApprovalGate
   */
  async recordAdaptationApproved(
    proposalId: string,
    payload: { approvedBy: string; approvedAt: string; action: string; target: Record<string, unknown> },
  ): Promise<EvidenceRecord | null> {
    return this.appendEvent("adaptation_approved", { proposalId, ...payload });
  }

  /**
   * Record that an AdaptationProposal was rejected by a human.
   * Writer: ApprovalGate
   */
  async recordAdaptationRejected(
    proposalId: string,
    payload: { rejectedBy: string; reason: string; action: string; target: Record<string, unknown> },
  ): Promise<EvidenceRecord | null> {
    return this.appendEvent("adaptation_rejected", { proposalId, ...payload });
  }

  /**
   * Record that an approved AdaptationProposal was successfully applied.
   * Writer: ApprovalGate
   */
  async recordAdaptationApplied(
    proposalId: string,
    payload: { appliedAt: string; action: string; target: Record<string, unknown>; approvedBy?: string },
  ): Promise<EvidenceRecord | null> {
    return this.appendEvent("adaptation_applied", { proposalId, ...payload });
  }

  /**
   * Record that an approved AdaptationProposal failed during application.
   * Writer: ApprovalGate
   */
  async recordAdaptationFailed(
    proposalId: string,
    payload: { error: string; action: string; target: Record<string, unknown>; approvedBy?: string },
  ): Promise<EvidenceRecord | null> {
    return this.appendEvent("adaptation_failed", { proposalId, ...payload });
  }

  /**
   * Record that an applied AdaptationProposal was assessed for effectiveness.
   * Writer: adaptation CLI (`alix adaptation effectiveness`)
   *
   * Advisory only — the recommendation here is informational. "revert" is a
   * recommendation for human action; it never executes a revert (no before
   * snapshot is stored; executable revert is a later phase).
   */
  async recordAdaptationEffectiveness(
    proposalId: string,
    payload: { recommendation: string; primaryMetric: string | null; assessedAt: string },
  ): Promise<EvidenceRecord | null> {
    return this.appendEvent("adaptation_effectiveness", { proposalId, ...payload });
  }

  // -----------------------------------------------------------------------
  // Adaptation revert (P5.2e)
  // -----------------------------------------------------------------------

  /**
   * Record that a snapshot was taken before applying a proposal, enabling
   * future executable revert.  Writer: AgentCardApplier / SkillApplier.
   */
  async recordSnapshotTaken(
    proposalId: string,
    payload: { snapshotFingerprint: string; contentHash: string; filePath: string },
  ): Promise<EvidenceRecord | null> {
    return this.appendEvent("adaptation_snapshot_taken", { proposalId, ...payload });
  }

  /**
   * Record that a revert attempt failed.  Writer: RevertApplier.
   *
   * `snapshotFingerprint` is optional — a revert can fail before a snapshot
   * is located (e.g. proposal was never snapshotted).
   */
  async recordRevertFailed(
    proposalId: string,
    payload: { error: string; snapshotFingerprint?: string },
  ): Promise<EvidenceRecord | null> {
    return this.appendEvent("adaptation_revert_failed", { proposalId, ...payload });
  }

  // -----------------------------------------------------------------------
  // Generic / internal
  // -----------------------------------------------------------------------

  private async record(
    type: EvidenceType,
    issueNumber: number,
    payload: Record<string, unknown>,
    context?: { actor?: AgentName; from?: WorkflowState; to?: WorkflowState },
  ): Promise<EvidenceRecord | null> {
    const enriched = {
      ...payload,
      issueNumber,
      ...(context?.from ? { fromState: context.from } : {}),
      ...(context?.to ? { toState: context.to } : {}),
      ...(context?.actor ? { actor: context.actor } : {}),
    };
    try {
      return await this.append(type, enriched);
    } catch {
      return null;
    }
  }

  /** Best-effort append for events that do not belong to an issue workflow. */
  private async appendEvent(
    type: EvidenceType,
    payload: Record<string, unknown>,
  ): Promise<EvidenceRecord | null> {
    try {
      return await this.append(type, payload);
    } catch {
      return null;
    }
  }
}
