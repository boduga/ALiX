// tests/observability/execution-context.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { EMPTY_CONTEXT, hasExecutionContext, mergeExecutionContext } from "../../src/observability/execution-context.js";
import { buildRuntimeDiagnostic, createMultiplexDiagnosticSink, consoleSink } from "../../src/runtime/runtime-diagnostics.js";
import { buildDiagnostic } from "../../src/contracts/contract-diagnostics.js";
import { runtimeDiagToEvent, contractDiagToEvent } from "../../src/observability/diagnostic-event.js";
import { DiagnosticEventStore, createDiagnosticStoreSink } from "../../src/observability/diagnostic-event-store.js";

// ---------------------------------------------------------------------------
// ExecutionContext
// ---------------------------------------------------------------------------

describe("EMPTY_CONTEXT", () => {
  it("has all undefined fields", () => {
    assert.strictEqual(EMPTY_CONTEXT.runId, undefined);
    assert.strictEqual(EMPTY_CONTEXT.agentId, undefined);
  });
});

describe("hasExecutionContext", () => {
  it("returns false for empty object", () => {
    assert.strictEqual(hasExecutionContext({}), false);
  });

  it("returns true when at least one field is set", () => {
    assert.strictEqual(hasExecutionContext({ runId: "run-1" }), true);
    assert.strictEqual(hasExecutionContext({ agentId: "coder" }), true);
  });

  it("returns false for undefined", () => {
    assert.strictEqual(hasExecutionContext(undefined), false);
  });
});

describe("mergeExecutionContext", () => {
  it("returns override when base is empty", () => {
    const merged = mergeExecutionContext({}, { runId: "run-1" });
    assert.strictEqual(merged.runId, "run-1");
  });

  it("preserves base when override has no matching fields", () => {
    const merged = mergeExecutionContext({ runId: "run-1" }, { agentId: "coder" });
    assert.strictEqual(merged.runId, "run-1");
    assert.strictEqual(merged.agentId, "coder");
  });

  it("override takes precedence", () => {
    const merged = mergeExecutionContext({ runId: "old" }, { runId: "new" });
    assert.strictEqual(merged.runId, "new");
  });

  it("does not mutate inputs", () => {
    const base = { runId: "run-1" };
    const override = { agentId: "coder" };
    const merged = mergeExecutionContext(base, override);
    assert.deepStrictEqual(base, { runId: "run-1" });
    assert.deepStrictEqual(override, { agentId: "coder" });
    assert.strictEqual(merged.runId, "run-1");
    assert.strictEqual(merged.agentId, "coder");
  });
});

// ---------------------------------------------------------------------------
// Runtime diagnostic context preservation
// ---------------------------------------------------------------------------

describe("RuntimeDiagnostic context", () => {
  it("preserves context when mapping to event", () => {
    const ctx = { runId: "run-abc", agentId: "coder" };
    const diag = buildRuntimeDiagnostic(
      "timeout",
      "shell.run",
      "timed out",
      { timeoutMs: 30000 },
    );
    // Add context after construction
    (diag as any).context = ctx;

    const event = runtimeDiagToEvent(diag);
    assert.deepStrictEqual(event.context, ctx);
  });

  it("context is undefined when not set", () => {
    const diag = buildRuntimeDiagnostic("timeout", "test", "event");
    const event = runtimeDiagToEvent(diag);
    assert.strictEqual(event.context, undefined);
  });
});

// ---------------------------------------------------------------------------
// Contract diagnostic context preservation
// ---------------------------------------------------------------------------

describe("ContractDiagnostic context", () => {
  it("preserves context when mapping to event", () => {
    const ctx = { runId: "run-xyz", sessionId: "sess-1" };
    const diag = buildDiagnostic("provider", "complete.request", "Schema", "error");
    (diag as any).context = ctx;

    const event = contractDiagToEvent(diag);
    assert.deepStrictEqual(event.context, ctx);
  });
});

// ---------------------------------------------------------------------------
// Event store persistence preserves context
// ---------------------------------------------------------------------------

describe("DiagnosticEventStore context persistence", () => {
  function tempDir(): string {
    const dir = join(tmpdir(), `diag-ctx-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  it("persists context in JSONL event", () => {
    const dir = tempDir();
    const store = new DiagnosticEventStore(dir);

    const ctx = { runId: "run-ctx-1", agentId: "test-agent" };
    const diag = buildRuntimeDiagnostic("timeout", "test", "with context");
    (diag as any).context = ctx;

    store.appendRuntime(diag);

    const content = readFileSync(join(dir, "diagnostics.jsonl"), "utf-8");
    const parsed = JSON.parse(content.trim());
    assert.deepStrictEqual(parsed.context, { runId: "run-ctx-1", agentId: "test-agent" });

    rmSync(dir, { recursive: true, force: true });
  });

  it("multiplex sink preserves context through the pipeline", () => {
    const dir = tempDir();
    const store = new DiagnosticEventStore(dir);
    const storeSink = createDiagnosticStoreSink(store);
    const mux = createMultiplexDiagnosticSink(consoleSink, storeSink);

    const ctx = { runId: "run-mux-1" };
    const diag = buildRuntimeDiagnostic("timeout", "test", "via mux");
    (diag as any).context = ctx;

    mux.emit(diag);

    const content = readFileSync(join(dir, "diagnostics.jsonl"), "utf-8");
    const parsed = JSON.parse(content.trim());
    assert.strictEqual(parsed.context.runId, "run-mux-1");

    rmSync(dir, { recursive: true, force: true });
  });
});
