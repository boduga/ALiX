// tests/observability/diagnostic-event.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { runtimeDiagToEvent, contractDiagToEvent, nextDiagnosticId } from "../../src/observability/diagnostic-event.js";
import { DiagnosticEventStore, createDiagnosticStoreSink } from "../../src/observability/diagnostic-event-store.js";
import { buildRuntimeDiagnostic } from "../../src/runtime/runtime-diagnostics.js";
import { buildDiagnostic } from "../../src/contracts/contract-diagnostics.js";

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

describe("nextDiagnosticId", () => {
  it("produces unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(nextDiagnosticId());
    }
    assert.strictEqual(ids.size, 100);
  });

  it("starts with diag- prefix", () => {
    assert.ok(nextDiagnosticId().startsWith("diag-"));
  });
});

// ---------------------------------------------------------------------------
// Runtime diagnostic mapping
// ---------------------------------------------------------------------------

describe("runtimeDiagToEvent", () => {
  it("maps timeout diagnostic", () => {
    const diag = buildRuntimeDiagnostic("timeout", "shell.run", "timed out", { timeoutMs: 30000 });
    const event = runtimeDiagToEvent(diag);

    assert.strictEqual(event.type, "runtime");
    assert.strictEqual(event.domain, "runtime");
    assert.strictEqual(event.boundary, "timeout");
    assert.strictEqual(event.operation, "shell.run");
    assert.strictEqual(event.event, "timed out");
    assert.strictEqual(event.severity, "error");
    assert.strictEqual(event.timeoutMs, 30000);
  });

  it("maps retry.attempt as warning severity", () => {
    const diag = buildRuntimeDiagnostic("retry.attempt", "file.read", "retrying", { attempt: 1, maxRetries: 2 });
    const event = runtimeDiagToEvent(diag);

    assert.strictEqual(event.boundary, "retry.attempt");
    assert.strictEqual(event.severity, "warning");
    assert.strictEqual(event.attempt, 1);
    assert.strictEqual(event.maxRetries, 2);
  });

  it("maps retry.exhausted as error severity", () => {
    const diag = buildRuntimeDiagnostic("retry.exhausted", "file.read", "failed after 2 attempt(s)", { attempt: 2, maxRetries: 1 });
    const event = runtimeDiagToEvent(diag);

    assert.strictEqual(event.boundary, "retry.exhausted");
    assert.strictEqual(event.severity, "error");
    assert.strictEqual(event.attempt, 2);
  });
});

// ---------------------------------------------------------------------------
// Contract diagnostic mapping
// ---------------------------------------------------------------------------

describe("contractDiagToEvent", () => {
  it("maps provider contract diagnostic", () => {
    const diag = buildDiagnostic("provider", "complete.request", "NormalizedRequestSchema", "missing systemPrompt");
    const event = contractDiagToEvent(diag);

    assert.strictEqual(event.type, "contract");
    assert.strictEqual(event.domain, "provider");
    assert.strictEqual(event.boundary, "complete.request");
    assert.strictEqual(event.event, "missing systemPrompt");
    assert.strictEqual(event.severity, "error");
  });

  it("maps planning diagnostic with entityId", () => {
    const diag = buildDiagnostic("planning", "plan.save", "StrategicPlanSchema", "invalid subsystem", "plan-123");
    const event = contractDiagToEvent(diag);

    assert.strictEqual(event.domain, "planning");
    assert.strictEqual(event.entityId, "plan-123");
  });

  it("maps adaptation diagnostic", () => {
    const diag = buildDiagnostic("adaptation", "proposal.save", "AdaptationProposalSchema", "invalid action", "prop-1");
    const event = contractDiagToEvent(diag);

    assert.strictEqual(event.domain, "adaptation");
    assert.strictEqual(event.boundary, "proposal.save");
    assert.strictEqual(event.entityId, "prop-1");
  });
});

// ---------------------------------------------------------------------------
// DiagnosticEventStore
// ---------------------------------------------------------------------------

describe("DiagnosticEventStore", () => {
  function tempDir(): string {
    const dir = join(tmpdir(), `diag-store-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  it("appends event to JSONL file", () => {
    const dir = tempDir();
    const store = new DiagnosticEventStore(dir);

    const diag = buildRuntimeDiagnostic("timeout", "test", "timeout");
    store.appendRuntime(diag);

    const content = readFileSync(join(dir, "diagnostics.jsonl"), "utf-8");
    const lines = content.trim().split("\n");
    assert.strictEqual(lines.length, 1);

    const parsed = JSON.parse(lines[0]);
    assert.strictEqual(parsed.boundary, "timeout");
    assert.strictEqual(parsed.operation, "test");

    rmSync(dir, { recursive: true, force: true });
  });

  it("appends multiple events preserving order", () => {
    const dir = tempDir();
    const store = new DiagnosticEventStore(dir);

    store.appendRuntime(buildRuntimeDiagnostic("timeout", "first", "event 1"));
    store.appendRuntime(buildRuntimeDiagnostic("retry.attempt", "second", "event 2"));

    const content = readFileSync(join(dir, "diagnostics.jsonl"), "utf-8");
    const lines = content.trim().split("\n");
    assert.strictEqual(lines.length, 2);
    assert.ok(JSON.parse(lines[0]).operation === "first");
    assert.ok(JSON.parse(lines[1]).operation === "second");

    rmSync(dir, { recursive: true, force: true });
  });

  it("creates parent directory on first write", () => {
    const dir = tempDir();
    const nested = join(dir, "sub", "nested");
    const store = new DiagnosticEventStore(nested);

    store.appendRuntime(buildRuntimeDiagnostic("timeout", "nested", "first write"));

    assert.ok(existsSync(join(nested, "diagnostics.jsonl")));

    rmSync(dir, { recursive: true, force: true });
  });

  it("handles contract diagnostic append", () => {
    const dir = tempDir();
    const store = new DiagnosticEventStore(dir);

    const diag = buildDiagnostic("provider", "complete.request", "schema", "error");
    store.appendContract(diag);

    const content = readFileSync(join(dir, "diagnostics.jsonl"), "utf-8");
    const parsed = JSON.parse(content.trim());
    assert.strictEqual(parsed.type, "contract");

    rmSync(dir, { recursive: true, force: true });
  });

  it("createDiagnosticStoreSink wraps store correctly", () => {
    const dir = tempDir();
    const store = new DiagnosticEventStore(dir);
    const sink = createDiagnosticStoreSink(store);

    const diag = buildRuntimeDiagnostic("timeout", "sink-test", "via sink");
    sink.emit(diag);

    const content = readFileSync(join(dir, "diagnostics.jsonl"), "utf-8");
    const parsed = JSON.parse(content.trim());
    assert.strictEqual(parsed.operation, "sink-test");

    rmSync(dir, { recursive: true, force: true });
  });
});
