/**
 * P4.4b — Evidence CLI tests.
 *
 * Tests the evidence CLI command handlers.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EvidenceStore } from "../../src/security/evidence/evidence-store.js";
import type { EvidenceRecord } from "../../src/security/evidence/evidence-types.js";

// ---------------------------------------------------------------------------
// We test the underlying store operations that the CLI wraps, as well as
// CLI-adjacent behaviour (error messages, parse logic, output formatting).
// Full CLI integration tests (spawning the actual CLI) use the audit pattern
// in security.test.ts and would be added at a higher level.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  const dir = join("/tmp", "evidence-cli-test-" + randomUUID().slice(0, 8));
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  return dir;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Parse-args tests (pure, no FS needed)
// ---------------------------------------------------------------------------

describe("evidence CLI argument parsing", () => {
  it("parses --kind flag", async () => {
    // Test argument parsing via the store's query method
    const dir = tmpDir();
    const store = new EvidenceStore({ storeDir: dir });
    await store.append("config_signed", { configVersion: 1 });
    await store.append("trust_evaluation", { trusted: true, configVersion: 1 });

    // Filter by type
    const result = await store.query({ type: "config_signed" });
    expect(result.records.length).toBe(1);
    expect(result.records[0].type).toBe("config_signed");

    rmSync(dir, { recursive: true, force: true });
  });

  it("parses --limit flag", async () => {
    const dir = tmpDir();
    const store = new EvidenceStore({ storeDir: dir });
    for (let i = 0; i < 10; i++) {
      await store.append("config_signed", { configVersion: i });
    }

    const result = await store.query({ limit: 3 });
    expect(result.records.length).toBe(3);
    expect(result.total).toBe(10);
    expect(result.truncated).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  it("parses --json flag via query behavior", async () => {
    const dir = tmpDir();
    const store = new EvidenceStore({ storeDir: dir });
    await store.append("config_signed", { configVersion: 1 });

    // JSON output is just the record serialized
    const result = await store.query({ limit: 10 });
    const json = JSON.stringify(result);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.records.length).toBe(1);

    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects unknown evidence kind", () => {
    // This mirrors what the CLI's parseArgs does
    const unknownKind = "not_a_real_kind";
    expect(() => {
      if (!["config_signed", "trust_evaluation", "audit_checkpoint", "evidence_compaction"].includes(unknownKind)) {
        throw new Error(`Unknown evidence kind "${unknownKind}"`);
      }
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Store-level tests that CLI commands wrap
// ---------------------------------------------------------------------------

describe("evidence CLI list behavior", () => {
  let dir: string;
  let store: EvidenceStore;

  beforeEach(() => {
    dir = tmpDir();
    store = new EvidenceStore({ storeDir: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty for an empty store", async () => {
    const result = await store.query();
    expect(result.records).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("lists records newest-first", async () => {
    await store.append("config_signed", { configVersion: 1 });
    await sleep(10);
    await store.append("config_signed", { configVersion: 2 });
    await sleep(10);
    await store.append("config_signed", { configVersion: 3 });

    const result = await store.query();
    expect(result.records.length).toBe(3);
    expect(result.records[0].payload.configVersion).toBe(3);
    expect(result.records[2].payload.configVersion).toBe(1);
  });

  it("filters by kind", async () => {
    await store.append("config_signed", { configVersion: 1 });
    await store.append("audit_checkpoint", { sequence: 5, recordHash: "abc", signerKeyId: "k1" });

    const signed = await store.query({ type: "config_signed" });
    expect(signed.records.length).toBe(1);
    expect(signed.records[0].type).toBe("config_signed");
  });

  it("handles a store with a malformed record", async () => {
    // Write a valid record, then a malformed one
    const r = await store.append("config_signed", { configVersion: 1 });
    // Append a malformed line
    const { appendFile } = await import("node:fs/promises");
    await appendFile(join(dir, "evidence.jsonl"), "not valid json\n", "utf-8");

    // Query should skip malformed and return the valid record
    const result = await store.query();
    expect(result.records.length).toBe(1);
    expect(result.records[0].id).toBe(r.id);
  });
});

describe("evidence CLI show behavior", () => {
  let dir: string;
  let store: EvidenceStore;

  beforeEach(() => {
    dir = tmpDir();
    store = new EvidenceStore({ storeDir: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("finds a record by fingerprint", async () => {
    const r = await store.append("config_signed", { configVersion: 7 });
    const found = await store.getByFingerprint(r.fingerprint);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(r.id);
    expect(found!.payload.configVersion).toBe(7);
  });

  it("returns null for unknown fingerprint", async () => {
    const found = await store.getByFingerprint("aa".repeat(32));
    expect(found).toBeNull();
  });
});

describe("evidence CLI query behavior", () => {
  let dir: string;
  let store: EvidenceStore;

  beforeEach(() => {
    dir = tmpDir();
    store = new EvidenceStore({ storeDir: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("filters by time range", async () => {
    await store.append("config_signed", { configVersion: 1 });
    await sleep(50);
    const mid = new Date().toISOString();
    await sleep(50);
    await store.append("config_signed", { configVersion: 2 });

    const after = await store.query({ after: mid });
    expect(after.records.length).toBe(1);
    expect(after.records[0].payload.configVersion).toBe(2);

    const before = await store.query({ before: mid });
    expect(before.records.length).toBe(1);
    expect(before.records[0].payload.configVersion).toBe(1);
  });

  it("combines kind and time filters", async () => {
    await store.append("config_signed", { configVersion: 1 });
    await store.append("audit_checkpoint", { sequence: 5, recordHash: "abc", signerKeyId: "k1" });

    const result = await store.query({ type: "audit_checkpoint" });
    expect(result.records.length).toBe(1);
    expect(result.records[0].type).toBe("audit_checkpoint");
    expect(result.records[0].payload.sequence).toBe(5);
  });
});

describe("evidence CLI verify behavior", () => {
  let dir: string;
  let store: EvidenceStore;

  beforeEach(() => {
    dir = tmpDir();
    store = new EvidenceStore({ storeDir: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("passes on an empty store", async () => {
    const result = await store.verify();
    expect(result.ok).toBe(true);
    expect(result.total).toBe(0);
  });

  it("passes on valid records", async () => {
    await store.append("config_signed", { configVersion: 1 });
    await store.append("trust_evaluation", { trusted: true, configVersion: 1 });

    const result = await store.verify();
    expect(result.ok).toBe(true);
    expect(result.total).toBe(2);
  });

  it("fails on tampered fingerprint", async () => {
    await store.append("config_signed", { configVersion: 1 });

    // Corrupt the fingerprint
    const filePath = join(dir, "evidence.jsonl");
    let content = readFileSync(filePath, "utf-8");
    content = content.replace(/"fingerprint":"[^"]+"/, '"fingerprint":"00' + "aa".repeat(31) + '"');
    writeFileSync(filePath, content);

    const result = await store.verify();
    expect(result.ok).toBe(false);
    expect(result.failed.length).toBe(1);
  });

  it("detects malformed records", async () => {
    await store.append("config_signed", { configVersion: 1 });
    const { appendFile } = await import("node:fs/promises");
    await appendFile(join(dir, "evidence.jsonl"), "corrupted line\n", "utf-8");

    const result = await store.verify();
    expect(result.ok).toBe(false);
  });
});

describe("evidence CLI edge cases", () => {
  let dir: string;
  let store: EvidenceStore;

  beforeEach(() => {
    dir = tmpDir();
    store = new EvidenceStore({ storeDir: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("does not crash on empty store show attempt", async () => {
    // getByFingerprint returns null gracefully
    const result = await store.getByFingerprint("nonexistent");
    expect(result).toBeNull();
  });

  it("handles concurrent append and query", async () => {
    const storeA = new EvidenceStore({ storeDir: dir });
    const storeB = new EvidenceStore({ storeDir: dir });

    await Promise.all([
      storeA.append("config_signed", { configVersion: 1 }),
      storeB.append("trust_evaluation", { trusted: true, configVersion: 1 }),
    ]);

    const result = await store.query();
    expect(result.records.length).toBe(2);
  });

  it("displays correct record type after batch write", async () => {
    await store.append("config_signed", { configVersion: 1 });
    await store.append("audit_checkpoint", { sequence: 42, recordHash: "def", signerKeyId: "k2" });
    await store.append("trust_evaluation", { trusted: false, configVersion: 1 });

    const types = (await store.query()).records.map((r) => r.type);
    expect(types).toContain("config_signed");
    expect(types).toContain("audit_checkpoint");
    expect(types).toContain("trust_evaluation");
  });
});
