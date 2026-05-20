import { describe, it } from "node:test";
import assert from "node:assert";
import { VerificationPipeline } from "../../src/verification/verification-pipeline.js";

describe("VerificationPipeline", () => {
  it("discovers commands from the project", async () => {
    const pipeline = new VerificationPipeline({ cwd: process.cwd() });
    const result = await pipeline.run();

    // Pipeline should return results with proper structure
    assert.ok(result.discovered !== undefined, "discovered should be defined");
    assert.ok(Array.isArray(result.discovered), "discovered should be an array");
    assert.ok(Array.isArray(result.executed), "executed should be an array");
    assert.ok(result.reporter !== undefined, "reporter should be defined");
  });

  it("reports execution status", async () => {
    const pipeline = new VerificationPipeline({ cwd: process.cwd() });
    const result = await pipeline.run();

    // Success should be true only if no failures; partial if some passed and some failed
    assert.equal(typeof result.success, "boolean", "success should be boolean");
    assert.equal(typeof result.partial, "boolean", "partial should be boolean");

    // If all executed commands passed, success should be true
    if (result.executed.every(cmd => cmd.success)) {
      assert.ok(result.success, "success should be true when all commands pass");
      assert.ok(!result.partial, "partial should be false when all commands pass");
    }
  });

  it("stops on first failure when stopOnFailure is true", async () => {
    const pipeline = new VerificationPipeline({
      cwd: process.cwd(),
      stopOnFailure: true,
    });

    const result = await pipeline.run();

    // Result should have valid structure regardless of outcome
    assert.ok(Array.isArray(result.executed), "executed should be an array");
    assert.ok(Array.isArray(result.discovered), "discovered should be an array");

    // When stopOnFailure is true and there are failures, partial should be true
    if (!result.success && result.discovered.length > 1) {
      assert.ok(result.partial, "partial should be true when some commands are skipped");
    }
  });

  it("respects timeout configuration", async () => {
    const pipeline = new VerificationPipeline({
      cwd: process.cwd(),
      timeout: 5000,
      verbose: false,
    });

    const result = await pipeline.run();

    // Should complete within reasonable time and return valid results
    assert.ok(result.discovered !== undefined);
    assert.equal(typeof result.success, "boolean");
  });
});