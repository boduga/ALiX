// tests/runtime/retry.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withRetry, RetryError } from "../../src/runtime/retry.js";

describe("withRetry", () => {
  // -- Successful operation -------------------------------------------------

  it("resolves immediately on success", async () => {
    const result = await withRetry("ok", async () => "done");
    assert.strictEqual(result, "done");
  });

  it("resolves after retry when first attempt fails", async () => {
    let calls = 0;
    const result = await withRetry(
      "recovers",
      async () => {
        calls++;
        if (calls < 2) throw Object.assign(new Error("transient"), { name: "SideEffectTimeoutError" });
        return "recovered";
      },
      { maxRetries: 2, baseDelayMs: 5 },
    );
    assert.strictEqual(result, "recovered");
    assert.strictEqual(calls, 2);
  });

  // -- Non-retryable errors -------------------------------------------------

  it("rejects immediately on non-retryable error", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withRetry("fatal", async () => {
          calls++;
          throw new Error("fatal");
        }),
      (err: unknown) => err instanceof Error && err.message === "fatal",
    );
    // Should have only tried once
    assert.strictEqual(calls, 1);
  });

  // -- Exhausted retries ----------------------------------------------------

  it("rejects with RetryError after exhausting retries", async () => {
    let calls = 0;
    const err = await withRetry(
      "exhaust",
      async () => {
        calls++;
        throw Object.assign(new Error("always fails"), { name: "SideEffectTimeoutError" });
      },
      { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 2 },
    ).then(
      () => { throw new Error("should not resolve"); },
      (e: unknown) => e,
    );

    assert.ok(err instanceof RetryError);
    assert.strictEqual(err.operation, "exhaust");
    assert.strictEqual(err.attempts, 4); // 1 initial + 3 retries
    assert.strictEqual(calls, 4);
  });

  // -- Custom shouldRetry ---------------------------------------------------

  it("uses custom shouldRetry predicate", async () => {
    let calls = 0;
    const result = await withRetry(
      "custom",
      async () => {
        calls++;
        if (calls < 3) throw new Error("custom-retryable");
        return "done";
      },
      {
        maxRetries: 3,
        baseDelayMs: 1,
        shouldRetry: (err) => err instanceof Error && err.message === "custom-retryable",
      },
    );
    assert.strictEqual(result, "done");
    assert.strictEqual(calls, 3);
  });

  // -- RetryError metadata --------------------------------------------------

  it("RetryError preserves last error", async () => {
    const lastErr = new Error("underlying cause");
    try {
      await withRetry(
        "meta",
        async () => { throw lastErr; },
        { maxRetries: 1, baseDelayMs: 1, shouldRetry: () => true },
      );
      assert.fail("should have thrown");
    } catch (e: unknown) {
      if (!(e instanceof RetryError)) throw e;
      assert.strictEqual(e.kind, "RetryError");
      assert.strictEqual(e.operation, "meta");
      assert.strictEqual(e.lastError, lastErr);
    }
  });

  // -- Zero retries ---------------------------------------------------------

  it("with maxRetries=0 does not retry", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withRetry(
          "no-retry",
          async () => {
            calls++;
            throw Object.assign(new Error("fail"), { name: "SideEffectTimeoutError" });
          },
          { maxRetries: 0, shouldRetry: () => true },
        ),
      RetryError,
    );
    assert.strictEqual(calls, 1);
  });
});
