/**
 * runtime-gate.ts — Two-layer execution gate for graph nodes.
 *
 * Layer 1: CapabilityResolver — does any agent/tool cover this capability?
 * Layer 2: RuleEvaluator or PolicyGate — is this capability allowed by policy?
 *
 * PolicyGate is the preferred decision path; PolicyEvaluator is retained
 * for backward compatibility.
 */
import type { CardRegistry } from "../registry/card-registry.js";
import { resolveCapabilities, type CapabilityResolution } from "../registry/capability-resolver.js";
import type { RuleEvaluator } from "./rule-evaluator.js";
import type { TaskNode } from "../kernel/task-graph.js";
import type { ApprovalStore } from "../approvals/approval-store.js";
import type { AuditStore } from "../audit/audit-store.js";
import type { PolicyGate } from "./policy-gate.js";
import type { AlixConfig } from "../config/schema.js";

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
  policyGate?: PolicyGate;     // preferred — overrides policyEvaluator when set
  approvalStore?: ApprovalStore;
  auditStore?: AuditStore;
  config?: AlixConfig;         // required when policyGate is used
}

export async function evaluateRuntimeGate(input: RuntimeGateInput): Promise<RuntimeGateDecision> {
  const { node, registry, policyEvaluator, approvalStore, auditStore } = input;
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
      auditStore?.append({ action: "runtime.blocked", actor: "system", details: {
        graphId: node.graphId, nodeId: node.id,
        capability: caps.join(","),
        reason: `Missing capabilities: ${capResult.missingCapabilities.join(", ")}`,
      }}).catch(() => {});
      return {
        status: "blocked",
        capabilityResolution: capResult,
        reason: `Missing capabilities: ${capResult.missingCapabilities.join(", ")}`,
      };
    }
    // Layer 2: Policy evaluation across all capabilities
    // Apply the most restrictive decision: deny > ask > allow
    let overall: { decision: "allow" | "ask" | "deny"; ruleId?: string; reason?: string; approvalId?: string } | undefined;

    if (input.policyGate && input.config) {
      for (const cap of caps) {
        const decision = await input.policyGate.evaluateCapability({
          requestId: `${node.graphId ?? "?"}:${node.id}:${cap}`,
          capability: cap,
          sessionMode: input.config.permissions.sessionMode ?? "ask",
          nodeId: node.id,
          graphId: node.graphId,
          source: "graph",
        });
        if (decision.decision === "deny") {
          overall = { decision: "deny", ruleId: decision.matchedRuleId, reason: decision.reason };
          break;
        }
        if (decision.decision === "ask" && (!overall || overall.decision === "allow")) {
          overall = { decision: "ask", ruleId: decision.matchedRuleId, reason: decision.reason, approvalId: decision.approvalId };
        }
        if (decision.decision === "allow" && !overall) {
          overall = { decision: "allow", ruleId: decision.matchedRuleId, reason: decision.reason };
        }
      }
    } else {
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
    }

    if (overall?.decision === "deny") {
      auditStore?.append({ action: "policy.denied", actor: "policy", details: {
        graphId: node.graphId, nodeId: node.id,
        capability: caps.join(","), policyRuleId: overall.ruleId,
        policyDecision: "deny", reason: overall.reason,
      }}).catch(() => {});
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
      // When PolicyGate already handled the approval lifecycle, use it directly
      if (overall.approvalId) {
        auditStore?.append({ action: "policy.asked", actor: "policy", details: {
          graphId: node.graphId, nodeId: node.id,
          capability: caps.join(","), approvalId: overall.approvalId,
          policyDecision: "ask", reason: overall.reason,
        }}).catch(() => {});
        return {
          status: "needs_approval",
          capabilityResolution: capResult,
          policyDecision: "ask",
          policyRuleId: overall.ruleId,
          policyReason: overall.reason,
          approvalId: overall.approvalId,
          reason: `Pending approval: ${overall.approvalId}`,
        };
      }

      if (!approvalStore) {
        auditStore?.append({ action: "runtime.blocked", actor: "system", details: {
          graphId: node.graphId, nodeId: node.id,
          capability: caps.join(","),
          reason: "Approval required but no approval store configured",
        }}).catch(() => {});
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
          auditStore?.append({ action: "policy.allowed", actor: "policy", details: {
            graphId: node.graphId, nodeId: node.id,
            capability: caps.join(","), approvalId: resolved.id,
            policyDecision: "allow", reason: "Approved by prior approval",
          }}).catch(() => {});
          return { status: "ready", reason: `Approved by prior approval: ${resolved.id}` };
        }
        auditStore?.append({ action: "policy.denied", actor: "policy", details: {
          graphId: node.graphId, nodeId: node.id,
          capability: caps.join(","), approvalId: resolved.id,
          policyDecision: "deny", reason: `Prior approval was denied: ${resolved.id}`,
        }}).catch(() => {});
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
        auditStore?.append({ action: "policy.asked", actor: "policy", details: {
          graphId: node.graphId, nodeId: node.id,
          capability: caps.join(","), approvalId: existing.id,
          policyDecision: "ask",
          reason: overall.reason,
        }}).catch(() => {});
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
      auditStore?.append({ action: "policy.asked", actor: "policy", details: {
        graphId: node.graphId, nodeId: node.id,
        capability: caps.join(","), approvalId: approval.id,
        policyDecision: "ask",
        reason: overall.reason,
      }}).catch(() => {});
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

  auditStore?.append({ action: "runtime.allowed", actor: "system", details: {
    graphId: node.graphId, nodeId: node.id,
    reason: "All gates passed",
  }}).catch(() => {});
  return { status: "ready", reason: "All gates passed" };
}
