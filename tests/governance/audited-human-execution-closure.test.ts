import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileEvidenceLedgerStore } from "../../src/governance/human-execution-evidence-ledger.js";
import { FileClosureReviewStore } from "../../src/governance/human-execution-closure-review.js";
import { AuditedClosureRecorder } from "../../src/governance/audited-human-execution-closure.js";
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
    summary: "Action completed",
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
let evidenceStore: FileEvidenceLedgerStore;
let reviewStore: FileClosureReviewStore;
let recorder: AuditedClosureRecorder;
let auditPath: string;

describe("AuditedClosureRecorder", () => {
  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "p21-test-"));
    const evPath = join(tmpDir, "evidence.jsonl");
    const revPath = join(tmpDir, "reviews.jsonl");
    auditPath = join(tmpDir, "audit-events.jsonl");
    evidenceStore = new FileEvidenceLedgerStore(evPath);

    // Seed evidence for review validation
    writeFileSync(evPath, JSON.stringify(makeEvidence()) + "\n", "utf-8");
    const evLoader = async () => [makeEvidence()];

    // Need to use the loaded evidence for review store
    // Since review store takes a loader, we create it with the seeded path
    const seededEvLoader = async () => {
      const raw = readFileSync(evPath, "utf-8").trim();
      if (!raw) return [];
      return raw.split("\n").map((l: string) => JSON.parse(l) as HumanExecutionEvidenceRef);
    };

    reviewStore = new FileClosureReviewStore(revPath, seededEvLoader);
    recorder = new AuditedClosureRecorder(evidenceStore, reviewStore, auditPath);
  });

  it("evidence append emits audit event", async () => {
    const ref = makeEvidence({ evidenceId: "ev-audit-1" });
    const result = await recorder.appendEvidence(ref);
    assert.ok(result.auditRefs.length > 0);
    assert.ok(result.auditRefs[0]!.length > 0);
  });

  it("stored evidence includes auditRefs", async () => {
    const all = await evidenceStore.listEvidence();
    const audited = all.find((e) => e.evidenceId === "ev-audit-1");
    assert.ok(audited);
    assert.ok(audited.auditRefs.length > 0);
  });

  it("closure review emits audit event", async () => {
    const review = makeReview({ closureReviewId: "cr-audit-1" });
    const result = await recorder.appendReview(review);
    assert.ok(result.auditRefs.length > 0);
    assert.ok(result.auditRefs[0]!.length > 0);
  });

  it("stored review includes auditRefs", async () => {
    const all = await reviewStore.listReviews();
    const audited = all.find((r) => r.closureReviewId === "cr-audit-1");
    assert.ok(audited);
    assert.ok(audited.auditRefs.length > 0);
  });

  it("recorder preserves evidence validation failures", async () => {
    const { EvidenceLedgerError } = await import("../../src/governance/human-execution-evidence-ledger.js");
    await assert.rejects(
      () => recorder.appendEvidence(makeEvidence({ handoffId: "" })),
      EvidenceLedgerError,
    );
  });

  it("recorder preserves closure review validation failures", async () => {
    const { ClosureReviewError } = await import("../../src/governance/human-execution-closure-review.js");
    await assert.rejects(
      () => recorder.appendReview(makeReview({ evidenceIds: [] })),
      ClosureReviewError,
    );
  });

  it("audit events are appended to audit file", async () => {
    const raw = readFileSync(auditPath, "utf-8").trim();
    const lines = raw.split("\n").filter(Boolean);
    const evidenceEvents = lines.filter((l) => l.includes("human_execution_evidence_appended"));
    const reviewEvents = lines.filter((l) => l.includes("human_execution_closure_reviewed"));
    assert.ok(evidenceEvents.length > 0);
    assert.ok(reviewEvents.length > 0);
  });
});
