// tests/governance/failure-memory.test.ts
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createFailureRecord,
  validateFailureRecord,
  FileFailureMemoryStore,
  type FailureRecord,
  type CreateFailureRecordInput,
} from "../../src/governance/failure-memory.js";

// ---------------------------------------------------------------------------
// validateFailureRecord tests
// ---------------------------------------------------------------------------

describe("validateFailureRecord", () => {
  const valid: FailureRecord = {
    runId: "run-001",
    issueId: "issue-123",
    failureType: "test_failure",
    detail: "E2E tests failed on login flow",
    timestamp: "2026-07-04T12:00:00.000Z",
    filePaths: ["src/auth/login.ts"],
    command: "pnpm test:e2e",
    policyIds: ["p1"],
    verificationCommand: "pnpm test:e2e --run",
  };

  it("valid record passes", () => {
    const r = validateFailureRecord(valid);
    assert.strictEqual(r.valid, true);
    assert.deepStrictEqual(r.errors, []);
  });

  it("missing runId fails", () => {
    const r = validateFailureRecord({ ...valid, runId: "" });
    assert.strictEqual(r.valid, false);
    assert.ok(r.errors.some((e) => e.includes("runId")));
  });

  it("missing issueId fails", () => {
    const r = validateFailureRecord({ ...valid, issueId: "" });
    assert.strictEqual(r.valid, false);
    assert.ok(r.errors.some((e) => e.includes("issueId")));
  });

  it("invalid failureType fails", () => {
    const r = validateFailureRecord({ ...valid, failureType: "unknown_type" });
    assert.strictEqual(r.valid, false);
    assert.ok(r.errors.some((e) => e.includes("failureType")));
  });

  it("missing detail fails", () => {
    const r = validateFailureRecord({ ...valid, detail: "" });
    assert.strictEqual(r.valid, false);
    assert.ok(r.errors.some((e) => e.includes("detail")));
  });

  it("missing timestamp fails", () => {
    const r = validateFailureRecord({ ...valid, timestamp: "" });
    assert.strictEqual(r.valid, false);
    assert.ok(r.errors.some((e) => e.includes("timestamp")));
  });

  it("rejects non-array filePaths", () => {
    const r = validateFailureRecord({ ...valid, filePaths: "not-an-array" });
    assert.strictEqual(r.valid, false);
    assert.ok(r.errors.some((e) => e.includes("filePaths")));
  });

  it("rejects non-array policyIds", () => {
    const r = validateFailureRecord({ ...valid, policyIds: "not-an-array" });
    assert.strictEqual(r.valid, false);
    assert.ok(r.errors.some((e) => e.includes("policyIds")));
  });

  it("createFailureRecord preserves supplied timestamp", () => {
    const ts = "2026-07-04T12:00:00.000Z";
    const input: CreateFailureRecordInput = {
      runId: "r1",
      issueId: "i1",
      failureType: "verification_timeout",
      detail: "Timeout waiting for CI",
    };
    const record = createFailureRecord(input, ts);
    assert.strictEqual(record.timestamp, ts);
    assert.strictEqual(record.runId, "r1");
  });
});

// ---------------------------------------------------------------------------
// FileFailureMemoryStore tests
// ---------------------------------------------------------------------------

describe("FileFailureMemoryStore", () => {
  let dir: string;
  let store: FileFailureMemoryStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "failure-memory-test-"));
    store = new FileFailureMemoryStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const validRecord: FailureRecord = {
    runId: "run-001",
    issueId: "issue-123",
    failureType: "test_failure",
    detail: "E2E tests failed on login flow",
    timestamp: "2026-07-04T12:00:00.000Z",
    filePaths: ["src/auth/login.ts"],
    command: "pnpm test:e2e",
    policyIds: ["p1"],
    verificationCommand: "pnpm test:e2e --run",
  };

  it("append writes one JSONL row", async () => {
    await store.append(validRecord);
    const records = await store.list();
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].runId, "run-001");
  });

  it("append rejects invalid record", async () => {
    await assert.rejects(
      () => store.append({ ...validRecord, runId: "" }),
      /Invalid failure record/,
    );
  });

  it("list returns newest-first", async () => {
    await store.append(validRecord);
    const r2: FailureRecord = {
      ...validRecord,
      runId: "run-002",
      timestamp: "2026-07-04T13:00:00.000Z",
    };
    await store.append(r2);
    const records = await store.list();
    assert.strictEqual(records[0].runId, "run-002");
    assert.strictEqual(records[1].runId, "run-001");
  });

  it("list limit works", async () => {
    await store.append(validRecord);
    await store.append({ ...validRecord, runId: "run-002" });
    const records = await store.list(1);
    assert.strictEqual(records.length, 1);
  });

  it("getByRun returns matching records", async () => {
    await store.append(validRecord);
    await store.append({ ...validRecord, runId: "run-002", issueId: "issue-456" });
    const matched = await store.getByRun("run-001");
    assert.strictEqual(matched.length, 1);
    assert.strictEqual(matched[0].runId, "run-001");
  });

  it("getByRun returns empty for unknown runId", async () => {
    await store.append(validRecord);
    assert.deepStrictEqual(await store.getByRun("run-unknown"), []);
  });

  it("getByIssue returns matching records", async () => {
    await store.append(validRecord);
    await store.append({ ...validRecord, runId: "run-002", issueId: "issue-456" });
    const matched = await store.getByIssue("issue-123");
    assert.strictEqual(matched.length, 1);
    assert.strictEqual(matched[0].issueId, "issue-123");
  });

  it("getByIssue returns empty for unknown issueId", async () => {
    await store.append(validRecord);
    assert.deepStrictEqual(await store.getByIssue("issue-unknown"), []);
  });

  it("findSimilar matches by failureType", async () => {
    await store.append(validRecord);
    await store.append({ ...validRecord, runId: "run-002", failureType: "policy_denied" });
    const results = await store.findSimilar({ failureType: "test_failure" });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].failureType, "test_failure");
  });

  it("findSimilar matches overlapping filePaths", async () => {
    await store.append(validRecord);
    await store.append({
      ...validRecord,
      runId: "run-002",
      filePaths: ["src/auth/login.ts", "src/auth/session.ts"],
    });
    const results = await store.findSimilar({ filePaths: ["src/auth/login.ts"] });
    assert.strictEqual(results.length, 2);
  });

  it("findSimilar matches command", async () => {
    await store.append(validRecord);
    await store.append({ ...validRecord, runId: "run-002", command: "pnpm build" });
    const results = await store.findSimilar({ command: "pnpm test:e2e" });
    assert.strictEqual(results.length, 1);
  });

  it("list skips malformed JSONL rows", async () => {
    await store.append(validRecord);
    await appendFile(join(dir, "failure-memory.jsonl"), "not-json\n");
    const records = await store.list();
    assert.strictEqual(records.length, 1);
  });

  it("list skips invalid semantic rows", async () => {
    await store.append(validRecord);
    await appendFile(join(dir, "failure-memory.jsonl"), JSON.stringify({ foo: "bar" }) + "\n");
    const records = await store.list();
    assert.strictEqual(records.length, 1);
  });
});
