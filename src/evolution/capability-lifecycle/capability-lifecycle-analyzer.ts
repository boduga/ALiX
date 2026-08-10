// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import type {
  CapabilityLifecycleCandidate,
  CapabilitySignalInputs,
} from "./contracts/lifecycle-contract.js";
import type { LifecycleState } from "../../adaptation/capability-evolution-types.js";

/**
 * A7 — Capability Lifecycle Analyzer (pure).
 *
 * Consumes P5.5/P5.6 capability intelligence (health/gap/overlap/drift),
 * adoption telemetry, and A5 outcome evidence; emits lifecycle candidates. It
 * does NOT infer health, gap, overlap, or drift — those remain P5.5/P5.6
 * responsibilities (anti-duplication invariant, spec §6.1).
 *
 * Deterministic: same inputs → identical candidates and ordering.
 */
export function analyzeCapabilityLifecycle(
  inputs: CapabilitySignalInputs,
): CapabilityLifecycleCandidate[] {
  const candidates: CapabilityLifecycleCandidate[] = [];
  const healthByCapability = new Map<string, { lifecycleState: LifecycleState }>();
  for (const h of inputs.health) healthByCapability.set(h.capability, { lifecycleState: h.lifecycleState });

  // register ← P5.5 gap with a suggested capability.
  for (const gap of inputs.gaps) {
    if (!gap.suggestedCapability) continue;
    candidates.push({
      intent: "register",
      target: { capabilityId: gap.suggestedCapability },
      confidence: gap.signalStrength / 3,
      rationale: gap.evidence,
      evidenceRefs: [],
      observedLifecycleState: null,
      proposedLifecycleState: "emerging",
    });
  }

  const NEXT_TIER: Partial<Record<LifecycleState, LifecycleState>> = {
    emerging: "active",
    active: "mature",
  };

  for (const h of inputs.health) {
    const next = NEXT_TIER[h.lifecycleState];
    const adoption = inputs.adoption[h.capability];
    // promote ← emerging/active health AND adoption telemetry with invocations.
    if (next && adoption && adoption.invocationCount > 0) {
      candidates.push({
        intent: "promote",
        target: { capabilityId: h.capability },
        confidence: 0.8,
        rationale: [h.rationale],
        evidenceRefs: [],
        observedLifecycleState: h.lifecycleState,
        proposedLifecycleState: next,
      });
    }
    // deprecate ← declining/stagnant health.
    if (h.lifecycleState === "declining" || h.lifecycleState === "stagnant") {
      candidates.push({
        intent: "deprecate",
        target: { capabilityId: h.capability },
        confidence: 0.8,
        rationale: [h.rationale],
        evidenceRefs: [],
        observedLifecycleState: h.lifecycleState,
        proposedLifecycleState: "deprecated",
      });
    }
  }

  // consolidate ← P5.5 overlap consolidationCandidate (score > 0.7, P5.5-owned).
  for (const o of inputs.overlap) {
    if (!o.consolidationCandidate) continue;
    candidates.push({
      intent: "consolidate",
      target: { capabilityId: o.capabilityA, relatedCapabilityIds: [o.capabilityB] },
      confidence: o.overlapScore,
      rationale: [`overlap ${o.overlapScore.toFixed(2)} between ${o.capabilityA} and ${o.capabilityB}`],
      evidenceRefs: [],
      observedLifecycleState: healthByCapability.get(o.capabilityA)?.lifecycleState ?? null,
      proposedLifecycleState: "mature",
    });
  }

  // modify ← P5.5 drift splitCandidate (magnitude > 0.5, P5.5-owned).
  for (const d of inputs.drift) {
    if (!d.splitCandidate) continue;
    candidates.push({
      intent: "modify",
      target: { capabilityId: d.capability },
      confidence: d.driftMagnitude,
      rationale: [d.currentScope],
      evidenceRefs: [],
      observedLifecycleState: healthByCapability.get(d.capability)?.lifecycleState ?? null,
      proposedLifecycleState: healthByCapability.get(d.capability)?.lifecycleState ?? "active",
    });
  }

  // Corroborating A5 outcome evidence: attach to matching candidates, never as
  // a source of new signals. A6 pattern evidence is intentionally NOT attached:
  // PatternObservation carries no capability identity (no capabilityId), so
  // attribution of pattern evidence to a candidate would be unsound.
  for (const ev of inputs.outcome) {
    for (const c of candidates) {
      if (ev.proposalId && ev.proposalId.includes(c.target.capabilityId)) {
        c.evidenceRefs.push(ev.evidenceId);
      }
    }
  }

  candidates.sort((a, b) => {
    if (a.target.capabilityId !== b.target.capabilityId) {
      return a.target.capabilityId < b.target.capabilityId ? -1 : 1;
    }
    return a.intent < b.intent ? -1 : 1;
  });
  return candidates;
}
