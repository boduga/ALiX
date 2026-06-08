import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseManager } from "../../src/db/manager.js";

describe("DatabaseManager", () => {
  let tmpDir: string;
  let dbPath: string;
  let manager: DatabaseManager;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "db-test-"));
    dbPath = join(tmpDir, "test.db");
    manager = new DatabaseManager(dbPath);
  });

  after(() => {
    manager.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("opens a new database file", () => {
    manager.open();
    const health = manager.health();
    assert.equal(health.ok, true);
  });

  it("runs kernel migration successfully", () => {
    manager.migrateKernel();
    const health = manager.health();
    const expectedTables = ["events", "m09_metrics", "policy_decisions", "task_graphs", "task_nodes", "workflows"];
    for (const t of expectedTables) {
      assert.ok(health.tables.includes(t), `table ${t} should exist`);
    }
  });

  it("migration is idempotent (safe to run twice)", () => {
    manager.migrateKernel(); // second run
    const health = manager.health();
    assert.ok(health.tables.includes("workflows"), "workflows table still exists after second migration");
  });
});
