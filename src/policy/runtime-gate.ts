/**
 * runtime-gate.ts — Two-layer execution gate for graph nodes.
 *
 * Layer 1: CapabilityResolver — does any agent/tool cover this capability?
 * Layer 2: RuleEvaluator — is this capability allowed by policy?
 */
import type { CardRegistry } from "../registry/card-registry.js";
import { resolveCapabilities, type CapabilityResolution } from "../registry/capability-resolver.js";
import type { RuleEvaluator } from "./rule-evaluator.js";
import type { TaskNode } from "../kernel/task-graph.js";
import type { ApprovalStore } from "../approvals/approval-store.js";

export type RuntimeGateStatus = "ready" | "blocked" | "needs_approval";

export interface RuntimeGateDecision {
  status: RuntimeGateStatus;
  capabilityResolution?: CapabilityResolution;
  policyDecision?: "allow" | "ask" | "deny";
  policyRuleId?: string;
  policyReason?: string;
  approvalId?: string;
  reason: string;
}

export interface RuntimeGateInput {
  node: TaskNode;
  registry: CardRegistry;
  policyEvaluator: RuleEvaluator;
  approvalStore?: ApprovalStore;
}

export async function evaluateRuntimeGate(input: RuntimeGateInput): Promise<RuntimeGateDecision> {
  const { node, registry, policyEvaluator, approvalStore } = input;
  const caps = node.requiredCapabilities ?? [];

  // Layer 1: Capability coverage check
  if (caps.length > 0) {
    const capResult = resolveCapabilities({
      requiredCapabilities: caps,
      domain: node.domain,
      executionProfile: (node as any).executionProfile,
      registry,
    });
    if (capResult.missingCapabilities.length > 0) {
      return {
        status: "blocked",
        capabilityResolution: capResult,
        reason: `Missing capabilities: ${capResult.missingCapabilities.join(", ")}`,
      };
    }
    // Layer 2: Policy evaluation across all capabilities
    // Apply the most restrictive decision: deny > ask > allow
    let overall: { decision: "allow" | "ask" | "deny"; ruleId?: string; reason?: string } | undefined;

    for (const cap of caps) {
      const policyResult = policyEvaluator.evaluate({
        capability: cap,
        riskLevel: node.riskLevel as any,
        executionProfile: (node as any).executionProfile,
      });
      if (policyResult.decision === "deny") {
        overall = { decision: "deny", ruleId: policyResult.matchedRuleId, reason: policyResult.reason };
        break; // deny is final
      }
      if (policyResult.decision === "ask" && (!overall || overall.decision === "allow")) {
        overall = { decision: "ask", ruleId: policyResult.matchedRuleId, reason: policyResult.reason };
        // continue — a later cap might deny
      }
      if (policyResult.decision === "allow" && !overall) {
        overall = { decision: "allow", ruleId: policyResult.matchedRuleId, reason: policyResult.reason };
      }
    }

    if (overall?.decision === "deny") {
      return {
        status: "blocked",
        capabilityResolution: capResult,
        policyDecision: "deny",
        policyRuleId: overall.ruleId,
        policyReason: overall.reason,
        reason: overall.reason ?? `Blocked by policy rule: ${overall.ruleId}`,
      };
    }

    if (overall?.decision === "ask") {
      if (!approvalStore) {
        return {
          status: "blocked",
          capabilityResolution: capResult,
          policyDecision: "ask",
          policyRuleId: overall.ruleId,
          policyReason: overall.reason,
          reason: "Approval required but no approval store configured",
        };
      }

      // Check for existing resolved approval for this graph/node/capability
      const resolved = approvalStore.findResolved({
        graphId: node.graphId, nodeId: node.id, capability: caps[0],
      });
      if (resolved) {
        if (resolved.status === "approved") {
          return { status: "ready", reason: `Approved by prior approval: ${resolved.id}` };
        }
        return {
          status: "blocked",
          capabilityResolution: capResult,
          policyDecision: "deny",
          policyReason: resolved.decisionReason,
          reason: `Prior approval was denied: ${resolved.id}`,
        };
      }

      // Check for existing pending approval — reuse rather than duplicate
      const existing = approvalStore.findPending({
        graphId: node.graphId, nodeId: node.id, capability: caps[0],
      });
      if (existing) {
        return {
          status: "needs_approval",
          capabilityResolution: capResult,
          policyDecision: "ask",
          policyRuleId: overall.ruleId,
          policyReason: overall.reason,
          approvalId: existing.id,
          reason: `Pending approval: ${existing.id}`,
        };
      }

      // No existing approval — create new one
      const approval = await approvalStore.request({
        reason: overall.reason ?? `Approval required for capability: ${caps.join(", ")}`,
        graphId: node.graphId,
        nodeId: node.id,
        capability: caps[0],
        riskLevel: node.riskLevel as any,
      });
      return {
        status: "needs_approval",
        capabilityResolution: capResult,
        policyDecision: "ask",
        policyRuleId: overall.ruleId,
        policyReason: overall.reason,
        approvalId: approval.id,
        reason: `Pending approval: ${approval.id}`,
      };
    }
  }

  return { status: "ready", reason: "All gates passed" };
}
