import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, unlinkSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileEvidenceLedgerStore, EvidenceLedgerError } from "../../src/governance/human-execution-evidence-ledger.js";
import type { HumanExecutionEvidenceRef } from "../../src/governance/human-execution-closure-types.js";

const VALID_ISO = "2026-07-08T18:00:00.000Z";

function makeRef(overrides: Partial<HumanExecutionEvidenceRef> = {}): HumanExecutionEvidenceRef {
  return {
    evidenceId: "ev-1",
    handoffId: "ho-1",
    preparedRecordId: null,
    kind: "log_ref",
    uri: "https://example.com/log",
    label: "Execution log",
    summary: "Manual action completed successfully",
    submittedBy: "operator-1",
    submittedAt: VALID_ISO,
    contentHash: null,
    auditRefs: [],
    ...overrides,
  };
}

let tmpDir: string;
let store: FileEvidenceLedgerStore;
const storePath = () => join(tmpDir, "evidence-ledger.jsonl");

describe("FileEvidenceLedgerStore", () => {
  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "p21-test-"));
    store = new FileEvidenceLedgerStore(storePath());
  });

  it("appends valid evidence", async () => {
    const ref = makeRef();
    const result = await store.appendEvidence(ref);
    assert.equal(result.evidenceId, "ev-1");
    assert.equal(result.handoffId, "ho-1");
  });

  it("lists all evidence", async () => {
    const all = await store.listEvidence();
    assert.ok(all.length >= 1);
    assert.ok(all.some((e) => e.evidenceId === "ev-1"));
  });

  it("lists evidence by handoff", async () => {
    const ref = makeRef({ evidenceId: "ev-ho1", handoffId: "ho-1" });
    await store.appendEvidence(ref);
    const forHo1 = await store.listEvidenceForHandoff("ho-1");
    assert.ok(forHo1.length >= 2);
    assert.ok(forHo1.every((e) => e.handoffId === "ho-1"));
  });

  it("rejects duplicate evidenceId for same handoff", async () => {
    await assert.rejects(
      () => store.appendEvidence(makeRef({ evidenceId: "ev-1", handoffId: "ho-1" })),
      EvidenceLedgerError,
    );
  });

  it("rejects missing handoffId", async () => {
    await assert.rejects(
      () => store.appendEvidence(makeRef({ handoffId: "" })),
      EvidenceLedgerError,
    );
  });

  it("rejects unknown kind", async () => {
    await assert.rejects(
      () => store.appendEvidence(makeRef({ kind: "unknown_kind" as any })),
      EvidenceLedgerError,
    );
  });

  it("allows manual_verification_note without uri", async () => {
    const ref = makeRef({ evidenceId: "ev-manual", kind: "manual_verification_note", uri: null });
    const result = await store.appendEvidence(ref);
    assert.equal(result.evidenceId, "ev-manual");
  });

  it("requires uri for non-note evidence", async () => {
    await assert.rejects(
      () => store.appendEvidence(makeRef({ evidenceId: "ev-nouri", kind: "log_ref", uri: null })),
      EvidenceLedgerError,
    );
  });

  it("orders evidence deterministically by submittedAt then evidenceId", async () => {
    const refA = makeRef({ evidenceId: "z-late", handoffId: "ho-sort", submittedAt: "2026-07-09T12:00:00.000Z" });
    const refB = makeRef({ evidenceId: "a-early", handoffId: "ho-sort", submittedAt: "2026-07-07T12:00:00.000Z" });
    await store.appendEvidence(refB);
    await store.appendEvidence(refA);
    const sorted = await store.listEvidenceForHandoff("ho-sort");
    assert.equal(sorted[0]!.evidenceId, "a-early");
    assert.equal(sorted[1]!.evidenceId, "z-late");
  });
});
