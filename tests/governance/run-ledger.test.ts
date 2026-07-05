// tests/governance/run-ledger.test.ts
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createLedgerEntry,
  validateLedgerEntry,
  FileLedgerStore,
  type LedgerEntry,
  type CreateLedgerEntryInput,
} from "../../src/governance/run-ledger.js";

// ---------------------------------------------------------------------------
// validateLedgerEntry tests
// ---------------------------------------------------------------------------

describe("validateLedgerEntry", () => {
  const valid: LedgerEntry = {
    runId: "run-001",
    issueId: "issue-123",
    policyResult: { decision: "allow", reason: "ok", matchedPolicies: ["p1"], requiredApprovals: [] },
    riskScore: { level: "low", score: 10, factors: [] },
    approvals: [{ gate: "verification", status: "approved", approvedBy: "test" }],
    filesChanged: ["src/main.ts"],
    verificationResults: [{ command: "build", status: "passed" }],
    outcome: "completed",
    timestamp: "2026-07-04T12:00:00.000Z",
  };

  it("valid entry passes", () => {
    const r = validateLedgerEntry(valid);
    assert.strictEqual(r.valid, true);
    assert.deepStrictEqual(r.errors, []);
  });

  it("missing runId fails", () => {
    const r = validateLedgerEntry({ ...valid, runId: "" });
    assert.strictEqual(r.valid, false);
    assert.ok(r.errors.some((e) => e.includes("runId")));
  });

  it("missing issueId fails", () => {
    const r = validateLedgerEntry({ ...valid, issueId: "" });
    assert.strictEqual(r.valid, false);
    assert.ok(r.errors.some((e) => e.includes("issueId")));
  });

  it("invalid outcome fails", () => {
    const r = validateLedgerEntry({ ...valid, outcome: "unknown" });
    assert.strictEqual(r.valid, false);
    assert.ok(r.errors.some((e) => e.includes("outcome")));
  });

  it("requires policyResult.decision", () => {
    const r = validateLedgerEntry({ ...valid, policyResult: { decision: "" } });
    assert.strictEqual(r.valid, false);
    assert.ok(r.errors.some((e) => e.includes("policyResult.decision")));
  });

  it("requires riskScore.level and riskScore.score", () => {
    const r = validateLedgerEntry({ ...valid, riskScore: { level: "", score: "ten" } });
    assert.strictEqual(r.valid, false);
    assert.ok(r.errors.some((e) => e.includes("riskScore.level")));
    assert.ok(r.errors.some((e) => e.includes("riskScore.score")));
  });

  it("rejects non-string filesChanged entries", () => {
    const r = validateLedgerEntry({ ...valid, filesChanged: [42] });
    assert.strictEqual(r.valid, false);
    assert.ok(r.errors.some((e) => e.includes("filesChanged")));
  });

  it("createLedgerEntry preserves supplied timestamp", () => {
    const ts = "2026-07-04T12:00:00.000Z";
    const input: CreateLedgerEntryInput = {
      runId: "r1", issueId: "i1",
      policyResult: { decision: "allow", reason: "", matchedPolicies: [], requiredApprovals: [] },
      riskScore: { level: "low", score: 5, factors: [] },
      approvals: [], filesChanged: [], verificationResults: [],
      outcome: "completed",
    };
    const entry = createLedgerEntry(input, ts);
    assert.strictEqual(entry.timestamp, ts);
    assert.strictEqual(entry.runId, "r1");
  });
});

// ---------------------------------------------------------------------------
// FileLedgerStore tests
// ---------------------------------------------------------------------------

describe("FileLedgerStore", () => {
  let dir: string;
  let store: FileLedgerStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "run-ledger-test-"));
    store = new FileLedgerStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const validEntry: LedgerEntry = {
    runId: "run-001",
    issueId: "issue-123",
    policyResult: { decision: "allow", reason: "ok", matchedPolicies: ["p1"], requiredApprovals: [] },
    riskScore: { level: "low", score: 10, factors: [] },
    approvals: [{ gate: "verification", status: "approved", approvedBy: "test" }],
    filesChanged: ["src/main.ts"],
    verificationResults: [{ command: "build", status: "passed" }],
    outcome: "completed",
    timestamp: "2026-07-04T12:00:00.000Z",
  };

  it("append writes one row", async () => {
    await store.append(validEntry);
    const entries = await store.list();
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].runId, "run-001");
  });

  it("append rejects invalid entry", async () => {
    await assert.rejects(
      () => store.append({ ...validEntry, runId: "" }),
      /Invalid ledger entry/,
    );
  });

  it("list returns newest first", async () => {
    await store.append(validEntry);
    const e2: LedgerEntry = { ...validEntry, runId: "run-002", timestamp: "2026-07-04T13:00:00.000Z" };
    await store.append(e2);
    const entries = await store.list();
    assert.strictEqual(entries[0].runId, "run-002");
    assert.strictEqual(entries[1].runId, "run-001");
  });

  it("list limit works", async () => {
    await store.append(validEntry);
    await store.append({ ...validEntry, runId: "run-002" });
    const entries = await store.list(1);
    assert.strictEqual(entries.length, 1);
  });

  it("get returns matching runId", async () => {
    await store.append(validEntry);
    const found = await store.get("run-001");
    assert.ok(found);
    assert.strictEqual(found.runId, "run-001");
    assert.deepStrictEqual(found.policyResult, validEntry.policyResult);
  });

  it("get returns undefined for unknown runId", async () => {
    await store.append(validEntry);
    assert.strictEqual(await store.get("run-unknown"), undefined);
  });

  it("get returns newest duplicate runId entry", async () => {
    await store.append(validEntry);
    const corrected: LedgerEntry = { ...validEntry, runId: "run-001", outcome: "failed", timestamp: "2026-07-04T13:00:00.000Z" };
    await store.append(corrected);
    const found = await store.get("run-001");
    assert.strictEqual(found!.outcome, "failed");
  });

  it("policy/risk/approval evidence preserved exactly", async () => {
    await store.append(validEntry);
    const found = await store.get("run-001");
    assert.deepStrictEqual(found!.policyResult, validEntry.policyResult);
    assert.deepStrictEqual(found!.riskScore, validEntry.riskScore);
    assert.deepStrictEqual(found!.approvals, validEntry.approvals);
  });

  it("list skips malformed JSON rows", async () => {
    const { appendFile } = await import("node:fs/promises");
    await store.append(validEntry);
    await appendFile(join(dir, "run-ledger.jsonl"), "not-json\n");
    const entries = await store.list();
    assert.strictEqual(entries.length, 1); // only valid entry returned
  });
});
