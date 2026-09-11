/**
 * NoopTraceClient — defensive contract of the disabled / construction-failure
 * fallback (design §4, §10-11).
 *
 * The Noop client is the DEFAULT deployment: every run whose tracing section
 * is absent or disabled — and every enabled-but-invalid config that degrades
 * through warn-once → Noop — routes all instrumentation through this frozen
 * singleton for the whole process. These tests pin the full face:
 *
 *   - NOOP_TRACE_CLIENT is a frozen singleton (Task 4 zero-alloc contract)
 *   - startRun returns a frozen per-call handle carrying the AUTHORITATIVE
 *     runId (TraceRun's only readable member, types.ts) — never a fixed one
 *   - getRun always returns null (seams then skip span creation)
 *   - startModelSpan/startToolSpan return the shared frozen span handle
 *   - endSpan / endRun / flush / shutdown never throw, never delay, and are
 *     safe on unknown, repeated, or garbage-adjacent handles
 *
 * This is the "tracing can never change an agent outcome" contract in its
 * purest form: every lifecycle method is a guaranteed no-op.
 *
 * Task: Task 15 of
 *   docs/superpowers/plans/2026-09-06-langfuse-tracing-implementation-plan.md
 */
import { describe, it, expect } from "vitest";

import { NOOP_TRACE_CLIENT, NoopTraceClient } from "../../src/tracing/noop-client.js";
import type { ModelSpanInput, RunOutcome, SpanOutcome, ToolSpanInput, TraceRun, TraceRunInput, TraceSpan } from "../../src/tracing/types.js";

function runInput(overrides: Partial<TraceRunInput> = {}): TraceRunInput {
  return { runId: "noop-run", sessionId: "s1", task: "noop task", ...overrides };
}

const modelSpan: ModelSpanInput = { provider: "anthropic", model: "claude-sonnet-4" };
const toolSpan: ToolSpanInput = { toolName: "shell.run", toolCallId: "call_1" };
const okSpan: SpanOutcome = { status: "success", output: "x" };
const okRun: RunOutcome = { status: "success", endedAt: 2_000_000 };

describe("NoopTraceClient · inert default (Task 4)", () => {
  it("exposes a frozen shared singleton", () => {
    expect(NOOP_TRACE_CLIENT).toBeInstanceOf(NoopTraceClient);
    expect(Object.isFrozen(NOOP_TRACE_CLIENT)).toBe(true);
    // Same instance across repeated access — zero allocation on the default path.
    expect(NOOP_TRACE_CLIENT).toBe(NOOP_TRACE_CLIENT);
  });

  it("startRun returns a frozen per-call handle carrying the authoritative runId", () => {
    const a = NOOP_TRACE_CLIENT.startRun(runInput({ runId: "run-alpha" }));
    const b = NOOP_TRACE_CLIENT.startRun(runInput({ runId: "run-beta" }));

    expect(Object.keys(a)).toEqual(["runId"]);
    expect(Object.isFrozen(a)).toBe(true);
    expect(a.runId).toBe("run-alpha");
    expect(b.runId).toBe("run-beta");
    // Honored per call — not a fixed shared handle.
    expect(a).not.toBe(b);
  });

  it("getRun always returns null — seams skip span creation on the disabled path", () => {
    NOOP_TRACE_CLIENT.startRun(runInput({ runId: "run-live" }));
    expect(NOOP_TRACE_CLIENT.getRun("run-live")).toBeNull();
    expect(NOOP_TRACE_CLIENT.getRun("run-unknown")).toBeNull();
  });

  it("startModelSpan/startToolSpan return the same shared frozen span handle", () => {
    const runA = NOOP_TRACE_CLIENT.startRun(runInput({ runId: "run-a" }));
    const runB = NOOP_TRACE_CLIENT.startRun(runInput({ runId: "run-b" }));

    const m1 = NOOP_TRACE_CLIENT.startModelSpan(runA, modelSpan);
    const m2 = NOOP_TRACE_CLIENT.startModelSpan(runB, modelSpan);
    const t1 = NOOP_TRACE_CLIENT.startToolSpan(runA, toolSpan);

    expect(Object.isFrozen(m1)).toBe(true);
    expect(m1).toBe(m2);
    expect(t1).toBe(m2);
  });

  it("endSpan never throws, for repeated or foreign ends", () => {
    const run = NOOP_TRACE_CLIENT.startRun(runInput());
    const span = NOOP_TRACE_CLIENT.startModelSpan(run, modelSpan);

    expect(() => NOOP_TRACE_CLIENT.endSpan(span, okSpan)).not.toThrow();
    // Repeated and unknown-handle ends are equally safe no-ops.
    expect(() => NOOP_TRACE_CLIENT.endSpan(span, okSpan)).not.toThrow();
    expect(() => NOOP_TRACE_CLIENT.endSpan({} as unknown as TraceSpan, { status: "error" })).not.toThrow();
  });

  it("endRun resolves immediately and never throws — unknown, repeated, reused handles", async () => {
    const run = NOOP_TRACE_CLIENT.startRun(runInput({ runId: "run-a" }));
    const ghost = { runId: "run-ghost" } as unknown as TraceRun;

    await expect(NOOP_TRACE_CLIENT.endRun(run, okRun)).resolves.toBeUndefined();
    // Repeated end of the same handle: still a no-op that resolves.
    await expect(NOOP_TRACE_CLIENT.endRun(run, { status: "error", error: "too late" })).resolves.toBeUndefined();
    await expect(NOOP_TRACE_CLIENT.endRun(ghost, okRun)).resolves.toBeUndefined();
  });

  it("flush and shutdown resolve immediately with zero transport work", async () => {
    const run = NOOP_TRACE_CLIENT.startRun(runInput());
    NOOP_TRACE_CLIENT.startModelSpan(run, modelSpan);

    await expect(NOOP_TRACE_CLIENT.flush()).resolves.toBeUndefined();
    await expect(NOOP_TRACE_CLIENT.shutdown()).resolves.toBeUndefined();
    // Shutdown is repeatable even outside the adapter (Noop has no state).
    await expect(NOOP_TRACE_CLIENT.shutdown()).resolves.toBeUndefined();
  });
});