/**
 * replan-impact-analyzer.ts — Deterministic agent assignment & impact analysis.
 *
 * Derives agent assignments, risk, ownership impact, and policy decisions
 * from a PlanRevisionDraft. The model's hints are advisory — ALiX decides
 * everything:
 *  - riskLevel is derived from worker specs (model confidence ignored)
 *  - capabilityChanges are derived from diffing (model hints ignored)
 *  - ownershipChanges come from real OwnershipRegistry state
 *  - approvalMode is derived from worker specs (model hints ignored)
 *
 * All imports use .js extensions (NodeNext).
 */

import { matchCapabilities } from "./collaborative-planner.js";
import type { CapabilityRegistry } from "./collaborative-planner.js";
import type { PlanRevisionDraft, OwnershipImpact, PolicyDecision, ImpactAnalysis, SimulatedGraph } from "./replan-types.js";
import type { WorkerAssignment } from "./coordination-types.js";
import type { OwnershipRegistry } from "../ownership/ownership-registry.js";
import { PolicyEngine } from "../policy/policy-engine.js";
import type { ToolCallRequest } from "../policy/policy-engine.js";
import type { SessionMode } from "../config/schema.js";

// ─── Risk helpers ──────────────────────────────────────────────────────────

const RISK_ORDER: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const RISK_LEVELS: string[] = ["low", "medium", "high", "critical"];

/**
 * Rank a risk-level string (0–3).  Unknown/unset → medium (rank 1).
 */
function riskRank(level: string | undefined): number {
  if (level == null) return 1;
  return RISK_ORDER[level.toLowerCase()] ?? 1;
}

/**
 * Return the higher of two risk-level strings.
 */
function higherRisk(a: string, b: string): string {
  return RISK_LEVELS[Math.max(riskRank(a), riskRank(b))];
}

// ─── Agent assignment ──────────────────────────────────────────────────────

export interface AgentAssignment {
  /** The selected agent ID. */
  agentId: string;
  /** Capabilities the agent matched from the required list. */
  matched: string[];
  /** Capabilities the agent did NOT match. */
  unmatched: string[];
  /** Match score (0–1). */
  score: number;
}

// ─── Analyze result ────────────────────────────────────────────────────────

export interface AnalyzeResult {
  /** The full ImpactAnalysis ready for the proposal record. */
  impactAnalysis: ImpactAnalysis;
  /**
   * Agent assignments keyed by draftWorkerId (for new/replacement workers).
   * The caller uses this to set agentId on actual WorkerAssignments.
   */
  agentAssignments: Record<string, AgentAssignment>;
}

// ─── Options ───────────────────────────────────────────────────────────────

export interface ReplanImpactAnalyzerOptions {
  /** Maps agent IDs to their declared capabilities. */
  capabilityRegistry: CapabilityRegistry;
  /** Real ownership registry for lease conflict detection. */
  ownershipRegistry: OwnershipRegistry;
  /**
   * Optional explicit agent pool (defaults to the keys of capabilityRegistry).
   * Determines which agents are eligible for assignment.
   */
  agentPool?: string[];
  /**
   * Glob-style path patterns that are considered protected.
   * Any worker claiming ownership of a protected scope is flagged.
   */
  protectedScopes?: string[];
  /**
   * Optional PolicyEngine instance for real policy evaluation.
   * When provided, enables "deny" decisions for high-risk operations.
   * When omitted, uses simplified policy logic ("allow" / "ask" only).
   */
  policyEngine?: PolicyEngine;
}

// ─── Analyzer ──────────────────────────────────────────────────────────────

export class ReplanImpactAnalyzer {
  private agentPool: string[];
  private protectedScopes: string[];

  constructor(private options: ReplanImpactAnalyzerOptions) {
    this.agentPool = options.agentPool ?? Object.keys(options.capabilityRegistry);
    this.protectedScopes = options.protectedScopes ?? [
      ".git/**",
      "node_modules/**",
      ".alix/**",
    ];
  }

