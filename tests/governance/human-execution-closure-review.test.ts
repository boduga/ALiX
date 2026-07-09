import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  FileClosureReviewStore,
  ClosureReviewError,
  validateReview,
  deriveLatestState,
  validateTransition,
} from "../../src/governance/human-execution-closure-review.js";
import type { HumanExecutionEvidenceRef } from "../../src/governance/human-execution-closure-types.js";
import type { HumanExecutionClosureReview } from "../../src/governance/human-execution-closure-types.js";

const VALID_ISO = "2026-07-08T18:00:00.000Z";

function makeEvidence(overrides: Partial<HumanExecutionEvidenceRef> = {}): HumanExecutionEvidenceRef {
  return {
    evidenceId: "ev-1",
    handoffId: "ho-1",
    preparedRecordId: null,
    kind: "log_ref",
    uri: "https://example.com/log",
    label: "Log",
    summary: "Done",
    submittedBy: "op",
    submittedAt: VALID_ISO,
    contentHash: null,
    auditRefs: [],
    ...overrides,
  };
}

function makeReview(overrides: Partial<HumanExecutionClosureReview> = {}): HumanExecutionClosureReview {
  return {
    closureReviewId: "cr-1",
    handoffId: "ho-1",
    preparedRecordId: null,
    decision: "accepted",
    rationale: "Evidence sufficient",
    reviewedBy: "reviewer-1",
    reviewedAt: VALID_ISO,
    evidenceIds: ["ev-1"],
    followUpRequired: false,
    followUpSummary: null,
    auditRefs: [],
    ...overrides,
  };
}

let tmpDir: string;
let store: FileClosureReviewStore;
let evidenceLoader: () => Promise<HumanExecutionEvidenceRef[]>;
const storePath = () => join(tmpDir, "closure-reviews.jsonl");

describe("validateReview (pure)", () => {
  it("accepted review succeeds with evidence", () => {
    const review = makeReview();
    validateReview(review, [makeEvidence()], null);
  });

  it("rejected review succeeds with evidence", () => {
    const review = makeReview({ decision: "rejected" });
    validateReview(review, [makeEvidence()], null);
  });

  it("incomplete requires follow-up summary", () => {
    const review = makeReview({ decision: "incomplete", followUpSummary: null });
    assert.throws(
      () => validateReview(review, [makeEvidence()], null),
      ClosureReviewError,
    );
  });

  it("needs_follow_up requires follow-up summary", () => {
    const review = makeReview({ decision: "needs_follow_up", followUpSummary: null });
    assert.throws(
      () => validateReview(review, [makeEvidence()], null),
      ClosureReviewError,
    );
  });

  it("closure without evidence fails", () => {
    const review = makeReview({ evidenceIds: [] });
    assert.throws(
      () => validateReview(review, [], null),
      ClosureReviewError,
    );
  });

  it("unknown evidence ID fails", () => {
    const review = makeReview({ evidenceIds: ["unknown-ev"] });
    assert.throws(
      () => validateReview(review, [makeEvidence()], null),
      ClosureReviewError,
    );
  });

  it("evidence ID from another handoff fails", () => {
    const evidence = makeEvidence({ handoffId: "ho-other" });
    const review = makeReview({ evidenceIds: ["ev-1"], handoffId: "ho-1" });
    assert.throws(
      () => validateReview(review, [evidence], null),
      ClosureReviewError,
    );
  });

  it("terminal closure cannot be reopened", () => {
    const review = makeReview({ decision: "incomplete" });
    assert.throws(
      () => validateReview(review, [makeEvidence()], "accepted"),
      ClosureReviewError,
    );
    assert.throws(
      () => validateReview(review, [makeEvidence()], "rejected"),
      ClosureReviewError,
    );
  });

  it("incomplete can transition after later evidence", () => {
    const review = makeReview({ decision: "accepted", evidenceIds: ["ev-2"] });
    const ev2 = makeEvidence({ evidenceId: "ev-2", handoffId: "ho-1" });
    validateReview(review, [makeEvidence(), ev2], "incomplete");
  });

  it("needs_follow_up can transition after later evidence", () => {
    const review = makeReview({ decision: "accepted", evidenceIds: ["ev-2"] });
    const ev2 = makeEvidence({ evidenceId: "ev-2", handoffId: "ho-1" });
    validateReview(review, [makeEvidence(), ev2], "needs_follow_up");
  });
});

describe("deriveLatestState (pure)", () => {
  it("no reviews, no evidence → prepared", () => {
    assert.equal(deriveLatestState([], []), "prepared");
  });

  it("no reviews, has evidence → evidence_submitted", () => {
    assert.equal(deriveLatestState([makeEvidence()], []), "evidence_submitted");
  });

  it("latest review accepted → accepted", () => {
    const reviews = [makeReview({ decision: "accepted" })];
    assert.equal(deriveLatestState([makeEvidence()], reviews), "accepted");
  });

  it("latest review rejected → rejected", () => {
    const reviews = [makeReview({ decision: "rejected" })];
    assert.equal(deriveLatestState([makeEvidence()], reviews), "rejected");
  });

  it("latest review incomplete → incomplete", () => {
    const reviews = [makeReview({ decision: "incomplete", evidenceIds: ["ev-1"], followUpSummary: "Need more" })];
    assert.equal(deriveLatestState([makeEvidence()], reviews), "incomplete");
  });
});

describe("FileClosureReviewStore", () => {
  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "p21-test-"));
    const evStorePath = join(tmpDir, "evidence-ledger.jsonl");
    writeFileSync(evStorePath, JSON.stringify(makeEvidence()) + "\n", "utf-8");
    evidenceLoader = async () => {
      const raw = evStorePath;
      const { readFileSync, existsSync } = await import("node:fs");
      if (!existsSync(raw)) return [];
      return readFileSync(raw, "utf-8").trim().split("\n").filter(Boolean).map(
        (l) => JSON.parse(l) as HumanExecutionEvidenceRef,
      );
    };
    store = new FileClosureReviewStore(storePath(), evidenceLoader);
  });

  it("appends valid review", async () => {
    const review = makeReview();
    const result = await store.appendReview(review);
    assert.equal(result.closureReviewId, "cr-1");
  });

  it("lists all reviews", async () => {
    const all = await store.listReviews();
    assert.ok(all.length >= 1);
  });

  it("lists reviews for handoff", async () => {
    const forHo = await store.listReviewsForHandoff("ho-1");
    assert.ok(forHo.length >= 1);
    assert.ok(forHo.every((r) => r.handoffId === "ho-1"));
  });
});
