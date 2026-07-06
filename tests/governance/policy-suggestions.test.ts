// tests/governance/policy-suggestions.test.ts
//
// P13.3 — Tests for the pure policy-suggestion pipeline.
//
// Invariant under test: every emitted suggestion is advisory-only, evidence
// backed, deterministic, and division-guarded. We cover each heuristic (H1-H5),
// the conflict-resolution rules, runId-join semantics, confidence clamps and
// rounding, division guards, deterministic sort, and per-heuristic provenance.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computePolicySuggestions,
  computeEvidenceForPolicy,
  clamp,
  round2,
  safeRatio,
  MIN_SAMPLE_SIZE,
  MIN_CONFIDENCE,
  type PolicySuggestion,
} from "../../src/governance/policy-suggestions.js";
import type { LedgerEntry } from "../../src/governance/run-ledger.js";
import type { FailureRecord } from "../../src/governance/failure-memory.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLedger(overrides: Partial<LedgerEntry> & { timestamp: string }): LedgerEntry {
  return {
    runId: "run-001",
    issueId: "issue-001",
    policyResult: {
      decision: "allow",
      reason: "ok",
      matchedPolicies: [],
      requiredApprovals: [],
    },
    riskScore: { level: "low", score: 10, factors: [] },
    approvals: [],
    filesChanged: [],
    verificationResults: [],
    outcome: "completed",
    ...overrides,
  };
}

function makeFailure(overrides: Partial<FailureRecord> & { timestamp: string }): FailureRecord {
  // Note: `timestamp` is required in `overrides` per the signature; the default
  // below is a placeholder that is always overwritten by the spread.
  return {
    runId: "run-001",
    issueId: "issue-001",
    failureType: "test_failure",
    detail: "some failure",
    ...overrides,
  } as FailureRecord;
}

// ---------------------------------------------------------------------------
// Constants & pure helpers
// ---------------------------------------------------------------------------

describe("policy-suggestions constants", () => {
  it("exposes MIN_SAMPLE_SIZE = 3 and MIN_CONFIDENCE = 0.5", () => {
    assert.strictEqual(MIN_SAMPLE_SIZE, 3);
    assert.strictEqual(MIN_CONFIDENCE, 0.5);
  });
});

describe("clamp / round2 / safeRatio", () => {
  it("clamps into [min, max]", () => {
    assert.strictEqual(clamp(5, 0, 10), 5);
    assert.strictEqual(clamp(-1, 0, 10), 0);
    assert.strictEqual(clamp(99, 0, 10), 10);
  });

  it("rounds to 2 decimals deterministically", () => {
    assert.strictEqual(round2(0.7142857), 0.71);
    assert.strictEqual(round2(0.6666666), 0.67);
    assert.strictEqual(round2(1), 1);
    assert.strictEqual(round2(0.005), 0.01);
  });

  it("safeRatio returns 0 for zero denominator instead of NaN/Infinity", () => {
    assert.strictEqual(safeRatio(5, 0), 0);
    assert.strictEqual(safeRatio(0, 0), 0);
    assert.strictEqual(safeRatio(4, 2), 2);
  });
});

// ---------------------------------------------------------------------------
// 1. Empty inputs
// ---------------------------------------------------------------------------

