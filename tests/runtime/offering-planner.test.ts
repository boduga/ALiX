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
/*  Rule priority: first match wins                                    */
/*                                                                     */
/*  1. approvalRequired || (toolRequired && policyRisk)  → ask_approval */
/*  2. replayRollbackContext && mutationPossible          → rollback_preview */
/*  3. replayRollbackContext                              → replay_preview  */
/*  4. freshnessRequired && memoryRequired                 → fetch_memory   */
/*  5. freshnessRequired                                  → run_policy_check */
/*  6. memoryRequired                                     → fetch_memory    */
/*  7. policyRisk                                         → run_policy_check */
/*  8. toolRequired                                       → proceed         */
/*  9. otherwise                                          → proceed         */
/* ------------------------------------------------------------------ */

describe("prescribeOffering", () => {
  /* ---- Rule 1 ---- */

  it("approvalRequired → ask_approval", () => {
    const signal = makeSignal({ bits: { approvalRequired: true } });
    const plan = prescribeOffering(signal);

    assert.equal(plan.action, "ask_approval");
    assert.deepEqual(plan.requiredEvidence, ["policy_decision", "approval_status"]);
    assert.deepEqual(plan.successCriteria, ["approval_granted"]);
  });

  it("toolRequired + policyRisk → ask_approval", () => {
    const signal = makeSignal({
      bits: { toolRequired: true, policyRisk: true },
    });
    const plan = prescribeOffering(signal);

    assert.equal(plan.action, "ask_approval");
    assert.deepEqual(plan.requiredEvidence, ["policy_decision", "approval_status"]);
    assert.deepEqual(plan.successCriteria, ["approval_granted"]);
  });

  /* ---- Rule 2 ---- */

  it("replayRollbackContext + mutationPossible → rollback_preview", () => {
    const signal = makeSignal({
      bits: { replayRollbackContext: true, mutationPossible: true },
    });
    const plan = prescribeOffering(signal);

    assert.equal(plan.action, "rollback_preview");
    assert.deepEqual(plan.requiredEvidence, ["replay_diff", "rollback_plan"]);
    assert.deepEqual(plan.successCriteria, ["diff_generated", "plan_reviewed"]);
  });

  /* ---- Rule 3 ---- */

  it("replayRollbackContext alone → replay_preview", () => {
    const signal = makeSignal({
      bits: { replayRollbackContext: true },
    });
    const plan = prescribeOffering(signal);

    assert.equal(plan.action, "replay_preview");
    assert.deepEqual(plan.requiredEvidence, ["trace_events", "replay_plan"]);
    assert.deepEqual(plan.successCriteria, ["preview_generated"]);
  });

  /* ---- Rule 4 ---- */

  it("freshnessRequired + memoryRequired → fetch_memory", () => {
    const signal = makeSignal({
      bits: { freshnessRequired: true, memoryRequired: true },
    });
    const plan = prescribeOffering(signal);

    assert.equal(plan.action, "fetch_memory");
    assert.deepEqual(plan.requiredEvidence, ["memory_index", "session_context"]);
    assert.deepEqual(plan.successCriteria, ["memory_loaded"]);
  });

  /* ---- Rule 5 ---- */

  it("freshnessRequired → run_policy_check", () => {
    const signal = makeSignal({ bits: { freshnessRequired: true } });
    const plan = prescribeOffering(signal);

    assert.equal(plan.action, "run_policy_check");
    assert.deepEqual(plan.requiredEvidence, ["current_state", "policy_rules"]);
    assert.deepEqual(plan.successCriteria, ["policy_verified"]);
  });

  /* ---- Rule 6 ---- */

  it("memoryRequired → fetch_memory", () => {
    const signal = makeSignal({ bits: { memoryRequired: true } });
    const plan = prescribeOffering(signal);

    assert.equal(plan.action, "fetch_memory");
    assert.deepEqual(plan.requiredEvidence, ["memory_index", "session_context"]);
    assert.deepEqual(plan.successCriteria, ["memory_loaded"]);
  });

  /* ---- Rule 7 ---- */

  it("policyRisk → run_policy_check", () => {
    const signal = makeSignal({ bits: { policyRisk: true } });
    const plan = prescribeOffering(signal);

    assert.equal(plan.action, "run_policy_check");
    assert.deepEqual(plan.requiredEvidence, ["current_state", "policy_rules"]);
    assert.deepEqual(plan.successCriteria, ["policy_verified"]);
  });

  /* ---- Rule 8 ---- */

  it("toolRequired → proceed", () => {
    const signal = makeSignal({ bits: { toolRequired: true } });
    const plan = prescribeOffering(signal);

    assert.equal(plan.action, "proceed");
    assert.deepEqual(plan.requiredEvidence, ["tool_listing"]);
    assert.deepEqual(plan.successCriteria, ["execution_completed"]);
  });

  /* ---- Rule 9 ---- */

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

  it("approvalRequired beats replayRollbackContext when both match", () => {
    const signal = makeSignal({
      bits: { approvalRequired: true, replayRollbackContext: true },
    });
    const plan = prescribeOffering(signal);

    // Rule 1 fires before rule 3
    assert.equal(plan.action, "ask_approval");
  });

  it("replayRollbackContext+mutationPossible beats freshnessRequired when both match", () => {
    const signal = makeSignal({
      bits: {
        replayRollbackContext: true,
        mutationPossible: true,
        freshnessRequired: true,
      },
    });
    const plan = prescribeOffering(signal);

    // Rule 2 fires before rule 5
    assert.equal(plan.action, "rollback_preview");
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
});
