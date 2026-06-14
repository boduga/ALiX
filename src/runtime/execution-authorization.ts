/**
 * execution-authorization.ts — Single orchestration boundary for execution decisions.
 *
 * Composes CapabilityResolver → PolicyGate → ApprovalStore → OwnershipGate → Audit
 * into one evaluate() call. Every execution path (tool, graph, daemon, TUI, agent)
 * goes through this service once per request.
 *
 * This is a COMPOSITION boundary, not a merge. The underlying stores (PolicyGate,
 * ApprovalStore, OwnershipGate) are unchanged. Existing call sites migrate one at a time.
 */

import type { PolicyGate } from "../policy/policy-gate.js";
import type { OwnershipGateConfig } from "../ownership/ownership-gate.js";
import type { CapabilityRegistry } from "../policy/capability-registry.js";
import type { AuditStore } from "../audit/audit-store.js";
import type { EventLog } from "../events/event-log.js";
import { checkOwnershipGate } from "../ownership/ownership-gate.js";
import type { ExecutionDecision, ExecutionDecisionRequest } from "./execution-decision.js";
import { decisionAllowed, decisionDenied, decisionApprovalRequired } from "./execution-decision.js";

export type AuthorizationDeps = {
  policyGate: PolicyGate;
  ownershipGateConfig?: OwnershipGateConfig;
  capabilityRegistry?: CapabilityRegistry;
  auditStore?: AuditStore;
  eventLog?: EventLog;
};

/**
 * Simple capability classification for ownership gate.
 * Write-capable capabilities are: file.write, file.delete, shell.run, patch.apply.
 */
function isMutatingCapability(capability: string): boolean {
  switch (capability) {
    case "file.write":
    case "file.delete":
    case "shell.run":
    case "patch.apply":
      return true;
    default:
      return false;
  }
}

export class ExecutionAuthorization {
  constructor(private deps: AuthorizationDeps) {}

  /**
   * Evaluate one execution request through the full authorization pipeline.
   *
   * Pipeline:
   *   1. Capability check—resolve risk level, requiresApproval flag
   *   2. Policy evaluation—delegate to PolicyGate
   *   3. Approval lifecycle - delegated to PolicyGate handleAskDecision()
   *   4. Ownership gate—verify mutation targets are covered
   *   5. Audit emission—one canonical record
   */
  async evaluate(request: ExecutionDecisionRequest): Promise<ExecutionDecision> {
    const { policyGate, ownershipGateConfig, capabilityRegistry, auditStore, eventLog } = this.deps;
    const agentId = request.agentId ?? "alix";

    // ── Step 1: Capability metadata ──────────────────────────────
    const capDef = capabilityRegistry?.get(request.capability);
    const riskLevel = capDef?.riskLevel;

    // ── Step 2: Policy evaluation ───────────────────────────────
    const policyDecision = request.toolName
      ? await policyGate.evaluateToolCall({
          requestId: request.requestId,
          toolName: request.toolName,
          capability: request.capability,
          args: request.args ?? {},
          cwd: request.cwd,
          sessionMode: request.sessionMode,
          sessionId: request.sessionId,
          source: request.source === "agent" ? "tool" : request.source,
        })
      : await policyGate.evaluateCapability({
          requestId: request.requestId,
          capability: request.capability,
          sessionMode: request.sessionMode,
          nodeId: request.nodeId,
          graphId: request.graphId,
          sessionId: request.sessionId,
          source: request.source === "agent" ? "tool" : request.source,
        });

    // Short-circuit deny
    if (policyDecision.decision === "deny") {
      const finalDecision = decisionDenied(policyDecision.reason, {
        policyRuleId: policyDecision.matchedRuleId,
      });
      await this.emitAudit(auditStore, eventLog, request, finalDecision, { riskLevel, policyDecision });
      return finalDecision;
    }

    // ── Step 3: Approval lifecycle ───────────────────────────────
    if (policyDecision.decision === "ask") {
      // approval_required — return the approvalId and reason from PolicyGate
      const finalDecision = decisionApprovalRequired(
        policyDecision.approvalId ?? "unknown",
        policyDecision.reason,
        { policyRuleId: policyDecision.matchedRuleId },
      );
      await this.emitAudit(auditStore, eventLog, request, finalDecision, { riskLevel, policyDecision });
      return finalDecision;
    }

    // ── Step 4: Ownership gate ───────────────────────────────────
    // Only run ownership check for known-mutating capabilities
    if (ownershipGateConfig && request.toolName && request.args) {
      const mutatesCap = isMutatingCapability(request.capability);
      if (mutatesCap) {
        const ownershipResult = await checkOwnershipGate(
          ownershipGateConfig,
          agentId,
          request.toolName,
          request.args,
          true, // mutates
        );
        if (ownershipResult !== null) {
          const errMsg = ownershipResult.kind === "error" ? ownershipResult.message : "Ownership check failed";
          const finalDecision = decisionDenied(
            `Ownership check failed: ${errMsg}`,
            { policyRuleId: "ownership-gate" },
          );
          await this.emitAudit(auditStore, eventLog, request, finalDecision, { riskLevel, policyDecision, ownershipResult });
          return finalDecision;
        }
      }
    }

    // ── Step 5: Allowed ─────────────────────────────────────────
    const finalDecision = decisionAllowed({
      policyRuleId: policyDecision.matchedRuleId,
      approvalId: policyDecision.approvalId,
    });
    await this.emitAudit(auditStore, eventLog, request, finalDecision, { riskLevel, policyDecision });
    return finalDecision;
  }

  private async emitAudit(
    auditStore: AuditStore | undefined,
    eventLog: EventLog | undefined,
    request: ExecutionDecisionRequest,
    decision: ExecutionDecision,
    extras: { riskLevel?: string; policyDecision?: unknown; ownershipResult?: unknown },
  ): Promise<void> {
    // Narrow the discriminated union for field access
    const reason = decision.status === "denied" || decision.status === "approval_required" ? decision.reason : undefined;
    const policyRuleId = "policyRuleId" in decision ? (decision as any).policyRuleId as string | undefined : undefined;
    const approvalId = decision.status === "allowed" || decision.status === "approval_required" ? (decision as any).approvalId as string | undefined : undefined;
    const action = `authorization.${decision.status}` as "authorization.allowed" | "authorization.denied" | "authorization.approval_required";

    const auditPromise = auditStore?.append({
      action,
      actor: "system",
      details: {
        requestId: request.requestId,
        capability: request.capability,
        toolName: request.toolName,
        agentId: request.agentId,
        source: request.source,
        sessionId: request.sessionId,
        decision: decision.status,
        reason,
        policyRuleId,
        approvalId,
        riskLevel: extras.riskLevel,
      },
    }).catch(() => {});

    const eventPromise = eventLog?.append({
      sessionId: request.sessionId,
      actor: "authorization",
      type: "authorization.evaluated",
      payload: {
        requestId: request.requestId,
        capability: request.capability,
        toolName: request.toolName,
        agentId: request.agentId,
        source: request.source,
        decision: decision.status,
        policyRuleId,
        approvalId,
      },
    }).catch(() => {});

    await Promise.all([auditPromise, eventPromise]);
  }
}
