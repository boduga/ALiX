// tests/mcp/retry.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withRetry } from "../../src/mcp/retry.js";

describe("withRetry", () => {
  it("returns immediately on success", async () => {
    let calls = 0;
    const result = await withRetry(async () => { calls++; return "ok"; }, { maxRetries: 0, baseDelayMs: 1 });
    assert.equal(result, "ok");
    assert.equal(calls, 1);
  });

  it("retries on connection error up to maxRetries", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error("ECONNREFUSED");
        return "ok";
      },
      { maxRetries: 3, baseDelayMs: 1 }
    );
    assert.equal(result, "ok");
    assert.equal(calls, 3);
  });

  it("throws after maxRetries exhausted", async () => {
    let calls = 0;
    await assert.rejects(
      () => withRetry(
        async () => { calls++; throw new Error("ECONNREFUSED"); },
        { maxRetries: 2, baseDelayMs: 1 }
      ),
      /ECONNREFUSED/
    );
    assert.equal(calls, 3);  // initial + 2 retries
  });

  it("does not retry on non-retryable error", async () => {
    let calls = 0;
    await assert.rejects(
      () => withRetry(
        async () => { calls++; throw new Error("Invalid argument"); },
        { maxRetries: 3, baseDelayMs: 1, isRetryable: (e) => e.message.includes("ECONN") }
      ),
      /Invalid argument/
    );
    assert.equal(calls, 1);
  });
});
