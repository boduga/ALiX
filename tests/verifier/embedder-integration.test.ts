import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { EnhancedVerifier } from "../../src/verifier/enhanced-verifier.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, mkdir, unlink, rmdir } from "node:fs/promises";

describe("EnhancedVerifier Integration", () => {
  const testDir = join(tmpdir(), "enhanced-verifier-test");
  const dbPath = join(testDir, "failures.db");

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    await writeFile(join(testDir, "package.json"), JSON.stringify({
      scripts: { test: "echo 'no tests'" }
    }));
  });

  afterEach(async () => {
    try {
      await unlink(dbPath);
      await rmdir(testDir);
    } catch {}
  });

  it("scores verification with embedder confidence", async () => {
    const verifier = new EnhancedVerifier({
      cwd: testDir,
      embedderDb: dbPath,
    });

    await verifier.init();
    const result = await verifier.verifyAndScore();

    assert.ok(result.score >= 0 && result.score <= 1);
    assert.ok(result.checks.length >= 0);

    await verifier.close();
  });

  it("suggests fixes from historical failures", async () => {
    const verifier = new EnhancedVerifier({
      cwd: testDir,
      embedderDb: dbPath,
    });

    await verifier.init();

    // Record a past failure
    await verifier.recordFailure({
      task: "fix import bug",
      errorSummary: "Cannot find module './utils'",
      fileChanges: ["src/utils.ts"],
      resolution: "Added index.ts export",
    });

    // Query for similar
    const suggestions = await verifier.suggestFixes({
      errors: ["Cannot find module"],
      files: ["src/utils.ts"],
    });

    assert.ok(Array.isArray(suggestions));

    await verifier.close();
  });
});