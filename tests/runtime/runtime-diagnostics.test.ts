// tests/runtime/runtime-diagnostics.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRuntimeDiagnostic, formatRuntimeDiagnostic, createMultiplexDiagnosticSink } from "../../src/runtime/runtime-diagnostics.js";
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

// ---------------------------------------------------------------------------
// Multiplex sink
// ---------------------------------------------------------------------------

describe("createMultiplexDiagnosticSink", () => {
  it("emits to all child sinks", () => {
    const received: any[] = [];
    const sink1 = { emit: (d: any) => received.push("a:" + d.event) };
    const sink2 = { emit: (d: any) => received.push("b:" + d.event) };

    const mux = createMultiplexDiagnosticSink(sink1, sink2);
    const diag = buildRuntimeDiagnostic("timeout", "test", "testing");

    mux.emit(diag);
    assert.strictEqual(received.length, 2);
    assert.ok(received[0].startsWith("a:"));
    assert.ok(received[1].startsWith("b:"));
  });

  it("isolates failing sinks", () => {
    const received: any[] = [];
    const failing = { emit: () => { throw new Error("sink failure"); } };
    const working = { emit: (d: any) => received.push(d.event) };

    const mux = createMultiplexDiagnosticSink(failing, working);
    const diag = buildRuntimeDiagnostic("timeout", "test", "survives");

    mux.emit(diag);
    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0], "survives");
  });
});

// ---------------------------------------------------------------------------
// Context propagation through withTimeout
// ---------------------------------------------------------------------------

describe("withTimeout context", () => {
  it("emits diagnostic with context on timeout", async () => {
    const received: any[] = [];
    const ctx = { runId: "run-t1", agentId: "coder" };

    await assert.rejects(
      () =>
        withTimeout("ctx-timeout", 10, () => new Promise((r) => setTimeout(r, 5000)), (d) => received.push(d), ctx),
      SideEffectTimeoutError,
    );

    assert.strictEqual(received.length, 1);
    assert.deepStrictEqual(received[0].context, ctx);
  });

  it("without context emits diagnostic without context", async () => {
    const received: any[] = [];

    await assert.rejects(
      () =>
        withTimeout("no-ctx", 10, () => new Promise((r) => setTimeout(r, 5000)), (d) => received.push(d)),
      SideEffectTimeoutError,
    );

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].context, undefined);
  });
});

// ---------------------------------------------------------------------------
// Context propagation through withRetry
// ---------------------------------------------------------------------------

describe("withRetry context", () => {
  it("emits retry attempt with context", async () => {
    const received: any[] = [];
    const ctx = { runId: "run-retry" };

    await assert.rejects(
      () =>
        withRetry(
          "ctx-retry",
          () => { throw Object.assign(new Error("fail"), { name: "SideEffectTimeoutError" }); },
          { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 2 },
          (d) => received.push(d),
          ctx,
        ),
      RetryError,
    );

    assert.ok(received.length >= 1);
    assert.deepStrictEqual(received[0].context, ctx);
  });

  it("retry exhaustion includes context", async () => {
    const received: any[] = [];
    const ctx = { agentId: "test-agent" };

    await assert.rejects(
      () =>
        withRetry(
          "ctx-exhaust",
          () => { throw Object.assign(new Error("fail"), { name: "SideEffectTimeoutError" }); },
          { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 2 },
          (d) => received.push(d),
          ctx,
        ),
      RetryError,
    );

    // Last diagnostic should be retry.exhausted with context
    const last = received[received.length - 1];
    assert.strictEqual(last.boundary, "retry.exhausted");
    assert.deepStrictEqual(last.context, ctx);
  });
});
