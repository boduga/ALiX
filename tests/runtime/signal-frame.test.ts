import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  encodeSignalBits,
  decodeSignalCode,
  inferSignalPolarity,
  createSignalFrame,
} from "../../src/runtime/signal-frame.js";
import type { SignalBits, SignalPolarity, SignalDomain } from "../../src/runtime/signal-frame.js";

/* ------------------------------------------------------------------ */
/*  encodeSignalBits                                                    */
/* ------------------------------------------------------------------ */

describe("encodeSignalBits", () => {
  it('encodes all false as "00000000"', () => {
    const bits: SignalBits = {
      intentClear: false,
      policyRisk: false,
      toolRequired: false,
      memoryRequired: false,
      freshnessRequired: false,
      mutationPossible: false,
      approvalRequired: false,
      replayRollbackContext: false,
    };
    assert.equal(encodeSignalBits(bits), "00000000");
  });

  it('encodes all true as "11111111"', () => {
    const bits: SignalBits = {
      intentClear: true,
      policyRisk: true,
      toolRequired: true,
      memoryRequired: true,
      freshnessRequired: true,
      mutationPossible: true,
      approvalRequired: true,
      replayRollbackContext: true,
    };
    assert.equal(encodeSignalBits(bits), "11111111");
  });

  it("encodes a mixed pattern correctly", () => {
    const bits: SignalBits = {
      intentClear: true,
      policyRisk: false,
      toolRequired: true,
      memoryRequired: false,
      freshnessRequired: true,
      mutationPossible: false,
      approvalRequired: true,
      replayRollbackContext: false,
    };
    // intentClear(1) policyRisk(0) toolRequired(1) memoryRequired(0)
    // freshnessRequired(1) mutationPossible(0) approvalRequired(1) replayRollbackContext(0)
    assert.equal(encodeSignalBits(bits), "10101010");
  });
});

/* ------------------------------------------------------------------ */
/*  decodeSignalCode                                                    */
/* ------------------------------------------------------------------ */

describe("decodeSignalCode", () => {
  it('decodes "11111111" to all bits true', () => {
    const bits = decodeSignalCode("11111111");
    assert.equal(bits.intentClear, true);
    assert.equal(bits.policyRisk, true);
    assert.equal(bits.toolRequired, true);
    assert.equal(bits.memoryRequired, true);
    assert.equal(bits.freshnessRequired, true);
    assert.equal(bits.mutationPossible, true);
    assert.equal(bits.approvalRequired, true);
    assert.equal(bits.replayRollbackContext, true);
  });

  it('decodes "00000000" to all bits false', () => {
    const bits = decodeSignalCode("00000000");
    assert.equal(bits.intentClear, false);
    assert.equal(bits.policyRisk, false);
    assert.equal(bits.toolRequired, false);
    assert.equal(bits.memoryRequired, false);
    assert.equal(bits.freshnessRequired, false);
    assert.equal(bits.mutationPossible, false);
    assert.equal(bits.approvalRequired, false);
    assert.equal(bits.replayRollbackContext, false);
  });

  it("decodes a mixed pattern correctly", () => {
    const bits = decodeSignalCode("10101010");
    assert.equal(bits.intentClear, true);
    assert.equal(bits.policyRisk, false);
    assert.equal(bits.toolRequired, true);
    assert.equal(bits.memoryRequired, false);
    assert.equal(bits.freshnessRequired, true);
    assert.equal(bits.mutationPossible, false);
    assert.equal(bits.approvalRequired, true);
    assert.equal(bits.replayRollbackContext, false);
  });

  it("round-trips encode then decode", () => {
    const original: SignalBits = {
      intentClear: true,
      policyRisk: false,
      toolRequired: false,
      memoryRequired: true,
      freshnessRequired: false,
      mutationPossible: true,
      approvalRequired: false,
      replayRollbackContext: true,
    };
    const code = encodeSignalBits(original);
    const decoded = decodeSignalCode(code);
    assert.deepEqual(decoded, original);
  });

  it("decodes non-binary characters as zeros", () => {
    // Each non-'1' char should be treated as 0.
    const bits = decodeSignalCode("abcdefgh");
    assert.equal(bits.intentClear, false);
    assert.equal(bits.policyRisk, false);
    assert.equal(bits.toolRequired, false);
    assert.equal(bits.memoryRequired, false);
    assert.equal(bits.freshnessRequired, false);
    assert.equal(bits.mutationPossible, false);
    assert.equal(bits.approvalRequired, false);
    assert.equal(bits.replayRollbackContext, false);
  });

  it("pads or truncates to 8 characters for short / long inputs", () => {
    // Short input: pad with '0'
    const short = decodeSignalCode("101");
    assert.equal(short.intentClear, true);
    assert.equal(short.policyRisk, false);
    assert.equal(short.toolRequired, true);
    // beyond input length should be padded as 0
    assert.equal(short.memoryRequired, false);
    assert.equal(short.freshnessRequired, false);
    assert.equal(short.mutationPossible, false);
    assert.equal(short.approvalRequired, false);
    assert.equal(short.replayRollbackContext, false);

    // Long input: truncate to first 8 chars
    const long = decodeSignalCode("101010101111");
    assert.equal(long.intentClear, true);
    assert.equal(long.policyRisk, false);
    assert.equal(long.toolRequired, true);
    assert.equal(long.memoryRequired, false);
    assert.equal(long.freshnessRequired, true);
    assert.equal(long.mutationPossible, false);
    assert.equal(long.approvalRequired, true);
    assert.equal(long.replayRollbackContext, false);
  });
});

