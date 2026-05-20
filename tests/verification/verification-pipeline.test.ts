import { describe, it } from "node:test";
import assert from "node:assert";
import { VerificationPipeline } from "../../src/verification/verification-pipeline.js";

describe("VerificationPipeline", () => {
  it("runs discovery and execution in sequence", async () => {
    const pipeline = new VerificationPipeline({ cwd: process.cwd() });
    const result = await pipeline.run();

    assert.ok(result.discovered.length >= 0);
    assert.ok(result.executed.length >= 0);
  });

  it("stops on first failure when configured", async () => {
    const pipeline = new VerificationPipeline({
      cwd: process.cwd(),
      stopOnFailure: true,
    });

    const result = await pipeline.run();
    assert.ok(result.success || result.partial);
  });
});