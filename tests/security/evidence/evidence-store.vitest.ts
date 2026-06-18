/**
 * P4.4a — Evidence Store tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EvidenceStore } from "../../../src/security/evidence/evidence-store.js";
import type { EvidenceRecord } from "../../../src/security/evidence/evidence-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  const dir = join("/tmp", "evidence-test-" + randomUUID().slice(0, 8));
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  return dir;
}

function makeStore(dir?: string): { store: EvidenceStore; dir: string } {
  const d = dir ?? tmpDir();
  return { store: new EvidenceStore({ storeDir: d }), dir: d };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EvidenceStore", () => {
  let store: EvidenceStore;
  let dir: string;

  beforeEach(() => {
    const m = makeStore();
    store = m.store;
    dir = m.dir;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Append
  // -----------------------------------------------------------------------

  describe("append", () => {
    it("creates the store file on first append", async () => {
      const r = await store.append("config_signed", { configVersion: 1 });
      expect(r.id).toBeTruthy();
      expect(r.type).toBe("config_signed");
      expect(r.fingerprint).toBeTruthy();
      expect(r.version).toBe(1);
      expect(existsSync(join(dir, "evidence.jsonl"))).toBe(true);
    });

    it("returns a record with a valid fingerprint", async () => {
      const r = await store.append("trust_evaluation", { trusted: true, configVersion: 1 });
      expect(r.fingerprint.length).toBe(64); // SHA-256 hex = 64 chars
    });

    it("appends multiple records sequentially", async () => {
      await store.append("config_signed", { configVersion: 1 });
      await store.append("config_signed", { configVersion: 2 });
      await store.append("trust_evaluation", { trusted: true, configVersion: 2 });

      const result = await store.query();
      expect(result.records.length).toBe(3);
      expect(result.total).toBe(3);
    });

    it("rejects unknown evidence types gracefully", async () => {
      // @ts-expect-error testing invalid type
      await expect(store.append("unknown_type", {})).rejects.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // appendBatch
  // -----------------------------------------------------------------------

  describe("appendBatch", () => {
    it("appends zero entries without error", async () => {
      const records = await store.appendBatch([]);
      expect(records).toEqual([]);
    });

    it("appends multiple records atomically", async () => {
      const records = await store.appendBatch([
        { type: "config_signed" as const, payload: { configVersion: 1 } },
        { type: "trust_evaluation" as const, payload: { trusted: true, configVersion: 1 } },
      ]);
      expect(records.length).toBe(2);
      // Same timestamp for the batch
      expect(records[0].timestamp).toBe(records[1].timestamp);

      const result = await store.query();
      expect(result.records.length).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  describe("query", () => {
    it("returns empty for an empty store", async () => {
      const result = await store.query();
      expect(result.records).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.truncated).toBe(false);
    });

    it("returns newest-first ordering", async () => {
      await store.append("config_signed", { configVersion: 1 });
      await sleep(10);
      await store.append("config_signed", { configVersion: 2 });
      await sleep(10);
      await store.append("config_signed", { configVersion: 3 });

      const result = await store.query();
      expect(result.records[0].payload.configVersion).toBe(3);
      expect(result.records[2].payload.configVersion).toBe(1);
    });

    it("filters by type", async () => {
      await store.append("config_signed", { configVersion: 1 });
      await store.append("trust_evaluation", { trusted: true, configVersion: 1 });
      await store.append("audit_checkpoint", { sequence: 5, recordHash: "abc", signerKeyId: "k1" });

      const signed = await store.query({ type: "config_signed" });
      expect(signed.records.length).toBe(1);
      expect(signed.total).toBe(1);

      const all = await store.query();
      expect(all.records.length).toBe(3);
    });

    it("filters by fingerprint", async () => {
      const r = await store.append("config_signed", { configVersion: 42 });
      const found = await store.query({ fingerprint: r.fingerprint });
      expect(found.records.length).toBe(1);
      expect(found.records[0].fingerprint).toBe(r.fingerprint);

      const notFound = await store.query({ fingerprint: "nonexistent" });
      expect(notFound.records.length).toBe(0);
    });

    it("filters by time range", async () => {
      await store.append("config_signed", { configVersion: 1 });
      await sleep(50);
      const mid = new Date().toISOString();
      await sleep(50);
      await store.append("config_signed", { configVersion: 2 });

      const afterMid = await store.query({ after: mid });
      expect(afterMid.records.length).toBe(1);
      expect(afterMid.records[0].payload.configVersion).toBe(2);

      const beforeMid = await store.query({ before: mid });
      expect(beforeMid.records.length).toBe(1);
      expect(beforeMid.records[0].payload.configVersion).toBe(1);
    });

    it("respects limit", async () => {
      for (let i = 0; i < 10; i++) {
        await store.append("config_signed", { configVersion: i });
      }

      const limited = await store.query({ limit: 3 });
      expect(limited.records.length).toBe(3);
      expect(limited.truncated).toBe(true);
      expect(limited.total).toBe(10);
    });
  });

  // -----------------------------------------------------------------------
  // getByFingerprint
  // -----------------------------------------------------------------------

  describe("getByFingerprint", () => {
    it("returns the record for a valid fingerprint", async () => {
      const r = await store.append("config_signed", { configVersion: 7 });
      const found = await store.getByFingerprint(r.fingerprint);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(r.id);
    });

    it("returns null for unknown fingerprint", async () => {
      const found = await store.getByFingerprint("aa".repeat(32));
      expect(found).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Compaction
  // -----------------------------------------------------------------------

  describe("compact", () => {
    it("is a no-op on empty store", async () => {
      const result = await store.compact(new Date().toISOString());
      expect(result.recordsBefore).toBe(0);
      expect(result.recordsAfter).toBe(0);
    });

    it("does nothing when no records are older than the cutoff", async () => {
      await store.append("config_signed", { configVersion: 1 });
      const past = new Date(Date.now() - 100_000).toISOString();
      const result = await store.compact(past);
      expect(result.recordsBefore).toBe(1);
      expect(result.recordsAfter).toBe(1);
    });

    it("compacts old records into summary records", async () => {
      const oldDir = tmpDir();
      // Seed the store with old records by writing them directly
      const oldTime = new Date(Date.now() - 10_000).toISOString();
      const cutoff = new Date(Date.now() - 5_000).toISOString();

      const oldRecord1: EvidenceRecord = {
        version: 1, id: randomUUID(), type: "config_signed",
        timestamp: oldTime, fingerprint: "ff".repeat(32),
        payload: { configVersion: 1 },
      };
      const oldRecord2: EvidenceRecord = {
        version: 1, id: randomUUID(), type: "trust_evaluation",
        timestamp: oldTime, fingerprint: "ee".repeat(32),
        payload: { trusted: true, configVersion: 1 },
      };

      writeFileSync(
        join(oldDir, "evidence.jsonl"),
        JSON.stringify(oldRecord1) + "\n" + JSON.stringify(oldRecord2) + "\n",
        "utf-8",
      );

      const seededStore = new EvidenceStore({ storeDir: oldDir });
      // Append a recent record
      await seededStore.append("config_signed", { configVersion: 2 });

      const result = await seededStore.compact(cutoff);
      expect(result.recordsBefore).toBe(3); // 2 old + 1 recent
      expect(result.recordsAfter).toBeGreaterThanOrEqual(2); // 1 recent + summaries

      const compactions = await seededStore.query({ type: "evidence_compaction" });
      expect(compactions.records.length).toBeGreaterThanOrEqual(1);

      rmSync(oldDir, { recursive: true, force: true });
    });

    it("does not create compaction records if nothing to compact", async () => {
      await store.append("config_signed", { configVersion: 1 });
      // Cutoff in the past, before any records — nothing is old enough to compact
      const past = new Date(Date.now() - 100_000).toISOString();
      await store.compact(past);
      const compactions = await store.query({ type: "evidence_compaction" });
      expect(compactions.records.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Verify
  // -----------------------------------------------------------------------

  describe("verify", () => {
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

    it("detects tampered fingerprints", async () => {
      await store.append("config_signed", { configVersion: 1 });

      // Manually corrupt a fingerprint in the file
      const filePath = join(dir, "evidence.jsonl");
      let content = readFileSync(filePath, "utf-8");
      content = content.replace(/"fingerprint":"[^"]+"/, '"fingerprint":"00' + "aa".repeat(31) + '"');
      writeFileSync(filePath, content);

      const result = await store.verify();
      expect(result.ok).toBe(false);
      expect(result.failed.length).toBe(1);
      expect(result.total).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  describe("stats", () => {
    it("returns zeros for empty store", async () => {
      const s = await store.stats();
      expect(s.byType).toEqual({});
      expect(s.total).toBe(0);
    });

    it("counts records by type", async () => {
      await store.append("config_signed", { configVersion: 1 });
      await store.append("config_signed", { configVersion: 2 });
      await store.append("trust_evaluation", { trusted: true, configVersion: 2 });

      const s = await store.stats();
      expect(s.byType.config_signed).toBe(2);
      expect(s.byType.trust_evaluation).toBe(1);
      expect(s.total).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe("edge cases", () => {
    it("handles a pre-existing store with malformed lines", async () => {
      const filePath = join(dir, "evidence.jsonl");
      writeFileSync(filePath, "valid line\nnot json\n{also not}\n", "utf-8");

      // Append still works
      const r = await store.append("trust_evaluation", { trusted: true });
      expect(r).toBeTruthy();

      // Query skips malformed lines
      const result = await store.query();
      expect(result.records.length).toBe(1);
    });

    it("handles concurrent store instances", async () => {
      const storeA = new EvidenceStore({ storeDir: dir });
      const storeB = new EvidenceStore({ storeDir: dir });

      const [r1, r2] = await Promise.all([
        storeA.append("config_signed", { configVersion: 1 }),
        storeB.append("config_signed", { configVersion: 2 }),
      ]);

      expect(r1).toBeTruthy();
      expect(r2).toBeTruthy();

      const result = await store.query();
      // Both appends should have succeeded
      expect(result.records.length).toBe(2);
    });
  });
});

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
