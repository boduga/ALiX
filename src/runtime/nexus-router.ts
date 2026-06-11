/**
 * nexus-router.ts -- Passive diagnostic routing for BridgeEnvelopes.
 *
 * Evaluates a BridgeEnvelope and produces a routing recommendation
 * indicating which agent role should handle the envelope next.
 *
 * This is pure logic -- it does NOT execute tools, change policies,
 * or alter routing.  It returns a recommendation only.
 *
 * Note: The M0.48 plan sketch predates BridgeEnvelope.  This implementation
 * consumes a pre-built BridgeEnvelope rather than raw task/cwd/sessionId
 * parameters.
 */

import type { BridgeEnvelope } from "./bridge-envelope.js";
import type { ChronicleEntry, ChronicleStore } from "../chronicle/chronicle-store.js";
import type { EssenceCompatibility } from "../agents/essence-profile.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type NexusRouteDecision = {
  envelope: BridgeEnvelope;
  routeHint: {
    /** "genesis" is reserved for future use */
    targetRole: "genesis" | "nexus" | "bridge" | "guild" | "caller";
    confidence: number;       // 0-100
    reason: string;
  };
  chronicleEntries: ChronicleEntry[];
};

/* ------------------------------------------------------------------ */
/*  Router                                                             */
/* ------------------------------------------------------------------ */

/**
 * Produce a passive routing recommendation for the given envelope.
 *
 * Rules are evaluated in order (first match wins).  The result includes
 * a routeHint with the recommended target role, confidence level, and
 * a human-readable reason string.
 *
 * If a `chronicleStore` is provided, matching past failure entries (by
 * signal domain and polarity) are included as `chronicleEntries`.
 *
 * If `essence` is provided, the reason is appended with the essence score.
 *
 * @param input.envelope - The envelope to route.
 * @param input.chronicleStore - Optional store for past case lookup.
 * @param input.essence - Optional essence compatibility score.
 * @returns A routing decision (advisory only).
 */
export async function routeViaNexus(input: {
  envelope: BridgeEnvelope;
  chronicleStore?: ChronicleStore;
  essence?: EssenceCompatibility;
}): Promise<NexusRouteDecision> {
  const { envelope, chronicleStore } = input;

  /* ---------------------------------------------------------------- */
  /*  Routing rules -- first match wins                                */
  /*                                                                   */
  /*  1. ask_approval              -> caller                           */
  /*  2. pause                     -> nexus                            */
  /*  3. mutationPossible          -> bridge                           */
  /*  4. proceed + safe            -> guild                            */
  /*  5. requiresPolicyGate        -> bridge                           */
  /*  6. default                   -> guild                            */
  /* ---------------------------------------------------------------- */

  let targetRole: "genesis" | "nexus" | "bridge" | "guild" | "caller";
  let confidence: number;
  let reason: string;

  if (envelope.offering.action === "ask_approval") {
    targetRole = "caller";
    confidence = 80;
    reason = "approval_required";
  } else if (envelope.offering.action === "pause") {
    targetRole = "nexus";
    confidence = 85;
    reason = "requires_diagnosis";
  } else if (envelope.safety.mutationPossible === true) {
    targetRole = "bridge";
    confidence = 75;
    reason = "mutation_needs_validation";
  } else if (
    envelope.offering.action === "proceed" &&
    envelope.safety.requiresPolicyGate === false
  ) {
    targetRole = "guild";
    confidence = 70;
    reason = "safe_to_execute";
  } else if (envelope.safety.requiresPolicyGate === true) {
    targetRole = "bridge";
    confidence = 65;
    reason = "policy_check_required";
  } else {
    targetRole = "guild";
    confidence = 50;
    reason = "default_route";
  }

  /* ---------------------------------------------------------------- */
  /*  Chronicle lookup                                                 */
  /* ---------------------------------------------------------------- */

  let chronicleEntries: ChronicleEntry[] = [];

  if (chronicleStore) {
    const domainResults = await chronicleStore.search({
      domain: envelope.signal.domain,
      outcome: "failure",
    });

    const polarityResults = await chronicleStore.search({
      polarity: envelope.signal.polarity,
      outcome: "failure",
    });

    // Deduplicate by entryId, limit to 5
    const seen = new Set<string>();

    for (const entry of [...domainResults, ...polarityResults]) {
      if (seen.has(entry.entryId)) continue;
      seen.add(entry.entryId);
      chronicleEntries.push(entry);
      if (chronicleEntries.length >= 5) break;
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Essence scoring                                                  */
  /* ---------------------------------------------------------------- */

  if (input.essence !== undefined) {
    reason = `${reason} | essence_scored_${input.essence.score}`;
  }

  /* ---------------------------------------------------------------- */
  /*  Return recommendation                                            */
  /* ---------------------------------------------------------------- */

  return {
    envelope,
    routeHint: { targetRole, confidence, reason },
    chronicleEntries,
  };
}
