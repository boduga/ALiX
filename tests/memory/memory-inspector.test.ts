import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { MemoryInspector } from "../../src/memory/memory-inspector.js";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("MemoryInspector", () => {
  let testDir: string;
  let inspector: MemoryInspector;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "alix-memory-inspector-"));
    inspector = new MemoryInspector(testDir);
  });

  it("lists project memory", async () => {
    const result = await inspector.inspect("project");
    assert.ok(result.scope === "project");
    assert.ok(Array.isArray(result.records));
  });

  it("lists session memory", async () => {
    const result = await inspector.inspect("session");
    assert.ok(result.scope === "session");
  });

  it("shows memory stats", async () => {
    const stats = await inspector.getStats();
    assert.ok(typeof stats.projectRecords === "number");
    assert.ok(typeof stats.sessionRecords === "number");
    assert.ok(typeof stats.totalTokens === "number");
  });

  it("formats memory for display", async () => {
    const formatted = await inspector.format("project");
    assert.ok(typeof formatted === "string");
  });

  it("clears memory by scope", async () => {
    // Create a session memory directory with a record
    const sessionDir = join(testDir, ".alix", "memory", "session");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "test-record.json"),
      JSON.stringify({
        id: "test-record",
        scope: "session",
        content: "Test content",
        source: "test",
        createdAt: new Date().toISOString(),
      })
    );

    const before = await inspector.getStats();
    assert.ok(before.sessionRecords >= 1, "Should have session records before clear");

    await inspector.clear("session");

    const after = await inspector.getStats();
    assert.ok(after.sessionRecords < before.sessionRecords, "Should have fewer session records after clear");

    await rm(testDir, { recursive: true, force: true });
  });
});