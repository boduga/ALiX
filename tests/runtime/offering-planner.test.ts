import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { prescribeOffering } from "../../src/runtime/offering-planner.js";
import type { SignalFrame, SignalBits, SignalDomain } from "../../src/runtime/signal-frame.js";
import { createSignalFrame } from "../../src/runtime/signal-frame.js";

/* ------------------------------------------------------------------ */
/*  Helper                                                             */
/* ------------------------------------------------------------------ */

/**
 * Build a `SignalFrame` with the given bits (merged over all-false
 * defaults) and domain.  Uses the shared `createSignalFrame` factory so
 * constraints, taboos, and polarity are realistic.
 */
function makeSignal(opts: {
  bits?: Partial<SignalBits>;
  domain?: SignalDomain;
}): SignalFrame {
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
    bits: { ...defaultBits, ...opts.bits },
    domain: opts.domain ?? "task",
    intent: "test",
  });
}

/* ------------------------------------------------------------------ */
/*  Action mapping                                                     */
/* ------------------------------------------------------------------ */

describe("prescribeOffering", () => {
  it("policyRisk + approvalRequired → ask_approval", () => {
    const signal = makeSignal({
      bits: { policyRisk: true, approvalRequired: true },
    });
    const plan = prescribeOffering(signal);

    assert.equal(plan.action, "ask_approval");
    assert.deepEqual(plan.requiredEvidence, [
      "policy_decision",
      "approval_status",
    ]);
    assert.deepEqual(plan.successCriteria, ["approval_granted"]);
  });

  it("mutationPossible + replayRollbackContext → rollback_preview", () => {
    const signal = makeSignal({
      bits: { mutationPossible: true, replayRollbackContext: true },
    });
    const plan = prescribeOffering(signal);

    assert.equal(plan.action, "rollback_preview");
    assert.deepEqual(plan.requiredEvidence, ["replay_diff", "rollback_plan"]);
    assert.deepEqual(plan.successCriteria, [
      "diff_generated",
      "plan_reviewed",
    ]);
  });

  it("memoryRequired → fetch_memory", () => {
    const signal = makeSignal({ bits: { memoryRequired: true } });
    const plan = prescribeOffering(signal);

    assert.equal(plan.action, "fetch_memory");
    assert.deepEqual(plan.requiredEvidence, ["memory_index", "session_context"]);
    assert.deepEqual(plan.successCriteria, ["memory_loaded"]);
  });

  it("freshnessRequired → run_policy_check", () => {
    const signal = makeSignal({ bits: { freshnessRequired: true } });
    const plan = prescribeOffering(signal);

    assert.equal(plan.action, "run_policy_check");
    assert.deepEqual(plan.requiredEvidence, ["current_state", "policy_rules"]);
    assert.deepEqual(plan.successCriteria, ["policy_verified"]);
  });

  it("toolRequired + policyRisk → pause", () => {
    const signal = makeSignal({
      bits: { toolRequired: true, policyRisk: true },
    });
    const plan = prescribeOffering(signal);

    assert.equal(plan.action, "pause");
    assert.deepEqual(plan.requiredEvidence, ["tool_listing", "policy_decision"]);
    assert.deepEqual(plan.successCriteria, ["tool_reviewed", "risk_assessed"]);
  });

  it("domain=rollback → rollback_preview", () => {
    const signal = makeSignal({ bits: {}, domain: "rollback" });
    const plan = prescribeOffering(signal);

    assert.equal(plan.action, "rollback_preview");
    assert.deepEqual(plan.requiredEvidence, ["replay_diff", "rollback_plan"]);
    // rollback rule has single-element success criteria
    assert.deepEqual(plan.successCriteria, ["diff_generated"]);
  });

  it("domain=replay → replay_preview", () => {
    const signal = makeSignal({ bits: {}, domain: "replay" });
    const plan = prescribeOffering(signal);

    assert.equal(plan.action, "replay_preview");
    assert.deepEqual(plan.requiredEvidence, ["trace_events", "replay_plan"]);
    assert.deepEqual(plan.successCriteria, ["preview_generated"]);
  });

  it("domain=research → proceed", () => {
    const signal = makeSignal({ bits: {}, domain: "research" });
    const plan = prescribeOffering(signal);

    assert.equal(plan.action, "proceed");
    assert.deepEqual(plan.requiredEvidence, []);
    assert.deepEqual(plan.successCriteria, ["research_completed"]);
  });

  it("no flags matched → proceed (default)", () => {
    const signal = makeSignal({ bits: {}, domain: "task" });
    const plan = prescribeOffering(signal);

    assert.equal(plan.action, "proceed");
    assert.deepEqual(plan.requiredEvidence, []);
    assert.deepEqual(plan.successCriteria, ["execution_completed"]);
  });

  /* ---------------------------------------------------------------- */
  /*  Rule priority                                                    */
  /* ---------------------------------------------------------------- */

  it("policyRisk+approvalRequired beats domain=replay when both match", () => {
    const signal = makeSignal({
      bits: { policyRisk: true, approvalRequired: true },
      domain: "replay",
    });
    const plan = prescribeOffering(signal);

    // The bit-based rule fires before the domain-based re-play rule
    assert.equal(plan.action, "ask_approval");
  });

  it("domain matches override generic proceed", () => {
    // No bit-based rules match, but domain=research should use the
    // research-specific criteria, not the generic default.
    const signal = makeSignal({
      bits: { intentClear: true },
      domain: "research",
    });
    const plan = prescribeOffering(signal);

    assert.equal(plan.action, "proceed");
    assert.deepEqual(plan.successCriteria, ["research_completed"]);
  });

  /* ---------------------------------------------------------------- */
  /*  Metadata passthrough                                             */
  /* ---------------------------------------------------------------- */

  it("includes signalId from input SignalFrame", () => {
    const signal = makeSignal({ bits: {} });
    const plan = prescribeOffering(signal);

    assert.equal(plan.signalId, signal.signalId);
  });

  it("includes constraints from signal constraints", () => {
    // ibi polarity (policyRisk + mutationPossible + approvalRequired)
    // produces signal constraints ["require_approval", "require_policy_check"]
    const signal = makeSignal({
      bits: {
        policyRisk: true,
        mutationPossible: true,
        approvalRequired: true,
      },
    });
    const plan = prescribeOffering(signal);

    assert.ok(plan.constraints.includes("require_approval"));
    assert.ok(plan.constraints.includes("require_policy_check"));
  });

  it("includes taboos from signal taboos", () => {
    // replay domain adds taboo "no_side_effects_without_approval"
    const signal = makeSignal({ bits: {}, domain: "replay" });
    const plan = prescribeOffering(signal);

    assert.ok(plan.taboos.includes("no_side_effects_without_approval"));
  });

  /* ---------------------------------------------------------------- */
  /*  Action-specific constraint additions                             */
  /* ---------------------------------------------------------------- */

  it('proceed action adds "proceed_with_confidence" to constraints', () => {
    const signal = makeSignal({ bits: {}, domain: "task" });
    const plan = prescribeOffering(signal);

    assert.equal(plan.action, "proceed");
    assert.ok(plan.constraints.includes("proceed_with_confidence"));
  });

  it('pause action adds "require_human_review" to constraints', () => {
    const signal = makeSignal({
      bits: { toolRequired: true, policyRisk: true },
    });
    const plan = prescribeOffering(signal);

    assert.equal(plan.action, "pause");
    assert.ok(plan.constraints.includes("require_human_review"));
  });
});
