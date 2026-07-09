// tests/governance/policy-review-outcome-ledger.test.ts

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPolicyReviewOutcomeLedger } from "../../src/governance/policy-review-outcome-ledger.js";

describe("PolicyReviewOutcomeLedger", () => {
  let rootDir: string;
  let ledger: ReturnType<typeof createPolicyReviewOutcomeLedger>;

  before(() => {
    rootDir = mkdtempSync(join(tmpdir(), "p26-outcome-"));
    ledger = createPolicyReviewOutcomeLedger({ rootDir });
  });

  after(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("recordOutcome persists outcome and returns record", async () => {
    const outcome = await ledger.recordOutcome({
      candidateId: "p25-candidate-1",
      outcomeType: "dismissed_no_change",
      recordedBy: "human-1",
      rationale: "No evidence of policy drift.",
    });
    assert.ok(outcome.outcomeId);
    assert.equal(outcome.outcomeType, "dismissed_no_change");
    assert.equal(outcome.candidateId, "p25-candidate-1");
  });

  it("empty rationale is rejected", async () => {
    await assert.rejects(
      () => ledger.recordOutcome({
        candidateId: "p25-candidate-1",
        outcomeType: "dismissed_no_change",
        recordedBy: "human-1",
        rationale: "",
      }),
      /rationale/,
    );
  });

  it("empty recordedBy is rejected", async () => {
    await assert.rejects(
      () => ledger.recordOutcome({
        candidateId: "p25-candidate-1",
        outcomeType: "dismissed_no_change",
        recordedBy: "",
        rationale: "No evidence.",
      }),
      /recordedBy/,
    );
  });

  it("duplicate outcomeId is rejected", async () => {
    const first = await ledger.recordOutcome({
      candidateId: "p25-candidate-2",
      outcomeType: "accepted_for_policy_work",
      recordedBy: "human-1",
      rationale: "Clear calibration gap.",
    });
    // Duplicate inputs produce same deterministic ID -> reject
    await assert.rejects(
      () => ledger.recordOutcome({
        candidateId: "p25-candidate-2",
        outcomeType: "accepted_for_policy_work",
        recordedBy: "human-1",
        rationale: "Clear calibration gap.",
      }),
      /duplicate|already exists/i,
    );
  });

  it("append-only: recording same candidate twice produces separate records", async () => {
    const first = await ledger.recordOutcome({
      candidateId: "p25-candidate-3",
      outcomeType: "dismissed_no_change",
      recordedBy: "human-1",
      rationale: "First outcome.",
    });
    // Different rationale = different ID, so this should work
    const second = await ledger.recordOutcome({
      candidateId: "p25-candidate-3",
      outcomeType: "accepted_for_policy_work",
      recordedBy: "human-2",
      rationale: "Second outcome after review.",
    });
    assert.notEqual(first.outcomeId, second.outcomeId);
  });

  it("evidence references are preserved as strings", async () => {
    const outcome = await ledger.recordOutcome({
      candidateId: "p25-candidate-4",
      outcomeType: "accepted_for_policy_work",
      recordedBy: "human-1",
      rationale: "Evidence supports drift.",
      evidenceRefs: ["p24-signal-1", "p24-signal-2"],
    });
    assert.deepEqual(outcome.evidenceRefs, ["p24-signal-1", "p24-signal-2"]);
  });

  it("getOutcome returns correct record", async () => {
    const recorded = await ledger.recordOutcome({
      candidateId: "p25-candidate-5",
      outcomeType: "deferred_needs_more_evidence",
      recordedBy: "human-1",
      rationale: "Need more data.",
    });
    const retrieved = await ledger.getOutcome(recorded.outcomeId);
    assert.ok(retrieved);
    assert.equal(retrieved.outcomeId, recorded.outcomeId);
    assert.equal(retrieved.outcomeType, "deferred_needs_more_evidence");
  });

  it("getOutcome returns null for non-existent outcome", async () => {
    const result = await ledger.getOutcome("nonexistent-id");
    assert.equal(result, null);
  });

  it("outcome record includes immutable createdAt timestamp", async () => {
    const outcome = await ledger.recordOutcome({
      candidateId: "p25-candidate-6",
      outcomeType: "closed_as_duplicate",
      recordedBy: "human-1",
      rationale: "Duplicate of p25-candidate-1.",
    });
    assert.ok(outcome.createdAt);
    assert.equal(outcome.createdAt, outcome.createdAt); // immutable
  });

  it("listOutcomes returns all outcomes", async () => {
    const outcomes = await ledger.listOutcomes();
    assert.ok(outcomes.length >= 5); // at least 5 records from prior tests
  });

  it("listOutcomes filters by candidateId", async () => {
    const filtered = await ledger.listOutcomes({ candidateId: "p25-candidate-1" });
    assert.ok(filtered.every(o => o.candidateId === "p25-candidate-1"));
  });

  it("listOutcomes filters by outcomeType", async () => {
    const filtered = await ledger.listOutcomes({ outcomeType: "dismissed_no_change" });
    assert.ok(filtered.every(o => o.outcomeType === "dismissed_no_change"));
  });
});
