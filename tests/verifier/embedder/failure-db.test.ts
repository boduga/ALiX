import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { FailureDatabase } from "../../../src/verifier/embedder/failure-db.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink } from "node:fs/promises";

describe("FailureDatabase", () => {
  const dbPath = join(tmpdir(), "test-failures.db");

  afterEach(async () => {
    try {
      await unlink(dbPath);
    } catch {}
  });

  it("initializes database with schema", async () => {
    const db = new FailureDatabase(dbPath);
    await db.init();

    const tables = await db.listTables();
    assert.ok(tables.includes("failure_records"));
    assert.ok(tables.includes("embeddings"));

    await db.close();
  });

  it("inserts and retrieves failure record", async () => {
    const db = new FailureDatabase(dbPath);
    await db.init();

    const record = {
      id: "fail-1",
      sessionId: "session-123",
      task: "fix auth bug",
      errorSummary: "Cannot read property of undefined",
      fileChanges: ["src/auth.ts"],
      resolution: "Added null check",
      resolvedAt: Date.now(),
      embeddingId: "emb-1",
    };

    await db.insertFailure(record);

    const found = await db.getFailure("fail-1");
    assert.ok(found);
    assert.equal(found.task, "fix auth bug");

    await db.close();
  });

  it("searches by text similarity", async () => {
    const db = new FailureDatabase(dbPath);
    await db.init();

    // Insert test records
    await db.insertFailure({
      id: "fail-1",
      sessionId: "s1",
      task: "TypeError in auth",
      errorSummary: "Cannot read property 'name' of null",
      fileChanges: ["auth.ts"],
      resolution: "Added null check",
      resolvedAt: Date.now(),
      embeddingId: "emb-1",
    });

    // Search with similar query
    const results = await db.searchByEmbedding(
      new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]), // query embedding
      5, // top K
      0.7 // threshold
    );

    assert.ok(Array.isArray(results));

    await db.close();
  });
});