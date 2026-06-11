import { randomUUID } from "node:crypto";
import type { SignalFrame } from "./signal-frame.js";
import { decodeSignalCode } from "./signal-frame.js";
import type { OfferingPlan } from "./offering-planner.js";
import type { EssenceCompatibility } from "../agents/essence-profile.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/**
 * Transport envelope that wraps SignalFrame, OfferingPlan, optional
 * EssenceCompatibility, and Chronicle refs into a single carry-context
 * for the ALiX runtime.
 *
 * This is a passive integration — it wraps data, it does NOT execute
 * tools, change policy, or alter routing.
 */
export type BridgeEnvelope = {
  envelopeId: string;
  signal: SignalFrame;
  offering: OfferingPlan;
  essence?: EssenceCompatibility;
  chronicleRefs: string[];

  routeHint?: {
    targetRole?: "genesis" | "nexus" | "bridge" | "guild" | "caller";
    targetAgentId?: string;
    reason?: string;
  };

  safety: {
    requiresPolicyGate: boolean;
    requiresApproval: boolean;
    mutationPossible: boolean;
    taboos: string[];
  };

  createdAt: string;
};

/* ------------------------------------------------------------------ */
/*  Known taboo-like constraint values                                 */
/* ------------------------------------------------------------------ */

const TABOO_LIKE_CONSTRAINTS = new Set([
  "no_side_effects_without_approval",
  "no_mutation",
]);

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Build the deduplicated `safety.taboos` array.
 *
 * Order: signal taboos first, then offering taboos, then matching
 * offering constraints.  Duplicates are removed keeping the first
 * occurrence (insertion-order preservation).
 */
function computeSafetyTaboos(
  signal: SignalFrame,
  offering: OfferingPlan,
): string[] {
  const seen = new Set<string>();
  const taboos: string[] = [];

  for (const t of signal.taboos) {
    if (!seen.has(t)) {
      seen.add(t);
      taboos.push(t);
    }
  }

  for (const t of offering.taboos) {
    if (!seen.has(t)) {
      seen.add(t);
      taboos.push(t);
    }
  }

  for (const c of offering.constraints) {
    if (TABOO_LIKE_CONSTRAINTS.has(c) && !seen.has(c)) {
      seen.add(c);
      taboos.push(c);
    }
  }

  return taboos;
}

/* ------------------------------------------------------------------ */
/*  Builder                                                            */
/* ------------------------------------------------------------------ */

/**
 * Assemble a `BridgeEnvelope` from a signal, offering, and optional
 * essence / chronicle refs / route hint.
 *
 * Safety fields (`requiresPolicyGate`, `requiresApproval`,
 * `mutationPossible`, `taboos`) are derived from the decoded signal
 * bits and the offering's action / constraints.
 *
 * This function is pure logic — it does NOT call ToolExecutor,
 * PolicyGate, or any routing function.
 */
export function buildBridgeEnvelope(input: {
  signal: SignalFrame;
  offering: OfferingPlan;
  essence?: EssenceCompatibility;
  chronicleRefs?: string[];
  routeHint?: BridgeEnvelope["routeHint"];
}): BridgeEnvelope {
  const bits = decodeSignalCode(input.signal.code);

  const envelope: BridgeEnvelope = {
    envelopeId: randomUUID(),
    signal: input.signal,
    offering: input.offering,
    chronicleRefs: input.chronicleRefs ?? [],
    safety: {
      requiresPolicyGate:
        bits.policyRisk ||
        bits.mutationPossible ||
        bits.approvalRequired ||
        input.offering.action !== "proceed",
      requiresApproval: input.offering.action === "ask_approval",
      mutationPossible: bits.mutationPossible,
      taboos: computeSafetyTaboos(input.signal, input.offering),
    },
    createdAt: new Date().toISOString(),
  };

  if (input.essence !== undefined) {
    envelope.essence = input.essence;
  }

  if (input.routeHint !== undefined) {
    envelope.routeHint = input.routeHint;
  }

  return envelope;
}