describe("computePolicySuggestions", () => {
  it("1. returns [] for empty ledger and empty failures", () => {
    assert.deepEqual(computePolicySuggestions([], []), []);
  });

  // -------------------------------------------------------------------------
  // H1 — loosen / remove_rule
  // -------------------------------------------------------------------------

  it("2. H1 emits loosen for high deny rate with low bypassed (matched=5, denied=4, bypassed=0)", () => {
    const ledger: LedgerEntry[] = [
      makeLedger({ runId: "r1", timestamp: "t1", outcome: "denied", policyResult: { decision: "deny", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
      makeLedger({ runId: "r2", timestamp: "t2", outcome: "denied", policyResult: { decision: "deny", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
      makeLedger({ runId: "r3", timestamp: "t3", outcome: "denied", policyResult: { decision: "deny", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
      makeLedger({ runId: "r4", timestamp: "t4", outcome: "denied", policyResult: { decision: "deny", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
      makeLedger({ runId: "r5", timestamp: "t5", outcome: "completed", policyResult: { decision: "allow", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
    ];
    const out = computePolicySuggestions(ledger, []);
    assert.strictEqual(out.length, 1);
    const s = out[0];
    assert.strictEqual(s.type, "loosen");
    assert.strictEqual(s.policyId, "P1");
    assert.strictEqual(s.sourceHeuristic, "H1");
    // denyRate = 4/5 = 0.8, clamped to [0, 0.9] → 0.8
    assert.strictEqual(s.confidence, 0.8);
    assert.deepStrictEqual(s.evidence, {
      matchedCount: 5,
      deniedCount: 4,
      bypassedCount: 0,
      relatedFailureCount: 0,
    });
  });

  it("3. H1 emits remove_rule when deniedCount === matchedCount AND bypassedCount === 0", () => {
    const ledger: LedgerEntry[] = [
      makeLedger({ runId: "r1", timestamp: "t1", outcome: "denied", policyResult: { decision: "deny", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
      makeLedger({ runId: "r2", timestamp: "t2", outcome: "denied", policyResult: { decision: "deny", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
      makeLedger({ runId: "r3", timestamp: "t3", outcome: "denied", policyResult: { decision: "deny", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
    ];
    const out = computePolicySuggestions(ledger, []);
    assert.strictEqual(out.length, 1);
    const s = out[0];
    assert.strictEqual(s.type, "remove_rule");
    assert.strictEqual(s.policyId, "P1");
    assert.strictEqual(s.sourceHeuristic, "H1");
    // denyRate = 3/3 = 1.0, clamped to 0.9
    assert.strictEqual(s.confidence, 0.9);
  });

  // -------------------------------------------------------------------------
  // H2 — tighten
  // -------------------------------------------------------------------------

  it("4. H2 emits tighten when matched runs produce test_failure/verification_timeout on overlapping file paths", () => {
    const ledger: LedgerEntry[] = [
      makeLedger({ runId: "r1", timestamp: "t1", outcome: "completed", filesChanged: ["src/a.ts"], policyResult: { decision: "allow", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
      makeLedger({ runId: "r2", timestamp: "t2", outcome: "completed", filesChanged: ["src/a.ts"], policyResult: { decision: "allow", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
      makeLedger({ runId: "r3", timestamp: "t3", outcome: "completed", filesChanged: ["src/a.ts"], policyResult: { decision: "allow", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
    ];
    const failures: FailureRecord[] = [
      makeFailure({ runId: "r1", timestamp: "t1", failureType: "test_failure", filePaths: ["src/a.ts"] }),
      makeFailure({ runId: "r2", timestamp: "t2", failureType: "verification_timeout", filePaths: ["src/a.ts"] }),
      makeFailure({ runId: "r3", timestamp: "t3", failureType: "test_failure", filePaths: ["src/a.ts"] }),
    ];
    const out = computePolicySuggestions(ledger, failures);
    const tighten = out.find((s) => s.type === "tighten");
    assert.ok(tighten, "expected a tighten suggestion");
    assert.strictEqual(tighten.policyId, "P1");
    assert.strictEqual(tighten.sourceHeuristic, "H2");
    // overlappingFailures=3, matchedCount=3 → ratio 1.0, cap 0.85
    assert.strictEqual(tighten.confidence, 0.85);
  });

  // -------------------------------------------------------------------------
  // H3 — add_rule (ungoverned recurring file-path failures)
  // -------------------------------------------------------------------------

  it("5. H3 emits add_rule for 3+ ungoverned failures on the same path with no policyIds", () => {
    const failures: FailureRecord[] = [
      makeFailure({ runId: "r1", timestamp: "t1", failureType: "test_failure", filePaths: ["src/x.ts"] }),
      makeFailure({ runId: "r2", timestamp: "t2", failureType: "test_failure", filePaths: ["src/x.ts"] }),
      makeFailure({ runId: "r3", timestamp: "t3", failureType: "test_failure", filePaths: ["src/x.ts"] }),
    ];
    const out = computePolicySuggestions([], failures);
    assert.strictEqual(out.length, 1);
    const s = out[0];
    assert.strictEqual(s.type, "add_rule");
    assert.strictEqual(s.policyId, undefined);
    assert.strictEqual(s.sourceHeuristic, "H3");
    // recurrence=3, totalUngoverned=3 → ratio 1.0, cap 0.8
    assert.strictEqual(s.confidence, 0.8);
  });

  // -------------------------------------------------------------------------
  // H4 — add_rule (verification_timeout + test_failure cluster)
  // -------------------------------------------------------------------------

  it("6. H4 emits add_rule for shared verification_timeout + test_failure paths (co-occurrence >= 3)", () => {
    // Give every failure a policyId so H3 (which only fires for ungoverned
    // failures) does not also fire on these paths.
    const failures: FailureRecord[] = [
      makeFailure({ runId: "r1", timestamp: "t1", failureType: "verification_timeout", filePaths: ["src/a.ts"], policyIds: ["P-other"] }),
      makeFailure({ runId: "r2", timestamp: "t2", failureType: "verification_timeout", filePaths: ["src/a.ts"], policyIds: ["P-other"] }),
      makeFailure({ runId: "r3", timestamp: "t3", failureType: "verification_timeout", filePaths: ["src/a.ts"], policyIds: ["P-other"] }),
      makeFailure({ runId: "r4", timestamp: "t4", failureType: "test_failure", filePaths: ["src/a.ts"], policyIds: ["P-other"] }),
      makeFailure({ runId: "r5", timestamp: "t5", failureType: "test_failure", filePaths: ["src/a.ts"], policyIds: ["P-other"] }),
      makeFailure({ runId: "r6", timestamp: "t6", failureType: "test_failure", filePaths: ["src/a.ts"], policyIds: ["P-other"] }),
    ];
    const out = computePolicySuggestions([], failures);
    const h4 = out.find((s) => s.sourceHeuristic === "H4");
    assert.ok(h4, "expected an H4 add_rule suggestion");
    assert.strictEqual(h4.type, "add_rule");
    assert.strictEqual(h4.policyId, undefined);
    // coOccurrence = min(3,3) = 3, totalQualifying = 6 → ratio 0.5
    assert.strictEqual(h4.confidence, 0.5);
  });

  // -------------------------------------------------------------------------
  // H5 — loosen (repeated policy_denied, no downstream safety failure)
  // -------------------------------------------------------------------------

  it("7. H5 emits loosen for repeated policy_denied failures with no downstream safety failure", () => {
    // Three policy_denied records tagged with P1; their runIds do NOT appear
    // in any completed ledger entry, so bypassedCount stays 0.
    const failures: FailureRecord[] = [
      makeFailure({ runId: "r-denied-1", timestamp: "t1", failureType: "policy_denied", policyIds: ["P1"] }),
      makeFailure({ runId: "r-denied-2", timestamp: "t2", failureType: "policy_denied", policyIds: ["P1"] }),
      makeFailure({ runId: "r-denied-3", timestamp: "t3", failureType: "policy_denied", policyIds: ["P1"] }),
    ];
    const out = computePolicySuggestions([], failures);
    assert.strictEqual(out.length, 1);
    const s = out[0];
    assert.strictEqual(s.type, "loosen");
    assert.strictEqual(s.policyId, "P1");
    assert.strictEqual(s.sourceHeuristic, "H5");
    // policyDeniedCount=3 → 3/(3+2)=0.6, cap 0.8 → 0.6
    assert.strictEqual(s.confidence, 0.6);
  });

  // -------------------------------------------------------------------------
  // Sample-size + confidence gates
  // -------------------------------------------------------------------------

  it("8. does not emit when matchedCount < MIN_SAMPLE_SIZE (matched=2)", () => {
    const ledger: LedgerEntry[] = [
      makeLedger({ runId: "r1", timestamp: "t1", outcome: "denied", policyResult: { decision: "deny", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
      makeLedger({ runId: "r2", timestamp: "t2", outcome: "denied", policyResult: { decision: "deny", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
    ];
    const out = computePolicySuggestions(ledger, []);
    assert.deepEqual(out, []);
  });

  it("9. does not emit suggestions whose computed confidence is below MIN_CONFIDENCE", () => {
    // H3 ratio is recurrence / totalUngoverned, where totalUngoverned counts
    // EVERY ungoverned failure in the input. We construct two recurring paths
    // so that one's ratio clears MIN_CONFIDENCE and the other's does not:
    //   keep.ts: 9 / 12 = 0.75 → confidence 0.75 → emitted
    //   drop.ts: 3 / 12 = 0.25 → confidence 0.25 (< 0.5) → filtered
    const failures: FailureRecord[] = [
      ...Array.from({ length: 9 }, (_, i) =>
        makeFailure({ runId: `k${i}`, timestamp: `t${i}`, failureType: "test_failure", filePaths: ["keep.ts"] }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        makeFailure({ runId: `d${i}`, timestamp: `t${i}`, failureType: "test_failure", filePaths: ["drop.ts"] }),
      ),
    ];
    const out = computePolicySuggestions([], failures);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].type, "add_rule");
    assert.ok(out[0].reason.includes("keep.ts"));
    assert.ok(!out[0].reason.includes("drop.ts"));
    for (const s of out) {
      assert.ok(s.confidence >= MIN_CONFIDENCE);
    }
  });

  // -------------------------------------------------------------------------
  // runId-join semantics
  // -------------------------------------------------------------------------

  it("10. bypassedCount only counts failure records whose runId links to a completed ledger entry", () => {
    // Two ledger entries match P1: one completed (r-done), one denied (r-denied).
    // Two failures tagged P1: one with runId r-done (counts), one with r-denied (does not).
    const ledger: LedgerEntry[] = [
      makeLedger({ runId: "r-done", timestamp: "t1", outcome: "completed", policyResult: { decision: "allow", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
      makeLedger({ runId: "r-denied", timestamp: "t2", outcome: "denied", policyResult: { decision: "deny", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
    ];
    const failures: FailureRecord[] = [
      makeFailure({ runId: "r-done", timestamp: "t1", failureType: "test_failure", policyIds: ["P1"] }),
      makeFailure({ runId: "r-denied", timestamp: "t2", failureType: "test_failure", policyIds: ["P1"] }),
    ];
    const evidence = computeEvidenceForPolicy("P1", ledger, failures);
    assert.strictEqual(evidence.matchedCount, 2);
    assert.strictEqual(evidence.relatedFailureCount, 2);
    assert.strictEqual(evidence.bypassedCount, 1);
  });

  it("11. records without a runId contribute to relatedFailureCount, NOT bypassedCount", () => {
    // FailureRecord.runId is typed as string; an empty string models "no runId"
    // and is treated as falsy by the join predicate.
    const ledger: LedgerEntry[] = [
      makeLedger({ runId: "r-done", timestamp: "t1", outcome: "completed", policyResult: { decision: "allow", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
    ];
    const failures: FailureRecord[] = [
      makeFailure({ runId: "", timestamp: "t1", failureType: "test_failure", policyIds: ["P1"] }),
      makeFailure({ runId: "r-done", timestamp: "t2", failureType: "test_failure", policyIds: ["P1"] }),
    ];
    const evidence = computeEvidenceForPolicy("P1", ledger, failures);
    assert.strictEqual(evidence.relatedFailureCount, 2);
    assert.strictEqual(evidence.bypassedCount, 1);
  });

  // -------------------------------------------------------------------------
  // Confidence rounding + clamps
  // -------------------------------------------------------------------------

  it("12. confidence is rounded to 2 decimals", () => {
    // H1 with matchedCount=7, deniedCount=5 → denyRate = 5/7 ≈ 0.7142857 → 0.71.
    const ledger: LedgerEntry[] = Array.from({ length: 7 }, (_, i) =>
      makeLedger({
        runId: `r${i}`,
        timestamp: `t${i}`,
        outcome: i < 5 ? "denied" : "completed",
        policyResult: { decision: i < 5 ? "deny" : "allow", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] },
      }),
    );
    const out = computePolicySuggestions(ledger, []);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].confidence, 0.71);
  });

  it("13. confidence is clamped to per-heuristic caps (H1=0.9, H2=0.85, H3=0.8, H5=0.8)", () => {
    // H1: matchedCount=3, deniedCount=3, bypassedCount=0 → denyRate 1.0, cap 0.9.
    const ledgerH1: LedgerEntry[] = [
      makeLedger({ runId: "r1", timestamp: "t1", outcome: "denied", policyResult: { decision: "deny", reason: "x", matchedPolicies: ["PH1"], requiredApprovals: [] } }),
      makeLedger({ runId: "r2", timestamp: "t2", outcome: "denied", policyResult: { decision: "deny", reason: "x", matchedPolicies: ["PH1"], requiredApprovals: [] } }),
      makeLedger({ runId: "r3", timestamp: "t3", outcome: "denied", policyResult: { decision: "deny", reason: "x", matchedPolicies: ["PH1"], requiredApprovals: [] } }),
    ];
    const outH1 = computePolicySuggestions(ledgerH1, []);
    const h1 = outH1.find((s) => s.sourceHeuristic === "H1");
    assert.ok(h1);
    assert.strictEqual(h1.confidence, 0.9);

    // H2: matchedCount=3, 3 overlapping failures → ratio 1.0, cap 0.85.
    const ledgerH2: LedgerEntry[] = [
      makeLedger({ runId: "r1", timestamp: "t1", outcome: "completed", filesChanged: ["a.ts"], policyResult: { decision: "allow", reason: "x", matchedPolicies: ["PH2"], requiredApprovals: [] } }),
      makeLedger({ runId: "r2", timestamp: "t2", outcome: "completed", filesChanged: ["a.ts"], policyResult: { decision: "allow", reason: "x", matchedPolicies: ["PH2"], requiredApprovals: [] } }),
      makeLedger({ runId: "r3", timestamp: "t3", outcome: "completed", filesChanged: ["a.ts"], policyResult: { decision: "allow", reason: "x", matchedPolicies: ["PH2"], requiredApprovals: [] } }),
    ];
    const failuresH2: FailureRecord[] = [
      makeFailure({ runId: "x1", timestamp: "t1", failureType: "test_failure", filePaths: ["a.ts"] }),
      makeFailure({ runId: "x2", timestamp: "t2", failureType: "test_failure", filePaths: ["a.ts"] }),
      makeFailure({ runId: "x3", timestamp: "t3", failureType: "test_failure", filePaths: ["a.ts"] }),
    ];
    const outH2 = computePolicySuggestions(ledgerH2, failuresH2);
    const h2 = outH2.find((s) => s.sourceHeuristic === "H2");
    assert.ok(h2);
    assert.strictEqual(h2.confidence, 0.85);

    // H3: 3 ungoverned failures on one path → ratio 1.0, cap 0.8.
    const failuresH3: FailureRecord[] = [
      makeFailure({ runId: "r1", timestamp: "t1", failureType: "test_failure", filePaths: ["h3.ts"] }),
      makeFailure({ runId: "r2", timestamp: "t2", failureType: "test_failure", filePaths: ["h3.ts"] }),
      makeFailure({ runId: "r3", timestamp: "t3", failureType: "test_failure", filePaths: ["h3.ts"] }),
    ];
    const outH3 = computePolicySuggestions([], failuresH3);
    const h3 = outH3.find((s) => s.sourceHeuristic === "H3");
    assert.ok(h3);
    assert.strictEqual(h3.confidence, 0.8);

    // H5: 10 policy_denied failures → 10/12 ≈ 0.833, cap 0.8.
    const failuresH5: FailureRecord[] = Array.from({ length: 10 }, (_, i) =>
      makeFailure({ runId: `rd${i}`, timestamp: `t${i}`, failureType: "policy_denied", policyIds: ["PH5"] }),
    );
    const outH5 = computePolicySuggestions([], failuresH5);
    const h5 = outH5.find((s) => s.sourceHeuristic === "H5");
    assert.ok(h5);
    assert.strictEqual(h5.confidence, 0.8);
  });

  // -------------------------------------------------------------------------
  // Sorting
  // -------------------------------------------------------------------------

  it("14. sorts deterministically: confidence desc → type asc → policyId asc (undefined last)", () => {
    // Build inputs that yield multiple tighten + loosen + add_rule suggestions
    // with controlled confidences, types, and policyIds.
    //
    // - PT and PA both fire H2 tighten at 0.85 (same confidence + type) →
    //   policyId asc decides (PA before PT).
    // - PU fires H1 loosen at 0.67 (lower confidence than tighten).
    // - Two H3 add_rule suggestions on different paths at 0.5 each (lower
    //   confidence than loosen).
    //
    // Note: the "undefined policyId sorts last" branch is only reachable when
    // two suggestions share BOTH confidence AND type but one has policyId and
    // the other does not. Since `add_rule` is the only type that omits
    // policyId, that combination cannot arise under the current type system —
    // the branch exists defensively. We cover the reachable levels here.
    //
    // The H2 driver failures carry a marker policyId so they do NOT register
    // as ungoverned for H3 (which would otherwise inflate totalUngoverned and
    // suppress the add_rule confidences we want).
    const ledger: LedgerEntry[] = [
      // PT — 3 completed matches on path pt.ts (H2 fires at 0.85).
      makeLedger({ runId: "pt1", timestamp: "t1", outcome: "completed", filesChanged: ["pt.ts"], policyResult: { decision: "allow", reason: "x", matchedPolicies: ["PT"], requiredApprovals: [] } }),
      makeLedger({ runId: "pt2", timestamp: "t2", outcome: "completed", filesChanged: ["pt.ts"], policyResult: { decision: "allow", reason: "x", matchedPolicies: ["PT"], requiredApprovals: [] } }),
      makeLedger({ runId: "pt3", timestamp: "t3", outcome: "completed", filesChanged: ["pt.ts"], policyResult: { decision: "allow", reason: "x", matchedPolicies: ["PT"], requiredApprovals: [] } }),
      // PU — 3 matches, 2 denied, 0 bypassed → H1 loosen at 0.67.
      makeLedger({ runId: "pu1", timestamp: "t4", outcome: "denied", policyResult: { decision: "deny", reason: "x", matchedPolicies: ["PU"], requiredApprovals: [] } }),
      makeLedger({ runId: "pu2", timestamp: "t5", outcome: "denied", policyResult: { decision: "deny", reason: "x", matchedPolicies: ["PU"], requiredApprovals: [] } }),
      makeLedger({ runId: "pu3", timestamp: "t6", outcome: "completed", policyResult: { decision: "allow", reason: "x", matchedPolicies: ["PU"], requiredApprovals: [] } }),
      // PA — same shape as PT but different policyId, used to test policyId asc
      // at the same confidence + type (tighten, 0.85).
      makeLedger({ runId: "pa1", timestamp: "t7", outcome: "completed", filesChanged: ["pa.ts"], policyResult: { decision: "allow", reason: "x", matchedPolicies: ["PA"], requiredApprovals: [] } }),
      makeLedger({ runId: "pa2", timestamp: "t8", outcome: "completed", filesChanged: ["pa.ts"], policyResult: { decision: "allow", reason: "x", matchedPolicies: ["PA"], requiredApprovals: [] } }),
      makeLedger({ runId: "pa3", timestamp: "t9", outcome: "completed", filesChanged: ["pa.ts"], policyResult: { decision: "allow", reason: "x", matchedPolicies: ["PA"], requiredApprovals: [] } }),
    ];
    const failures: FailureRecord[] = [
      // H2 drivers for PT (tagged with a marker policy so H3 ignores them).
      makeFailure({ runId: "f1", timestamp: "t1", failureType: "test_failure", filePaths: ["pt.ts"], policyIds: ["marker"] }),
      makeFailure({ runId: "f2", timestamp: "t2", failureType: "test_failure", filePaths: ["pt.ts"], policyIds: ["marker"] }),
      makeFailure({ runId: "f3", timestamp: "t3", failureType: "test_failure", filePaths: ["pt.ts"], policyIds: ["marker"] }),
      // H2 drivers for PA.
      makeFailure({ runId: "f4", timestamp: "t4", failureType: "test_failure", filePaths: ["pa.ts"], policyIds: ["marker"] }),
      makeFailure({ runId: "f5", timestamp: "t5", failureType: "test_failure", filePaths: ["pa.ts"], policyIds: ["marker"] }),
      makeFailure({ runId: "f6", timestamp: "t6", failureType: "test_failure", filePaths: ["pa.ts"], policyIds: ["marker"] }),
      // H3 drivers: two paths, each recurring 3 of 6 → ratio 0.5 → confidence 0.5.
      makeFailure({ runId: "u1", timestamp: "t1", failureType: "test_failure", filePaths: ["u-a.ts"] }),
      makeFailure({ runId: "u2", timestamp: "t2", failureType: "test_failure", filePaths: ["u-a.ts"] }),
      makeFailure({ runId: "u3", timestamp: "t3", failureType: "test_failure", filePaths: ["u-a.ts"] }),
      makeFailure({ runId: "u4", timestamp: "t4", failureType: "test_failure", filePaths: ["u-b.ts"] }),
      makeFailure({ runId: "u5", timestamp: "t5", failureType: "test_failure", filePaths: ["u-b.ts"] }),
      makeFailure({ runId: "u6", timestamp: "t6", failureType: "test_failure", filePaths: ["u-b.ts"] }),
    ];
    const out = computePolicySuggestions(ledger, failures);
    // Expected ordering:
    //   1. PA tighten   0.85  (confidence desc; type asc → tighten first;
    //                         policyId asc → PA before PT)
    //   2. PT tighten   0.85
    //   3. PU loosen    0.67  (next confidence tier; type asc → loosen before
    //                         add_rule/remove_rule alphabetically)
    //   4. add_rule     0.5   (H3, u-a.ts or u-b.ts; tie, stable order)
    //   5. add_rule     0.5
    assert.strictEqual(out.length, 5);
    assert.strictEqual(out[0].policyId, "PA");
    assert.strictEqual(out[0].type, "tighten");
    assert.strictEqual(out[0].confidence, 0.85);
    assert.strictEqual(out[1].policyId, "PT");
    assert.strictEqual(out[1].type, "tighten");
    assert.strictEqual(out[1].confidence, 0.85);
    assert.strictEqual(out[2].policyId, "PU");
    assert.strictEqual(out[2].type, "loosen");
    assert.strictEqual(out[2].confidence, 0.67);
    assert.strictEqual(out[3].type, "add_rule");
    assert.strictEqual(out[3].confidence, 0.5);
    assert.strictEqual(out[4].type, "add_rule");
    assert.strictEqual(out[4].confidence, 0.5);
  });

  // -------------------------------------------------------------------------
  // Conflict resolution
  // -------------------------------------------------------------------------

  it("15. same policyId does NOT emit both tighten and loosen (highest confidence wins)", () => {
    // P1: matchedCount=3, 2 denied, 0 bypassed → H1 loosen at 0.67.
    //     3 test_failure failures on matched path "a.ts" → H2 tighten at 0.85.
    // Conflict: tighten 0.85 > loosen 0.67 → only tighten survives.
    const ledger: LedgerEntry[] = [
      makeLedger({ runId: "r1", timestamp: "t1", outcome: "denied", filesChanged: ["a.ts"], policyResult: { decision: "deny", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
      makeLedger({ runId: "r2", timestamp: "t2", outcome: "denied", filesChanged: ["a.ts"], policyResult: { decision: "deny", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
      makeLedger({ runId: "r3", timestamp: "t3", outcome: "completed", filesChanged: ["a.ts"], policyResult: { decision: "allow", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
    ];
    const failures: FailureRecord[] = [
      makeFailure({ runId: "f1", timestamp: "t1", failureType: "test_failure", filePaths: ["a.ts"] }),
      makeFailure({ runId: "f2", timestamp: "t2", failureType: "test_failure", filePaths: ["a.ts"] }),
      makeFailure({ runId: "f3", timestamp: "t3", failureType: "test_failure", filePaths: ["a.ts"] }),
    ];
    const out = computePolicySuggestions(ledger, failures);
    const forP1 = out.filter((s) => s.policyId === "P1");
    assert.strictEqual(forP1.length, 1);
    assert.strictEqual(forP1[0].type, "tighten");
    assert.strictEqual(forP1[0].sourceHeuristic, "H2");
  });

  it("16. confidence tie prefers tighten over loosen/remove_rule", () => {
    // P1: matchedCount=4, deniedCount=3, bypassedCount=0 → H1 loosen at 0.75.
    //     3 test_failure failures on matched path "a.ts" → H2 tighten at 0.75.
    // Tie at 0.75 → tighten wins.
    const ledger: LedgerEntry[] = [
      makeLedger({ runId: "r1", timestamp: "t1", outcome: "denied", filesChanged: ["a.ts"], policyResult: { decision: "deny", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
      makeLedger({ runId: "r2", timestamp: "t2", outcome: "denied", filesChanged: ["a.ts"], policyResult: { decision: "deny", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
      makeLedger({ runId: "r3", timestamp: "t3", outcome: "denied", filesChanged: ["a.ts"], policyResult: { decision: "deny", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
      makeLedger({ runId: "r4", timestamp: "t4", outcome: "completed", filesChanged: ["a.ts"], policyResult: { decision: "allow", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
    ];
    const failures: FailureRecord[] = [
      makeFailure({ runId: "f1", timestamp: "t1", failureType: "test_failure", filePaths: ["a.ts"] }),
      makeFailure({ runId: "f2", timestamp: "t2", failureType: "test_failure", filePaths: ["a.ts"] }),
      makeFailure({ runId: "f3", timestamp: "t3", failureType: "test_failure", filePaths: ["a.ts"] }),
    ];
    const out = computePolicySuggestions(ledger, failures);
    const forP1 = out.filter((s) => s.policyId === "P1");
    assert.strictEqual(forP1.length, 1);
    assert.strictEqual(forP1[0].type, "tighten");
    assert.strictEqual(forP1[0].confidence, 0.75);
    assert.strictEqual(forP1[0].sourceHeuristic, "H2");
  });

  it("17. add_rule (no policyId) is NOT deduped against named policies", () => {
    // H1 fires remove_rule on P1 (3 denied, 0 bypassed).
    // H3 fires add_rule for path "x.ts" (3 ungoverned failures).
    // Both must appear in the output.
    const ledger: LedgerEntry[] = [
      makeLedger({ runId: "r1", timestamp: "t1", outcome: "denied", policyResult: { decision: "deny", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
      makeLedger({ runId: "r2", timestamp: "t2", outcome: "denied", policyResult: { decision: "deny", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
      makeLedger({ runId: "r3", timestamp: "t3", outcome: "denied", policyResult: { decision: "deny", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
    ];
    const failures: FailureRecord[] = [
      makeFailure({ runId: "u1", timestamp: "t1", failureType: "test_failure", filePaths: ["x.ts"] }),
      makeFailure({ runId: "u2", timestamp: "t2", failureType: "test_failure", filePaths: ["x.ts"] }),
      makeFailure({ runId: "u3", timestamp: "t3", failureType: "test_failure", filePaths: ["x.ts"] }),
    ];
    const out = computePolicySuggestions(ledger, failures);
    const named = out.find((s) => s.policyId === "P1");
    const addRule = out.find((s) => s.type === "add_rule");
    assert.ok(named, "named-policy suggestion survived");
    assert.ok(addRule, "add_rule suggestion survived");
    assert.strictEqual(addRule.policyId, undefined);
  });

  // -------------------------------------------------------------------------
  // Division-by-zero guards
  // -------------------------------------------------------------------------

  it("18. division-by-zero guards: zero matchedCount/deniedCount produce no NaN", () => {
    // Direct helper checks.
    assert.strictEqual(safeRatio(5, 0), 0);
    assert.strictEqual(safeRatio(0, 0), 0);
    assert.ok(!Number.isNaN(safeRatio(0, 0)));

    // Evidence for a policy that never matched: all zeros, no NaN anywhere.
    const evidence = computeEvidenceForPolicy("P-phantom", [], []);
    assert.deepStrictEqual(evidence, {
      matchedCount: 0,
      deniedCount: 0,
      bypassedCount: 0,
      relatedFailureCount: 0,
    });

    // A policy that matches entries but has zero denied (denyRate = 0/3 → 0,
    // not NaN). H1 will not fire (denyRate < 0.6), so output is empty.
    const ledger: LedgerEntry[] = [
      makeLedger({ runId: "r1", timestamp: "t1", outcome: "completed", policyResult: { decision: "allow", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
      makeLedger({ runId: "r2", timestamp: "t2", outcome: "completed", policyResult: { decision: "allow", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
      makeLedger({ runId: "r3", timestamp: "t3", outcome: "completed", policyResult: { decision: "allow", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
    ];
    const out = computePolicySuggestions(ledger, []);
    for (const s of out) {
      assert.ok(Number.isFinite(s.confidence), "confidence must be finite");
      assert.ok(!Number.isNaN(s.confidence), "confidence must not be NaN");
    }
    assert.deepEqual(out, []);
  });

  // -------------------------------------------------------------------------
  // Output contract: every emitted suggestion is well-formed
  // -------------------------------------------------------------------------

  it("19. every emitted suggestion has non-empty evidence, sourceHeuristic, reason, and recommendation", () => {
    // Construct an input that triggers several heuristics at once.
    const ledger: LedgerEntry[] = [
      // P1 — H1 remove_rule (3 denied, 0 bypassed).
      makeLedger({ runId: "r1", timestamp: "t1", outcome: "denied", policyResult: { decision: "deny", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
      makeLedger({ runId: "r2", timestamp: "t2", outcome: "denied", policyResult: { decision: "deny", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
      makeLedger({ runId: "r3", timestamp: "t3", outcome: "denied", policyResult: { decision: "deny", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
      // P2 — H2 tighten (3 completed matches on path p2.ts + 3 test failures).
      makeLedger({ runId: "r4", timestamp: "t4", outcome: "completed", filesChanged: ["p2.ts"], policyResult: { decision: "allow", reason: "x", matchedPolicies: ["P2"], requiredApprovals: [] } }),
      makeLedger({ runId: "r5", timestamp: "t5", outcome: "completed", filesChanged: ["p2.ts"], policyResult: { decision: "allow", reason: "x", matchedPolicies: ["P2"], requiredApprovals: [] } }),
      makeLedger({ runId: "r6", timestamp: "t6", outcome: "completed", filesChanged: ["p2.ts"], policyResult: { decision: "allow", reason: "x", matchedPolicies: ["P2"], requiredApprovals: [] } }),
    ];
    const failures: FailureRecord[] = [
      makeFailure({ runId: "f1", timestamp: "t1", failureType: "test_failure", filePaths: ["p2.ts"] }),
      makeFailure({ runId: "f2", timestamp: "t2", failureType: "test_failure", filePaths: ["p2.ts"] }),
      makeFailure({ runId: "f3", timestamp: "t3", failureType: "test_failure", filePaths: ["p2.ts"] }),
      // H3 — ungoverned path recurring 3 times.
      makeFailure({ runId: "u1", timestamp: "t1", failureType: "test_failure", filePaths: ["ungoverned.ts"] }),
      makeFailure({ runId: "u2", timestamp: "t2", failureType: "test_failure", filePaths: ["ungoverned.ts"] }),
      makeFailure({ runId: "u3", timestamp: "t3", failureType: "test_failure", filePaths: ["ungoverned.ts"] }),
    ];
    const out = computePolicySuggestions(ledger, failures);
    assert.ok(out.length >= 3, "expected multiple suggestions to validate");
    for (const s of out) {
      assert.ok(s.reason && s.reason.trim().length > 0, "reason must be non-empty");
      assert.ok(s.recommendation && s.recommendation.trim().length > 0, "recommendation must be non-empty");
      assert.ok(s.sourceHeuristic, "sourceHeuristic must be set");
      assert.ok(typeof s.confidence === "number" && s.confidence >= MIN_CONFIDENCE);
      const ev = s.evidence;
      const anyNonZero =
        ev.matchedCount !== 0 ||
        ev.deniedCount !== 0 ||
        ev.bypassedCount !== 0 ||
        ev.relatedFailureCount !== 0;
      assert.ok(anyNonZero, "evidence must have at least one non-zero count");
    }
  });

  // -------------------------------------------------------------------------
  // Determinism
  // -------------------------------------------------------------------------

  it("20. identical inputs yield identical outputs (deterministic)", () => {
    const ledger: LedgerEntry[] = [
      makeLedger({ runId: "r1", timestamp: "t1", outcome: "denied", filesChanged: ["a.ts"], policyResult: { decision: "deny", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
      makeLedger({ runId: "r2", timestamp: "t2", outcome: "denied", filesChanged: ["a.ts"], policyResult: { decision: "deny", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
      makeLedger({ runId: "r3", timestamp: "t3", outcome: "denied", filesChanged: ["a.ts"], policyResult: { decision: "deny", reason: "x", matchedPolicies: ["P1"], requiredApprovals: [] } }),
    ];
    const failures: FailureRecord[] = [
      makeFailure({ runId: "f1", timestamp: "t1", failureType: "test_failure", filePaths: ["a.ts"] }),
      makeFailure({ runId: "f2", timestamp: "t2", failureType: "test_failure", filePaths: ["a.ts"] }),
      makeFailure({ runId: "f3", timestamp: "t3", failureType: "test_failure", filePaths: ["a.ts"] }),
    ];
    const a = computePolicySuggestions(ledger, failures);
    const b = computePolicySuggestions(ledger, failures);
    assert.deepStrictEqual(a, b);
  });

  // -------------------------------------------------------------------------
  // Per-heuristic provenance
  // -------------------------------------------------------------------------

  it("21. per-heuristic provenance: each of H1-H5 carries its own sourceHeuristic, non-empty reason/recommendation, and >=1 non-zero evidence count", () => {
    // --- H1 (loosen) ---
    const h1Ledger: LedgerEntry[] = [
      makeLedger({ runId: "h1a", timestamp: "t1", outcome: "denied", policyResult: { decision: "deny", reason: "x", matchedPolicies: ["H1P"], requiredApprovals: [] } }),
      makeLedger({ runId: "h1b", timestamp: "t2", outcome: "denied", policyResult: { decision: "deny", reason: "x", matchedPolicies: ["H1P"], requiredApprovals: [] } }),
      makeLedger({ runId: "h1c", timestamp: "t3", outcome: "completed", policyResult: { decision: "allow", reason: "x", matchedPolicies: ["H1P"], requiredApprovals: [] } }),
      makeLedger({ runId: "h1d", timestamp: "t4", outcome: "denied", policyResult: { decision: "deny", reason: "x", matchedPolicies: ["H1P"], requiredApprovals: [] } }),
    ];
    const h1Out = computePolicySuggestions(h1Ledger, []);
    const h1 = h1Out.find((s) => s.policyId === "H1P");
    assert.ok(h1, "H1 should fire");
    assert.strictEqual(h1.sourceHeuristic, "H1");
    assert.ok(h1.reason.length > 0);
    assert.ok(h1.recommendation.length > 0);
    assert.ok(
      h1.evidence.matchedCount > 0 || h1.evidence.deniedCount > 0 ||
      h1.evidence.bypassedCount > 0 || h1.evidence.relatedFailureCount > 0,
    );

    // --- H2 (tighten) ---
    const h2Ledger: LedgerEntry[] = [
      makeLedger({ runId: "h2a", timestamp: "t1", outcome: "completed", filesChanged: ["h2.ts"], policyResult: { decision: "allow", reason: "x", matchedPolicies: ["H2P"], requiredApprovals: [] } }),
      makeLedger({ runId: "h2b", timestamp: "t2", outcome: "completed", filesChanged: ["h2.ts"], policyResult: { decision: "allow", reason: "x", matchedPolicies: ["H2P"], requiredApprovals: [] } }),
      makeLedger({ runId: "h2c", timestamp: "t3", outcome: "completed", filesChanged: ["h2.ts"], policyResult: { decision: "allow", reason: "x", matchedPolicies: ["H2P"], requiredApprovals: [] } }),
    ];
    const h2Failures: FailureRecord[] = [
      makeFailure({ runId: "h2f1", timestamp: "t1", failureType: "test_failure", filePaths: ["h2.ts"] }),
      makeFailure({ runId: "h2f2", timestamp: "t2", failureType: "test_failure", filePaths: ["h2.ts"] }),
      makeFailure({ runId: "h2f3", timestamp: "t3", failureType: "test_failure", filePaths: ["h2.ts"] }),
    ];
    const h2Out = computePolicySuggestions(h2Ledger, h2Failures);
    const h2 = h2Out.find((s) => s.policyId === "H2P");
    assert.ok(h2, "H2 should fire");
    assert.strictEqual(h2.sourceHeuristic, "H2");
    assert.ok(h2.reason.length > 0);
    assert.ok(h2.recommendation.length > 0);
    assert.ok(h2.evidence.matchedCount > 0);

    // --- H3 (add_rule, ungoverned) ---
    const h3Failures: FailureRecord[] = [
      makeFailure({ runId: "h3f1", timestamp: "t1", failureType: "test_failure", filePaths: ["h3.ts"] }),
      makeFailure({ runId: "h3f2", timestamp: "t2", failureType: "test_failure", filePaths: ["h3.ts"] }),
      makeFailure({ runId: "h3f3", timestamp: "t3", failureType: "test_failure", filePaths: ["h3.ts"] }),
    ];
    const h3Out = computePolicySuggestions([], h3Failures);
    const h3 = h3Out.find((s) => s.sourceHeuristic === "H3");
    assert.ok(h3, "H3 should fire");
    assert.strictEqual(h3.type, "add_rule");
    assert.ok(h3.reason.length > 0);
    assert.ok(h3.recommendation.length > 0);
    assert.ok(h3.evidence.bypassedCount > 0 || h3.evidence.relatedFailureCount > 0);

    // --- H4 (add_rule, verification + test cluster) ---
    // PolicyIds are set so H3 does not also fire on these failures.
    const h4Failures: FailureRecord[] = [
      makeFailure({ runId: "h4v1", timestamp: "t1", failureType: "verification_timeout", filePaths: ["h4.ts"], policyIds: ["H4-other"] }),
      makeFailure({ runId: "h4v2", timestamp: "t2", failureType: "verification_timeout", filePaths: ["h4.ts"], policyIds: ["H4-other"] }),
      makeFailure({ runId: "h4v3", timestamp: "t3", failureType: "verification_timeout", filePaths: ["h4.ts"], policyIds: ["H4-other"] }),
      makeFailure({ runId: "h4t1", timestamp: "t4", failureType: "test_failure", filePaths: ["h4.ts"], policyIds: ["H4-other"] }),
      makeFailure({ runId: "h4t2", timestamp: "t5", failureType: "test_failure", filePaths: ["h4.ts"], policyIds: ["H4-other"] }),
      makeFailure({ runId: "h4t3", timestamp: "t6", failureType: "test_failure", filePaths: ["h4.ts"], policyIds: ["H4-other"] }),
    ];
    const h4Out = computePolicySuggestions([], h4Failures);
    const h4 = h4Out.find((s) => s.sourceHeuristic === "H4");
    assert.ok(h4, "H4 should fire");
    assert.strictEqual(h4.type, "add_rule");
    assert.ok(h4.reason.length > 0);
    assert.ok(h4.recommendation.length > 0);
    assert.ok(h4.evidence.bypassedCount > 0 || h4.evidence.relatedFailureCount > 0);

    // --- H5 (loosen, repeated policy_denied) ---
    const h5Failures: FailureRecord[] = [
      makeFailure({ runId: "h5d1", timestamp: "t1", failureType: "policy_denied", policyIds: ["H5P"] }),
      makeFailure({ runId: "h5d2", timestamp: "t2", failureType: "policy_denied", policyIds: ["H5P"] }),
      makeFailure({ runId: "h5d3", timestamp: "t3", failureType: "policy_denied", policyIds: ["H5P"] }),
    ];
    const h5Out = computePolicySuggestions([], h5Failures);
    const h5 = h5Out.find((s) => s.policyId === "H5P");
    assert.ok(h5, "H5 should fire");
    assert.strictEqual(h5.sourceHeuristic, "H5");
    assert.strictEqual(h5.type, "loosen");
    assert.ok(h5.reason.length > 0);
    assert.ok(h5.recommendation.length > 0);
    assert.ok(h5.evidence.relatedFailureCount > 0);
  });
});
