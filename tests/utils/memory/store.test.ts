import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { MemoryStore } from "../../../src/utils/memory/store.js";

describe("MemoryStore", () => {
  const testDir = path.join("/tmp", "memory-store-test-" + Date.now());
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore(testDir);
    await store.init();
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("init()", () => {
    it("should create base directory", async () => {
      const stat = await fs.stat(testDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it("should create type directories", async () => {
      const types = ["user", "project", "feedback", "reference"];
      for (const type of types) {
        const typeDir = path.join(testDir, type);
        const stat = await fs.stat(typeDir);
        expect(stat.isDirectory()).toBe(true);
      }
    });

    it("should create logs directory", async () => {
      const logsDir = path.join(testDir, "logs");
      const stat = await fs.stat(logsDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it("should create config file", async () => {
      const configPath = path.join(testDir, "config.json");
      const stat = await fs.stat(configPath);
      expect(stat.isFile()).toBe(true);
    });

    it("should create initial index file", async () => {
      const indexPath = path.join(testDir, "memory.md");
      const stat = await fs.stat(indexPath);
      expect(stat.isFile()).toBe(true);
    });
  });

  describe("save()", () => {
    it("should save a memory entry", async () => {
      const entry = {
        name: "Test Memory",
        description: "A test memory entry",
        type: "project" as const,
        content: "This is test content",
        confidence: 0.8,
        confirmations: 2,
      };

      const saved = await store.save(entry);
      expect(saved.name).toBe(entry.name);
      expect(saved.createdAt).toBeDefined();
      expect(saved.modifiedAt).toBeDefined();
    });

    it("should create file with frontmatter", async () => {
      const entry = {
        name: "Frontmatter Test",
        description: "Testing frontmatter",
        type: "user" as const,
        content: "Some content here",
        confidence: 0.9,
        confirmations: 1,
      };

      await store.save(entry);
      const filePath = path.join(testDir, "user", "frontmatter-test.md");
      const content = await fs.readFile(filePath, "utf-8");

      expect(content).toContain("---");
      expect(content).toContain("name: Frontmatter Test");
      expect(content).toContain("type: user");
      expect(content).toContain("Some content here");
    });
  });

  describe("find()", () => {
    beforeEach(async () => {
      // Save some test entries
      await store.save({
        name: "JavaScript Project",
        description: "A JS project",
        type: "project",
        content: "This is about JavaScript development",
        confidence: 0.8,
        confirmations: 1,
      });
      await store.save({
        name: "Python Script",
        description: "A Python script",
        type: "project",
        content: "This is about Python programming",
        confidence: 0.7,
        confirmations: 1,
      });
      await store.save({
        name: "User Preference",
        description: "User likes dark mode",
        type: "user",
        content: "Prefers dark mode theme",
        confidence: 0.9,
        confirmations: 3,
      });
    });

    it("should find entries by query", async () => {
      const results = await store.find("JavaScript", 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toContain("JavaScript");
    });

    it("should limit results", async () => {
      const results = await store.find("project", 1);
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it("should return empty array for no matches", async () => {
      const results = await store.find("nonexistent-query-xyz", 10);
      expect(results).toEqual([]);
    });
  });

  describe("loadIndex()", () => {
    it("should load the index file content", async () => {
      const index = await store.loadIndex();
      expect(index).toContain("# ALiX Memory Index");
    });

    it("should return empty string for non-existent index", async () => {
      // Create a new store without init
      const emptyStore = new MemoryStore("/tmp/nonexistent-" + Date.now());
      const index = await emptyStore.loadIndex();
      expect(index).toBe("");
    });
  });

  describe("buildIndex()", () => {
    it("should rebuild index with all entries", async () => {
      await store.save({
        name: "Indexed Entry",
        description: "Should be in index",
        type: "reference",
        content: "Reference content",
        confidence: 0.8,
        confirmations: 1,
      });

      await store.buildIndex();
      const index = await store.loadIndex();
      expect(index).toContain("Indexed Entry");
    });
  });

  describe("getBasePath()", () => {
    it("should return the base path", () => {
      expect(store.getBasePath()).toBe(testDir);
    });
  });
});