import type { SignalFrame, SignalDomain } from "../runtime/signal-frame.js";
import { decodeSignalCode } from "../runtime/signal-frame.js";
import type { OfferingPlan } from "../runtime/offering-planner.js";

/* ------------------------------------------------------------------ */
/*  Named scoring constants                                            */
/* ------------------------------------------------------------------ */

const MAX_REPORTED_VIOLATIONS = 4;
const COMPATIBILITY_THRESHOLD = 50;

const SCORE_DOMAIN_MATCH = 40;
const SCORE_AFFINITY_MATCH = 20;
const SCORE_AFFINITY_GENERAL = 10;
const SCORE_RISK_HIGH = 20;
const SCORE_RISK_MEDIUM = 10;
const SCORE_RISK_LOW_SAFE = 20;
const SCORE_RISK_MEDIUM_SAFE = 15;
const SCORE_RISK_HIGH_SAFE = 10;
const SCORE_OFFERING_NO_OFFERING = 10;
const SCORE_OFFERING_PROCESS_CLEAN = 20;
const SCORE_OFFERING_PROCESS_DIRTY = 5;
const SCORE_OFFERING_ASK_APPROVAL_LOW = 20;
const SCORE_OFFERING_ASK_APPROVAL_HIGH = 5;
const SCORE_OFFERING_PAUSE_NEXUS = 20;
const SCORE_OFFERING_FALLBACK = 10;
const PENALTY_PER_VIOLATION = 10;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type EssenceAffinity =
  | "research"
  | "coding"
  | "policy"
  | "memory"
  | "replay"
  | "rollback"
  | "general";

/**
 * Agent identity profile that encodes what an agent is, what it can do,
 * what its boundaries are, and how it prefers to operate.
 */
export type EssenceProfile = {
  agentId: string;
  role: "genesis" | "nexus" | "bridge" | "guild" | "caller";
  domains: SignalDomain[];
  capabilities: string[];
  constraints: string[];
  taboos: string[];
  affinity: EssenceAffinity;
  riskTolerance: "low" | "medium" | "high";
};

/**
 * Result of a compatibility check between an EssenceProfile and
 * a SignalFrame (optionally with an OfferingPlan).
 */
export type EssenceCompatibility = {
  compatible: boolean;
  score: number; // 0-100
  reasons: string[];
  violatedConstraints: string[];
  violatedTaboos: string[];
};

/* ------------------------------------------------------------------ */
/*  Affinity-to-domain mapping                                         */
/* ------------------------------------------------------------------ */

const AFFINITY_DOMAINS: Record<EssenceAffinity, SignalDomain[]> = {
  general: [],
  research: ["research", "memory", "chronicle"],
  coding: ["tool", "task", "policy"],
  policy: ["policy"],
  memory: ["memory", "chronicle"],
  replay: ["replay"],
  rollback: ["rollback"],
};

/**
 * Returns true when a profile's affinity naturally aligns with a signal
 * domain.  "general" always matches (weakly — the caller awards a lower
 * score for general affinity).
 */
function affinityMatchesDomain(
  affinity: EssenceAffinity,
  domain: SignalDomain,
): boolean {
  if (affinity === "general") return true;
  return AFFINITY_DOMAINS[affinity]?.includes(domain) ?? false;
}

/* ------------------------------------------------------------------ */
/*  Compatibility check                                                */
/* ------------------------------------------------------------------ */

/**
 * Evaluate an agent profile against a signal and optional offering.
 *
 * Scoring is advisory — it does NOT assign work or execute anything.
 */
export function checkEssenceCompatibility(
  profile: EssenceProfile,
  signal: SignalFrame,
  offering?: OfferingPlan,
): EssenceCompatibility {
  const reasons: string[] = [];
  const violatedConstraints: string[] = [];
  const violatedTaboos: string[] = [];

  let score = 0;

  /* ------------------------------------------------------------------ */
  /*  1. Domain match (max 40)                                          */
  /* ------------------------------------------------------------------ */

  if (profile.domains.includes(signal.domain)) {
    score += SCORE_DOMAIN_MATCH;
  } else {
    reasons.push("domain_mismatch");
  }

  /* ------------------------------------------------------------------ */
  /*  2. Affinity bonus (max 20)                                         */
  /* ------------------------------------------------------------------ */

  if (affinityMatchesDomain(profile.affinity, signal.domain)) {
    score +=
      profile.affinity === "general"
        ? SCORE_AFFINITY_GENERAL
        : SCORE_AFFINITY_MATCH;
  }

  /* ------------------------------------------------------------------ */
  /*  3. Risk tolerance (max 20)                                         */
  /* ------------------------------------------------------------------ */

  const bits = decodeSignalCode(signal.code);
  const hasDangerousBits =
    bits.policyRisk || bits.mutationPossible || bits.approvalRequired;

  if (hasDangerousBits) {
    if (profile.riskTolerance === "high") {
      score += SCORE_RISK_HIGH;
    } else if (profile.riskTolerance === "medium") {
      score += SCORE_RISK_MEDIUM;
    } else {
      reasons.push("risk_tolerance_exceeded");
    }
  } else {
    if (profile.riskTolerance === "low") {
      score += SCORE_RISK_LOW_SAFE;
    } else if (profile.riskTolerance === "medium") {
      score += SCORE_RISK_MEDIUM_SAFE;
    } else {
      score += SCORE_RISK_HIGH_SAFE;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  5. Constraint / taboo violations                                   */
  /*     (computed before step 4 because step 4 references violations)   */
  /* ------------------------------------------------------------------ */

  for (const constraint of profile.constraints) {
    if (!signal.constraints.includes(constraint)) {
      violatedConstraints.push(constraint);
    }
  }

  for (const taboo of profile.taboos) {
    if (signal.taboos.includes(taboo)) {
      violatedTaboos.push(taboo);
    }
  }

  const totalViolations =
    violatedConstraints.length + violatedTaboos.length;
  const violationDeduction =
    Math.min(totalViolations, MAX_REPORTED_VIOLATIONS) * PENALTY_PER_VIOLATION;

  /* ------------------------------------------------------------------ */
  /*  4. Offering alignment (max 20)                                     */
  /* ------------------------------------------------------------------ */

  if (offering) {
    if (offering.action === "proceed" && totalViolations === 0) {
      score += SCORE_OFFERING_PROCESS_CLEAN;
    } else if (offering.action === "proceed" && totalViolations > 0) {
      score += SCORE_OFFERING_PROCESS_DIRTY;
    } else if (
      offering.action === "ask_approval" &&
      profile.riskTolerance === "low"
    ) {
      score += SCORE_OFFERING_ASK_APPROVAL_LOW;
    } else if (
      offering.action === "ask_approval" &&
      profile.riskTolerance === "high"
    ) {
      score += SCORE_OFFERING_ASK_APPROVAL_HIGH;
    } else if (offering.action === "pause" && profile.role === "nexus") {
      score += SCORE_OFFERING_PAUSE_NEXUS;
    } else {
      score += SCORE_OFFERING_FALLBACK;
    }
  } else {
    score += SCORE_OFFERING_NO_OFFERING;
  }

  /* ------------------------------------------------------------------ */
  /*  Apply violation deductions and clamp                               */
  /* ------------------------------------------------------------------ */

  score -= violationDeduction;
  score = Math.max(0, Math.min(100, score));

  return {
    compatible: score >= COMPATIBILITY_THRESHOLD,
    score,
    reasons,
    violatedConstraints,
    violatedTaboos,
  };
}
