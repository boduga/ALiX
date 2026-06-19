import type {
  AdaptationProposal,
  ProposalAction,
  ProposalTarget,
} from "./adaptation-types.js";
import type { Recommendation, RecommendationType } from "../reflection/reflection-types.js";

/**
 * Mapping from P5.0 Recommendation.type to P5.1 ProposalAction.
 *
 * 1:1 mapping: every supported RecommendationType has a designated ProposalAction.
 * Unknown types produce `null` so callers can skip or log them.
 */
const ACTION_MAP: Record<RecommendationType, ProposalAction> = {
  capability_gap: "create_agent_card",
  routing_adjustment: "suggest_routing_weight",
  skill_revision: "adjust_skill_definition",
  agent_card_update: "update_agent_card",
  process_change: "create_improvement_issue",
};

/**
 * Per-day monotonic counter for proposal ids.
 * Resets whenever the date (UTC) changes.
 */
let lastDate = "";
let counter = 0;

function nextProposalId(): string {
  const date = new Date().toISOString().slice(0, 10);
  if (date !== lastDate) {
    lastDate = date;
    counter = 0;
  }
  counter += 1;
  const nnn = String(counter).padStart(3, "0");
  return `prop-${date}-${nnn}`;
}

/**
 * Derive the ProposalTarget for a recommendation.
 * The target is intentionally lightweight — full id resolution happens
 * during proposal application, not conversion.
 */
function deriveTarget(rec: Recommendation): ProposalTarget {
  switch (rec.type) {
    case "capability_gap":
      return { kind: "agent_card", id: extractCapabilityName(rec) };
    case "agent_card_update":
      return { kind: "agent_card", id: extractCapabilityName(rec) };
    case "skill_revision":
      return { kind: "skill", id: extractCapabilityName(rec) };
    case "routing_adjustment":
      return { kind: "routing_weight", capability: extractCapabilityName(rec) };
    case "process_change":
      return { kind: "issue", title: rec.title };
  }
}

/**
 * Derive the change payload from the recommendation.
 * Includes the raw fields so appliers can inspect them later.
 */
function derivePayload(rec: Recommendation): Record<string, unknown> {
  return {
    title: rec.title,
    recommendedAction: rec.recommendedAction,
    evidence: rec.evidence,
  };
}

/**
 * Extract a coarse capability / entity name from the recommendation text.
 * Used as a placeholder id for agent_card / skill / routing_weight targets
 * before application enriches them.
 */
function extractCapabilityName(rec: Recommendation): string {
  // Prefer the recommended action verb's object, fall back to title slug.
  const fromAction = rec.recommendedAction.match(/(?:for|of|to)\s+([A-Za-z0-9_-]+)/);
  if (fromAction) return fromAction[1];
  return rec.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function buildReason(rec: Recommendation): string {
  return `${rec.title} — ${rec.recommendedAction}`;
}

/**
 * P5.1c — RecommendationToProposal
 *
 * Converts a P5.0 Recommendation into a pending P5.1 AdaptationProposal.
 * Unknown recommendation types return `null` so callers can skip them.
 */
export class RecommendationToProposal {
  static convert(rec: Recommendation): AdaptationProposal | null {
    const action = ACTION_MAP[rec.type];
    if (!action) return null;

    const now = new Date().toISOString();

    return {
      id: nextProposalId(),
      createdAt: now,
      status: "pending",
      action,
      target: deriveTarget(rec),
      payload: derivePayload(rec),
      sourceRecommendationType: rec.type,
      sourceConfidence: rec.confidence,
      evidenceFingerprints: [...rec.evidence],
      reason: buildReason(rec),
    };
  }
}
