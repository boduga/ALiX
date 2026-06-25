import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OutcomeStore } from "../../src/adaptation/outcome-store.js";
import type { OutcomeRecord } from "../../src/adaptation/outcome-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sampleRecord(overrides: Partial<OutcomeRecord> = {}): OutcomeRecord {
  return {
    id: "",
    subject: "Test outcome record",
    outcome: "success",
    confidence: 0.9,
    reasons: ["Test reason"],
    generatedAt: "2026-06-21T00:00:00.000Z",
    subjectId: "subject-1",
    subjectType: "test",
    actionTaken: "Applied test action",
    observationWindowDays: 7,
    ...overrides,
  };
}

function emptyRecord(overrides: Partial<OutcomeRecord> = {}): OutcomeRecord {
  return {
    id: "",
    subject: "",
    outcome: "unknown",
    confidence: 0,
    reasons: [],
    generatedAt: "",
    subjectId: "",
    subjectType: "",
    actionTaken: "",
    observationWindowDays: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OutcomeStore", () => {
  let dir: string;
  let store: OutcomeStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "outcome-store-"));
    store = new OutcomeStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Append
  // -----------------------------------------------------------------------

  describe("append", () => {
    it("writes a record to the JSONL file", async () => {
      const record = sampleRecord({ id: "out-1" });
      await store.append(record);

      const filePath = join(dir, "outcomes.jsonl");
      expect(existsSync(filePath)).toBe(true);

      const raw = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw.trim());
      expect(parsed.id).toBe("out-1");
      expect(parsed.subjectId).toBe("subject-1");
      expect(parsed.outcome).toBe("success");
    });

    it("generates an ID when the record has none", async () => {
      const record = sampleRecord({ id: "" });
      await store.append(record);

      // The record object should have been mutated with a generated ID
      expect(record.id).toMatch(/^outcome:\d{4}-\d{2}-\d{2}-[a-z0-9]+$/);
    });

    it("sets generatedAt when not provided", async () => {
      const record = sampleRecord({ id: "out-2", generatedAt: "" });
      await store.append(record);

      // Should be set to a current ISO timestamp
      expect(record.generatedAt).toBeTruthy();
      expect(() => new Date(record.generatedAt)).not.toThrow();
      // Should be recent (within the last minute)
      const ts = new Date(record.generatedAt).getTime();
      expect(Date.now() - ts).toBeLessThan(60_000);
    });

    it("preserves an existing generatedAt", async () => {
      const existingTs = "2025-01-15T12:00:00.000Z";
      const record = sampleRecord({ id: "out-3", generatedAt: existingTs });
      await store.append(record);

      expect(record.generatedAt).toBe(existingTs);
    });

    it("creates the store directory if it does not exist", async () => {
      rmSync(dir, { recursive: true, force: true });
      expect(existsSync(dir)).toBe(false);

      const newStore = new OutcomeStore(dir);
      await newStore.append(sampleRecord({ id: "out-dir" }));

      expect(existsSync(dir)).toBe(true);
      expect(existsSync(join(dir, "outcomes.jsonl"))).toBe(true);
    });

    it("allows appending the same ID twice (append-only, no dedup)", async () => {
      await store.append(sampleRecord({ id: "dup-id" }));
      await store.append(sampleRecord({ id: "dup-id" }));

      const all = await store.list();
      const dupes = all.filter((r) => r.id === "dup-id");
      expect(dupes).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // Read — get
  // -----------------------------------------------------------------------

  describe("get", () => {
    it("retrieves an appended record by ID", async () => {
      const record = sampleRecord({ id: "get-me" });
      await store.append(record);

      const found = await store.get("get-me");
      expect(found).not.toBeNull();
      expect(found!.id).toBe("get-me");
      expect(found!.subjectId).toBe("subject-1");
    });

    it("returns null for a missing ID", async () => {
      const found = await store.get("does-not-exist");
      expect(found).toBeNull();
    });

    it("returns null when the store file does not exist", async () => {
      // Store dir exists but no file
      const found = await store.get("anything");
      expect(found).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Read — list
  // -----------------------------------------------------------------------

  describe("list", () => {
    it("returns all appended records", async () => {
      await store.append(sampleRecord({ id: "a" }));
      await store.append(sampleRecord({ id: "b" }));
      await store.append(sampleRecord({ id: "c" }));

      const all = await store.list();
      expect(all).toHaveLength(3);
      expect(all.map((r) => r.id).sort()).toEqual(["a", "b", "c"]);
    });

    it("returns an empty array when no records exist", async () => {
      const all = await store.list();
      expect(all).toEqual([]);
    });

    it("returns an empty array when the store directory does not exist", async () => {
      rmSync(dir, { recursive: true, force: true });
      const emptyStore = new OutcomeStore(dir);
      const all = await emptyStore.list();
      expect(all).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Read — queryBySubject
  // -----------------------------------------------------------------------

  describe("queryBySubject", () => {
    beforeEach(async () => {
      await store.append(sampleRecord({ id: "s1", subjectId: "prop-1" }));
      await store.append(sampleRecord({ id: "s2", subjectId: "prop-1" }));
      await store.append(sampleRecord({ id: "s3", subjectId: "prop-2" }));
    });

    it("returns records matching the given subjectId", async () => {
      const results = await store.queryBySubject("prop-1");
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.id).sort()).toEqual(["s1", "s2"]);
    });

    it("returns empty array when no records match", async () => {
      const results = await store.queryBySubject("prop-nonexistent");
      expect(results).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Read — queryByWindow
  // -----------------------------------------------------------------------

  describe("queryByWindow", () => {
    beforeEach(async () => {
      // Use fake timers so "now" is a frozen instant, avoiding a race
      // between record creation and query when window=0.
      vi.useFakeTimers({ now: new Date("2026-06-22T12:00:00.000Z") });

      // Record from 10 days ago
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      await store.append(
        sampleRecord({
          id: "old",
          generatedAt: tenDaysAgo.toISOString(),
        }),
      );

      // Record from 2 days ago
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      await store.append(
        sampleRecord({
          id: "recent",
          generatedAt: twoDaysAgo.toISOString(),
        }),
      );

      // Record from right now (frozen by fake timers)
      await store.append(
        sampleRecord({
          id: "now",
          generatedAt: new Date().toISOString(),
        }),
      );
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns records within the given window", async () => {
      const results = await store.queryByWindow(7);
      const ids = results.map((r) => r.id);
      // "recent" (2 days) and "now" should be included; "old" (10 days) should not
      expect(ids).toContain("recent");
      expect(ids).toContain("now");
      expect(ids).not.toContain("old");
    });

    it("includes all records with a large window", async () => {
      const results = await store.queryByWindow(365);
      expect(results.map((r) => r.id).sort()).toEqual(["now", "old", "recent"]);
    });

    it("excludes all records with a very small window", async () => {
      // Window of 0 days — only records generated right at/after the query
      // time qualify.  Frozen fake timers guarantee "now" matches the query
      // instant so this is deterministic.
      const results = await store.queryByWindow(0);
      const ids = results.map((r) => r.id);
      expect(ids).toContain("now");
      expect(ids).not.toContain("old");
    });
  });

  // -----------------------------------------------------------------------
  // Resilience
  // -----------------------------------------------------------------------

  describe("resilience", () => {
    it("skips corrupt lines without crashing", async () => {
      // Manually write a corrupt line to the file
      const filePath = join(dir, "outcomes.jsonl");
      const { writeFileSync } = await import("node:fs");
      writeFileSync(filePath, '{"id":"good-1","subject":"ok","outcome":"success","confidence":1,"reasons":[],"generatedAt":"2026-06-21T00:00:00.000Z","subjectId":"s","subjectType":"t","actionTaken":"a","observationWindowDays":7}\nthis is not json\n{"id":"good-2","subject":"ok","outcome":"success","confidence":1,"reasons":[],"generatedAt":"2026-06-21T00:00:00.000Z","subjectId":"s","subjectType":"t","actionTaken":"a","observationWindowDays":7}\n');

      const all = await store.list();
      // Only the two valid records should be returned
      expect(all).toHaveLength(2);
      expect(all.map((r) => r.id).sort()).toEqual(["good-1", "good-2"]);
    });

    it("handles an entirely empty file", async () => {
      const filePath = join(dir, "outcomes.jsonl");
      const { writeFileSync } = await import("node:fs");
      writeFileSync(filePath, "");

      const all = await store.list();
      expect(all).toEqual([]);
    });

    it("does not crash reading a file with only whitespace lines", async () => {
      const filePath = join(dir, "outcomes.jsonl");
      const { writeFileSync } = await import("node:fs");
      writeFileSync(filePath, "\n  \n\t\n");

      const all = await store.list();
      expect(all).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // No delete
  // -----------------------------------------------------------------------

  describe("no delete", () => {
    it("has no delete method", () => {
      // The store should have no delete/remove methods
      const storeAny = store as unknown as Record<string, unknown>;
      expect(typeof storeAny.delete).not.toBe("function");
      expect(typeof storeAny.remove).not.toBe("function");
      expect(typeof storeAny.clear).not.toBe("function");
    });
  });
});
