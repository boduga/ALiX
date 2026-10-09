/**
 * runtime-gate.ts — Graph-node authorization adapter (R3.7).
 *
 * Graph nodes are the sequential `alix graph` path; this module keeps the
 * graph-specific lifecycle (capability coverage, approval reuse/creation,
 * headless carve-out) but routes every POLICY decision through the ONE
 * authorization boundary, `ExecutionAuthorization` — the same service tools
 * and coordination workers use. `GraphExecutor` is a sequential graph CLI
 * adapter, not a second scheduling authority (scheduling belongs to
 * `CoordinationScheduler`).
 */
import type { CardRegistry } from "../registry/card-registry.js";
import { resolveCapabilities, type CapabilityResolution } from "../registry/capability-resolver.js";
import type { TaskNode } from "../kernel/task-graph.js";
import type { ApprovalStore } from "../approvals/approval-store.js";
import type { AuditStore } from "../audit/audit-store.js";
import type { PolicyGate } from "./policy-gate.js";
import type { AlixConfig } from "../config/schema.js";
import { ExecutionAuthorization } from "../runtime/execution-authorization.js";

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
  policyGate: PolicyGate;
  approvalStore?: ApprovalStore;
  auditStore?: AuditStore;
  config: AlixConfig;
  /** Graph workspace root (required for the shared authorization boundary). */
  cwd?: string;
  /** Optional session identity passed to the authorization boundary. */
  sessionId?: string;
  /** Precomputed capability coverage (GraphExecutor computes it once). */
  capabilityResolution?: CapabilityResolution;
  /** Injected authorization boundary; defaults to one over `policyGate`. */
  authorization?: ExecutionAuthorization;
}

export async function evaluateRuntimeGate(input: RuntimeGateInput): Promise<RuntimeGateDecision> {
  const { node, registry, approvalStore, auditStore, policyGate, config } = input;
  const caps = node.requiredCapabilities ?? [];

  // Layer 1: Capability coverage check
  if (caps.length > 0) {
    const capResult = input.capabilityResolution ?? resolveCapabilities({
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
    // Layer 2: Policy evaluation across all capabilities, through the ONE
    // authorization boundary. Apply the most restrictive: deny > ask > allow.
    const authorization = input.authorization ?? new ExecutionAuthorization({ policyGate });
    let overall: { decision: "allow" | "ask" | "deny"; ruleId?: string; reason?: string; approvalId?: string } | undefined;

    for (const cap of caps) {
      const decision = await authorization.evaluate({
        requestId: `${node.graphId ?? "?"}:${node.id}:${cap}`,
        capability: cap,
        cwd: input.cwd ?? "",
        sessionMode: config.permissions.sessionMode ?? "ask",
        sessionId: input.sessionId ?? "",
        nodeId: node.id,
        graphId: node.graphId,
        source: "graph",
      });
      const ruleId = decision.policyRuleId;
      if (decision.status === "denied") {
        overall = { decision: "deny", ruleId, reason: decision.reason };
        break;
      }
      if (decision.status === "approval_required" && (!overall || overall.decision === "allow")) {
        // A real approval id only; the boundary substitutes "unknown" when the
        // policy layer did not create one, which must fall through to the
        // graph-specific reuse/create path below.
        overall = {
          decision: "ask",
          ruleId,
          reason: decision.reason,
          approvalId: decision.approvalId !== "unknown" ? decision.approvalId : undefined,
        };
      }
      if (decision.status === "allowed" && !overall) {
        overall = { decision: "allow", ruleId };
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
        // Headless mirror of the policy-gate carve-out: graph nodes needing
        // only headless-safe capabilities (read-only public web, plus the
        // zero-side-effect task.complete signal) stay runnable without a
        // store; anything else still fails closed.
        if (caps.length > 0 && caps.every((c) => c === "web.search" || c === "web.fetch" || c === "task.complete")) {
          auditStore?.append({ action: "policy.allowed", actor: "policy", details: {
            graphId: node.graphId, nodeId: node.id,
            capability: caps.join(","),
            policyDecision: "allow", reason: "Auto-allowed: read-only web capability with no approval store",
          }}).catch(() => {});
          return {
            status: "ready",
            capabilityResolution: capResult,
            policyDecision: "allow",
            policyRuleId: "headless-read-allow",
            policyReason: overall.reason,
            reason: "Auto-allowed: read-only web capability with no approval store",
          };
        }
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
