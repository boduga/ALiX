/**
 * collaborative-planner.ts — Capability matching, shared types, and
 * CollaborativePlanner for collaborative multi-agent planning.
 *
 * Provides:
 * - `normalizeCapability` — normalizes capability strings through a controlled
 *   alias registry to exact canonical IDs.
 * - `matchCapabilities` — matches required capabilities against agent
 *   capabilities using exact canonical ID equality (never substring matching).
 * - `CapabilityRegistry` — an interface mapping agent IDs to their capability
 *   lists.
 * - `CollaborativePlanner` — wraps CoordinationPlanner with capability-based
 *   agent assignment and planning round construction.
 */

import { randomUUID } from "node:crypto";
import type { CoordinationPlanner } from "./coordination-planner.js";
import type { CoordinationStore } from "./coordination-store.js";
import type { CoordinationRun, PlanningRound, PlanningProposal, PlanningBid } from "./coordination-types.js";

// ─── Capability alias registry ─────────────────────────────────────────

/**
 * Controlled alias registry.
 * Maps common aliases to their canonical capability IDs.
 * All comparisons use exact canonical ID equality.
 */
const CAPABILITY_ALIASES: Record<string, string> = {
  "read": "filesystem.read",
  "write": "filesystem.write",
  "filesystem_read": "filesystem.read",
  "filesystem_write": "filesystem.write",
  "filesystem.read": "filesystem.read",
  "filesystem.write": "filesystem.write",
};

/**
 * Normalize a capability string to its canonical form.
 *
 * 1. Lowercases and trims.
 * 2. Strips non-alphanumeric characters except `.` and `_`.
 * 3. Looks up in the alias registry.
 * 4. Returns the canonical ID if found, otherwise the normalized string.
 */
export function normalizeCapability(cap: string): string {
  const key = cap.trim().toLowerCase().replace(/[^a-z0-9._]/g, "");
  return CAPABILITY_ALIASES[key] ?? key;
}

// ─── Capability matching ───────────────────────────────────────────────

/**
 * Match required capabilities against an agent's declared capabilities
 * using exact canonical ID matching.
 *
 * - Each required capability is normalized through the alias registry and
 *   compared against the normalized set of agent capabilities.
 * - Only exact canonical ID equality is used — never substring matching.
 * - Score = matched.length / required.length (0 if required is empty).
 *
 * @param required - Capabilities required for a task.
 * @param agentCapabilities - Capabilities the agent declares.
 * @returns An object with `matched` array, `unmatched` array, and `score`.
 */
export function matchCapabilities(
  required: string[],
  agentCapabilities: string[],
): { matched: string[]; unmatched: string[]; score: number } {
  const agentNormalized = new Set(agentCapabilities.map(normalizeCapability));
  const matched = required.filter((r) => agentNormalized.has(normalizeCapability(r)));
  const unmatched = required.filter((r) => !agentNormalized.has(normalizeCapability(r)));
  const score = required.length === 0 ? 0 : matched.length / required.length;
  return { matched, unmatched, score };
}

// ─── Types ─────────────────────────────────────────────────────────────

/**
 * Maps agent IDs to their lists of declared capabilities.
 */
export interface CapabilityRegistry {
  [agentId: string]: string[];
}

// ─── Collaborative Planner Options and Result ───────────────────────────

/**
 * Options for configuring the CollaborativePlanner.
 */
export interface CollaborativePlannerOptions {
  /** Pool of available agent IDs for assignment. */
  agentPool: string[];
  /** Maps agent IDs to their declared capabilities (for bidding). */
  agentCapabilities?: CapabilityRegistry;
  /** Whether to enable capability-based bidding. Defaults to true. */
  enableBidding?: boolean;
}

/**
 * Result of a collaborative planning operation.
 */
export interface CollaborativePlanResult {
  /** The coordination run (null if planning failed). */
  run: CoordinationRun | null;
  /** Planning rounds produced during planning. */
  planningRounds: PlanningRound[];
  /** Whether the plan is valid and ready for execution. */
  valid: boolean;
  /** Error messages if planning failed. */
  errors: string[];
}

// ─── Collaborative Planner ─────────────────────────────────────────────

/**
 * CollaborativePlanner wraps CoordinationPlanner with capability-based
 * agent assignment and planning round construction.
 *
 * Responsibilities:
 * - Delegates goal decomposition to the base CoordinationPlanner.
 * - Builds PlanningRound proposals from worker assignments.
 * - Collects capability-based bids from the agent pool.
 * - Assigns agents to proposals based on best matching bid.
 * - Attaches planning rounds to the coordination run (no persistence).
 */
export class CollaborativePlanner {
  constructor(
    private basePlanner: CoordinationPlanner,
    private store: CoordinationStore,
    private options: CollaborativePlannerOptions,
  ) {}

