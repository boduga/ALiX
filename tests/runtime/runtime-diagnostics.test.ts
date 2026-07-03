// tests/runtime/runtime-diagnostics.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRuntimeDiagnostic, formatRuntimeDiagnostic } from "../../src/runtime/runtime-diagnostics.js";
import { withTimeout, SideEffectTimeoutError } from "../../src/runtime/side-effect-timeout.js";
import { withRetry, RetryError } from "../../src/runtime/retry.js";

// ---------------------------------------------------------------------------
// Diagnostic helpers
// ---------------------------------------------------------------------------

describe("buildRuntimeDiagnostic", () => {
  it("builds a timeout diagnostic", () => {
    const d = buildRuntimeDiagnostic("timeout", "file.read", "timed out", { timeoutMs: 5000 });
    assert.strictEqual(d.domain, "runtime");
    assert.strictEqual(d.boundary, "timeout");
    assert.strictEqual(d.operation, "file.read");
    assert.strictEqual(d.timeoutMs, 5000);
  });

  it("builds a retry.attempt diagnostic", () => {
    const d = buildRuntimeDiagnostic("retry.attempt", "provider.complete", "retrying", { attempt: 1, maxRetries: 2 });
    assert.strictEqual(d.boundary, "retry.attempt");
    assert.strictEqual(d.attempt, 1);
    assert.strictEqual(d.maxRetries, 2);
  });
});

describe("formatRuntimeDiagnostic", () => {
  it("formats a readable string", () => {
    const d = buildRuntimeDiagnostic("timeout", "shell.run", "timed out", { timeoutMs: 30000 });
    const s = formatRuntimeDiagnostic(d);
    assert.ok(s.includes("timeout"));
    assert.ok(s.includes("shell.run"));
    assert.ok(s.includes("30000ms"));
  });
});

// ---------------------------------------------------------------------------
// withTimeout diagnostics
// ---------------------------------------------------------------------------

describe("withTimeout diagnostics", () => {
  it("emits diagnostic on timeout before throwing", async () => {
    const diagnostics: any[] = [];
    const promise = withTimeout("slow", 10, () => new Promise((r) => setTimeout(r, 5000)), (d) => diagnostics.push(d));

    await assert.rejects(() => promise, SideEffectTimeoutError);
    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0].boundary, "timeout");
    assert.strictEqual(diagnostics[0].operation, "slow");
  });

  it("does not emit diagnostic on successful operation", async () => {
    const diagnostics: any[] = [];
    await withTimeout("fast", 1000, () => Promise.resolve("ok"), (d) => diagnostics.push(d));
    assert.strictEqual(diagnostics.length, 0);
  });
});

// ---------------------------------------------------------------------------
// withRetry diagnostics
// ---------------------------------------------------------------------------

describe("withRetry diagnostics", () => {
  it("emits diagnostic on retry attempt", async () => {
    const diagnostics: any[] = [];
    let calls = 0;

    await assert.rejects(
      () =>
        withRetry(
          "flaky",
          () => {
            calls++;
            throw Object.assign(new Error("transient"), { name: "SideEffectTimeoutError" });
          },
          { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2 },
          (d) => diagnostics.push(d),
        ),
      RetryError,
    );

    // Should have 2 retry attempt diagnostics (for attempts 1 and 2)
    assert.strictEqual(diagnostics.length, 3); // 2 attempts + 1 exhaustion
    assert.strictEqual(diagnostics[0].boundary, "retry.attempt");
    assert.strictEqual(diagnostics[1].boundary, "retry.attempt");
    assert.strictEqual(diagnostics[2].boundary, "retry.exhausted");
  });

  it("does not emit diagnostic on success", async () => {
    const diagnostics: any[] = [];
    await withRetry("ok", () => Promise.resolve("done"), {}, (d) => diagnostics.push(d));
    assert.strictEqual(diagnostics.length, 0);
  });

  it("does not emit diagnostic on non-retryable error", async () => {
    const diagnostics: any[] = [];
    await assert.rejects(
      () =>
        withRetry("fatal", () => { throw new Error("fatal"); }, {}, (d) => diagnostics.push(d)),
      Error,
    );
    assert.strictEqual(diagnostics.length, 0);
  });
});
