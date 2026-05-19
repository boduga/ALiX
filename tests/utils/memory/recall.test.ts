import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { MemoryStore } from "../../../src/utils/memory/store.js";
import { recall, buildMemoryContext, buildMemoryStats } from "../../../src/utils/memory/recall.js";

test("recall() finds matching entries", async () => {
  const testDir = "/tmp/recall-test-" + Date.now();
  const store = new MemoryStore(testDir);
  await store.init();

  await store.save({
    name: "TypeScript Project",
    description: "A TypeScript project",
    type: "project",
    content: "This is a TypeScript project with strict mode",
    confidence: 0.9,
    confirmations: 5,
  });

  const result = await recall("TypeScript", store);
  assert.ok(result.entries.length > 0);
  assert.ok(result.entries[0].name.includes("TypeScript"));
});

test("recall() filters by types when specified", async () => {
  const testDir = "/tmp/recall-test-types-" + Date.now();
  const store = new MemoryStore(testDir);
  await store.init();

  await store.save({ name: "Project 1", description: "", type: "project", content: "Content 1", confidence: 0.8, confirmations: 1 });
  await store.save({ name: "User 1", description: "", type: "user", content: "User content", confidence: 0.8, confirmations: 1 });

  const result = await recall("content", store, { types: ["project"] });
  for (const entry of result.entries) {
    assert.equal(entry.type, "project");
  }
});

test("recall() filters by minimum confidence", async () => {
  const testDir = "/tmp/recall-test-conf-" + Date.now();
  const store = new MemoryStore(testDir);
  await store.init();

  await store.save({ name: "High Conf", description: "", type: "project", content: "High confidence content", confidence: 0.9, confirmations: 1 });
  await store.save({ name: "Low Conf", description: "", type: "project", content: "Low confidence content", confidence: 0.3, confirmations: 1 });

  const result = await recall("content", store, { minConfidence: 0.8 });
  assert.ok(result.entries.length > 0);
  for (const entry of result.entries) {
    assert.ok(entry.confidence >= 0.8);
  }
});

test("recall() respects limit option", async () => {
  const testDir = "/tmp/recall-test-limit-" + Date.now();
  const store = new MemoryStore(testDir);
  await store.init();

  await store.save({ name: "Project 1", description: "", type: "project", content: "Content 1", confidence: 0.8, confirmations: 1 });
  await store.save({ name: "Project 2", description: "", type: "project", content: "Content 2", confidence: 0.8, confirmations: 1 });

  const result = await recall("project", store, { limit: 1 });
  assert.ok(result.entries.length <= 1);
});

test("recall() sorts by confidence descending", async () => {
  const testDir = "/tmp/recall-test-sort-" + Date.now();
  const store = new MemoryStore(testDir);
  await store.init();

  await store.save({ name: "Low", description: "", type: "project", content: "Low conf", confidence: 0.3, confirmations: 1 });
  await store.save({ name: "High", description: "", type: "project", content: "High conf", confidence: 0.9, confirmations: 1 });

  const result = await recall("conf", store);
  assert.ok(result.entries[0].confidence >= result.entries[1].confidence);
});

test("recall() returns empty context when no matches", async () => {
  const testDir = "/tmp/recall-test-empty-" + Date.now();
  const store = new MemoryStore(testDir);
  await store.init();

  const result = await recall("nonexistent-query", store);
  assert.deepEqual(result.entries, []);
});

test("buildMemoryContext() returns memory summary", async () => {
  const testDir = "/tmp/recall-test-context-" + Date.now();
  const store = new MemoryStore(testDir);
  await store.init();

  await store.save({ name: "Test Entry", description: "", type: "project", content: "Test content", confidence: 0.8, confirmations: 1 });

  const context = await buildMemoryContext(store);
  assert.ok(typeof context === "string");
});

test("buildMemoryContext() handles empty store", async () => {
  const testDir = "/tmp/recall-test-no-mem-" + Date.now();
  const store = new MemoryStore(testDir);
  await store.init();

  const context = await buildMemoryContext(store);
  assert.ok(typeof context === "string");
});

test("buildMemoryStats() returns stats summary with count", async () => {
  const testDir = "/tmp/recall-test-stats-" + Date.now();
  const store = new MemoryStore(testDir);
  await store.init();

  await store.save({ name: "TypeScript Preference", description: "Prefers TypeScript", type: "user", content: "User prefers TS", confidence: 0.9, confirmations: 5 });
  await store.save({ name: "File Storage", description: "We chose file-based storage", type: "project", content: "File storage", confidence: 0.8, confirmations: 2 });

  const stats = await buildMemoryStats(store);
  assert.ok(stats.includes("Loaded 2 memories:"));
  assert.ok(stats.includes("[user] TypeScript Preference"));
  assert.ok(stats.includes("(confirmed 5x)"));
  assert.ok(stats.includes("[project] File Storage"));
  assert.ok(stats.includes("(confirmed 2x)"));
});

test("buildMemoryStats() returns empty string for empty store", async () => {
  const testDir = "/tmp/recall-test-no-stats-" + Date.now();
  const store = new MemoryStore(testDir);
  await store.init();

  const stats = await buildMemoryStats(store);
  assert.equal(stats, "");
});

test("buildMemoryStats() groups by type and sorts by confidence", async () => {
  const testDir = "/tmp/recall-test-group-" + Date.now();
  const store = new MemoryStore(testDir);
  await store.init();

  await store.save({ name: "Low Priority", description: "Low", type: "feedback", content: "Content", confidence: 0.3, confirmations: 1 });
  await store.save({ name: "High Priority", description: "High", type: "feedback", content: "Content", confidence: 0.9, confirmations: 1 });
  await store.save({ name: "Another User", description: "User pref", type: "user", content: "Content", confidence: 0.7, confirmations: 2 });

  const stats = await buildMemoryStats(store);
  // High should appear before Low within feedback type
  const highIdx = stats.indexOf("High Priority");
  const lowIdx = stats.indexOf("Low Priority");
  assert.ok(highIdx < lowIdx, "Entries should be sorted by confidence within type");
});