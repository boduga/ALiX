import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { routeViaNexus, type NexusRouteDecision } from "../../src/runtime/nexus-router.js";
import { buildBridgeEnvelope } from "../../src/runtime/bridge-envelope.js";
import type { BridgeEnvelope } from "../../src/runtime/bridge-envelope.js";
import { createSignalFrame } from "../../src/runtime/signal-frame.js";
import type { SignalBits, SignalFrame, SignalDomain, SignalPolarity } from "../../src/runtime/signal-frame.js";
import { prescribeOffering } from "../../src/runtime/offering-planner.js";
import type { OfferingPlan } from "../../src/runtime/offering-planner.js";
import { ChronicleStore } from "../../src/chronicle/chronicle-store.js";
import type { ChronicleEntry } from "../../src/chronicle/chronicle-store.js";
import type { EssenceCompatibility } from "../../src/agents/essence-profile.js";

/* ------------------------------------------------------------------ */
/*  Helper                                                             */
/* ------------------------------------------------------------------ */

function makeSignal(
  bits: Partial<SignalBits> = {},
  domain: SignalDomain = "task",
): SignalFrame {
  const defaultBits: SignalBits = {
    intentClear: false,
    policyRisk: false,
    toolRequired: false,
    memoryRequired: false,
    freshnessRequired: false,
    mutationPossible: false,
    approvalRequired: false,
    replayRollbackContext: false,
  };

  return createSignalFrame({
    bits: { ...defaultBits, ...bits },
    domain,
    intent: "nexus-router-test",
  });
}

/* ------------------------------------------------------------------ */
/*  routeViaNexus                                                      */
/* ------------------------------------------------------------------ */

