import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { transitionRemediationState, InvalidTransitionError } from "../../src/governance/remediation-lifecycle.js";

const NOW = "2026-07-07T14:00:00.000Z";

describe("transitionRemediationState", () => {
  it("open → accepted — valid", () => {
    const r = transitionRemediationState("open", "accepted", { now: NOW });
    assert.equal(r.newState, "accepted");
    assert.equal(r.transitionedAt, NOW);
  });

  it("open → dismissed — valid", () => {
    assert.equal(transitionRemediationState("open", "dismissed", { now: NOW }).newState, "dismissed");
  });

  it("open → superseded — valid", () => {
    assert.equal(transitionRemediationState("open", "superseded", { now: NOW }).newState, "superseded");
  });

  it("accepted → resolved — valid", () => {
    assert.equal(transitionRemediationState("accepted", "resolved", { now: NOW }).newState, "resolved");
  });

  it("accepted → superseded — valid", () => {
    assert.equal(transitionRemediationState("accepted", "superseded", { now: NOW }).newState, "superseded");
  });

  it("dismissed → accepted — invalid (terminal)", () => {
    assert.throws(() => transitionRemediationState("dismissed", "accepted"), InvalidTransitionError);
  });

  it("resolved → accepted — invalid (terminal)", () => {
    assert.throws(() => transitionRemediationState("resolved", "accepted"), InvalidTransitionError);
  });

  it("superseded → resolved — invalid (terminal)", () => {
    assert.throws(() => transitionRemediationState("superseded", "resolved"), InvalidTransitionError);
  });

  it("accepted → dismissed — invalid (not allowed)", () => {
    assert.throws(() => transitionRemediationState("accepted", "dismissed"), InvalidTransitionError);
  });

  it("open → resolved — invalid (skips accepted)", () => {
    assert.throws(() => transitionRemediationState("open", "resolved"), InvalidTransitionError);
  });

  it("error message includes current and target", () => {
    try {
      transitionRemediationState("open", "resolved");
      assert.fail("should have thrown");
    } catch (e) {
      assert.ok(e instanceof InvalidTransitionError);
      assert.ok(e.message.includes("open"));
      assert.ok(e.message.includes("resolved"));
    }
  });
});
