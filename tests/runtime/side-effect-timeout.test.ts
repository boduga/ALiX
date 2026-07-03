// tests/runtime/side-effect-timeout.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withTimeout, SideEffectTimeoutError } from "../../src/runtime/side-effect-timeout.js";

describe("withTimeout", () => {
  // -- Successful operation ------------------------------------------------

  it("resolves with the result when operation completes in time", async () => {
    const result = await withTimeout("fast-op", 1000, async () => "done");
    assert.strictEqual(result, "done");
  });

  it("resolves with numeric result", async () => {
    const result = await withTimeout("count", 1000, async () => 42);
    assert.strictEqual(result, 42);
  });

  it("resolves with undefined when effect returns void", async () => {
    const result = await withTimeout("void-op", 1000, async () => {});
    assert.strictEqual(result, undefined);
  });

  // -- Operation throws ---------------------------------------------------

  it("rejects when operation throws before timeout", async () => {
    await assert.rejects(
      () =>
        withTimeout("throws", 1000, async () => {
          throw new Error("operation failed");
        }),
      (err: unknown) =>
        err instanceof Error && err.message === "operation failed",
    );
  });

  it("rejects with the original error type", async () => {
    class CustomError extends Error {
      readonly code = "CUSTOM";
    }

    await assert.rejects(
      () =>
        withTimeout("custom", 1000, async () => {
          throw new CustomError("custom failure");
        }),
      CustomError,
    );
  });

  // -- Timeout expiry -----------------------------------------------------

  it("rejects with SideEffectTimeoutError when timeout expires", async () => {
    const start = Date.now();
    await assert.rejects(
      () =>
        withTimeout("slow", 50, async () => {
          await new Promise((r) => setTimeout(r, 5000));
          return "too late";
        }),
      (err: unknown) =>
        err instanceof SideEffectTimeoutError &&
        err.operation === "slow" &&
        err.timeoutMs === 50,
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 500, `timed out in ${elapsed}ms, expected < 500`);
  });

  it("SideEffectTimeoutError has correct fields", async () => {
    try {
      await withTimeout("test-op", 30, async () => {
        await new Promise((r) => setTimeout(r, 5000));
      });
      assert.fail("should have thrown");
    } catch (e: unknown) {
      if (!(e instanceof SideEffectTimeoutError)) throw e;
      assert.strictEqual(e.kind, "SideEffectTimeoutError");
      assert.strictEqual(e.operation, "test-op");
      assert.strictEqual(e.timeoutMs, 30);
      assert.ok(e.message.includes("test-op"));
      assert.ok(e.message.includes("30ms"));
    }
  });

  it("timeout less than operation duration rejects", async () => {
    await assert.rejects(
      () =>
        withTimeout("barely-enough", 10, async () => {
          await new Promise((r) => setTimeout(r, 100));
          return "slow";
        }),
      SideEffectTimeoutError,
    );
  });

  // -- No timeout needed --------------------------------------------------

  it("completes immediately for zero-delay effect", async () => {
    const result = await withTimeout("instant", 1000, async () => "immediate");
    assert.strictEqual(result, "immediate");
  });
});
