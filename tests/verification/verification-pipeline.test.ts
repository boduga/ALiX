import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VerificationPipeline } from "../../src/verification/verification-pipeline.js";

// Hermetic fixture: a temp project dir with controlled npm test scripts.
// Running the pipeline against the real repo's cwd would discover and
// EXECUTE the project's own `npm test` (the full suite, minutes), blowing
// any unit-test timeout. A controlled fixture keeps these tests fast,
// deterministic, and able to exercise pass/fail/skip paths.
function makeFixtureDir(scripts: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "alix-verification-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts }));
  return dir;
}

async function withFixtureDir(
  scripts: Record<string, string>,
  fn: (cwd: string) => Promise<void>,
): Promise<void> {
  const cwd = makeFixtureDir(scripts);
  try {
    await fn(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

const PASS = 'node -e "process.exit(0)"';
const FAIL = 'node -e "process.exit(1)"';

describe("VerificationPipeline", () => {
  it("discovers commands from the project", async () => {
    await withFixtureDir({ test: PASS }, async (cwd) => {
      const pipeline = new VerificationPipeline({ cwd });
      const result = await pipeline.run();

      assert.ok(result.discovered !== undefined, "discovered should be defined");
      assert.ok(Array.isArray(result.discovered), "discovered should be an array");
      assert.ok(result.discovered.length >= 1, "should discover at least the npm test script");
      assert.ok(Array.isArray(result.executed), "executed should be an array");
      assert.ok(result.reporter !== undefined, "reporter should be defined");
    });
  });

  it("reports execution status", async () => {
    await withFixtureDir({ test: PASS }, async (cwd) => {
      const pipeline = new VerificationPipeline({ cwd });
      const result = await pipeline.run();

      assert.equal(typeof result.success, "boolean", "success should be boolean");
      assert.equal(typeof result.partial, "boolean", "partial should be boolean");

      // With an all-passing fixture this is deterministic, not conditional.
      assert.equal(result.success, true, "success should be true when all commands pass");
      assert.equal(result.partial, false, "partial should be false when all commands pass");
    });
  });

  it("stops on first failure when stopOnFailure is true", async () => {
    // The first command (test, priority CRITICAL) fails; the second
    // (test:unit, priority HIGH) must be skipped, not executed.
    await withFixtureDir({ test: FAIL, "test:unit": PASS }, async (cwd) => {
      const pipeline = new VerificationPipeline({ cwd, stopOnFailure: true });
      const result = await pipeline.run();

      assert.equal(result.success, false, "a failing command should make success false");
      assert.equal(result.partial, true, "stopOnFailure should mark the run partial");
      assert.ok(result.executed.length >= 2, "both commands should be present in executed");
      assert.equal(result.executed[0]!.name, "test", "the failing command runs first");
      assert.equal(result.executed[0]!.success, false, "the failing command should be recorded as failed");
      assert.equal(result.executed[1]!.name, "unit", "the second command is discovered");
      assert.equal(result.executed[1]!.success, false, "the skipped command should not be marked successful");
    });
  });

  it("respects timeout configuration", async () => {
    await withFixtureDir({ test: PASS }, async (cwd) => {
      const pipeline = new VerificationPipeline({ cwd, timeout: 5000, verbose: false });
      const result = await pipeline.run();

      assert.ok(result.discovered !== undefined);
      assert.equal(typeof result.success, "boolean");
    });
  });
});
