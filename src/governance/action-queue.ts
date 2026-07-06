/**
 * P14.4 — Action Queue.
 *
 * Append-only action proposals derived from P14.3 escalate / convert_to_issue
 * decisions. Status changes are append-only transition records — the original
 * proposal is never mutated.
 *
 * P14.4 depends on P14.1 (GovernanceSignal), P14.2 (OperatorReview), and
 * P14.3 (OperatorDecision, DecisionStore).
 *
 * Core invariants:
 * - Only escalate → escalation_review and convert_to_issue → github_issue
 * - Every proposal backlinks to its decision and through it to its signal
 * - Proposals are append-only; status transitions are separate append-only records
 * - refreshProposals deduplicates across ALL existing proposals (not just pending)
 * - No execution, no GitHub issue creation, no signal/decision mutation
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { readFile, appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type ActionProposalKind =
  | "escalation_review"
  | "github_issue";

export type ActionProposalStatus =
  | "pending"
  | "marked_executed_elsewhere"
  | "dismissed";

export const VALID_PROPOSAL_KINDS: ActionProposalKind[] = [
  "escalation_review",
  "github_issue",
];

export const VALID_PROPOSAL_STATUSES: ActionProposalStatus[] = [
  "pending",
  "marked_executed_elsewhere",
  "dismissed",
];

const ELIGIBLE_DECISION_KINDS = ["escalate", "convert_to_issue"] as const;

export interface GovernanceActionProposal {
  proposalId: string;
  /** Must reference an existing decision in the decision store. */
  decisionId: string;
  /** Preserved from the originating decision's signal backlink. */
  signalId: string;
  kind: ActionProposalKind;
  /** Human-readable title derived from the signal/decision. */
  title: string;
  /** Longer description explaining what action is needed. */
  description: string;
  /** Why this action proposal exists — sourced from the decision rationale. */
  rationale: string;
  /** Literal "pending" — terminal statuses are transition records only. */
  status: "pending";
  /**
   * Populated manually via mark-executed --ref in P14.4.
   * Remains null for pending proposals.
   */
  executionRef: string | null;
  createdAt: string;
}

