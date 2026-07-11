/**
 * Tests for A0.3 — Evolution Evidence Bridge.
 *
 * Covers outcome mapping, translation function, bridge emission,
 * metadata preservation, and edge cases.
 *
 * @module
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evolutionStateToOutcome,
  evolutionEventToEvidence,
  EvolutionEvidenceBridge,
} from "../../src/evolution/evolution-evidence-bridge.js";
import { EvolutionState } from "../../src/evolution/contracts/evolution-contract.js";
import type { EvolutionTransitionEvent } from "../../src/evolution/evolution-state-machine.js";
import type { ExecutionEvidence } from "../../src/runtime/contracts/execution-intent-contract.js";
import type { ExecutionEvidenceEmitter, ExecutionEventType } from "../../src/runtime/contracts/execution-runtime-contract.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const T = "2026-07-11T12:00:00.000Z";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<EvolutionTransitionEvent> = {}): EvolutionTransitionEvent {
  return {
    evolutionId: "evol-test-001",
    from: EvolutionState.DRAFT,
    to: EvolutionState.PROPOSED,
    eventType: "EvolutionProposed",
    timestamp: T,
    summary: "Evolution EvolutionProposed: DRAFT → PROPOSED",
    ...overrides,
  };
}

class CapturingEmitter implements ExecutionEvidenceEmitter {
  readonly emitted: Array<{ eventType: ExecutionEventType; evidence: ExecutionEvidence }> = [];

  emit(eventType: ExecutionEventType, evidence: ExecutionEvidence): void {
    this.emitted.push({ eventType, evidence });
  }
}

// ---------------------------------------------------------------------------
// Outcome Mapping
// ---------------------------------------------------------------------------

describe("evolutionStateToOutcome", () => {
  it("ACTIVE → SUCCESS", () => {
    assert.equal(evolutionStateToOutcome(EvolutionState.ACTIVE), "SUCCESS");
  });

  it("REJECTED → FAILED", () => {
    assert.equal(evolutionStateToOutcome(EvolutionState.REJECTED), "FAILED");
  });

  it("WITHDRAWN → FAILED", () => {
    assert.equal(evolutionStateToOutcome(EvolutionState.WITHDRAWN), "FAILED");
  });

  it("ROLLED_BACK → FAILED", () => {
    assert.equal(evolutionStateToOutcome(EvolutionState.ROLLED_BACK), "FAILED");
  });

  it("FAILED_VALIDATION → FAILED", () => {
    assert.equal(evolutionStateToOutcome(EvolutionState.FAILED_VALIDATION), "FAILED");
  });

  it("DRAFT → PARTIAL", () => {
    assert.equal(evolutionStateToOutcome(EvolutionState.DRAFT), "PARTIAL");
  });

  it("PROPOSED → PARTIAL", () => {
    assert.equal(evolutionStateToOutcome(EvolutionState.PROPOSED), "PARTIAL");
  });

  it("UNDER_REVIEW → PARTIAL", () => {
    assert.equal(evolutionStateToOutcome(EvolutionState.UNDER_REVIEW), "PARTIAL");
  });

  it("APPROVED → PARTIAL", () => {
    assert.equal(evolutionStateToOutcome(EvolutionState.APPROVED), "PARTIAL");
  });

  it("IMPLEMENTING → PARTIAL", () => {
    assert.equal(evolutionStateToOutcome(EvolutionState.IMPLEMENTING), "PARTIAL");
  });

  it("VALIDATING → PARTIAL", () => {
    assert.equal(evolutionStateToOutcome(EvolutionState.VALIDATING), "PARTIAL");
  });

  it("unknown future state → PARTIAL", () => {
    assert.equal(evolutionStateToOutcome("unknown_future_state"), "PARTIAL");
  });
});

// ---------------------------------------------------------------------------
// Translation Function
// ---------------------------------------------------------------------------

describe("evolutionEventToEvidence", () => {
  it("maps ACTIVE event correctly", () => {
    const event = makeEvent({ to: EvolutionState.ACTIVE, eventType: "EvolutionActivated" });
    const evidence = evolutionEventToEvidence(event);

    assert.equal(evidence.outcome, "SUCCESS");
    assert.equal(evidence.verificationPassed, true);
    assert.equal(evidence.intentId, "evol-test-001");
  });

  it("maps REJECTED event correctly", () => {
    const event = makeEvent({ to: EvolutionState.REJECTED, eventType: "EvolutionRejected" });
    const evidence = evolutionEventToEvidence(event);

    assert.equal(evidence.outcome, "FAILED");
    assert.equal(evidence.verificationPassed, false);
  });

  it("maps FAILED_VALIDATION event correctly", () => {
    const event = makeEvent({ to: EvolutionState.FAILED_VALIDATION, eventType: "EvolutionFailedValidation" });
    const evidence = evolutionEventToEvidence(event);

    assert.equal(evidence.outcome, "FAILED");
    assert.equal(evidence.verificationPassed, false);
  });

  it("maps DRAFT event → PARTIAL", () => {
    const event = makeEvent({ to: EvolutionState.DRAFT, eventType: "EvolutionDrafted" });
    const evidence = evolutionEventToEvidence(event);

    assert.equal(evidence.outcome, "PARTIAL");
    assert.equal(evidence.verificationPassed, false);
  });

  it("maps PROPOSED event → PARTIAL", () => {
    const event = makeEvent({ to: EvolutionState.PROPOSED, eventType: "EvolutionProposed" });
    const evidence = evolutionEventToEvidence(event);

    assert.equal(evidence.outcome, "PARTIAL");
    assert.equal(evidence.verificationPassed, false);
  });

  it("intentId matches evolutionId", () => {
    const event = makeEvent({ evolutionId: "evol-custom-id" });
    const evidence = evolutionEventToEvidence(event);

    assert.equal(evidence.intentId, "evol-custom-id");
  });

  it("timestamp preserved from event", () => {
    const event = makeEvent({ timestamp: "2026-07-11T08:00:00.000Z" });
    const evidence = evolutionEventToEvidence(event);

    assert.equal(evidence.startedAt, "2026-07-11T08:00:00.000Z");
    assert.equal(evidence.completedAt, "2026-07-11T08:00:00.000Z");
  });

  it("summary preserved exactly", () => {
    const event = makeEvent({ summary: "Custom summary text" });
    const evidence = evolutionEventToEvidence(event);

    assert.equal(evidence.summary, "Custom summary text");
  });

  it("artifacts initialized to empty array", () => {
    const event = makeEvent();
    const evidence = evolutionEventToEvidence(event);

    assert.deepEqual(evidence.artifacts, []);
  });

  it("evidenceHash initialized to empty string", () => {
    const event = makeEvent();
    const evidence = evolutionEventToEvidence(event);

    assert.equal(evidence.evidenceHash, "");
  });

  it("evidenceId override respected", () => {
    const event = makeEvent();
    const evidence = evolutionEventToEvidence(event, { evidenceId: "custom-evid-001" });

    assert.equal(evidence.evidenceId, "custom-evid-001");
  });

  it("generated evidenceId has correct prefix", () => {
    const event = makeEvent();
    const evidence = evolutionEventToEvidence(event);

    assert.ok(evidence.evidenceId.startsWith("evoe-"));
    assert.ok(evidence.evidenceId.length > 5);
  });

  it("does not mutate the input event (purity)", () => {
    const event = makeEvent();
    const frozen = { ...event };
    evolutionEventToEvidence(event);

    assert.deepEqual(event, frozen);
  });
});

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

describe("EvolutionEvidenceBridge", () => {
  it("emits translated evidence", () => {
    const emitter = new CapturingEmitter();
    const bridge = new EvolutionEvidenceBridge(emitter);

    const event = makeEvent({ to: EvolutionState.ACTIVE, eventType: "EvolutionActivated" });
    bridge.emitTransitionEvent(event);

    assert.equal(emitter.emitted.length, 1);
    assert.equal(emitter.emitted[0].evidence.outcome, "SUCCESS");
    assert.equal(emitter.emitted[0].evidence.intentId, "evol-test-001");
  });

  it("emitted evidence matches translator output", () => {
    const emitter = new CapturingEmitter();
    const bridge = new EvolutionEvidenceBridge(emitter);

    const event = makeEvent({ to: EvolutionState.ACTIVE, eventType: "EvolutionActivated" });
    bridge.emitTransitionEvent(event);

    const expected = evolutionEventToEvidence(event);
    const emitted = emitter.emitted[0].evidence;

    // Compare all fields except evidenceId (which is generated on each call)
    assert.equal(emitted.outcome, expected.outcome);
    assert.equal(emitted.intentId, expected.intentId);
    assert.equal(emitted.summary, expected.summary);
    assert.equal(emitted.verificationPassed, expected.verificationPassed);
    assert.equal(emitted.evidenceHash, expected.evidenceHash);
    assert.deepEqual(emitted.artifacts, expected.artifacts);
  });

  it("handles REJECTED event through bridge", () => {
    const emitter = new CapturingEmitter();
    const bridge = new EvolutionEvidenceBridge(emitter);

    const event = makeEvent({ to: EvolutionState.REJECTED, eventType: "EvolutionRejected" });
    bridge.emitTransitionEvent(event);

    assert.equal(emitter.emitted[0].evidence.outcome, "FAILED");
  });

  it("handles DRAFT → PROPOSED event through bridge", () => {
    const emitter = new CapturingEmitter();
    const bridge = new EvolutionEvidenceBridge(emitter);

    const event = makeEvent({
      from: EvolutionState.DRAFT,
      to: EvolutionState.PROPOSED,
      eventType: "EvolutionProposed",
    });
    bridge.emitTransitionEvent(event);

    assert.equal(emitter.emitted[0].evidence.outcome, "PARTIAL");
    assert.equal(emitter.emitted[0].evidence.verificationPassed, false);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("empty evolutionId still produces valid evidence", () => {
    const event = makeEvent({ evolutionId: "" });
    const evidence = evolutionEventToEvidence(event);

    assert.equal(evidence.intentId, "");
    assert.ok(evidence.evidenceId);
  });

  it("empty timestamp still produces valid evidence", () => {
    const event = makeEvent({ timestamp: "" });
    const evidence = evolutionEventToEvidence(event);

    assert.equal(evidence.startedAt, "");
    assert.equal(evidence.completedAt, "");
  });

  it("bridge handles multiple events", () => {
    const emitter = new CapturingEmitter();
    const bridge = new EvolutionEvidenceBridge(emitter);

    bridge.emitTransitionEvent(makeEvent({ to: EvolutionState.PROPOSED }));
    bridge.emitTransitionEvent(makeEvent({ to: EvolutionState.UNDER_REVIEW }));
    bridge.emitTransitionEvent(makeEvent({ to: EvolutionState.APPROVED }));

    assert.equal(emitter.emitted.length, 3);
    assert.equal(emitter.emitted[0].evidence.outcome, "PARTIAL");
    assert.equal(emitter.emitted[1].evidence.outcome, "PARTIAL");
    assert.equal(emitter.emitted[2].evidence.outcome, "PARTIAL");
  });
});