/* ------------------------------------------------------------------ */
/*  inferSignalPolarity                                                 */
/* ------------------------------------------------------------------ */

describe("inferSignalPolarity", () => {
  it('returns "ibi" when policyRisk, mutationPossible, and approvalRequired are all true', () => {
    const bits: SignalBits = {
      intentClear: true,
      policyRisk: true,
      toolRequired: false,
      memoryRequired: false,
      freshnessRequired: false,
      mutationPossible: true,
      approvalRequired: true,
      replayRollbackContext: false,
    };
    assert.equal(inferSignalPolarity(bits), "ibi");
  });

  it('returns "neutral" when all bits are false', () => {
    const bits: SignalBits = {
      intentClear: false,
      policyRisk: false,
      toolRequired: false,
      memoryRequired: false,
      freshnessRequired: false,
      mutationPossible: false,
      approvalRequired: false,
      replayRollbackContext: false,
    };
    assert.equal(inferSignalPolarity(bits), "neutral");
  });

  it('returns "mixed" when any of policyRisk, mutationPossible, or approvalRequired are true', () => {
    // Only policyRisk true
    const bits1: SignalBits = {
      intentClear: true,
      policyRisk: true,
      toolRequired: false,
      memoryRequired: false,
      freshnessRequired: false,
      mutationPossible: false,
      approvalRequired: false,
      replayRollbackContext: false,
    };
    assert.equal(inferSignalPolarity(bits1), "mixed");

    // Only mutationPossible true
    const bits2: SignalBits = {
      intentClear: true,
      policyRisk: false,
      toolRequired: false,
      memoryRequired: false,
      freshnessRequired: false,
      mutationPossible: true,
      approvalRequired: false,
      replayRollbackContext: false,
    };
    assert.equal(inferSignalPolarity(bits2), "mixed");

    // Only approvalRequired true
    const bits3: SignalBits = {
      intentClear: true,
      policyRisk: false,
      toolRequired: false,
      memoryRequired: false,
      freshnessRequired: false,
      mutationPossible: false,
      approvalRequired: true,
      replayRollbackContext: false,
    };
    assert.equal(inferSignalPolarity(bits3), "mixed");
  });

  it('returns "ire" for all-safe bits (no risk flags)', () => {
    const bits: SignalBits = {
      intentClear: true,
      policyRisk: false,
      toolRequired: true,
      memoryRequired: false,
      freshnessRequired: true,
      mutationPossible: false,
      approvalRequired: false,
      replayRollbackContext: false,
    };
    assert.equal(inferSignalPolarity(bits), "ire");
  });
});

/* ------------------------------------------------------------------ */
/*  createSignalFrame                                                   */
/* ------------------------------------------------------------------ */

