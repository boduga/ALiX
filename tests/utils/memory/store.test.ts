import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { MemoryStore } from "../../../src/utils/memory/store.js";

test("MemoryStore init() creates base directory", async () => {
  const testDir = "/tmp/memory-test-init-" + Date.now();
  const store = new MemoryStore(testDir);
  await store.init();

  const stat = await fs.stat(testDir);
  assert.ok(stat.isDirectory());
});

test("MemoryStore init() creates type directories", async () => {
  const testDir = "/tmp/memory-test-types-" + Date.now();
  const store = new MemoryStore(testDir);
  await store.init();

  const types = ["user", "project", "feedback", "reference"];
  for (const type of types) {
    const typeDir = path.join(testDir, type);
    const stat = await fs.stat(typeDir);
    assert.ok(stat.isDirectory(), `Directory ${type} should exist`);
  }
});

test("MemoryStore init() creates logs directory", async () => {
  const testDir = "/tmp/memory-test-logs-" + Date.now();
  const store = new MemoryStore(testDir);
  await store.init();

  const logsDir = path.join(testDir, "logs");
  const stat = await fs.stat(logsDir);
  assert.ok(stat.isDirectory());
});

test("MemoryStore init() creates config file", async () => {
  const testDir = "/tmp/memory-test-config-" + Date.now();
  const store = new MemoryStore(testDir);
  await store.init();

  const configPath = path.join(testDir, "config.json");
  const stat = await fs.stat(configPath);
  assert.ok(stat.isFile());
});

test("MemoryStore save() saves a memory entry", async () => {
  const testDir = "/tmp/memory-test-save-" + Date.now();
  const store = new MemoryStore(testDir);
  await store.init();

  const entry = {
    name: "Test Memory",
    description: "A test memory entry",
    type: "project" as const,
    content: "This is test content",
    confidence: 0.8,
    confirmations: 2,
  };

  const saved = await store.save(entry);
  assert.equal(saved.name, entry.name);
  assert.ok(saved.createdAt);
  assert.ok(saved.modifiedAt);
});

test("MemoryStore save() creates file with frontmatter", async () => {
  const testDir = "/tmp/memory-test-front-" + Date.now();
  const store = new MemoryStore(testDir);
  await store.init();

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

  assert.ok(content.includes("---"));
  assert.ok(content.includes("name: Frontmatter Test"));
  assert.ok(content.includes("type: user"));
  assert.ok(content.includes("Some content here"));
});

test("MemoryStore find() finds entries by query", async () => {
  const testDir = "/tmp/memory-test-find-" + Date.now();
  const store = new MemoryStore(testDir);
  await store.init();

  await store.save({
    name: "JavaScript Project",
    description: "A JS project",
    type: "project",
    content: "This is about JavaScript development",
    confidence: 0.8,
    confirmations: 1,
  });

  const results = await store.find("JavaScript", 10);
  assert.ok(results.length > 0);
  assert.ok(results[0].name.includes("JavaScript"));
});

test("MemoryStore find() limits results", async () => {
  const testDir = "/tmp/memory-test-limit-" + Date.now();
  const store = new MemoryStore(testDir);
  await store.init();

  await store.save({ name: "Project 1", description: "", type: "project", content: "Content 1", confidence: 0.8, confirmations: 1 });
  await store.save({ name: "Project 2", description: "", type: "project", content: "Content 2", confidence: 0.8, confirmations: 1 });

  const results = await store.find("project", 1);
  assert.ok(results.length <= 1);
});

test("MemoryStore find() returns empty array for no matches", async () => {
  const testDir = "/tmp/memory-test-empty-" + Date.now();
  const store = new MemoryStore(testDir);
  await store.init();

  const results = await store.find("nonexistent-query-xyz", 10);
  assert.deepEqual(results, []);
});

test("MemoryStore loadIndex() loads the index file content", async () => {
  const testDir = "/tmp/memory-test-index-" + Date.now();
  const store = new MemoryStore(testDir);
  await store.init();

  const index = await store.loadIndex();
  assert.ok(index.includes("# ALiX Memory Index") || index.includes("# Memory Index"));
});

test("MemoryStore buildIndex() rebuilds index with all entries", async () => {
  const testDir = "/tmp/memory-test-build-" + Date.now();
  const store = new MemoryStore(testDir);
  await store.init();

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
  assert.ok(index.includes("Indexed Entry"));
});

test("MemoryStore getBasePath() returns the base path", async () => {
  const testDir = "/tmp/memory-test-path-" + Date.now();
  const store = new MemoryStore(testDir);

  assert.equal(store.getBasePath(), testDir);
});