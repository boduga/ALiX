import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { MemoryStore } from "../../../src/utils/memory/store.js";
import { recall, buildMemoryContext } from "../../../src/utils/memory/recall.js";

describe("recall", () => {
  const testDir = path.join("/tmp", "recall-test-" + Date.now());
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore(testDir);
    await store.init();

    // Save test entries
    await store.save({
      name: "TypeScript Project",
      description: "A TypeScript project",
      type: "project",
      content: "This is a TypeScript project with strict mode",
      confidence: 0.9,
      confirmations: 5,
    });
    await store.save({
      name: "JavaScript Memory",
      description: "A JavaScript project",
      type: "project",
      content: "This is a JavaScript project",
      confidence: 0.7,
      confirmations: 2,
    });
    await store.save({
      name: "User Theme",
      description: "User theme preference",
      type: "user",
      content: "User prefers dark mode",
      confidence: 0.95,
      confirmations: 10,
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("recall()", () => {
    it("should find matching entries", async () => {
      const result = await recall("TypeScript", store);
      expect(result.entries.length).toBeGreaterThan(0);
      expect(result.entries[0].name).toContain("TypeScript");
    });

    it("should filter by types when specified", async () => {
      const result = await recall("project", store, { types: ["project"] });
      for (const entry of result.entries) {
        expect(entry.type).toBe("project");
      }
    });

    it("should filter by minimum confidence", async () => {
      const result = await recall("project", store, { minConfidence: 0.8 });
      for (const entry of result.entries) {
        expect(entry.confidence).toBeGreaterThanOrEqual(0.8);
      }
    });

    it("should respect limit option", async () => {
      const result = await recall("project", store, { limit: 1 });
      expect(result.entries.length).toBeLessThanOrEqual(1);
    });

    it("should sort by confidence descending", async () => {
      const result = await recall("project", store);
      for (let i = 1; i < result.entries.length; i++) {
        expect(result.entries[i - 1].confidence).toBeGreaterThanOrEqual(result.entries[i].confidence);
      }
    });

    it("should include context based on level", async () => {
      const briefResult = await recall("TypeScript", store, { level: "brief" });
      expect(briefResult.context).toContain("Relevant memories:");

      const standardResult = await recall("TypeScript", store, { level: "standard" });
      expect(standardResult.context).toContain("## Relevant memories");

      const detailedResult = await recall("TypeScript", store, { level: "detailed" });
      expect(detailedResult.context).toContain("**Type:**");
    });

    it("should return empty context when no matches", async () => {
      const result = await recall("nonexistent-query", store);
      expect(result.entries).toEqual([]);
      expect(result.context).toContain("No matching");
    });
  });

  describe("buildMemoryContext()", () => {
    it("should return memory summary", async () => {
      const context = await buildMemoryContext(store);
      expect(context).toContain("memories");
    });

    it("should return message when no memories", async () => {
      // Create empty store
      const emptyStore = new MemoryStore("/tmp/empty-recall-" + Date.now());
      await emptyStore.init();
      const context = await buildMemoryContext(emptyStore);
      expect(context).toBe("No memories recorded.");

      // Cleanup
      await fs.rm("/tmp/empty-recall-" + Date.now(), { recursive: true, force: true });
    });
  });
});