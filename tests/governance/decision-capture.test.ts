/**
 * Tests for P14.3 — Decision Capture.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import {
  validateOperatorDecision,
  FileDecisionStore,
  createOperatorDecision,
  type OperatorDecision,
  type DecisionKind,
} from "../../src/governance/decision-capture.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = "2026-07-06T12:00:00.000Z";

function validDecision(overrides: Partial<OperatorDecision> = {}): OperatorDecision {
  return {
    decisionId: "dec-test-1",
    signalId: "sig-test-1",
    decision: "accept",
    rationale: "Agree with P13 analysis — actionable signal",
    decider: "Test Operator",
    reviewId: null,
    actionProposalId: null,
    createdAt: NOW,
    ...overrides,
  };
}

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "gov-dec-test-"));
}

function cleanupTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function setupStore(): { store: FileDecisionStore; cleanup: () => void } {
  const dir = makeTempDir();
  return { store: new FileDecisionStore(dir), cleanup: () => cleanupTempDir(dir) };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("validateOperatorDecision", () => {
  it("accepts a valid accept decision", () => {
    const result = validateOperatorDecision(validDecision());
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it("accepts all five decision kinds", () => {
    for (const kind of ["accept", "dismiss", "defer", "escalate", "convert_to_issue"] as DecisionKind[]) {
      const result = validateOperatorDecision(validDecision({ decision: kind }));
      assert.equal(result.valid, true, `kind ${kind} should be valid`);
    }
  });

  it("rejects non-object", () => {
    const result = validateOperatorDecision("not-an-object");
    assert.equal(result.valid, false);
  });

  it("rejects empty object", () => {
    const result = validateOperatorDecision({});
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("decisionId")));
  });

  it("rejects missing decisionId", () => {
    const result = validateOperatorDecision(validDecision({ decisionId: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("decisionId")));
  });

  it("rejects missing signalId", () => {
    const result = validateOperatorDecision(validDecision({ signalId: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("signalId")));
  });

  it("rejects invalid decision kind", () => {
    const result = validateOperatorDecision(validDecision({ decision: "unknown" as DecisionKind }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("decision")));
  });

  it("rejects empty rationale", () => {
    const result = validateOperatorDecision(validDecision({ rationale: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("rationale")));
  });

  it("rejects missing decider", () => {
    const result = validateOperatorDecision(validDecision({ decider: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("decider")));
  });

  it("rejects non-null actionProposalId", () => {
    // Spread valid decision, then override actionProposalId via cast to test rejection
    const bad = { ...validDecision(), actionProposalId: "prop-1" };
    const result = validateOperatorDecision(bad as unknown as OperatorDecision);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("actionProposalId")));
  });

  it("accepts reviewId as non-empty string", () => {
    const result = validateOperatorDecision(validDecision({ reviewId: "rev-1" }));
    assert.equal(result.valid, true);
  });

  it("rejects reviewId as empty string", () => {
    const result = validateOperatorDecision(validDecision({ reviewId: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("reviewId")));
  });
});

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

describe("FileDecisionStore", () => {
  it("returns empty list from non-existent file", async () => {
    const { store } = setupStore();
    assert.deepEqual(await store.list(), []);
  });

  it("appends and lists newest-first", async () => {
    const { store } = setupStore();
    await store.append(validDecision({ decisionId: "d1", createdAt: "2026-01-01T00:00:00Z" }));
    await store.append(validDecision({ decisionId: "d2", createdAt: "2026-06-01T00:00:00Z" }));

    const all = await store.list();
    assert.equal(all.length, 2);
    assert.equal(all[0]!.decisionId, "d2");
    assert.equal(all[1]!.decisionId, "d1");
  });

  it("lists with limit", async () => {
    const { store } = setupStore();
    await store.append(validDecision({ decisionId: "d1" }));
    await store.append(validDecision({ decisionId: "d2" }));
    await store.append(validDecision({ decisionId: "d3" }));

    assert.equal((await store.list(2)).length, 2);
  });

  it("getById returns matching decision", async () => {
    const { store } = setupStore();
    await store.append(validDecision({ decisionId: "find-me" }));
    await store.append(validDecision({ decisionId: "other" }));

    const found = await store.getById("find-me");
    assert.notEqual(found, null);
    assert.equal(found!.decisionId, "find-me");
  });

  it("getById returns null for missing", async () => {
    const { store } = setupStore();
    assert.equal(await store.getById("nonexistent"), null);
  });

  it("getBySignalId returns decisions for a signal", async () => {
    const { store } = setupStore();
    await store.append(validDecision({ decisionId: "d1", signalId: "sig-a" }));
    await store.append(validDecision({ decisionId: "d2", signalId: "sig-b" }));
    await store.append(validDecision({ decisionId: "d3", signalId: "sig-a" }));

    const forSigA = await store.getBySignalId("sig-a");
    assert.equal(forSigA.length, 2);
    assert.ok(forSigA.every((d) => d.signalId === "sig-a"));
  });

  it("getByKind filters by decision kind", async () => {
    const { store } = setupStore();
    await store.append(validDecision({ decisionId: "d1", decision: "accept" }));
    await store.append(validDecision({ decisionId: "d2", decision: "dismiss" }));
    await store.append(validDecision({ decisionId: "d3", decision: "accept" }));

    const accepts = await store.getByKind("accept");
    assert.equal(accepts.length, 2);
    assert.ok(accepts.every((d) => d.decision === "accept"));
  });

  it("skips malformed JSON lines on read", async () => {
    const dir = makeTempDir();
    const store = new FileDecisionStore(dir);
    const filePath = join(dir, "governance-decisions.jsonl");
    writeFileSync(filePath, "{invalid}\n" + JSON.stringify(validDecision({ decisionId: "d1" })) + "\n", "utf8");

    const all = await store.list();
    assert.equal(all.length, 1);
    assert.equal(all[0]!.decisionId, "d1");
    cleanupTempDir(dir);
  });

  it("rejects invalid decision on append", async () => {
    const { store } = setupStore();
    await assert.rejects(
      () => store.append({} as unknown as OperatorDecision),
      /Invalid decision/,
    );
  });

  it("creates directory on first append", async () => {
    const nestedDir = join(makeTempDir(), "deep", "nested");
    const nestedStore = new FileDecisionStore(nestedDir);
    await nestedStore.append(validDecision({ decisionId: "d1" }));
    assert.ok(existsSync(join(nestedDir, "governance-decisions.jsonl")));
    cleanupTempDir(nestedDir);
  });
});

// ---------------------------------------------------------------------------
// Decision creation
// ---------------------------------------------------------------------------

describe("createOperatorDecision", () => {
  it("creates an accept decision when signal exists", async () => {
    const signal = { signalId: "sig-1" };

    const decision = await createOperatorDecision(
      "dec-1", "sig-1", signal, "accept", "Valid signal", "Operator", null, null, NOW,
    );

    assert.equal(decision.decision, "accept");
    assert.equal(decision.signalId, "sig-1");
    assert.equal(decision.rationale, "Valid signal");
    assert.equal(decision.decider, "Operator");
    assert.equal(decision.reviewId, null);
    assert.equal(decision.actionProposalId, null);
  });

  it("creates all five decision kinds", async () => {
    const signal = { signalId: "sig-1" };

    for (const kind of ["accept", "dismiss", "defer", "escalate", "convert_to_issue"] as DecisionKind[]) {
      const decision = await createOperatorDecision(
        `dec-${kind}`, "sig-1", signal, kind, `Rationale for ${kind}`, "Operator", null, null, NOW,
      );
      assert.equal(decision.decision, kind);
    }
  });

  it("actionProposalId is always null", async () => {
    const signal = { signalId: "sig-1" };
    const decision = await createOperatorDecision(
      "dec-null", "sig-1", signal, "accept", "Check", "Operator", null, null, NOW,
    );
    assert.strictEqual(decision.actionProposalId, null);
  });

  it("throws when signal does not exist", async () => {
    await assert.rejects(
      () => createOperatorDecision("dec-1", "missing", null, "accept", "reason", "Operator", null, null, NOW),
      /Signal not found/,
    );
  });

  it("throws when rationale is empty", async () => {
    const signal = { signalId: "sig-1" };
    await assert.rejects(
      () => createOperatorDecision("dec-1", "sig-1", signal, "accept", "", "Operator", null, null, NOW),
      /Rationale is required/,
    );
  });

  it("throws when rationale is whitespace-only", async () => {
    const signal = { signalId: "sig-1" };
    await assert.rejects(
      () => createOperatorDecision("dec-1", "sig-1", signal, "accept", "   ", "Operator", null, null, NOW),
      /Rationale is required/,
    );
  });

  it("preserves signalId backlink", async () => {
    const signal = { signalId: "sig-target" };
    const decision = await createOperatorDecision(
      "dec-3", "sig-target", signal, "dismiss", "Not relevant", "Operator", null, null, NOW,
    );
    assert.equal(decision.signalId, "sig-target");
  });

  it("accepts optional reviewId when review exists for same signal", async () => {
    const signal = { signalId: "sig-1" };
    const reviewStore = {
      getById: async (id: string) =>
        id === "rev-1" ? { reviewId: "rev-1", signalId: "sig-1" } : null,
    };

    const decision = await createOperatorDecision(
      "dec-4", "sig-1", signal, "accept", "Good", "Operator", "rev-1", reviewStore, NOW,
    );
    assert.equal(decision.reviewId, "rev-1");
  });

  it("throws when reviewId references non-existent review", async () => {
    const signal = { signalId: "sig-1" };
    const reviewStore = { getById: async () => null };

    await assert.rejects(
      () => createOperatorDecision("dec-5", "sig-1", signal, "accept", "Good", "Operator", "missing-review", reviewStore, NOW),
      /Review not found/,
    );
  });

  it("throws when reviewId references review for different signal", async () => {
    const signal = { signalId: "sig-1" };
    const reviewStore = {
      getById: async () => ({ reviewId: "rev-other", signalId: "sig-other" }),
    };

    await assert.rejects(
      () => createOperatorDecision("dec-6", "sig-1", signal, "accept", "Good", "Operator", "rev-other", reviewStore, NOW),
      /same signal/,
    );
  });

  it("throws when reviewId provided but no review store", async () => {
    const signal = { signalId: "sig-1" };
    await assert.rejects(
      () => createOperatorDecision("dec-7", "sig-1", signal, "accept", "Good", "Operator", "rev-1", null, NOW),
      /Review store is required/,
    );
  });
});
