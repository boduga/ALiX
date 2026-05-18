import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../../../src/utils/memory/store.js";
import { buildMemoryContext, recall } from "../../../src/utils/memory/recall.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("MemoryStore can init and save entry", async () => {
  const store = new MemoryStore(join(tmpdir(), "test-memory"));
  await store.init();

  await store.save({
    name: "Test preference",
    description: "Testing memory store",
    type: "user",
    content: "User prefers concise responses",
    confidence: 0.5,
    confirmations: 0,
  });

  const found = await store.find("preference", 5);
  assert.ok(found.length > 0);
  assert.equal(found[0].type, "user");
});

test("buildMemoryContext returns index content", async () => {
  const store = new MemoryStore(join(tmpdir(), "test-memory-context"));
  await store.init();
  await store.buildIndex();

  const context = await buildMemoryContext(store);
  assert.ok(typeof context === "string");
});

test("recall finds entries by query", async () => {
  const store = new MemoryStore(join(tmpdir(), "test-memory-recall"));
  await store.init();

  await store.save({
    name: "Preferred language",
    description: "User's preferred coding language",
    type: "user",
    content: "User prefers TypeScript over JavaScript",
    confidence: 0.8,
    confirmations: 2,
  });

  const result = await recall("TypeScript", store);
  assert.ok(result.entries.length > 0);
  assert.equal(result.level, "standard");
});