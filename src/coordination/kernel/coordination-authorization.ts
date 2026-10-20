/**
 * coordination-authorization.ts — Per-capability authorization aggregation.
 *
 * Evaluates every declared capability through ExecutionAuthorization.
 * Aggregates fail-closed: any denial wins, else any approval_required wins,
 * else allowed. Empty capabilities are denied.
 */

import type { SessionMode } from "../../operations/config/schema.js";
import type { ExecutionAuthorization } from "../../runtime-state/runtime/execution-authorization.js";
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
  // Deduplicate: a repeated capability is ONE authorization requirement, not
  // two. Evaluating it twice made the second pass re-ask against an approval the
  // first pass had already consumed, so a planner that listed a capability
  // twice produced a worker that could never resume (F6, test 8).
  const caps = [...new Set(worker.requiredCapabilities ?? [])];

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
  let bindingKey: string | undefined;
  let requestFingerprint: string | undefined;

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
      // Typed, trusted identity (SRAP approval-binding continuity). The
      // boundary validates this and routes the request through the
      // coordination-aware approval path — the metadata bag above is kept for
      // observability only and is never the authorization input.
      coordination: {
        coordinationRunId: run.id,
        workerId: worker.id,
        workerAttempt: worker.attempt,
        ownershipClaims: worker.ownershipClaims,
      },
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
      // Persist the binding the approval was actually created with; the
      // scheduler reconciles on THIS key, never a reconstructed one.
      bindingKey = (decision as any).bindingKey ?? bindingKey;
      requestFingerprint = (decision as any).requestFingerprint ?? requestFingerprint;
    }
  }

  const evidence: WorkerAuthorizationEvidence = {
    evaluatedAt: new Date().toISOString(),
    decisions,
    ...(bindingKey !== undefined ? { bindingKey } : {}),
    ...(requestFingerprint !== undefined ? { requestFingerprint } : {}),
  };

  if (hasDenied) {
    return { status: "denied", evidence, reason: "Authorization denied for one or more capabilities" };
  }

  if (hasApproval) {
    // Fail closed: an approval-required verdict MUST carry the durable approval
    // id the authority actually created (SRAP PR B). A missing id — OR the
    // boundary's legacy `"unknown"` sentinel (ExecutionAuthorization coerces an
    // id-less `ask` to `"unknown"` for the graph reuse path) — is NOT a
    // legitimate pending approval and must never become a blocked coordination
    // worker. The gate returns `ask` only with a real persisted id, so either
    // shape means no durable approval exists.
    if (!approvalId || approvalId === "unknown") {
      return {
        status: "denied",
        evidence,
        reason: "Approval required but no durable approval was created (missing approval id)",
      };
    }
    return { status: "approval_required", evidence, approvalId, reason: approvalReason ?? "Approval required" };
  }

  return { status: "allowed", evidence };
}