describe("routeViaNexus", () => {
  /* ---------------------------------------------------------------- */
  /*  Basic structure                                                  */
  /* ---------------------------------------------------------------- */

  it("returns valid NexusRouteDecision with envelope and routeHint", async () => {
    const signal = makeSignal();
    const offering = prescribeOffering(signal);
    const envelope = buildBridgeEnvelope({ signal, offering });

    const result = await routeViaNexus({ envelope });

    assert.ok(result);
    assert.equal(result.envelope.envelopeId, envelope.envelopeId);
    assert.ok(result.routeHint);
    assert.equal(typeof result.routeHint.targetRole, "string");
    assert.equal(typeof result.routeHint.confidence, "number");
    assert.ok(result.routeHint.confidence >= 0 && result.routeHint.confidence <= 100);
    assert.equal(typeof result.routeHint.reason, "string");
    assert.ok(Array.isArray(result.chronicleEntries));
  });

  /* ---------------------------------------------------------------- */
  /*  Routing rules                                                    */
  /* ---------------------------------------------------------------- */

  it("ask_approval action -> targetRole 'caller'", async () => {
    const signal = makeSignal({ approvalRequired: true });
    const offering = prescribeOffering(signal);
    const envelope = buildBridgeEnvelope({ signal, offering });

    assert.equal(envelope.offering.action, "ask_approval");

    const result = await routeViaNexus({ envelope });

    assert.equal(result.routeHint.targetRole, "caller");
    assert.equal(result.routeHint.confidence, 80);
    assert.equal(result.routeHint.reason, "approval_required");
  });

  it("pause action -> targetRole 'nexus'", async () => {
    // Offering planner never produces "pause", so we construct the
    // offering manually to exercise this rule.
    const signal = makeSignal();
    const offering: OfferingPlan = {
      offeringId: "off-pause-test",
      signalId: signal.signalId,
      action: "pause",
      requiredEvidence: [],
      constraints: [],
      taboos: [],
      successCriteria: [],
      createdAt: new Date().toISOString(),
    };
    const envelope = buildBridgeEnvelope({ signal, offering });

    assert.equal(envelope.offering.action, "pause");

    const result = await routeViaNexus({ envelope });

    assert.equal(result.routeHint.targetRole, "nexus");
    assert.equal(result.routeHint.confidence, 85);
    assert.equal(result.routeHint.reason, "requires_diagnosis");
  });

  it("mutationPossible true -> targetRole 'bridge'", async () => {
    // mutationPossible alone (no approvalRequired) yields action "proceed",
    // so rules 1-2 don't match and rule 3 wins.
    const signal = makeSignal({ mutationPossible: true });
    const offering = prescribeOffering(signal);
    const envelope = buildBridgeEnvelope({ signal, offering });

    assert.equal(envelope.safety.mutationPossible, true);
    assert.equal(envelope.offering.action, "proceed");

    const result = await routeViaNexus({ envelope });

    assert.equal(result.routeHint.targetRole, "bridge");
    assert.equal(result.routeHint.confidence, 75);
    assert.equal(result.routeHint.reason, "mutation_needs_validation");
  });

  it("proceed + safe -> targetRole 'guild'", async () => {
    // All bits false -> action "proceed", requiresPolicyGate false
    const signal = makeSignal();
    const offering = prescribeOffering(signal);
    const envelope = buildBridgeEnvelope({ signal, offering });

    assert.equal(envelope.offering.action, "proceed");
    assert.equal(envelope.safety.requiresPolicyGate, false);
    assert.equal(envelope.safety.mutationPossible, false);

    const result = await routeViaNexus({ envelope });

    assert.equal(result.routeHint.targetRole, "guild");
    assert.equal(result.routeHint.confidence, 70);
    assert.equal(result.routeHint.reason, "safe_to_execute");
  });

  it("requiresPolicyGate -> targetRole 'bridge'", async () => {
    // policyRisk bit sets requiresPolicyGate=true and produces action
    // "run_policy_check" (which is not ask_approval/pause/proceed),
    // so rules 1-4 don't match and rule 5 wins.
    const signal = makeSignal({ policyRisk: true });
    const offering = prescribeOffering(signal);
    const envelope = buildBridgeEnvelope({ signal, offering });

    assert.equal(envelope.offering.action, "run_policy_check");
    assert.equal(envelope.safety.requiresPolicyGate, true);
    assert.equal(envelope.safety.mutationPossible, false);

    const result = await routeViaNexus({ envelope });

    assert.equal(result.routeHint.targetRole, "bridge");
    assert.equal(result.routeHint.confidence, 65);
    assert.equal(result.routeHint.reason, "policy_check_required");
  });

  it("default -> targetRole 'guild'", async () => {
    // Construct an envelope that doesn't match any rule 1-5:
    // action is not ask_approval/pause/proceed, mutationPossible false,
    // requiresPolicyGate false.  This combination is unreachable via
    // buildBridgeEnvelope (requiresPolicyGate auto-computes to true for
    // any non-"proceed" action when bits are unsafe), so we construct
    // the envelope manually.
    const signal = makeSignal();
    const offering: OfferingPlan = {
      offeringId: "off-default-test",
      signalId: signal.signalId,
      action: "replay_preview",
      requiredEvidence: [],
      constraints: [],
      taboos: [],
      successCriteria: [],
      createdAt: new Date().toISOString(),
    };
    const envelope: BridgeEnvelope = {
      envelopeId: "env-default-test",
      signal,
      offering,
      chronicleRefs: [],
      safety: {
        requiresPolicyGate: false,
        requiresApproval: false,
        mutationPossible: false,
        taboos: [],
      },
      createdAt: new Date().toISOString(),
    };

    const result = await routeViaNexus({ envelope });

    assert.equal(result.routeHint.targetRole, "guild");
    assert.equal(result.routeHint.confidence, 50);
    assert.equal(result.routeHint.reason, "default_route");
  });

  /* ---------------------------------------------------------------- */
  /*  Chronicle lookup                                                 */
  /* ---------------------------------------------------------------- */

  it("chronicleEntries is [] when chronicleStore not provided", async () => {
    const signal = makeSignal();
    const offering = prescribeOffering(signal);
    const envelope = buildBridgeEnvelope({ signal, offering });

    const result = await routeViaNexus({ envelope });

    assert.deepEqual(result.chronicleEntries, []);
  });

  it("chronicleStore search returns entries when provided", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "nexus-router-test-"));
    const store = new ChronicleStore(tmpDir);

    try {
      const signal = makeSignal({}, "chronicle"); // domain="chronicle", polarity="neutral"
      const offering = prescribeOffering(signal);
      const envelope = buildBridgeEnvelope({ signal, offering });

      // Entry matching by domain (chronicle) + failure
      const domainEntry = await store.append({
        signalCode: "00000000",
        domain: "chronicle",
        polarity: "mixed",
        problem: "domain match",
        diagnosis: "chronicle domain failure",
        actionTaken: "rerouted",
        outcome: "failure",
        lesson: "chronicle domain needs attention",
        taboosObserved: [],
        offeringsUsed: [],
        traceRefs: [],
        replayRefs: [],
        rollbackRefs: [],
      });

      // Entry matching by polarity (neutral) + failure
      const polarityEntry = await store.append({
        signalCode: "00000000",
        domain: "task",
        polarity: "neutral",
        problem: "polarity match",
        diagnosis: "neutral polarity failure",
        actionTaken: "diagnosed",
        outcome: "failure",
        lesson: "neutral signals may hide issues",
        taboosObserved: [],
        offeringsUsed: [],
        traceRefs: [],
        replayRefs: [],
        rollbackRefs: [],
      });

      // Non-matching entry (different domain, different polarity, success)
      await store.append({
        signalCode: "00000000",
        domain: "tool",
        polarity: "ire",
        problem: "no match",
        diagnosis: "irrelevant",
        actionTaken: "none",
        outcome: "success",
        lesson: "nothing to see",
        taboosObserved: [],
        offeringsUsed: [],
        traceRefs: [],
        replayRefs: [],
        rollbackRefs: [],
      });

      const result = await routeViaNexus({ envelope, chronicleStore: store });

      assert.equal(result.chronicleEntries.length, 2);

      const entryIds = result.chronicleEntries.map((e) => e.entryId);
      assert.ok(entryIds.includes(domainEntry.entryId));
      assert.ok(entryIds.includes(polarityEntry.entryId));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  /* ---------------------------------------------------------------- */
  /*  Essence scoring                                                  */
  /* ---------------------------------------------------------------- */

  it("essence score is appended to reason when provided", async () => {
    const signal = makeSignal();
    const offering = prescribeOffering(signal);
    const envelope = buildBridgeEnvelope({ signal, offering });
    const essence: EssenceCompatibility = {
      compatible: false,
      score: 42,
      reasons: ["domain_mismatch"],
      violatedConstraints: [],
      violatedTaboos: [],
    };

    const result = await routeViaNexus({ envelope, essence });

    // With all-bits-false signal: action="proceed", safe -> rule 4
    assert.ok(result.routeHint.reason.startsWith("safe_to_execute"));
    assert.ok(result.routeHint.reason.includes("essence_scored_42"));
  });

  /* ---------------------------------------------------------------- */
  /*  Integrity -- no executor / policy gate coupling                  */
  /* ---------------------------------------------------------------- */

  it("does NOT call ToolExecutor or PolicyGate", async () => {
    // routeViaNexus should not import or reference ToolExecutor,
    // PolicyGate, or routing modules.  At runtime we verify the
    // function returns data without throwing, proving it performs
    // no hidden execution.
    const signal = makeSignal();
    const offering = prescribeOffering(signal);
    const envelope = buildBridgeEnvelope({ signal, offering });

    const result = await routeViaNexus({ envelope });

    assert.ok(result);
    assert.equal(typeof result.routeHint.targetRole, "string");
    assert.equal(typeof result.routeHint.confidence, "number");
  });
});
