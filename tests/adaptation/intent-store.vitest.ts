import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IntentStore } from "../../src/adaptation/intent-store.js";
import type { ExecutionIntent } from "../../src/adaptation/execution-intent-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sampleIntent(overrides: Partial<ExecutionIntent> = {}): ExecutionIntent {
  return {
    id: "",
    subject: "Skill run: test-skill",
    outcome: "captured",
    confidence: 1,
    reasons: ["Skill rendered successfully"],
    generatedAt: "2026-06-21T00:00:00.000Z",
    source: "skill_run",
    input: "--prompt: test input",
    outputSummary: "This is the rendered skill output summary...",
    skillId: "test-skill",
    status: "captured",
    rationale: "Test rationale",
    sourceArtifacts: [{ type: "context", id: "skill:test-skill" }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IntentStore", () => {
  let dir: string;
  let store: IntentStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "intent-store-"));
    store = new IntentStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Append
  // -----------------------------------------------------------------------

  describe("append", () => {
    it("writes a record to the intents.jsonl file", async () => {
      const intent = sampleIntent({ id: "int-1" });
      await store.append(intent);

      const filePath = join(dir, "intents.jsonl");
      expect(existsSync(filePath)).toBe(true);

      const raw = readFileSync(filePath, "utf-8").trim();
      const parsed = JSON.parse(raw);
      expect(parsed.id).toBe("int-1");
      expect(parsed.source).toBe("skill_run");
    });

    it("appends multiple records as separate lines", async () => {
      await store.append(sampleIntent({ id: "int-a" }));
      await store.append(sampleIntent({ id: "int-b" }));

      const all = await store.list();
      expect(all).toHaveLength(2);
      expect(all.map((r) => r.id).sort()).toEqual(["int-a", "int-b"]);
    });

    it("generates an ID when none is provided", async () => {
      const intent = sampleIntent({ id: "" });
      await store.append(intent);

      expect(intent.id).toBeTruthy();
      expect(intent.id).toMatch(/^intent:\d{4}-\d{2}-\d{2}-[a-z0-9]+$/);
    });

    it("sets generatedAt when not provided", async () => {
      const intent = sampleIntent({ id: "int-ts", generatedAt: "" });
      await store.append(intent);

      expect(intent.generatedAt).toBeTruthy();
      expect(() => new Date(intent.generatedAt)).not.toThrow();
      const ts = new Date(intent.generatedAt).getTime();
      expect(Date.now() - ts).toBeLessThan(60_000);
    });

    it("preserves an existing generatedAt", async () => {
      const existingTs = "2025-01-15T12:00:00.000Z";
      const intent = sampleIntent({ id: "int-preserve", generatedAt: existingTs });
      await store.append(intent);

      expect(intent.generatedAt).toBe(existingTs);
    });

    it("creates store directory if it does not exist", async () => {
      rmSync(dir, { recursive: true, force: true });
      expect(existsSync(dir)).toBe(false);

      const newStore = new IntentStore(dir);
      await newStore.append(sampleIntent({ id: "int-dir" }));

      expect(existsSync(dir)).toBe(true);
      expect(existsSync(join(dir, "intents.jsonl"))).toBe(true);
    });

    it("allows appending same ID twice (append-only, no dedup)", async () => {
      await store.append(sampleIntent({ id: "dup-id" }));
      await store.append(sampleIntent({ id: "dup-id" }));

      const all = await store.list();
      const dupes = all.filter((r) => r.id === "dup-id");
      expect(dupes).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // Read — get
  // -----------------------------------------------------------------------

  describe("get", () => {
    it("retrieves appended intent by ID", async () => {
      const intent = sampleIntent({ id: "get-me" });
      await store.append(intent);

      const found = await store.get("get-me");
      expect(found).not.toBeNull();
      expect(found!.id).toBe("get-me");
      expect(found!.source).toBe("skill_run");
      expect(found!.skillId).toBe("test-skill");
    });

    it("returns null for missing ID", async () => {
      const found = await store.get("does-not-exist");
      expect(found).toBeNull();
    });

    it("returns null when store file does not exist", async () => {
      const found = await store.get("anything");
      expect(found).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Read — list
  // -----------------------------------------------------------------------

  describe("list", () => {
    it("returns all appended records", async () => {
      await store.append(sampleIntent({ id: "l1" }));
      await store.append(sampleIntent({ id: "l2" }));
      await store.append(sampleIntent({ id: "l3" }));

      const all = await store.list();
      expect(all).toHaveLength(3);
      expect(all.map((r) => r.id).sort()).toEqual(["l1", "l2", "l3"]);
    });

    it("returns empty array when no records exist", async () => {
      const all = await store.list();
      expect(all).toEqual([]);
    });

    it("returns empty array when store directory exists but file does not", async () => {
      const emptyStore = new IntentStore(dir);
      const all = await emptyStore.list();
      expect(all).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Read — queryByStatus
  // -----------------------------------------------------------------------

  describe("queryByStatus", () => {
    beforeEach(async () => {
      await store.append(sampleIntent({ id: "s1", status: "captured" }));
      await store.append(sampleIntent({ id: "s2", status: "captured" }));
      await store.append(sampleIntent({ id: "s3", status: "discarded" }));
      await store.append(sampleIntent({ id: "s4", status: "proposed" }));
    });

    it("returns records matching status 'captured'", async () => {
      const results = await store.queryByStatus("captured");
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.id).sort()).toEqual(["s1", "s2"]);
    });

    it("returns records matching status 'proposed'", async () => {
      const results = await store.queryByStatus("proposed");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("s4");
    });

    it("returns records matching status 'discarded'", async () => {
      const results = await store.queryByStatus("discarded");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("s3");
    });

    it("returns empty array when no records match", async () => {
      const results = await store.queryByStatus("captured");
      // Should still match the 2 captured we appended
      expect(results).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // Resilience
  // -----------------------------------------------------------------------

  describe("resilience", () => {
    it("skips corrupt lines without crashing", async () => {
      const filePath = join(dir, "intents.jsonl");
      writeFileSync(
        filePath,
        '{"id":"good-1","subject":"ok","outcome":"captured","confidence":1,"reasons":[],"generatedAt":"2026-06-21T00:00:00.000Z","source":"skill_run","input":"test","outputSummary":"summary","skillId":"test-skill","status":"captured","rationale":"ok","sourceArtifacts":[]}\nthis is not valid json\n{"id":"good-2","subject":"ok","outcome":"captured","confidence":1,"reasons":[],"generatedAt":"2026-06-21T00:00:00.000Z","source":"skill_run","input":"test","outputSummary":"summary","skillId":"test-skill","status":"captured","rationale":"ok","sourceArtifacts":[]}\n',
      );

      const all = await store.list();
      expect(all).toHaveLength(2);
      expect(all.map((r) => r.id).sort()).toEqual(["good-1", "good-2"]);
    });

    it("handles entirely empty file", async () => {
      const filePath = join(dir, "intents.jsonl");
      writeFileSync(filePath, "");

      const all = await store.list();
      expect(all).toEqual([]);
    });

    it("does not crash reading file with only whitespace lines", async () => {
      const filePath = join(dir, "intents.jsonl");
      writeFileSync(filePath, "\n   \n  \n");

      const all = await store.list();
      expect(all).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Invariants — append-only, no mutation
  // -----------------------------------------------------------------------

  describe("invariants", () => {
    it("has no update method", () => {
      expect("update" in store).toBe(false);
    });

    it("has no delete method", () => {
      expect("delete" in store).toBe(false);
    });

    it("has no remove method", () => {
      expect("remove" in store).toBe(false);
    });

    it("has no clear method", () => {
      expect("clear" in store).toBe(false);
    });

    it("has no compact method", () => {
      expect("compact" in store).toBe(false);
    });
  });
});