  /**
   * Run impact analysis on a PlanRevisionDraft.
   *
   * @param draft — The model-proposed draft (advisory).
   * @param existingWorkers — Current set of WorkerAssignments.
   * @param simulatedGraph — Output from ReplanSimulator.simulate().
   * @returns AnalyzeResult with ImpactAnalysis and agent assignments.
   */
  async analyze(
    draft: PlanRevisionDraft,
    existingWorkers: WorkerAssignment[],
    simulatedGraph: SimulatedGraph,
  ): Promise<AnalyzeResult> {
    const existingById = new Map(existingWorkers.map((w) => [w.id, w]));
    const replaceTargets = new Set(draft.workersToReplace.map((rs) => rs.targetWorkerId));
    const cancelSet = new Set(draft.workersToCancel);
    const modifySet = new Set(draft.workersToModify.map((m) => m.workerId));

    // ── 1. Assign agents to new/replacement workers ─────────────────────

    const agentAssignments: Record<string, AgentAssignment> = {};

    for (const w of draft.workersToAdd) {
      agentAssignments[w.draftWorkerId] = this.pickBestAgent(w.requiredCapabilities);
    }

    for (const rs of draft.workersToReplace) {
      agentAssignments[rs.replacement.draftWorkerId] = this.pickBestAgent(
        rs.replacement.requiredCapabilities,
      );
    }

    const uniqueAgentIds = new Set(
      Object.values(agentAssignments).map((a) => a.agentId),
    );

    // ── 2. Derive capability changes ────────────────────────────────────

    const capabilitiesAdded = new Set<string>();
    const capabilitiesRemoved = new Set<string>();

    // Additions: capabilities of new workers
    for (const w of draft.workersToAdd) {
      for (const cap of w.requiredCapabilities) {
        capabilitiesAdded.add(cap);
      }
    }

    // Replacements: diff old vs new capabilities
    for (const rs of draft.workersToReplace) {
      const existing = existingById.get(rs.targetWorkerId);
      const oldCaps = new Set(existing?.requiredCapabilities ?? []);
      const newCaps = new Set(rs.replacement.requiredCapabilities);

      for (const cap of newCaps) {
        if (!oldCaps.has(cap)) capabilitiesAdded.add(cap);
      }
      for (const cap of oldCaps) {
        if (!newCaps.has(cap)) capabilitiesRemoved.add(cap);
      }
    }

    // Removals: capabilities of cancelled workers
    for (const id of draft.workersToCancel) {
      const existing = existingById.get(id);
      if (existing) {
        for (const cap of existing.requiredCapabilities) {
          capabilitiesRemoved.add(cap);
        }
      }
    }

    // ── 3. Derive ownership impacts ─────────────────────────────────────

    const ownershipChanges: OwnershipImpact[] = [];

    for (const rs of draft.workersToReplace) {
      const existing = existingById.get(rs.targetWorkerId);
      if (!existing) continue;

      const newAgentId = agentAssignments[rs.replacement.draftWorkerId]?.agentId ?? "unknown";

      for (const scope of existing.ownershipScopes) {
        ownershipChanges.push({
          scope,
          currentOwner: existing.agentId,
          proposedOwner: newAgentId,
          severity: "medium",
        });
      }
      for (const claim of existing.ownershipClaims) {
        ownershipChanges.push({
          scope: claim.path,
          currentOwner: existing.agentId,
          proposedOwner: newAgentId,
          severity: "medium",
        });
      }
    }

    for (const id of draft.workersToCancel) {
      const existing = existingById.get(id);
      if (existing) {
        for (const scope of existing.ownershipScopes) {
          ownershipChanges.push({
            scope,
            currentOwner: existing.agentId,
            proposedOwner: "",
            severity: "high",
          });
        }
      }
    }

    // ── 4. Compute risk level (model confidence is ignored) ─────────────

    let riskLevel = "low";

    for (const w of draft.workersToAdd) {
      // New workers default to "medium"
      riskLevel = higherRisk(riskLevel, "medium");
    }

    for (const rs of draft.workersToReplace) {
      const existing = existingById.get(rs.targetWorkerId);
      const workerRisk = existing?.riskLevel ?? "medium";
      riskLevel = higherRisk(riskLevel, workerRisk);
    }

    for (const m of draft.workersToModify) {
      const existing = existingById.get(m.workerId);
      if (existing?.riskLevel) {
        riskLevel = higherRisk(riskLevel, existing.riskLevel);
      }
    }

    // Model confidence is NEVER allowed to lower risk.
    // Per the brief: "model confidence hints cannot lower system risk, only raise it."
    // But model confidence also cannot raise risk — only worker specs matter.
    // The brief says "Model confidence hints are ignored for risk — only the worker's
    // spec riskLevel matters."
    // So we do nothing with confidence here.

    // ── 5. Detect active lease conflicts via OwnershipRegistry ──────────

    const activeLeaseConflicts: string[] = [];
    // Dedup set: tracks already-reported scope/claim paths per agent pair
    const reportedConflicts = new Set<string>();

    try {
      // Check each proposed ownership scope against active leases
      for (const rs of draft.workersToReplace) {
        const existing = existingById.get(rs.targetWorkerId);
        if (!existing) continue;

        for (const scope of existing.ownershipScopes) {
          const conflicting = await this.options.ownershipRegistry.findConflictsByPattern(scope);
          for (const c of conflicting) {
            if (c.agentId !== existing.agentId) {
              const key = `scope:${scope}:${c.agentId}:${c.mode}`;
              if (!reportedConflicts.has(key)) {
                reportedConflicts.add(key);
                activeLeaseConflicts.push(
                  `Scope "${scope}" conflicts with lease held by "${c.agentId}" (${c.mode})`,
                );
              }
            }
          }
        }

        for (const claim of existing.ownershipClaims) {
          const conflicting = await this.options.ownershipRegistry.findConflictsByPattern(claim.path);
          for (const c of conflicting) {
            if (c.agentId !== existing.agentId) {
              const key = `claim:${claim.path}:${c.agentId}:${c.mode}`;
              if (!reportedConflicts.has(key)) {
                reportedConflicts.add(key);
                activeLeaseConflicts.push(
                  `Ownership claim "${claim.path}" conflicts with lease held by "${c.agentId}" (${c.mode})`,
                );
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn("OwnershipRegistry unavailable during lease conflict detection:", err);
      // Registry unavailable — skip lease conflict detection
    }

    // ── 6. Check protected scope violations ─────────────────────────────

    const protectedScopeViolations: string[] = [];

    for (const rs of draft.workersToReplace) {
      const existing = existingById.get(rs.targetWorkerId);
      if (!existing) continue;
      for (const scope of existing.ownershipScopes) {
        if (this.isProtectedScope(scope)) {
          protectedScopeViolations.push(
            `Scope "${scope}" is protected and cannot be transferred to replacement worker`,
          );
        }
      }
    }

    for (const id of draft.workersToCancel) {
      const existing = existingById.get(id);
      if (!existing) continue;
      for (const scope of existing.ownershipScopes) {
        if (this.isProtectedScope(scope)) {
          protectedScopeViolations.push(
            `Scope "${scope}" is protected and cannot be released by cancellation`,
          );
        }
      }
    }

    // ── 7. Evaluate policy decisions ────────────────────────────────────

    const policyDecisions: PolicyDecision[] = [];

    for (const w of draft.workersToAdd) {
      policyDecisions.push(
        this.evaluateWorkerPolicy(w.draftWorkerId, undefined, existingById),
      );
    }

    for (const rs of draft.workersToReplace) {
      policyDecisions.push(
        this.evaluateWorkerPolicy(
          rs.replacement.draftWorkerId,
          rs.targetWorkerId,
          existingById,
        ),
      );
    }

    for (const id of draft.workersToCancel) {
      const existing = existingById.get(id);
      policyDecisions.push({
        workerRef: id,
        decision: existing?.approvalMode === "manual" ? "ask" : "allow",
        reason: existing?.approvalMode === "manual"
          ? "Manual-approval worker being cancelled requires authorization"
          : "Worker cancellation is permitted",
      });
    }

    const requiresApproval = policyDecisions.some(
      (pd) => pd.decision === "ask" || pd.decision === "deny",
    );

    // ── 8. Build summary ────────────────────────────────────────────────

    const summary = this.buildSummary({
      riskLevel,
      agentsAssigned: uniqueAgentIds.size,
      totalNew: draft.workersToAdd.length,
      totalReplace: draft.workersToReplace.length,
      totalCancel: draft.workersToCancel.length,
      totalModify: draft.workersToModify.length,
      capabilitiesAdded: capabilitiesAdded.size,
      capabilitiesRemoved: capabilitiesRemoved.size,
      ownershipChangesCount: ownershipChanges.length,
      conflictCount: activeLeaseConflicts.length,
      protectedViolationCount: protectedScopeViolations.length,
      policyViolations: policyDecisions.filter((pd) => pd.decision !== "allow").length,
      requiresApproval,
    });

    return {
      impactAnalysis: {
        riskLevel,
        agentsAssigned: uniqueAgentIds.size,
        capabilitiesAdded: [...capabilitiesAdded],
        capabilitiesRemoved: [...capabilitiesRemoved],
        ownershipChanges,
        activeLeaseConflicts,
        protectedScopeViolations,
        policyDecisions,
        requiresApproval,
        summary,
      },
      agentAssignments,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────

  /**
   * Pick the best agent from the pool for the given required capabilities.
   * Uses matchCapabilities() for exact canonical ID matching.
   * Never returns an empty agentId — falls back to the first pool agent.
   */
  private pickBestAgent(requiredCapabilities: string[]): AgentAssignment {
    if (this.agentPool.length === 0) {
      // No pool means no eligible agents.  This is an error condition but
      // we never return agentId: "", so assign a sentinel.
      return { agentId: "__no_agent_available__", matched: [], unmatched: [...requiredCapabilities], score: 0 };
    }

    let best: AgentAssignment | null = null;

    for (const agentId of this.agentPool) {
      const agentCaps = this.options.capabilityRegistry[agentId] ?? [];
      const { matched, unmatched, score } = matchCapabilities(requiredCapabilities, agentCaps);

      if (!best || score > best.score || (score === best.score && matched.length > best.matched.length)) {
        best = { agentId, matched, unmatched, score };
      }
    }

    // Guard: best should always be non-null since pool is non-empty, but
    // TypeScript needs the fallback.
    return best ?? { agentId: "__no_agent_available__", matched: [], unmatched: [...requiredCapabilities], score: 0 };
  }

  /**
   * Evaluate policy for a single worker (new or replacement).
   *
   * When a PolicyEngine is available, delegates to evaluateWithPolicyEngine
   * for full policy evaluation including "deny" decisions.
   *
   * Fallback (no PolicyEngine):
   * - New workers without an explicit approvalMode default to "auto" (allow).
   * - Replacement workers inherit the existing approvalMode (or "auto").
   * - "manual" approvalMode → "ask" decision.
   * - No "deny" in fallback mode — always "allow" unless manual.
   */
  private evaluateWorkerPolicy(
    workerRef: string,
    targetWorkerId: string | undefined,
    existingById: Map<string, WorkerAssignment>,
  ): PolicyDecision {
    // When PolicyEngine is available, use it for full evaluation
    if (this.options.policyEngine) {
      return this.evaluateWithPolicyEngine(workerRef, targetWorkerId, existingById);
    }

    const existing = targetWorkerId ? existingById.get(targetWorkerId) : undefined;
    const approvalMode = existing?.approvalMode ?? "auto";

    if (approvalMode === "manual") {
      return {
        workerRef,
        decision: "ask",
        reason: `Worker requires manual approval (approvalMode: "${approvalMode}")`,
      };
    }

    return {
      workerRef,
      decision: "allow",
      reason: `Worker policy allows execution (approvalMode: "${approvalMode}")`,
    };
  }

  /**
   * Evaluate worker policy using the real PolicyEngine instance.
   *
   * Constructs a ToolRequest wrapping the "coordination.plan.revise" capability
   * and delegates to PolicyEngine.evaluatePolicy() for the actual decision.
   * This enables "deny" decisions for high-risk operations that the simplified
   * fallback logic cannot produce.
   *
   * NOTE: PolicyEngine.evaluatePolicy() is designed for tool-call-level
   * authorization (file read/write, shell commands, network fetches). Using
   * it at the worker level by injecting "coordination.plan.revise" as the
   * capability is a best-effort integration. The PolicyEngine checks
   * protected paths, capability registry approval requirements, and default
   * policy — but it does not natively understand worker-level concepts like
   * approvalMode or ownership scopes. Those remain handled by the caller.
   */
  private evaluateWithPolicyEngine(
    workerRef: string,
    targetWorkerId: string | undefined,
    existingById: Map<string, WorkerAssignment>,
  ): PolicyDecision {
    const engine = this.options.policyEngine!;
    const existing = targetWorkerId ? existingById.get(targetWorkerId) : undefined;

    // Build a ToolRequest that wraps the replan authorization as a capability check
    const request: ToolCallRequest = {
      toolCallId: `replan_${workerRef}`,
      toolName: "coordination.plan",
      args: {},
      capability: "coordination.plan.revise",
      sessionMode: "auto" as SessionMode,
    };

    const engineDecision = engine.check(request);

    // Map the engine's decision to our PolicyDecision shape
    const decision = engineDecision.decision;

    // If the engine says "deny", respect it.
    // If "ask", return ask (needs authorization).
    // If "allow", still check approvalMode for manual workers.
    if (decision === "deny") {
      return {
        workerRef,
        decision: "deny",
        reason: engineDecision.reason,
      };
    }

    if (decision === "ask") {
      return {
        workerRef,
        decision: "ask",
        reason: engineDecision.reason,
      };
    }

    // Engine allowed it — also check worker-level approvalMode
    const approvalMode = existing?.approvalMode ?? "auto";
    if (approvalMode === "manual") {
      return {
        workerRef,
        decision: "ask",
        reason: `Worker requires manual approval (approvalMode: "${approvalMode}")`,
      };
    }

    return {
      workerRef,
      decision: "allow",
      reason: `PolicyEngine allowed; worker policy permits execution (approvalMode: "${approvalMode}")`,
    };
  }

  /**
   * Check whether a path scope matches any protected pattern.
   */
  private isProtectedScope(scope: string): boolean {
    return this.protectedScopes.some((p) => {
      // Simple glob matching: treat ** as wildcard, * as single-segment wildcard
      const pattern = p
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, ".*")
        .replace(/\*/g, "[^/]*");
      return new RegExp(`^${pattern}$`).test(scope);
    });
  }

  /**
   * Build a human-readable summary string.
   */
  private buildSummary(info: {
    riskLevel: string;
    agentsAssigned: number;
    totalNew: number;
    totalReplace: number;
    totalCancel: number;
    totalModify: number;
    capabilitiesAdded: number;
    capabilitiesRemoved: number;
    ownershipChangesCount: number;
    conflictCount: number;
    protectedViolationCount: number;
    policyViolations: number;
    requiresApproval: boolean;
  }): string {
    const parts: string[] = [
      `Risk level: ${info.riskLevel}`,
      `Agents assigned: ${info.agentsAssigned}`,
      `Workers to add: ${info.totalNew}`,
      `Workers to replace: ${info.totalReplace}`,
      `Workers to cancel: ${info.totalCancel}`,
      `Workers to modify: ${info.totalModify}`,
    ];

    if (info.capabilitiesAdded > 0) {
      parts.push(`Capabilities added: ${info.capabilitiesAdded}`);
    }
    if (info.capabilitiesRemoved > 0) {
      parts.push(`Capabilities removed: ${info.capabilitiesRemoved}`);
    }
    if (info.ownershipChangesCount > 0) {
      parts.push(`Ownership changes: ${info.ownershipChangesCount}`);
    }
    if (info.conflictCount > 0) {
      parts.push(`Active lease conflicts: ${info.conflictCount}`);
    }
    if (info.protectedViolationCount > 0) {
      parts.push(`Protected scope violations: ${info.protectedViolationCount}`);
    }
    if (info.policyViolations > 0) {
      parts.push(`Policy violations: ${info.policyViolations}`);
    }
    if (info.requiresApproval) {
      parts.push("Requires approval: yes");
    }

    return parts.join("; ");
  }
}
