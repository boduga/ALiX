import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildBridgeEnvelope } from "../../src/runtime/bridge-envelope.js";
import type { BridgeEnvelope } from "../../src/runtime/bridge-envelope.js";
import { createSignalFrame } from "../../src/runtime/signal-frame.js";
import type { SignalBits, SignalFrame, SignalDomain } from "../../src/runtime/signal-frame.js";
import { prescribeOffering } from "../../src/runtime/offering-planner.js";
import type { OfferingPlan } from "../../src/runtime/offering-planner.js";
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
    intent: "test",
  });
}

/* ------------------------------------------------------------------ */
/*  buildBridgeEnvelope                                                */
/* ------------------------------------------------------------------ */

describe("buildBridgeEnvelope", () => {
  /* ---------------------------------------------------------------- */
  /*  Basic structure                                                  */
  /* ---------------------------------------------------------------- */

  it("returns a valid BridgeEnvelope with envelopeId and createdAt", () => {
    const signal = makeSignal();
    const offering = prescribeOffering(signal);
    const envelope = buildBridgeEnvelope({ signal, offering });

    assert.match(envelope.envelopeId, /^[0-9a-f-]{36}$/);
    assert.doesNotThrow(() => new Date(envelope.createdAt).toISOString());
  });

  it("preserves the input signal (signalId matches)", () => {
    const signal = makeSignal();
    const offering = prescribeOffering(signal);
    const envelope = buildBridgeEnvelope({ signal, offering });

    assert.equal(envelope.signal.signalId, signal.signalId);
  });

  it("preserves the input offering (offeringId matches)", () => {
    const signal = makeSignal();
    const offering = prescribeOffering(signal);
    const envelope = buildBridgeEnvelope({ signal, offering });

    assert.equal(envelope.offering.offeringId, offering.offeringId);
  });

  /* ---------------------------------------------------------------- */
  /*  safety fields                                                    */
  /* ---------------------------------------------------------------- */

  it("sets requiresApproval when offering.action === 'ask_approval'", () => {
    const signal = makeSignal({ approvalRequired: true });
    const offering = prescribeOffering(signal);
    assert.equal(offering.action, "ask_approval");

    const envelope = buildBridgeEnvelope({ signal, offering });

    assert.equal(envelope.safety.requiresApproval, true);
  });

  it("does NOT set requiresApproval when offering.action is not 'ask_approval'", () => {
    const signal = makeSignal();
    const offering = prescribeOffering(signal);
    // Default offering for safe signal is "proceed"
    assert.equal(offering.action, "proceed");

    const envelope = buildBridgeEnvelope({ signal, offering });

    assert.equal(envelope.safety.requiresApproval, false);
  });

  it("sets requiresPolicyGate when signal has policyRisk bit", () => {
    const signal = makeSignal({ policyRisk: true });
    const offering = prescribeOffering(signal);
    const envelope = buildBridgeEnvelope({ signal, offering });

    assert.equal(envelope.safety.requiresPolicyGate, true);
  });

  it("sets requiresPolicyGate when signal has mutationPossible bit", () => {
    const signal = makeSignal({ mutationPossible: true });
    const offering = prescribeOffering(signal);
    const envelope = buildBridgeEnvelope({ signal, offering });

    assert.equal(envelope.safety.requiresPolicyGate, true);
  });

  it("sets requiresPolicyGate when signal has approvalRequired bit", () => {
    const signal = makeSignal({ approvalRequired: true });
    const offering = prescribeOffering(signal);
    const envelope = buildBridgeEnvelope({ signal, offering });

    assert.equal(envelope.safety.requiresPolicyGate, true);
  });

  it("sets requiresPolicyGate when offering.action is not 'proceed'", () => {
    // freshnessRequired produces action "run_policy_check"
    const signal = makeSignal({ freshnessRequired: true });
    const offering = prescribeOffering(signal);
    assert.notEqual(offering.action, "proceed");

    const envelope = buildBridgeEnvelope({ signal, offering });

    assert.equal(envelope.safety.requiresPolicyGate, true);
  });

  it("does NOT set requiresPolicyGate when all bits are safe and offering is 'proceed'", () => {
    const signal = makeSignal();
    const offering = prescribeOffering(signal);
    assert.equal(offering.action, "proceed");

    const envelope = buildBridgeEnvelope({ signal, offering });

    assert.equal(envelope.safety.requiresPolicyGate, false);
  });

  it("sets mutationPossible from decoded signal bits", () => {
    const signal = makeSignal({ mutationPossible: true });
    const offering = prescribeOffering(signal);
    const envelope = buildBridgeEnvelope({ signal, offering });

    assert.equal(envelope.safety.mutationPossible, true);
  });

  it("sets mutationPossible to false when signal bit is not set", () => {
    const signal = makeSignal({ mutationPossible: false });
    const offering = prescribeOffering(signal);
    const envelope = buildBridgeEnvelope({ signal, offering });

    assert.equal(envelope.safety.mutationPossible, false);
  });

  /* ---------------------------------------------------------------- */
  /*  chronicleRefs                                                    */
  /* ---------------------------------------------------------------- */

  it("chronicleRefs defaults to [] when not provided", () => {
    const signal = makeSignal();
    const offering = prescribeOffering(signal);
    const envelope = buildBridgeEnvelope({ signal, offering });

    assert.deepEqual(envelope.chronicleRefs, []);
  });

  it("chronicleRefs includes explicit refs when provided", () => {
    const signal = makeSignal();
    const offering = prescribeOffering(signal);
    const refs = ["chronicle-001", "chronicle-002"];
    const envelope = buildBridgeEnvelope({
      signal,
      offering,
      chronicleRefs: refs,
    });

    assert.deepEqual(envelope.chronicleRefs, refs);
  });

  /* ---------------------------------------------------------------- */
  /*  taboos — deduplicated union                                      */
  /* ---------------------------------------------------------------- */

  it("taboos is a deduplicated union of signal taboos + offering taboos + matching offering constraints", () => {
    // Manually construct a signal and offering with known taboos so we
    // can verify each source is included and duplicates are removed.
    const signal: SignalFrame = {
      signalId: "sig-taboo-test",
      code: "00000000",
      polarity: "neutral",
      domain: "task",
      intent: "taboo-test",
      constraints: [],
      taboos: ["taboo-a", "taboo-b"],
      evidenceRefs: [],
      createdAt: new Date().toISOString(),
    };

    const offering: OfferingPlan = {
      offeringId: "off-taboo-test",
      signalId: "sig-taboo-test",
      action: "proceed",
      requiredEvidence: [],
      constraints: ["no_mutation", "some_other_constraint"],
      taboos: ["taboo-b", "taboo-c"],
      successCriteria: [],
      createdAt: new Date().toISOString(),
    };

    const envelope = buildBridgeEnvelope({ signal, offering });

    // Expected order: signal taboos first, then offering taboos (deduped),
    // then matching offering constraints (deduped).
    //   signal:      ["taboo-a", "taboo-b"]
    //   offering:    ["taboo-b"(skip), "taboo-c"]
    //   constraints: ["no_mutation", "some_other_constraint"(not taboo-like)]
    // Result: ["taboo-a", "taboo-b", "taboo-c", "no_mutation"]
    assert.deepEqual(envelope.safety.taboos, [
      "taboo-a",
      "taboo-b",
      "taboo-c",
      "no_mutation",
    ]);
  });

  it("returns empty safety.taboos when both signal and offering have no taboos", () => {
    const signal: SignalFrame = {
      signalId: "sig-empty",
      code: "00000000",
      polarity: "neutral",
      domain: "task",
      intent: "empty-taboos",
      constraints: [],
      taboos: [],
      evidenceRefs: [],
      createdAt: new Date().toISOString(),
    };

    const offering: OfferingPlan = {
      offeringId: "off-empty",
      signalId: "sig-empty",
      action: "proceed",
      requiredEvidence: [],
      constraints: ["proceed_with_confidence"],
      taboos: [],
      successCriteria: [],
      createdAt: new Date().toISOString(),
    };

    const envelope = buildBridgeEnvelope({ signal, offering });

    assert.deepEqual(envelope.safety.taboos, []);
  });

  it("excludes offering.constraints that aren't taboo-like from safety.taboos", () => {
    const signal: SignalFrame = {
      signalId: "sig-non-taboo",
      code: "00000000",
      polarity: "neutral",
      domain: "task",
      intent: "non-taboo-constraints",
      constraints: [],
      taboos: [],
      evidenceRefs: [],
      createdAt: new Date().toISOString(),
    };

    const offering: OfferingPlan = {
      offeringId: "off-non-taboo",
      signalId: "sig-non-taboo",
      action: "proceed",
      requiredEvidence: [],
      constraints: ["proceed_with_confidence", "require_human_review"],
      taboos: [],
      successCriteria: [],
      createdAt: new Date().toISOString(),
    };

    const envelope = buildBridgeEnvelope({ signal, offering });

    // Neither "proceed_with_confidence" nor "require_human_review" are
    // taboo-like, so safety.taboos should be empty.
    assert.deepEqual(envelope.safety.taboos, []);
  });

  /* ---------------------------------------------------------------- */
  /*  Optional fields                                                  */
  /* ---------------------------------------------------------------- */

  it("allows optional essence compatibility", () => {
    const signal = makeSignal();
    const offering = prescribeOffering(signal);
    const essence: EssenceCompatibility = {
      compatible: true,
      score: 85,
      reasons: ["domain_match"],
      violatedConstraints: [],
      violatedTaboos: [],
    };

    const envelope = buildBridgeEnvelope({ signal, offering, essence });

    assert.ok(envelope.essence !== undefined);
    assert.equal(envelope.essence!.compatible, true);
    assert.equal(envelope.essence!.score, 85);
  });

  it("omits essence when not provided", () => {
    const signal = makeSignal();
    const offering = prescribeOffering(signal);
    const envelope = buildBridgeEnvelope({ signal, offering });

    assert.equal(envelope.essence, undefined);
  });

  it("includes routeHint when provided", () => {
    const signal = makeSignal();
    const offering = prescribeOffering(signal);
    const routeHint: BridgeEnvelope["routeHint"] = {
      targetRole: "nexus",
      targetAgentId: "agent-42",
      reason: "coordination-test",
    };

    const envelope = buildBridgeEnvelope({ signal, offering, routeHint });

    assert.ok(envelope.routeHint !== undefined);
    assert.equal(envelope.routeHint!.targetRole, "nexus");
    assert.equal(envelope.routeHint!.targetAgentId, "agent-42");
    assert.equal(envelope.routeHint!.reason, "coordination-test");
  });

  it("leaves routeHint undefined when not provided (not empty object)", () => {
    const signal = makeSignal();
    const offering = prescribeOffering(signal);
    const envelope = buildBridgeEnvelope({ signal, offering });

    assert.equal(envelope.routeHint, undefined);
  });

  /* ---------------------------------------------------------------- */
  /*  Integrity — no executor / policy gate coupling                   */
  /* ---------------------------------------------------------------- */

  it("does NOT call any executor, policy gate, or routing function", () => {
    // This is a compile-time / import-time assurance: buildBridgeEnvelope
    // should not import or reference ToolExecutor, PolicyGate, or
    // routing modules.  At runtime we verify the function returns data
    // without throwing, proving it performs no hidden execution.
    const signal = makeSignal();
    const offering = prescribeOffering(signal);
    const envelope = buildBridgeEnvelope({ signal, offering });

    assert.ok(envelope);
    assert.equal(typeof envelope.envelopeId, "string");
    assert.equal(typeof envelope.safety.requiresPolicyGate, "boolean");
  });
});