export interface ActionProposalStatusTransition {
  transitionId: string;
  /** Must reference an existing proposal. */
  proposalId: string;
  /** The new status (never "pending"); the terminal states. */
  status: "marked_executed_elsewhere" | "dismissed";
  /** Human reason (required for dismissed, optional for marked_executed_elsewhere). */
  reason: string | null;
  /** Execution reference (required for marked_executed_elsewhere, null for dismissed). */
  executionRef: string | null;
  createdAt: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a GovernanceActionProposal structure.
 */
export function validateActionProposal(entry: unknown): ValidationResult {
  const errors: string[] = [];

  if (!entry || typeof entry !== "object") {
    return { valid: false, errors: ["Proposal must be an object"] };
  }

  const p = entry as Record<string, unknown>;

  if (!isNonEmptyString(p.proposalId)) errors.push("proposalId is required");
  if (!isNonEmptyString(p.decisionId)) errors.push("decisionId is required");
  if (!isNonEmptyString(p.signalId)) errors.push("signalId is required");
  if (!(VALID_PROPOSAL_KINDS as readonly string[]).includes(p.kind as string)) {
    errors.push(`kind must be one of: ${VALID_PROPOSAL_KINDS.join(", ")}`);
  }
  if (!isNonEmptyString(p.title)) errors.push("title is required and must be non-empty");
  if (!isNonEmptyString(p.description)) errors.push("description is required and must be non-empty");
  if (!isNonEmptyString(p.rationale)) errors.push("rationale is required and must be non-empty");
  if (p.status !== "pending") {
    errors.push("status must be \"pending\" — terminal statuses are transition records");
  }
  if (p.executionRef !== null && !isNonEmptyString(p.executionRef)) {
    errors.push("executionRef must be null or non-empty string");
  }
  if (!isNonEmptyString(p.createdAt)) errors.push("createdAt is required");

  return { valid: errors.length === 0, errors };
}

/**
 * Validate an ActionProposalStatusTransition structure.
 *
 * Cross-field rules:
 * - reason is required (non-empty) for dismissed
 * - executionRef is required (non-empty) for marked_executed_elsewhere
 * - executionRef must be null for dismissed
 */
export function validateActionProposalStatusTransition(entry: unknown): ValidationResult {
  const errors: string[] = [];

  if (!entry || typeof entry !== "object") {
    return { valid: false, errors: ["Status transition must be an object"] };
  }

  const t = entry as Record<string, unknown>;

  if (!isNonEmptyString(t.transitionId)) errors.push("transitionId is required");
  if (!isNonEmptyString(t.proposalId)) errors.push("proposalId is required");

  if (t.status === "marked_executed_elsewhere") {
    if (!isNonEmptyString(t.executionRef)) {
      errors.push("executionRef is required for marked_executed_elsewhere");
    }
    // reason is optional for marked_executed_elsewhere — no error if null
  } else if (t.status === "dismissed") {
    if (!isNonEmptyString(t.reason)) {
      errors.push("reason is required for dismissed");
    }
    if (t.executionRef !== null) {
      errors.push("executionRef must be null for dismissed");
    }
  } else {
    errors.push("status must be \"marked_executed_elsewhere\" or \"dismissed\"");
  }

  if (!isNonEmptyString(t.createdAt)) errors.push("createdAt is required");

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface ActionQueueStore {
  append(proposal: GovernanceActionProposal): Promise<void>;
  list(limit?: number): Promise<GovernanceActionProposal[]>;
  getById(proposalId: string): Promise<GovernanceActionProposal | null>;
  getByDecisionId(decisionId: string): Promise<GovernanceActionProposal[]>;
  /** Append-only status transition — never mutates the original proposal. */
  appendStatusTransition(transition: ActionProposalStatusTransition): Promise<void>;
  /** Returns all transitions for a proposal, newest-first. */
  getTransitions(proposalId: string): Promise<ActionProposalStatusTransition[]>;
}

// ---------------------------------------------------------------------------
// File-backed store
// ---------------------------------------------------------------------------

const PROPOSAL_FILE = "governance-action-queue.jsonl";
const TRANSITION_FILE = "governance-action-queue-transitions.jsonl";

export class FileActionQueueStore implements ActionQueueStore {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private get proposalPath(): string {
    return join(this.dir, PROPOSAL_FILE);
  }

  private get transitionPath(): string {
    return join(this.dir, TRANSITION_FILE);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  private async readProposals(): Promise<GovernanceActionProposal[]> {
    let content: string;
    try {
      content = await readFile(this.proposalPath, "utf8");
    } catch {
      return [];
    }
    const lines = content.trim().split("\n").filter(Boolean);
    const proposals: GovernanceActionProposal[] = [];
    for (const line of lines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const validation = validateActionProposal(parsed);
      if (!validation.valid) {
        continue;
      }
      proposals.push(parsed as GovernanceActionProposal);
    }
    return proposals.reverse();
  }

  private async readTransitions(): Promise<ActionProposalStatusTransition[]> {
    let content: string;
    try {
      content = await readFile(this.transitionPath, "utf8");
    } catch {
      return [];
    }
    const lines = content.trim().split("\n").filter(Boolean);
    const transitions: ActionProposalStatusTransition[] = [];
    for (const line of lines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const validation = validateActionProposalStatusTransition(parsed);
      if (!validation.valid) {
        continue;
      }
      transitions.push(parsed as ActionProposalStatusTransition);
    }
    return transitions.reverse();
  }

  async append(proposal: GovernanceActionProposal): Promise<void> {
    const validation = validateActionProposal(proposal);
    if (!validation.valid) {
      throw new Error(`Invalid action proposal: ${validation.errors.join("; ")}`);
    }
    await this.ensureDir();
    await appendFile(this.proposalPath, JSON.stringify(proposal) + "\n", "utf8");
  }

  async list(limit?: number): Promise<GovernanceActionProposal[]> {
    const proposals = await this.readProposals();
    return limit !== undefined && limit >= 0 ? proposals.slice(0, limit) : proposals;
  }

  async getById(proposalId: string): Promise<GovernanceActionProposal | null> {
    const proposals = await this.readProposals();
    return proposals.find((p) => p.proposalId === proposalId) ?? null;
  }

  async getByDecisionId(decisionId: string): Promise<GovernanceActionProposal[]> {
    const proposals = await this.readProposals();
    return proposals.filter((p) => p.decisionId === decisionId);
  }

  async appendStatusTransition(transition: ActionProposalStatusTransition): Promise<void> {
    const validation = validateActionProposalStatusTransition(transition);
    if (!validation.valid) {
      throw new Error(`Invalid status transition: ${validation.errors.join("; ")}`);
    }
    // Verify the referenced proposal exists
    const proposal = await this.getById(transition.proposalId);
    if (!proposal) {
      throw new Error(`Proposal not found: ${transition.proposalId}. Cannot add transition for missing proposal.`);
    }
    await this.ensureDir();
    await appendFile(this.transitionPath, JSON.stringify(transition) + "\n", "utf8");
  }

  async getTransitions(proposalId: string): Promise<ActionProposalStatusTransition[]> {
    const all = await this.readTransitions();
    return all.filter((t) => t.proposalId === proposalId);
  }
}

// ---------------------------------------------------------------------------
// Effective status derivation
// ---------------------------------------------------------------------------

/**
 * Derive the effective status of a proposal by combining its literal "pending"
 * status with its newest terminal transition (if any).
 *
 * If the newest transition sets a status, that status is the effective status.
 * Otherwise (no transitions), the effective status is "pending".
 */
export function deriveEffectiveStatus(
  proposal: GovernanceActionProposal,
  transitions: ActionProposalStatusTransition[],
): ActionProposalStatus {
  if (transitions.length === 0) return "pending";
  // transitions are already newest-first from readTransitions
  return transitions[0]!.status;
}

// ---------------------------------------------------------------------------
// Proposal creation
// ---------------------------------------------------------------------------

const KIND_MAP: Record<string, ActionProposalKind> = {
  escalate: "escalation_review",
  convert_to_issue: "github_issue",
};

/**
 * Create a GovernanceActionProposal from an existing OperatorDecision.
 *
 * @param proposalId - Unique proposal identifier.
 * @param decision - The originating OperatorDecision (must be escalate or convert_to_issue).
 * @param signal - The signal referenced by the decision (for derived title/description).
 * @param now - ISO timestamp for proposal creation.
 * @returns The created GovernanceActionProposal.
 * @throws If decision kind is not eligible for action proposal derivation.
 */
export async function createActionProposal(
  proposalId: string,
  decision: { decisionId: string; signalId: string; decision: string; rationale: string },
  signal: { signalId: string; title: string; description?: string; severity?: string },
  now: string,
): Promise<GovernanceActionProposal> {
  const kind = KIND_MAP[decision.decision];
  if (!kind) {
    throw new Error(
      `Decision kind "${decision.decision}" is not eligible for action proposals. ` +
      `Only escalate and convert_to_issue produce proposals.`,
    );
  }

  const proposal: GovernanceActionProposal = {
    proposalId,
    decisionId: decision.decisionId,
    signalId: decision.signalId,
    kind,
    title: signal.title,
    description: signal.description ?? `Action derived from decision ${decision.decisionId} on signal ${signal.signalId}`,
    rationale: decision.rationale,
    status: "pending",
    executionRef: null,
    createdAt: now,
  };

  // validateActionProposal is a pure check — delegate enforcement to the store's append gate
  return proposal;
}

// ---------------------------------------------------------------------------
// Refresh (decision → proposal derivation)
// ---------------------------------------------------------------------------

/**
 * Scan the decision store for eligible decisions (escalate, convert_to_issue)
 * that do not yet have an existing proposal (across all statuses), and create
 * new proposals for them.
 *
 * Deduplication checks decisionId + kind across ALL existing proposals, not
 * just pending ones. This prevents dismissed or executed proposals from being
 * recreated on subsequent refresh runs.
 *
 * @param decisionStore - The P14.3 DecisionStore to scan.
 * @param actionQueueStore - This P14.4 ActionQueueStore for dedup and append.
 * @param signalStore - The P14.1 signal store for fetching signal details.
 * @param now - ISO timestamp to stamp on new proposals.
 * @returns The list of newly created proposals.
 */
export async function refreshProposals(
  decisionStore: {
    list(limit?: number): Promise<{ decisionId: string; signalId: string; decision: string; rationale: string }[]>;
  },
  actionQueueStore: ActionQueueStore,
  signalStore: {
    getById(id: string): Promise<{ signalId: string; title: string; description?: string; severity?: string } | null>;
  },
  now: string,
): Promise<GovernanceActionProposal[]> {
  const allDecisions = await decisionStore.list();
  const eligible = allDecisions.filter((d) => ELIGIBLE_DECISION_KINDS.includes(d.decision as typeof ELIGIBLE_DECISION_KINDS[number]));

  if (eligible.length === 0) return [];

  // Build a set of existing (decisionId, kind) tuples across ALL proposals (all statuses)
  const allProposals = await actionQueueStore.list();
  const existingKeys = new Set<string>();
  for (const p of allProposals) {
    existingKeys.add(`${p.decisionId}::${p.kind}`);
  }

  const created: GovernanceActionProposal[] = [];

  for (const decision of eligible) {
    const kind = KIND_MAP[decision.decision];
    if (!kind) continue; // Shouldn't happen given the filter above, but defensive

    const key = `${decision.decisionId}::${kind}`;
    if (existingKeys.has(key)) continue; // Dedup: proposal already exists for this decision+kind

    // Fetch the signal for derived metadata — skip if signal is missing
    // (the signal store may have been cleaned up, or the signal never existed)
    const signal = await signalStore.getById(decision.signalId);
    if (!signal) continue;

    const proposalId = `prop-${now.replace(/[:.]/g, "-")}-${decision.decisionId.slice(0, 8)}-${Math.random().toString(36).slice(2, 6)}`;

    const proposal = await createActionProposal(
      proposalId,
      decision,
      signal,
      now,
    );

    await actionQueueStore.append(proposal);
    created.push(proposal);
    existingKeys.add(key); // Prevent duplicate in same refresh run
  }

  return created;
}