  /**
   * Produce a collaborative plan by decomposing the goal via the base planner
   * and matching agents to tasks based on capabilities.
   *
   * @param goal - The high-level goal to plan.
   * @param coordinatorAgentId - The ID of the coordinating agent.
   * @param sessionId - The session context.
   * @returns A CollaborativePlanResult with the run and planning rounds.
   */
  async plan(
    goal: string,
    coordinatorAgentId: string,
    sessionId: string,
  ): Promise<CollaborativePlanResult> {
    // 1. Delegate to base planner for initial TaskGraph decomposition
    const base = await this.basePlanner.plan(goal, coordinatorAgentId, sessionId);
    if (!base.valid || !base.run) {
      return { run: null, planningRounds: [], valid: false, errors: base.errors };
    }

    const run = base.run;
    run.planRevision = 0;

    // 2. Build planning round proposals from draft workers
    const round = this.buildRound(run);

    // 3. Collect capability-based bids if enabled and agent pool is available
    const enableBidding = this.options.enableBidding ?? true;
    if (enableBidding && this.options.agentPool.length > 0) {
      this.collectBids(round);
    }

    // 4. Assign agents to proposals
    const assignments = this.assignAgents(round, coordinatorAgentId);

    // 5. Write assigned agent IDs back to the workers
    for (const [proposalId, agentId] of assignments) {
      const worker = run.workers.find((w) => `proposal_${w.id}` === proposalId);
      if (worker) worker.agentId = agentId;
    }

    // 6. Attach planning round to the run (no persistence — caller's responsibility)
    run.planningRounds = [round];

    return { run, planningRounds: [round], valid: true, errors: [] };
  }

  /**
   * Build a PlanningRound with proposals from the run's worker assignments.
   */
  private buildRound(run: CoordinationRun): PlanningRound {
    const proposals: PlanningProposal[] = run.workers.map((w) => ({
      id: `proposal_${w.id}`,
      taskLabel: w.taskLabel,
      goalPrompt: w.goalPrompt,
      requiredCapabilities: w.requiredCapabilities,
      ownershipClaims: w.ownershipClaims,
      dependencies: w.dependencies,
      riskLevel: w.riskLevel,
      approvalMode: w.approvalMode,
    }));

    const now = new Date().toISOString();
    return {
      id: `round_${randomUUID()}`,
      coordinationRunId: run.id,
      roundNumber: 0,
      status: "draft",
      proposals,
      bids: [],
      acceptances: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Collect capability-based bids from the agent pool for each proposal.
   * For each proposal/agent pair, computes a matchCapabilities score.
   */
  private collectBids(round: PlanningRound): void {
    const caps = this.options.agentCapabilities;
    for (const proposal of round.proposals) {
      for (const agentId of this.options.agentPool) {
        const agentCaps = caps?.[agentId] ?? [];
        const { matched, unmatched, score } = matchCapabilities(
          proposal.requiredCapabilities,
          agentCaps,
        );
        round.bids.push({
          id: `bid_${randomUUID()}`,
          proposalId: proposal.id,
          agentId,
          matchedCapabilities: matched,
          unmatchedCapabilities: unmatched,
          confidence: score,
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  /**
   * Assign agents to proposals based on best bid or round-robin fallback.
   *
   * - If bids exist for a proposal, picks the bid with the highest confidence
   *   score, then the most matched capabilities as a tiebreaker.
   * - If no bids exist (or bidding is disabled), assigns agents round-robin
   *   from the pool. Falls back to the coordinator if the pool is empty.
   *
   * @returns A Map of proposal ID to assigned agent ID.
   */
  private assignAgents(
    round: PlanningRound,
    fallbackAgent: string,
  ): Map<string, string> {
    const assignments = new Map<string, string>();
    const pool = this.options.agentPool.length > 0
      ? this.options.agentPool
      : [fallbackAgent];

    for (let i = 0; i < round.proposals.length; i++) {
      const proposal = round.proposals[i];
      const proposalBids = round.bids.filter(
        (b) => b.proposalId === proposal.id,
      );

      if (proposalBids.length === 0) {
        // Round-robin fallback (also the path when bidding is disabled)
        assignments.set(proposal.id, pool[i % pool.length]);
      } else {
        // Pick the best bid: highest confidence, then most matched caps as tiebreaker
        const best = proposalBids.reduce((a, b) => {
          if (b.confidence !== a.confidence) {
            return b.confidence > a.confidence ? b : a;
          }
          return b.matchedCapabilities.length > a.matchedCapabilities.length
            ? b
            : a;
        });
        assignments.set(proposal.id, best.agentId);
      }
    }

    return assignments;
  }
}