describe("createSignalFrame", () => {
  it("generates a signalId and createdAt", () => {
    const bits: SignalBits = {
      intentClear: true,
      policyRisk: false,
      toolRequired: false,
      memoryRequired: false,
      freshnessRequired: false,
      mutationPossible: false,
      approvalRequired: false,
      replayRollbackContext: false,
    };
    const frame = createSignalFrame({ bits, domain: "task", intent: "test" });

    // signalId should be a UUID-formatted string
    assert.match(frame.signalId, /^[0-9a-f-]{36}$/);
    // createdAt should be an ISO string
    assert.doesNotThrow(() => new Date(frame.createdAt).toISOString());
  });

  it("sets code from encodeSignalBits and polarity from inferSignalPolarity", () => {
    const bits: SignalBits = {
      intentClear: false,
      policyRisk: false,
      toolRequired: false,
      memoryRequired: false,
      freshnessRequired: false,
      mutationPossible: false,
      approvalRequired: false,
      replayRollbackContext: false,
    };
    const frame = createSignalFrame({ bits, domain: "policy", intent: "neutral-test" });

    assert.equal(frame.code, "00000000");
    assert.equal(frame.polarity, "neutral");
  });

  it("sets evidenceRefs defaults to empty array when not provided", () => {
    const bits: SignalBits = {
      intentClear: true,
      policyRisk: false,
      toolRequired: false,
      memoryRequired: false,
      freshnessRequired: false,
      mutationPossible: false,
      approvalRequired: false,
      replayRollbackContext: false,
    };
    const frame = createSignalFrame({ bits, domain: "task", intent: "no-evid" });
    assert.deepEqual(frame.evidenceRefs, []);
  });

  it("includes optional traceId, replayId, rollbackId when provided", () => {
    const bits: SignalBits = {
      intentClear: true,
      policyRisk: false,
      toolRequired: false,
      memoryRequired: false,
      freshnessRequired: false,
      mutationPossible: false,
      approvalRequired: false,
      replayRollbackContext: true,
    };
    const frame = createSignalFrame({
      bits,
      domain: "replay",
      intent: "with-ids",
      traceId: "trace-abc",
      replayId: "replay-xyz",
      rollbackId: "roll-123",
    });
    assert.equal(frame.traceId, "trace-abc");
    assert.equal(frame.replayId, "replay-xyz");
    assert.equal(frame.rollbackId, "roll-123");
  });

  it("includes cause when provided", () => {
    const bits: SignalBits = {
      intentClear: true,
      policyRisk: false,
      toolRequired: false,
      memoryRequired: false,
      freshnessRequired: false,
      mutationPossible: false,
      approvalRequired: false,
      replayRollbackContext: false,
    };
    const frame = createSignalFrame({
      bits,
      domain: "task",
      intent: "with-cause",
      cause: "user-request",
    });
    assert.equal(frame.cause, "user-request");
  });
});

/* ------------------------------------------------------------------ */
/*  Domain-specific constraint / taboo generation                      */
/* ------------------------------------------------------------------ */

describe("constraints and taboos defaults", () => {
  it('ibi polarity includes require_approval and require_policy_check constraints', () => {
    const bits: SignalBits = {
      intentClear: false,
      policyRisk: true,
      toolRequired: false,
      memoryRequired: false,
      freshnessRequired: false,
      mutationPossible: true,
      approvalRequired: true,
      replayRollbackContext: false,
    };
    const frame = createSignalFrame({ bits, domain: "policy", intent: "dangerous" });
    assert.ok(frame.constraints.includes("require_approval"));
    assert.ok(frame.constraints.includes("require_policy_check"));
  });

  it('ire polarity includes proceed_with_confidence constraint', () => {
    const bits: SignalBits = {
      intentClear: true,
      policyRisk: false,
      toolRequired: false,
      memoryRequired: false,
      freshnessRequired: false,
      mutationPossible: false,
      approvalRequired: false,
      replayRollbackContext: false,
    };
    const frame = createSignalFrame({ bits, domain: "task", intent: "safe" });
    assert.ok(frame.constraints.includes("proceed_with_confidence"));
  });

  it('replay domain taboos includes no_side_effects_without_approval', () => {
    const bits: SignalBits = {
      intentClear: true,
      policyRisk: false,
      toolRequired: false,
      memoryRequired: false,
      freshnessRequired: false,
      mutationPossible: false,
      approvalRequired: false,
      replayRollbackContext: true,
    };
    const frame = createSignalFrame({ bits, domain: "replay", intent: "replay-test" });
    assert.ok(frame.taboos.includes("no_side_effects_without_approval"));
  });

  it('rollback domain taboos includes no_side_effects_without_approval', () => {
    const bits: SignalBits = {
      intentClear: true,
      policyRisk: false,
      toolRequired: false,
      memoryRequired: false,
      freshnessRequired: false,
      mutationPossible: false,
      approvalRequired: false,
      replayRollbackContext: true,
    };
    const frame = createSignalFrame({ bits, domain: "rollback", intent: "rollback-test" });
    assert.ok(frame.taboos.includes("no_side_effects_without_approval"));
  });

  it('chronicle domain taboos includes no_mutation', () => {
    const bits: SignalBits = {
      intentClear: true,
      policyRisk: false,
      toolRequired: false,
      memoryRequired: false,
      freshnessRequired: false,
      mutationPossible: false,
      approvalRequired: false,
      replayRollbackContext: false,
    };
    const frame = createSignalFrame({ bits, domain: "chronicle", intent: "chronicle-test" });
    assert.ok(frame.taboos.includes("no_mutation"));
  });

  it('research domain taboos includes no_mutation', () => {
    const bits: SignalBits = {
      intentClear: true,
      policyRisk: false,
      toolRequired: false,
      memoryRequired: false,
      freshnessRequired: false,
      mutationPossible: false,
      approvalRequired: false,
      replayRollbackContext: false,
    };
    const frame = createSignalFrame({ bits, domain: "research", intent: "research-test" });
    assert.ok(frame.taboos.includes("no_mutation"));
  });
});
