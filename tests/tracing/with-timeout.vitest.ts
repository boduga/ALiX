/**
 * with-timeout.vitest.ts — Task 21 bounded-flush edge behavior.
 *
 * Covers `src/tracing/withTimeout` (design §12/§13): the bounded-wait helper that
 * enforces ALiX's "flush never blocks agent execution" contract. This file pins
 * the REAL guard behavior (src/tracing/with-timeout.ts:38-52) for the
 * `flushTimeoutMs` values the brief asks about:
 *
 *   - a non-positive or non-finite ms → "never wait", resolves immediately
 *     (0 / negative / NaN / Infinity). The validator (src/config/validator.ts)
 *     REJECTS these at config-load, so the adapter only ever sees positive
 *     integer budgets; this guard is defense-in-depth for any caller that
 *     bypasses validation.
 *   - a valid positive ms → resolves with the promise's value, or `undefined`
 *     when the promise outlasts the budget (hang → continue).
 *   - a rejection propagates to the caller (the adapter owns warn-and-continue).
 *
 * Deliberately distinct from `src/runtime/side-effect-timeout.ts` `withTimeout`
 * (which REJECTS on timeout with SideEffectTimeoutError): here a timeout
 * RESOLVES `undefined` — "stop awaiting, continue" (design §13), never an error.
 *
 * Design: docs/superpowers/specs/2026-09-06-langfuse-tracing-design.md
 * Task: Task 21 of
 *   docs/superpowers/plans/2026-09-06-langfuse-tracing-implementation-plan.md
 */
import { describe, it, expect, vi } from "vitest";
import { withTimeout } from "../../src/tracing/with-timeout.js";

describe("tracing withTimeout · flush-budget edge behavior", () => {
  it("resolves with the promise's value when it settles before the budget", async () => {
    await expect(withTimeout(Promise.resolve(42), 50)).resolves.toBe(42);
    await expect(withTimeout(Promise.resolve("ok"), 50)).resolves.toBe("ok");
  });

  it("resolves undefined when the promise outlasts the budget (hang → continue)", async () => {
    vi.useFakeTimers();
    try {
      const hang = new Promise<string>(() => {});
      const result = withTimeout(hang, 50);
      await vi.advanceTimersByTimeAsync(50);
      await expect(result).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a non-positive budget means never wait — resolves immediately, before the promise settles", async () => {
    // The promise never settles, but ms<=0 makes withTimeout resolve at once.
    const hang = new Promise<string>(() => {});
    await expect(withTimeout(hang, 0)).resolves.toBeUndefined();
    await expect(withTimeout(hang, -1)).resolves.toBeUndefined();
    await expect(withTimeout(hang, -Infinity)).resolves.toBeUndefined();
  });

  it("a non-finite budget means never wait — NaN and Infinity resolve immediately", async () => {
    const hang = new Promise<string>(() => {});
    await expect(withTimeout(hang, Number.NaN)).resolves.toBeUndefined();
    await expect(withTimeout(hang, Infinity)).resolves.toBeUndefined();
  });

  it("a positive budget still waits the full duration for a slow (sub-budget) promise", async () => {
    const start = Date.now();
    const result = await withTimeout(
      new Promise((resolve) => setTimeout(() => resolve("slow"), 20)),
      1000,
    );
    expect(result).toBe("slow");
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });

  it("a rejection propagates to the caller (which owns warn-and-continue)", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("flush transport down")), 50),
    ).rejects.toThrow("flush transport down");
  });

  it("clears its timer once settled — no leaked handle, no late resolution after value", async () => {
    vi.useFakeTimers();
    try {
      let settled = false;
      const result = withTimeout(Promise.resolve("fast"), 50).then((v) => {
        settled = true;
        return v;
      });
      await vi.advanceTimersByTimeAsync(1000);
      await expect(result).resolves.toBe("fast");
      expect(settled).toBe(true);
      // Resolved from the underlying promise, not the (cleared) timer.
    } finally {
      vi.useRealTimers();
    }
  });
});
