/**
 * Tests for P14.2 — Operator Review Session.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import {
  validateOperatorReview,
  FileReviewStore,
  createOperatorReview,
  resolveReviewer,
  type OperatorReview,
} from "../../src/governance/operator-review.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = "2026-07-06T12:00:00.000Z";

function validReview(overrides: Partial<OperatorReview> = {}): OperatorReview {
  return {
    reviewId: "rev-test-1",
    signalId: "sig-test-1",
    reviewer: "Test Operator",
    notes: "Observed pattern in approval queue",
    classification: null,
    createdAt: NOW,
    ...overrides,
  };
}

function validReviewWithClassification(overrides: Partial<OperatorReview> = {}): OperatorReview {
  return {
    reviewId: "rev-test-2",
    signalId: "sig-test-1",
    reviewer: "Test Operator",
    notes: null,
    classification: "false_positive",
    createdAt: NOW,
    ...overrides,
  };
}

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "gov-review-test-"));
}

function cleanupTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function setupStore(): { store: FileReviewStore; cleanup: () => void } {
  const dir = makeTempDir();
  return { store: new FileReviewStore(dir), cleanup: () => cleanupTempDir(dir) };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("validateOperatorReview", () => {
  it("accepts a valid review with notes", () => {
    const result = validateOperatorReview(validReview());
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it("accepts a valid review with classification", () => {
    const result = validateOperatorReview(validReviewWithClassification());
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it("accepts a review with both notes and classification", () => {
    const result = validateOperatorReview(validReview({
      notes: "Some notes",
      classification: "needs_investigation",
    }));
    assert.equal(result.valid, true);
  });

  it("rejects non-object", () => {
    const result = validateOperatorReview("not-an-object");
    assert.equal(result.valid, false);
  });

  it("rejects empty object", () => {
    const result = validateOperatorReview({});
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("reviewId")));
  });

  it("rejects missing reviewId", () => {
    const result = validateOperatorReview(validReview({ reviewId: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("reviewId")));
  });

  it("rejects missing signalId", () => {
    const result = validateOperatorReview(validReview({ signalId: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("signalId")));
  });

  it("rejects missing reviewer", () => {
    const result = validateOperatorReview(validReview({ reviewer: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("reviewer")));
  });

  it("rejects missing createdAt", () => {
    const result = validateOperatorReview(validReview({ createdAt: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("createdAt")));
  });

  it("rejects when both notes and classification are null", () => {
    const result = validateOperatorReview(validReview({
      notes: null,
      classification: null,
    }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("notes or classification")));
  });

  it("rejects when both notes and classification are empty strings", () => {
    const result = validateOperatorReview(validReview({
      notes: "",
      classification: "",
      reviewer: "x",
      reviewId: "r1",
      signalId: "s1",
      createdAt: NOW,
    }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("notes or classification")));
  });
});

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

describe("FileReviewStore", () => {
  it("returns empty list from non-existent file", async () => {
    const { store } = setupStore();
    const reviews = await store.list();
    assert.deepEqual(reviews, []);
  });

  it("appends and lists reviews newest-first", async () => {
    const { store } = setupStore();
    await store.append(validReview({ reviewId: "r1", createdAt: "2026-01-01T00:00:00Z" }));
    await store.append(validReview({ reviewId: "r2", createdAt: "2026-06-01T00:00:00Z" }));

    const all = await store.list();
    assert.equal(all.length, 2);
    assert.equal(all[0]!.reviewId, "r2");
    assert.equal(all[1]!.reviewId, "r1");
  });

  it("lists with limit", async () => {
    const { store } = setupStore();
    await store.append(validReview({ reviewId: "r1" }));
    await store.append(validReview({ reviewId: "r2" }));
    await store.append(validReview({ reviewId: "r3" }));

    assert.equal((await store.list(2)).length, 2);
  });

  it("getById returns matching review", async () => {
    const { store } = setupStore();
    await store.append(validReview({ reviewId: "find-me" }));
    await store.append(validReview({ reviewId: "other" }));

    const found = await store.getById("find-me");
    assert.notEqual(found, null);
    assert.equal(found!.reviewId, "find-me");
  });

  it("getById returns null for missing", async () => {
    const { store } = setupStore();
    assert.equal(await store.getById("nonexistent"), null);
  });

  it("getBySignalId returns reviews for a signal", async () => {
    const { store } = setupStore();
    await store.append(validReview({ reviewId: "r1", signalId: "sig-a" }));
    await store.append(validReview({ reviewId: "r2", signalId: "sig-b" }));
    await store.append(validReview({ reviewId: "r3", signalId: "sig-a" }));

    const forSigA = await store.getBySignalId("sig-a");
    assert.equal(forSigA.length, 2);
    assert.ok(forSigA.every((r) => r.signalId === "sig-a"));
  });

  it("getBySignalId returns empty for unknown signal", async () => {
    const { store } = setupStore();
    assert.deepEqual(await store.getBySignalId("unknown"), []);
  });

  it("skips malformed JSON lines on read", async () => {
    const dir = makeTempDir();
    const store = new FileReviewStore(dir);
    const filePath = join(dir, "governance-reviews.jsonl");
    writeFileSync(filePath, "{invalid}\n" + JSON.stringify(validReview({ reviewId: "r1" })) + "\n", "utf8");

    const all = await store.list();
    assert.equal(all.length, 1);
    assert.equal(all[0]!.reviewId, "r1");
    cleanupTempDir(dir);
  });

  it("rejects invalid review on append", async () => {
    const { store } = setupStore();
    await assert.rejects(
      () => store.append({} as unknown as OperatorReview),
      /Invalid review/,
    );
  });

  it("creates directory on first append", async () => {
    const nestedDir = join(makeTempDir(), "deep", "nested");
    const nestedStore = new FileReviewStore(nestedDir);
    await nestedStore.append(validReview({ reviewId: "r1" }));
    assert.ok(existsSync(join(nestedDir, "governance-reviews.jsonl")));
    cleanupTempDir(nestedDir);
  });

  // Append-only invariant: no update or delete methods exist
  it("has no update or delete methods", () => {
    const store = new FileReviewStore("/tmp");
    assert.equal(typeof (store as any).update, "undefined");
    assert.equal(typeof (store as any).delete, "undefined");
    assert.equal(typeof (store as any).remove, "undefined");
  });
});

// ---------------------------------------------------------------------------
// Reviewer resolution
// ---------------------------------------------------------------------------

describe("resolveReviewer", () => {
  it("uses explicit --as override when provided", () => {
    const reviewer = resolveReviewer("Jane");
    assert.equal(reviewer, "Jane");
  });

  it("returns non-empty string", () => {
    const reviewer = resolveReviewer();
    assert.ok(reviewer.length > 0);
  });
});

// ---------------------------------------------------------------------------
// Review creation
// ---------------------------------------------------------------------------

describe("createOperatorReview", () => {
  it("creates a review when signal exists", async () => {
    const signal = { signalId: "sig-1" };

    const review = await createOperatorReview(
      "rev-1", "sig-1", signal, "Operator",
      "Observed issue", null, NOW,
    );

    assert.equal(review.reviewId, "rev-1");
    assert.equal(review.signalId, "sig-1");
    assert.equal(review.reviewer, "Operator");
    assert.equal(review.notes, "Observed issue");
    assert.equal(review.classification, null);
    assert.equal(review.createdAt, NOW);
  });

  it("creates a review with classification when notes is null", async () => {
    const signal = { signalId: "sig-1" };

    const review = await createOperatorReview(
      "rev-2", "sig-1", signal, "Operator",
      null, "false_positive", NOW,
    );

    assert.equal(review.classification, "false_positive");
    assert.equal(review.notes, null);
  });

  it("throws when signal does not exist", async () => {
    await assert.rejects(
      () => createOperatorReview("rev-1", "missing-sig", null, "Operator", "notes", null, NOW),
      /Signal not found/,
    );
  });

  it("throws when both notes and classification are null", async () => {
    const signal = { signalId: "sig-1" };

    await assert.rejects(
      () => createOperatorReview("rev-1", "sig-1", signal, "Operator", null, null, NOW),
      /Invalid review/,
    );
  });

  it("preserves signalId backlink in created review", async () => {
    const signal = { signalId: "sig-target" };

    const review = await createOperatorReview(
      "rev-3", "sig-target", signal, "Operator",
      "Found issue", "bug", NOW,
    );

    assert.equal(review.signalId, "sig-target");
  });
});
