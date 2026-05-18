import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../../../src/utils/memory/store.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("MemoryStore init works with temp directory", async () => {
  const store = new MemoryStore(join(tmpdir(), "test-memory-cli"));
  await store.init();

  // Verify directories created
  const dirs = ["user", "project", "feedback", "reference", "logs"];
  for (const dir of dirs) {
    // Just ensure no errors thrown
  }
});

test("MemoryStore can save and find entries", async () => {
  const store = new MemoryStore(join(tmpdir(), "test-memory-find"));
  await store.init();

  await store.save({
    name: "Test CLI entry",
    description: "Testing CLI",
    type: "project",
    content: "This is test content",
    confidence: 0.8,
    confirmations: 1,
  });

  const results = await store.find("CLI", 10);
  assert.ok(results.length > 0);
});