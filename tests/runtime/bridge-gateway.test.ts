import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BridgeGateway } from "../../src/runtime/bridge-gateway.js";
import type { BridgeEnvelope } from "../../src/runtime/bridge-envelope.js";
import { createSignalFrame } from "../../src/runtime/signal-frame.js";
import type { SignalBits, SignalDomain } from "../../src/runtime/signal-frame.js";
import { prescribeOffering } from "../../src/runtime/offering-planner.js";
import type { OfferingPlan } from "../../src/runtime/offering-planner.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeSignal(
  bits: Partial<SignalBits> = {},
  domain: SignalDomain = "task",
) {
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

/** Return a structurally valid `BridgeEnvelope` for use in test setup. */
function makeValidEnvelope(): BridgeEnvelope {
  return {
    envelopeId: "env-001",
    signal: {
      signalId: "sig-001",
      code: "00000000",
      polarity: "neutral",
      domain: "task",
      intent: "test",
      constraints: [],
      taboos: [],
      evidenceRefs: [],
      createdAt: "2025-01-01T00:00:00.000Z",
    },
    offering: {
      offeringId: "off-001",
      signalId: "sig-001",
      action: "proceed",
      requiredEvidence: [],
      successCriteria: [],
      constraints: [],
      taboos: [],
      createdAt: "2025-01-01T00:00:00.000Z",
    },
    safety: {
      requiresPolicyGate: false,
      requiresApproval: false,
      mutationPossible: false,
      taboos: [],
    },
    chronicleRefs: [],
    createdAt: "2025-01-01T00:00:00.000Z",
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("BridgeGateway", () => {
  const gateway = new BridgeGateway();

  /* ---------------------------------------------------------------- */
  /*  validateEnvelope — valid case                                    */
  /* ---------------------------------------------------------------- */

  describe("validateEnvelope", () => {
    it("returns valid:true for a well-formed envelope", () => {
      const envelope = makeValidEnvelope();
      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, true);
      assert.deepEqual(result.errors, []);
    });

    /* ---------------------------------------------------------------- */
    /*  Null / undefined envelope                                        */
    /* ---------------------------------------------------------------- */

    it("returns errors for undefined/null envelope", () => {
      const nullResult = gateway.validateEnvelope(null as unknown as BridgeEnvelope);
      assert.equal(nullResult.valid, false);
      assert.deepEqual(nullResult.errors, ["envelope is null or undefined"]);

      const undefinedResult = gateway.validateEnvelope(undefined as unknown as BridgeEnvelope);
      assert.equal(undefinedResult.valid, false);
      assert.deepEqual(undefinedResult.errors, ["envelope is null or undefined"]);
    });

    /* ---------------------------------------------------------------- */
    /*  envelopeId                                                       */
    /* ---------------------------------------------------------------- */

    it("returns errors for missing envelopeId", () => {
      const envelope = makeValidEnvelope();
      envelope.envelopeId = "";
      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("envelopeId")));
    });

    it("returns errors when envelopeId is not a string", () => {
      const envelope = makeValidEnvelope();
      (envelope as any).envelopeId = 42;
      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("envelopeId")));
    });

    /* ---------------------------------------------------------------- */
    /*  signal.code                                                      */
    /* ---------------------------------------------------------------- */

    it("returns errors for invalid signal.code (wrong length)", () => {
      const envelope = makeValidEnvelope();
      envelope.signal.code = "0000"; // 4 chars instead of 8
      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("signal.code")));
    });

    it("returns errors for invalid signal.code (non-binary chars)", () => {
      const envelope = makeValidEnvelope();
      envelope.signal.code = "abcdefgh"; // 8 chars but not binary
      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("signal.code")));
    });

    it("returns errors for signal.code that is not a string", () => {
      const envelope = makeValidEnvelope();
      (envelope.signal as any).code = 12345678;
      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("signal.code")));
    });

    /* ---------------------------------------------------------------- */
    /*  signal.signalId                                                  */
    /* ---------------------------------------------------------------- */

    it("returns errors for missing signal.signalId", () => {
      const envelope = makeValidEnvelope();
      (envelope.signal as any).signalId = undefined;
      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("signal.signalId")));
    });

    it("returns errors for empty signal.signalId", () => {
      const envelope = makeValidEnvelope();
      envelope.signal.signalId = "";
      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("signal.signalId")));
    });

    /* ---------------------------------------------------------------- */
    /*  signal.domain                                                    */
    /* ---------------------------------------------------------------- */

    it("returns errors for unknown signal.domain", () => {
      const envelope = makeValidEnvelope();
      (envelope.signal as any).domain = "unknown_domain";
      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("signal.domain")));
    });

    /* ---------------------------------------------------------------- */
    /*  signal.polarity                                                  */
    /* ---------------------------------------------------------------- */

    it("returns errors for invalid signal.polarity", () => {
      const envelope = makeValidEnvelope();
      (envelope.signal as any).polarity = "invalid";
      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("signal.polarity")));
    });

    /* ---------------------------------------------------------------- */
    /*  signal.createdAt                                                 */
    /* ---------------------------------------------------------------- */

    it("returns errors for empty signal.createdAt", () => {
      const envelope = makeValidEnvelope();
      envelope.signal.createdAt = "";
      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("signal.createdAt")));
    });

    /* ---------------------------------------------------------------- */
    /*  signal — entirely missing                                        */
    /* ---------------------------------------------------------------- */

    it("returns errors when signal is null", () => {
      const envelope = makeValidEnvelope();
      (envelope as any).signal = null;
      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("signal is missing")));
    });

    /* ---------------------------------------------------------------- */
    /*  offering.offeringId                                              */
    /* ---------------------------------------------------------------- */

    it("returns errors for missing offering.offeringId", () => {
      const envelope = makeValidEnvelope();
      (envelope.offering as any).offeringId = undefined;
      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("offering.offeringId")));
    });

    /* ---------------------------------------------------------------- */
    /*  offering.action                                                  */
    /* ---------------------------------------------------------------- */

    it("returns errors for invalid offering.action", () => {
      const envelope = makeValidEnvelope();
      (envelope.offering as any).action = "invalid_action";
      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("offering.action")));
    });

    /* ---------------------------------------------------------------- */
    /*  offering.signalId / createdAt                                    */
    /* ---------------------------------------------------------------- */

    it("returns errors for missing offering.signalId", () => {
      const envelope = makeValidEnvelope();
      (envelope.offering as any).signalId = "";
      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("offering.signalId")));
    });

    it("returns errors for empty offering.createdAt", () => {
      const envelope = makeValidEnvelope();
      envelope.offering.createdAt = "";
      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("offering.createdAt")));
    });

    /* ---------------------------------------------------------------- */
    /*  offering array fields                                            */
    /* ---------------------------------------------------------------- */

    it("returns errors when offering.requiredEvidence is not an array", () => {
      const envelope = makeValidEnvelope();
      (envelope.offering as any).requiredEvidence = "not-an-array";
      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("requiredEvidence")));
    });

    it("returns errors when offering.successCriteria is not an array", () => {
      const envelope = makeValidEnvelope();
      (envelope.offering as any).successCriteria = null;
      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("successCriteria")));
    });

    it("returns errors when offering.constraints is not an array", () => {
      const envelope = makeValidEnvelope();
      (envelope.offering as any).constraints = "string";
      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("offering.constraints")));
    });

    it("returns errors when offering.taboos is not an array", () => {
      const envelope = makeValidEnvelope();
      (envelope.offering as any).taboos = 42;
      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("offering.taboos")));
    });

    /* ---------------------------------------------------------------- */
    /*  offering — entirely missing                                      */
    /* ---------------------------------------------------------------- */

    it("returns errors when offering is null", () => {
      const envelope = makeValidEnvelope();
      (envelope as any).offering = null;
      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("offering is missing")));
    });

    /* ---------------------------------------------------------------- */
    /*  safety fields                                                    */
    /* ---------------------------------------------------------------- */

    it("returns errors for missing safety fields", () => {
      const envelope = makeValidEnvelope();
      (envelope as any).safety = {
        requiresPolicyGate: false,
        // missing: requiresApproval, mutationPossible, taboos
      };
      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("safety.requiresApproval")));
      assert.ok(result.errors.some((e) => e.includes("safety.mutationPossible")));
      assert.ok(result.errors.some((e) => e.includes("safety.taboos")));
    });

    it("returns errors when safety.requiresPolicyGate is not boolean", () => {
      const envelope = makeValidEnvelope();
      (envelope.safety as any).requiresPolicyGate = "yes";
      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("safety.requiresPolicyGate")));
    });

    it("returns errors when safety.taboos is not an array", () => {
      const envelope = makeValidEnvelope();
      (envelope.safety as any).taboos = "not-array";
      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("safety.taboos")));
    });

    it("returns errors when safety is null", () => {
      const envelope = makeValidEnvelope();
      (envelope as any).safety = null;
      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("safety is missing")));
    });

    /* ---------------------------------------------------------------- */
    /*  chronicleRefs                                                    */
    /* ---------------------------------------------------------------- */

    it("returns errors for missing chronicleRefs array", () => {
      const envelope = makeValidEnvelope();
      (envelope as any).chronicleRefs = "not-an-array";
      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("chronicleRefs")));
    });

    it("passes validation with empty chronicleRefs array", () => {
      const envelope = makeValidEnvelope();
      envelope.chronicleRefs = [];
      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, true);
    });

    /* ---------------------------------------------------------------- */
    /*  createdAt                                                        */
    /* ---------------------------------------------------------------- */

    it("returns errors for empty createdAt", () => {
      const envelope = makeValidEnvelope();
      envelope.createdAt = "";
      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("createdAt")));
    });

    it("returns errors for non-string createdAt", () => {
      const envelope = makeValidEnvelope();
      (envelope as any).createdAt = 123;
      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes("createdAt")));
    });

    /* ---------------------------------------------------------------- */
    /*  Collect ALL errors                                               */
    /* ---------------------------------------------------------------- */

    it("collects ALL errors (not just first)", () => {
      const envelope = makeValidEnvelope();
      // Break several independent fields
      envelope.envelopeId = "";
      envelope.signal.code = "abc";
      (envelope.offering as any).action = "bogus";
      (envelope.safety as any).taboos = "string-instead-of-array";
      (envelope as any).chronicleRefs = null;
      envelope.createdAt = "";

      const result = gateway.validateEnvelope(envelope);
      assert.equal(result.valid, false);
      // We expect exactly 6 distinct errors
      assert.equal(result.errors.length, 6);
      assert.ok(result.errors.some((e) => e.includes("envelopeId")));
      assert.ok(result.errors.some((e) => e.includes("signal.code")));
      assert.ok(result.errors.some((e) => e.includes("offering.action")));
      assert.ok(result.errors.some((e) => e.includes("safety.taboos")));
      assert.ok(result.errors.some((e) => e.includes("chronicleRefs")));
      assert.ok(result.errors.some((e) => e.includes("createdAt")));
    });
  });

  /* ---------------------------------------------------------------- */
  /*  wrapMessage                                                      */
  /* ---------------------------------------------------------------- */

  describe("wrapMessage", () => {
    it("returns BridgeMessage with envelope and payload", () => {
      const signal = makeSignal();
      const offering = prescribeOffering(signal);
      const payload = { foo: "bar" };

      const message = gateway.wrapMessage({ signal, offering, payload });

      assert.ok(message.envelope);
      assert.equal(typeof message.envelope.envelopeId, "string");
      assert.equal(message.envelope.signal.signalId, signal.signalId);
      assert.equal(message.envelope.offering.offeringId, offering.offeringId);
      assert.deepEqual(message.payload, payload);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  unwrapMessage                                                    */
  /* ---------------------------------------------------------------- */

  describe("unwrapMessage", () => {
    it("extracts signal, offering, payload correctly", () => {
      const signal = makeSignal({ policyRisk: true });
      const offering = prescribeOffering(signal);
      const payload = { result: "ok" };

      const message = gateway.wrapMessage({ signal, offering, payload });
      const extracted = gateway.unwrapMessage(message);

      assert.equal(extracted.signal.signalId, signal.signalId);
      assert.equal(extracted.offering.offeringId, offering.offeringId);
      assert.deepEqual(extracted.payload, payload);
    });

    it("throws on malformed message", () => {
      assert.throws(
        () => gateway.unwrapMessage(null as any),
        /malformed/,
      );
      assert.throws(
        () => gateway.unwrapMessage({} as any),
        /malformed/,
      );
      assert.throws(
        () => gateway.unwrapMessage({ envelope: {} } as any),
        /malformed/,
      );
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Round-trip                                                       */
  /* ---------------------------------------------------------------- */

  describe("round-trip", () => {
    it("validateEnvelope passes on envelope from wrapMessage", () => {
      const signal = makeSignal();
      const offering = prescribeOffering(signal);
      const payload = "round-trip-data";

      const message = gateway.wrapMessage({ signal, offering, payload });
      const result = gateway.validateEnvelope(message.envelope);

      assert.equal(result.valid, true);
      assert.deepEqual(result.errors, []);
    });
  });
});
