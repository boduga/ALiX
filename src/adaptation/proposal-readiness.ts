/**
 * P10.9.2a — Proposal State Machine & Readiness.
 *
 * Pure derivation layer: computes operational readiness from stored
 * proposal fields. Never persisted — derived on every read.
 *
 * @module
 */

import type {
  AdaptationProposal,
  ProposalAction,
  ProposalTarget,
} from "./adaptation-types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ProposalReadiness =
  | "needs_approval"
  | "needs_specification"
  | "ready_to_apply"
  | "manual_action"
  | "blocked"
  | "completed";

export type ApplySupportKind =
  | "registered_applier"
  | "manual_kind"
  | "unsupported";

export interface ApplySupport {
  supported: boolean;
  kind: ApplySupportKind;
  reason?: string;
  nextCommand?: string;
}

export interface ProposalReadinessInfo {
  /** The canonical stored status — always reflects what's on disk. */
  status: string;
  /** Derived operational readiness. What can the operator do next? */
  readiness: ProposalReadiness;
  /** Whether `alix adaptation apply` will succeed on this proposal. */
  applyable: boolean;
  /** Human-readable guidance for the operator's next step. */
  nextAction: string;
  /** Why the proposal is not applyable (when readiness !== ready_to_apply). */
  blocker?: string;
  /** Applier support classification, for routing decisions. */
  support: ApplySupport;
}

// ---------------------------------------------------------------------------
// Applier support classification
// ---------------------------------------------------------------------------

const REGISTERED_APPLIER_KINDS = new Set<string>([
  "agent_card", "skill", "revert", "governance",
]);
const MANUAL_KINDS = new Set<string>(["capability", "issue", "routing_weight"]);

/**
 * Pure classification of applier support for a proposal's target kind.
 * Maps to the same routing table as `selectApplier` in adaptation.ts,
 * but never throws — returns a structured result instead.
 */
export function getApplySupport(proposal: AdaptationProposal): ApplySupport {
  const kind = proposal.target.kind;

  if (REGISTERED_APPLIER_KINDS.has(kind)) {
    return { supported: true, kind: "registered_applier" };
  }

  if (MANUAL_KINDS.has(kind)) {
    return { supported: false, kind: "manual_kind" };
  }

  // Unsupported kinds
  if (kind === "executive_remediation") {
    return {
      supported: false,
      kind: "unsupported",
      reason: "requires human specification",
      nextCommand: `alix executive remediate ${proposal.id}`,
    };
  }

  if (kind === "learning") {
    return {
      supported: false,
      kind: "unsupported",
      reason: "learning proposal application deferred to P8.9/P9",
    };
  }

  // Fallback for unknown kinds
  return {
    supported: false,
    kind: "unsupported",
    reason: `unknown target kind: "${kind}"`,
  };
}

// ---------------------------------------------------------------------------
// Readiness derivation
// ---------------------------------------------------------------------------

function deriveReadiness(
  status: string,
  support: ApplySupport,
  proposal: AdaptationProposal,
): {
  readiness: ProposalReadiness;
  applyable: boolean;
  nextAction: string;
  blocker?: string;
} {
  // Terminal statuses
  if (status === "applied") {
    return {
      readiness: "completed",
      applyable: false,
      nextAction: `Assess effectiveness with: alix adaptation effectiveness ${proposal.id}`,
    };
  }
  if (status === "rejected") {
    return {
      readiness: "completed",
      applyable: false,
      nextAction: "No further action required.",
    };
  }
  if (status === "failed") {
    return {
      readiness: "completed",
      applyable: false,
      nextAction: `Inspect failure with: alix adaptation show ${proposal.id}`,
    };
  }

  // Pending: always needs approval first
  if (status === "pending") {
    return {
      readiness: "needs_approval",
      applyable: false,
      nextAction: `Run: alix adaptation approve ${proposal.id}`,
    };
  }

  // Approved — derive readiness from support + payload
  if (status === "approved") {
    // ready_to_apply: has a registered applier
    if (support.supported && support.kind === "registered_applier") {
      return {
        readiness: "ready_to_apply",
        applyable: true,
        nextAction: `Run: alix adaptation apply ${proposal.id}`,
      };
    }

    // needs_specification: unsupported but has specification hint
    if (
      !support.supported &&
      support.kind === "unsupported" &&
      proposal.payload?.requiresHumanSpecification === true
    ) {
      const cmd = support.nextCommand
        ? `Run: ${support.nextCommand}`
        : `Proposal ${proposal.id} requires human specification.`;
      return {
        readiness: "needs_specification",
        applyable: false,
        nextAction: cmd,
        blocker: support.reason ?? "requires human specification",
      };
    }

    // manual_action: intentional non-applyable workflow
    if (!support.supported && support.kind === "manual_kind") {
      return {
        readiness: "manual_action",
        applyable: false,
        nextAction: `This is a manual action. See: alix adaptation show ${proposal.id}`,
        blocker: "manual action — no automated applier",
      };
    }

    // blocked: unsupported with no specification path
    return {
      readiness: "blocked",
      applyable: false,
      nextAction: `Proposal ${proposal.id} is blocked: ${support.reason ?? "no applier available"}.`,
      blocker: support.reason ?? "no applier available",
    };
  }

  // Defensive: unknown status
  return {
    readiness: "blocked",
    applyable: false,
    nextAction: `Unknown proposal status: "${status}".`,
    blocker: `unknown status: "${status}"`,
  };
}

/**
 * Compute operational readiness for a proposal from its stored fields.
 *
 * Pure function — no I/O, no side effects. Derives readiness from:
 *   proposal.status + proposal.action + proposal.target.kind + proposal.payload
 */
export function computeProposalReadiness(
  proposal: AdaptationProposal,
): ProposalReadinessInfo {
  const support = getApplySupport(proposal);
  const { readiness, applyable, nextAction, blocker } = deriveReadiness(
    proposal.status,
    support,
    proposal,
  );

  return {
    status: proposal.status,
    readiness,
    applyable,
    nextAction,
    blocker,
    support,
  };
}

// ---------------------------------------------------------------------------
// Convenience: filter bridge-relevant proposals
// ---------------------------------------------------------------------------

/**
 * Check whether a proposal is executive-bridge-relevant for `bridge status`.
 * Matches if sourceRecommendationType is executive_remediation or
 * payload.source is executive_bridge.
 */
export function isExecutiveBridgeProposal(proposal: AdaptationProposal): boolean {
  return (
    proposal.sourceRecommendationType === "executive_remediation" ||
    (proposal.payload as Record<string, unknown>)?.source === "executive_bridge"
  );
}
