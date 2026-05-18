import test from "node:test";
import assert from "node:assert/strict";

test("MemoryType enum has correct values", () => {
  const types = ["user", "project", "feedback", "reference"] as const;
  assert.strictEqual(types.length, 4);
  assert.ok(types.includes("user"));
  assert.ok(types.includes("project"));
  assert.ok(types.includes("feedback"));
  assert.ok(types.includes("reference"));
});

test("MemoryEntry has correct structure", () => {
  const entry = {
    name: "User prefers TypeScript",
    description: "Always use TypeScript for code examples",
    type: "user" as const,
    content: "When writing code, always use TypeScript.",
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
    confidence: 0.5,
    confirmations: 0,
  };
  assert.ok(entry.name);
  assert.ok(entry.type);
  assert.ok(entry.content);
  assert.ok(entry.createdAt);
  assert.ok(entry.modifiedAt);
  assert.ok(typeof entry.confidence === "number");
  assert.ok(typeof entry.confirmations === "number");
});

test("MemoryConfig has correct defaults", () => {
  const config = {
    decayEnabled: true,
    decayDays: 30,
    maxEntriesPerType: 50,
    consolidateSchedule: "daily" as const,
    indexMaxLines: 100,
  };
  assert.strictEqual(config.decayDays, 30);
  assert.strictEqual(config.maxEntriesPerType, 50);
  assert.strictEqual(config.consolidateSchedule, "daily");
  assert.strictEqual(config.indexMaxLines, 100);
});