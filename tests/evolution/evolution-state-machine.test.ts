/**
 * Tests for A0.2 — Evolution Lifecycle State Machine.
 *
 * Covers full transition matrix, terminal immutability, error paths,
 * history ordering, event correctness, and isolation.
 *
 * @module
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EvolutionStateMachine,
  IllegalEvolutionTransitionError,
  UnknownEvolutionError,
  DuplicateEvolutionError,
  type EvolutionTransitionEvent,
} from "../../src/evolution/evolution-state-machine.js";
import { EvolutionState } from "../../src/evolution/contracts/evolution-contract.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMachine(): EvolutionStateMachine {
  return new EvolutionStateMachine();
}

/**
 * Advance an evolution through the given transition path.
 */
function advanceThrough(
  machine: EvolutionStateMachine,
  evolutionId: string,
  path: EvolutionState[],
): void {
  for (const state of path) {
    machine.transition(evolutionId, state);
  }
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

describe("createEvolution", () => {
  it("registers an evolution in DRAFT by default", () => {
    const m = makeMachine();
    m.createEvolution("evol-001");
    assert.equal(m.getStatus("evol-001"), EvolutionState.DRAFT);
  });

  it("accepts a custom initial state", () => {
    const m = makeMachine();
    m.createEvolution("evol-002", EvolutionState.PROPOSED);
    assert.equal(m.getStatus("evol-002"), EvolutionState.PROPOSED);
  });

  it("throws DuplicateEvolutionError on duplicate id", () => {
    const m = makeMachine();
    m.createEvolution("evol-003");
    assert.throws(() => m.createEvolution("evol-003"), DuplicateEvolutionError);
  });

  it("creates an initial Drafted event in history", () => {
    const m = makeMachine();
    m.createEvolution("evol-004");
    const history = m.getHistory("evol-004");
    assert.equal(history.length, 1);
    assert.equal(history[0].eventType, "EvolutionDrafted");
    assert.equal(history[0].from, EvolutionState.DRAFT);
    assert.equal(history[0].to, EvolutionState.DRAFT);
  });
});

// ---------------------------------------------------------------------------
// Valid transitions
// ---------------------------------------------------------------------------

describe("valid transitions", () => {
  it("DRAFT → PROPOSED", () => {
    const m = makeMachine();
    m.createEvolution("t1");
    const result = m.transition("t1", EvolutionState.PROPOSED);
    assert.equal(result.current, EvolutionState.PROPOSED);
    assert.equal(result.previous, EvolutionState.DRAFT);
    assert.equal(m.getStatus("t1"), EvolutionState.PROPOSED);
  });

  it("DRAFT → WITHDRAWN", () => {
    const m = makeMachine();
    m.createEvolution("t2");
    m.transition("t2", EvolutionState.WITHDRAWN);
    assert.equal(m.getStatus("t2"), EvolutionState.WITHDRAWN);
  });

  it("PROPOSED → UNDER_REVIEW", () => {
    const m = makeMachine();
    m.createEvolution("t3");
    m.transition("t3", EvolutionState.PROPOSED);
    m.transition("t3", EvolutionState.UNDER_REVIEW);
    assert.equal(m.getStatus("t3"), EvolutionState.UNDER_REVIEW);
  });

  it("PROPOSED → REJECTED", () => {
    const m = makeMachine();
    m.createEvolution("t4");
    m.transition("t4", EvolutionState.PROPOSED);
    m.transition("t4", EvolutionState.REJECTED);
    assert.equal(m.getStatus("t4"), EvolutionState.REJECTED);
  });

  it("UNDER_REVIEW → APPROVED", () => {
    const m = makeMachine();
    m.createEvolution("t5");
    advanceThrough(m, "t5", [EvolutionState.PROPOSED, EvolutionState.UNDER_REVIEW]);
    m.transition("t5", EvolutionState.APPROVED);
    assert.equal(m.getStatus("t5"), EvolutionState.APPROVED);
  });

  it("UNDER_REVIEW → REJECTED", () => {
    const m = makeMachine();
    m.createEvolution("t6");
    advanceThrough(m, "t6", [EvolutionState.PROPOSED, EvolutionState.UNDER_REVIEW]);
    m.transition("t6", EvolutionState.REJECTED);
    assert.equal(m.getStatus("t6"), EvolutionState.REJECTED);
  });

  it("UNDER_REVIEW → WITHDRAWN", () => {
    const m = makeMachine();
    m.createEvolution("t7");
    advanceThrough(m, "t7", [EvolutionState.PROPOSED, EvolutionState.UNDER_REVIEW]);
    m.transition("t7", EvolutionState.WITHDRAWN);
    assert.equal(m.getStatus("t7"), EvolutionState.WITHDRAWN);
  });

  it("APPROVED → IMPLEMENTING", () => {
    const m = makeMachine();
    m.createEvolution("t8");
    advanceThrough(m, "t8", [EvolutionState.PROPOSED, EvolutionState.UNDER_REVIEW, EvolutionState.APPROVED]);
    m.transition("t8", EvolutionState.IMPLEMENTING);
    assert.equal(m.getStatus("t8"), EvolutionState.IMPLEMENTING);
  });

  it("APPROVED → REJECTED (approval revocation)", () => {
    const m = makeMachine();
    m.createEvolution("t9");
    advanceThrough(m, "t9", [EvolutionState.PROPOSED, EvolutionState.UNDER_REVIEW, EvolutionState.APPROVED]);
    m.transition("t9", EvolutionState.REJECTED);
    assert.equal(m.getStatus("t9"), EvolutionState.REJECTED);
  });

  it("IMPLEMENTING → VALIDATING", () => {
    const m = makeMachine();
    m.createEvolution("t10");
    advanceThrough(m, "t10", [
      EvolutionState.PROPOSED, EvolutionState.UNDER_REVIEW,
      EvolutionState.APPROVED, EvolutionState.IMPLEMENTING,
    ]);
    m.transition("t10", EvolutionState.VALIDATING);
    assert.equal(m.getStatus("t10"), EvolutionState.VALIDATING);
  });

  it("IMPLEMENTING → FAILED_VALIDATION", () => {
    const m = makeMachine();
    m.createEvolution("t11");
    advanceThrough(m, "t11", [
      EvolutionState.PROPOSED, EvolutionState.UNDER_REVIEW,
      EvolutionState.APPROVED, EvolutionState.IMPLEMENTING,
    ]);
    m.transition("t11", EvolutionState.FAILED_VALIDATION);
    assert.equal(m.getStatus("t11"), EvolutionState.FAILED_VALIDATION);
  });

  it("VALIDATING → ACTIVE", () => {
    const m = makeMachine();
    m.createEvolution("t12");
    advanceThrough(m, "t12", [
      EvolutionState.PROPOSED, EvolutionState.UNDER_REVIEW,
      EvolutionState.APPROVED, EvolutionState.IMPLEMENTING,
      EvolutionState.VALIDATING,
    ]);
    m.transition("t12", EvolutionState.ACTIVE);
    assert.equal(m.getStatus("t12"), EvolutionState.ACTIVE);
  });

  it("VALIDATING → FAILED_VALIDATION", () => {
    const m = makeMachine();
    m.createEvolution("t13");
    advanceThrough(m, "t13", [
      EvolutionState.PROPOSED, EvolutionState.UNDER_REVIEW,
      EvolutionState.APPROVED, EvolutionState.IMPLEMENTING,
      EvolutionState.VALIDATING,
    ]);
    m.transition("t13", EvolutionState.FAILED_VALIDATION);
    assert.equal(m.getStatus("t13"), EvolutionState.FAILED_VALIDATION);
  });

  it("FAILED_VALIDATION → ROLLED_BACK", () => {
    const m = makeMachine();
    m.createEvolution("t14");
    advanceThrough(m, "t14", [
      EvolutionState.PROPOSED, EvolutionState.UNDER_REVIEW,
      EvolutionState.APPROVED, EvolutionState.IMPLEMENTING,
      EvolutionState.VALIDATING, EvolutionState.FAILED_VALIDATION,
    ]);
    m.transition("t14", EvolutionState.ROLLED_BACK);
    assert.equal(m.getStatus("t14"), EvolutionState.ROLLED_BACK);
  });

  it("FAILED_VALIDATION → ACTIVE (override)", () => {
    const m = makeMachine();
    m.createEvolution("t15");
    advanceThrough(m, "t15", [
      EvolutionState.PROPOSED, EvolutionState.UNDER_REVIEW,
      EvolutionState.APPROVED, EvolutionState.IMPLEMENTING,
      EvolutionState.VALIDATING, EvolutionState.FAILED_VALIDATION,
    ]);
    m.transition("t15", EvolutionState.ACTIVE);
    assert.equal(m.getStatus("t15"), EvolutionState.ACTIVE);
  });
});

// ---------------------------------------------------------------------------
// Invalid transitions
// ---------------------------------------------------------------------------

describe("invalid transitions", () => {
  it("DRAFT → UNDER_REVIEW rejected", () => {
    const m = makeMachine();
    m.createEvolution("i1");
    assert.throws(
      () => m.transition("i1", EvolutionState.UNDER_REVIEW),
      IllegalEvolutionTransitionError,
    );
  });

  it("DRAFT → ACTIVE rejected", () => {
    const m = makeMachine();
    m.createEvolution("i2");
    assert.throws(
      () => m.transition("i2", EvolutionState.ACTIVE),
      IllegalEvolutionTransitionError,
    );
  });

  it("PROPOSED → DRAFT rejected (reverse)", () => {
    const m = makeMachine();
    m.createEvolution("i3");
    m.transition("i3", EvolutionState.PROPOSED);
    assert.throws(
      () => m.transition("i3", EvolutionState.DRAFT),
      IllegalEvolutionTransitionError,
    );
  });

  it("UNDER_REVIEW → IMPLEMENTING rejected", () => {
    const m = makeMachine();
    m.createEvolution("i4");
    advanceThrough(m, "i4", [EvolutionState.PROPOSED, EvolutionState.UNDER_REVIEW]);
    assert.throws(
      () => m.transition("i4", EvolutionState.IMPLEMENTING),
      IllegalEvolutionTransitionError,
    );
  });
});

// ---------------------------------------------------------------------------
// Terminal state immutability
// ---------------------------------------------------------------------------

describe("terminal state immutability", () => {
  const terminals = [
    EvolutionState.ACTIVE,
    EvolutionState.REJECTED,
    EvolutionState.WITHDRAWN,
    EvolutionState.ROLLED_BACK,
  ];

  const targets = [
    EvolutionState.DRAFT,
    EvolutionState.PROPOSED,
    EvolutionState.UNDER_REVIEW,
    EvolutionState.APPROVED,
  ];

  for (const terminal of terminals) {
    for (const target of targets) {
      it(`${terminal} → ${target} rejected`, () => {
        const m = makeMachine();

        // Build the full happy path to ACTIVE, then go to the terminal
        if (terminal === EvolutionState.ACTIVE) {
          m.createEvolution("t");
          advanceThrough(m, "t", [
            EvolutionState.PROPOSED, EvolutionState.UNDER_REVIEW,
            EvolutionState.APPROVED, EvolutionState.IMPLEMENTING,
            EvolutionState.VALIDATING, EvolutionState.ACTIVE,
          ]);
        } else if (terminal === EvolutionState.REJECTED) {
          m.createEvolution("t");
          m.transition("t", EvolutionState.PROPOSED);
          m.transition("t", EvolutionState.REJECTED);
        } else if (terminal === EvolutionState.WITHDRAWN) {
          m.createEvolution("t");
          m.transition("t", EvolutionState.WITHDRAWN);
        } else if (terminal === EvolutionState.ROLLED_BACK) {
          m.createEvolution("t");
          advanceThrough(m, "t", [
            EvolutionState.PROPOSED, EvolutionState.UNDER_REVIEW,
            EvolutionState.APPROVED, EvolutionState.IMPLEMENTING,
            EvolutionState.VALIDATING, EvolutionState.FAILED_VALIDATION,
            EvolutionState.ROLLED_BACK,
          ]);
        }

        assert.throws(
          () => m.transition("t", target),
          IllegalEvolutionTransitionError,
        );
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe("error paths", () => {
  it("throws UnknownEvolutionError for unknown id", () => {
    const m = makeMachine();
    assert.throws(() => m.getStatus("nonexistent"), UnknownEvolutionError);
    assert.throws(() => m.getHistory("nonexistent"), UnknownEvolutionError);
    assert.throws(
      () => m.transition("nonexistent", EvolutionState.PROPOSED),
      UnknownEvolutionError,
    );
  });

  it("throws DuplicateEvolutionError on duplicate", () => {
    const m = makeMachine();
    m.createEvolution("dup");
    assert.throws(() => m.createEvolution("dup"), DuplicateEvolutionError);
  });

  it("IllegalEvolutionTransitionError carries metadata", () => {
    const m = makeMachine();
    m.createEvolution("meta");
    try {
      m.transition("meta", EvolutionState.ACTIVE);
      assert.fail("should have thrown");
    } catch (e) {
      assert.ok(e instanceof IllegalEvolutionTransitionError);
      const err = e as IllegalEvolutionTransitionError;
      assert.equal(err.evolutionId, "meta");
      assert.equal(err.currentState, EvolutionState.DRAFT);
      assert.equal(err.requestedState, EvolutionState.ACTIVE);
    }
  });
});

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

describe("history", () => {
  it("records events in chronological order", () => {
    const m = makeMachine();
    m.createEvolution("hist");
    m.transition("hist", EvolutionState.PROPOSED);
    m.transition("hist", EvolutionState.UNDER_REVIEW);

    const history = m.getHistory("hist");
    assert.equal(history.length, 3); // Drafted + Proposed + SentForReview
    assert.equal(history[0].eventType, "EvolutionDrafted");
    assert.equal(history[1].eventType, "EvolutionProposed");
    assert.equal(history[2].eventType, "EvolutionSentForReview");
  });

  it("failed transition does not append to history", () => {
    const m = makeMachine();
    m.createEvolution("hist-fail");
    const before = m.getHistory("hist-fail").length;

    assert.throws(
      () => m.transition("hist-fail", EvolutionState.ACTIVE),
      IllegalEvolutionTransitionError,
    );

    const after = m.getHistory("hist-fail").length;
    assert.equal(after, before);
  });

  it("failed transition does not change state", () => {
    const m = makeMachine();
    m.createEvolution("hist-state");
    assert.equal(m.getStatus("hist-state"), EvolutionState.DRAFT);

    assert.throws(
      () => m.transition("hist-state", EvolutionState.ACTIVE),
      IllegalEvolutionTransitionError,
    );

    assert.equal(m.getStatus("hist-state"), EvolutionState.DRAFT);
  });

  it("getHistory returns a copy (immutability)", () => {
    const m = makeMachine();
    m.createEvolution("copy");
    const history = m.getHistory("copy");
    history.push({} as EvolutionTransitionEvent);
    // Original should not be affected
    assert.equal(m.getHistory("copy").length, 1);
  });
});

// ---------------------------------------------------------------------------
// Transition result
// ---------------------------------------------------------------------------

describe("transition result", () => {
  it("contains previous, current, and event", () => {
    const m = makeMachine();
    m.createEvolution("res");
    const result = m.transition("res", EvolutionState.PROPOSED);

    assert.equal(result.previous, EvolutionState.DRAFT);
    assert.equal(result.current, EvolutionState.PROPOSED);
    assert.ok(result.event);
    assert.equal(result.event.eventType, "EvolutionProposed");
    assert.equal(result.event.evolutionId, "res");
    assert.equal(result.event.from, EvolutionState.DRAFT);
    assert.equal(result.event.to, EvolutionState.PROPOSED);
  });

  it("event contains summary text", () => {
    const m = makeMachine();
    m.createEvolution("sum");
    const result = m.transition("sum", EvolutionState.PROPOSED);
    assert.ok(result.event.summary.includes("EvolutionProposed"));
  });
});

// ---------------------------------------------------------------------------
// Isolation
// ---------------------------------------------------------------------------

describe("isolation", () => {
  it("multiple evolutions coexist independently", () => {
    const m = makeMachine();

    m.createEvolution("alpha");
    m.createEvolution("beta");

    m.transition("alpha", EvolutionState.PROPOSED);
    m.transition("alpha", EvolutionState.UNDER_REVIEW);

    m.transition("beta", EvolutionState.PROPOSED);

    assert.equal(m.getStatus("alpha"), EvolutionState.UNDER_REVIEW);
    assert.equal(m.getStatus("beta"), EvolutionState.PROPOSED);
    assert.equal(m.getHistory("alpha").length, 3);
    assert.equal(m.getHistory("beta").length, 2);
  });
});

// ---------------------------------------------------------------------------
// Repeated transition
// ---------------------------------------------------------------------------

describe("repeat transition", () => {
  it("DRAFT → PROPOSED called twice fails on second call", () => {
    const m = makeMachine();
    m.createEvolution("rpt");
    m.transition("rpt", EvolutionState.PROPOSED);

    assert.throws(
      () => m.transition("rpt", EvolutionState.PROPOSED), // PROPOSED → PROPOSED not in allowed
      IllegalEvolutionTransitionError,
    );
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("createEvolution with WITHDRAWN initial state", () => {
    // Edge case: starting directly in a terminal state
    const m = makeMachine();
    m.createEvolution("edge-term", EvolutionState.WITHDRAWN);
    assert.equal(m.getStatus("edge-term"), EvolutionState.WITHDRAWN);
    // Should be immutable
    assert.throws(() => m.transition("edge-term", EvolutionState.DRAFT));
  });
});
