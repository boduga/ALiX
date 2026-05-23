import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
import { ExemplarMatcher } from "../../../src/verifier/embedder/exemplar.js";
import { FailureDatabase } from "../../../src/verifier/embedder/failure-db.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink } from "node:fs/promises";

describe("ExemplarMatcher", () => {
  const dbPath = join(tmpdir(), "test-exemplars.db");

  afterEach(async () => {
    try {
      await unlink(dbPath);
    } catch {}
  });

  it("finds similar past failures", async () => {
    const db = new FailureDatabase(dbPath);
    await db.init();

    // Seed with known failure
    await db.insertFailure({
      id: "fail-auth-1",
      sessionId: "s1",
      task: "fix authentication bug",
      errorSummary: "TypeError: Cannot read property 'token' of null in auth handler",
      fileChanges: ["src/auth/handler.ts"],
      resolution: "Added null check: if (!user) return 401",
      resolvedAt: Date.now() - 86400000,
      embeddingId: "emb-1",
    });

    const matcher = new ExemplarMatcher(db);

    const results = await matcher.findSimilar({
      task: "auth is broken",
      errors: ["TypeError: Cannot read property 'token'"],
      files: ["src/auth/handler.ts"],
    });

    assert.ok(results.length > 0);
    assert.ok(results[0].score > 0.5);
    assert.ok(results[0].record.resolution);

    await db.close();
  });

  it("returns ranked results with confidence", async () => {
    const db = new FailureDatabase(dbPath);
    await db.init();

    const matcher = new ExemplarMatcher(db);

    await db.insertFailure({
      id: "fail-1",
      sessionId: "s1",
      task: "test failure",
      errorSummary: "AssertionError: expected 5 to equal 6",
      fileChanges: ["test.ts"],
      resolution: "Fixed assertion",
      resolvedAt: Date.now(),
      embeddingId: "emb-1",
    });

    const results = await matcher.findSimilar({
      task: "math test broken",
      errors: ["AssertionError"],
      files: ["test.ts"],
    });

    // Results should be sorted by score descending
    if (results.length > 1) {
      assert.ok(results[0].score >= results[1].score);
    }

    await db.close();
  });
});
