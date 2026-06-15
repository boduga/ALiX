/**
 * coordination-authorization.ts — Per-capability authorization aggregation.
 *
 * Evaluates every declared capability through ExecutionAuthorization.
 * Aggregates fail-closed: any denial wins, else any approval_required wins,
 * else allowed. Empty capabilities are denied.
 */

import type { SessionMode } from "../config/schema.js";
import type { ExecutionAuthorization } from "../runtime/execution-authorization.js";
import type { WorkerCapabilityDecision, WorkerAuthorizationEvidence } from "./coordination-types.js";
import type { CoordinationRun, WorkerAssignment } from "./coordination-types.js";

export type WorkerAuthorizationResult =
  | { status: "allowed"; evidence: WorkerAuthorizationEvidence }
  | { status: "denied"; evidence: WorkerAuthorizationEvidence; reason: string }
  | { status: "approval_required"; evidence: WorkerAuthorizationEvidence; approvalId: string; reason: string };

export type AuthorizeWorkerOptions = {
  authorization: ExecutionAuthorization;
  worker: WorkerAssignment;
  run: CoordinationRun;
  cwd: string;
  sessionMode: SessionMode;
};

/**
 * Evaluate all capabilities for a worker and aggregate results.
 *
 * Rules:
 * - Empty capabilities → denied (fail closed)
 * - Any denied → denied
 * - Any approval_required (and no denial) → approval_required
 * - All allowed → allowed
 * - Evidence is persisted before returning
 */
export async function authorizeWorker(options: AuthorizeWorkerOptions): Promise<WorkerAuthorizationResult> {
  const { authorization, worker, run, cwd, sessionMode } = options;
  const caps = worker.requiredCapabilities ?? [];

  // Empty capabilities fail closed
  if (caps.length === 0) {
    const evidence: WorkerAuthorizationEvidence = {
      evaluatedAt: new Date().toISOString(),
      decisions: [],
    };
    return { status: "denied", evidence, reason: "Worker has no declared capabilities" };
  }

  const decisions: WorkerCapabilityDecision[] = [];
  let hasDenied = false;
  let hasApproval = false;
  let approvalId: string | undefined;
  let approvalReason: string | undefined;

  for (const cap of caps) {
    const requestId = `${run.id}:${worker.id}:${cap}:${worker.attempt}`;
    const decision = await authorization.evaluate({
      requestId,
      capability: cap,
      cwd,
      sessionMode,
      sessionId: run.sessionId,
      agentId: worker.agentId,
      source: "agent",
      nodeId: worker.sourceNodeId,
      graphId: run.taskGraphId,
      metadata: { coordinationRunId: run.id, workerId: worker.id, attempt: worker.attempt },
    });

    const capDecision: WorkerCapabilityDecision = {
      capability: cap,
      status: decision.status === "allowed" ? "allowed" : decision.status === "denied" ? "denied" : "approval_required",
      policyRuleId: (decision as any).policyRuleId,
      approvalId: (decision as any).approvalId,
      reason: (decision as any).reason,
    };
    decisions.push(capDecision);

    if (decision.status === "denied") hasDenied = true;
    if (decision.status === "approval_required") {
      hasApproval = true;
      approvalId = (decision as any).approvalId;
      approvalReason = (decision as any).reason;
    }
  }

  const evidence: WorkerAuthorizationEvidence = {
    evaluatedAt: new Date().toISOString(),
    decisions,
  };

  if (hasDenied) {
    return { status: "denied", evidence, reason: "Authorization denied for one or more capabilities" };
  }

  if (hasApproval) {
    return { status: "approval_required", evidence, approvalId: approvalId ?? "unknown", reason: approvalReason ?? "Approval required" };
  }

  return { status: "allowed", evidence };
}
