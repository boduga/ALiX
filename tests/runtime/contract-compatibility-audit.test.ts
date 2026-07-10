// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * M1.8 — Runtime Contract Compatibility Audit
 *
 * Verifies that every runtime contract type remains structurally
 * compatible with its source implementation type.  Because the contracts
 * are direct re-exports (e.g. `export type AgentState = SourceAgentState`),
 * this is a compile-time structural assignability check — if source and
 * contract drift apart, these tests will fail to compile.
 *
 * Seven audits covering:
 * 1. AgentState     — src/autonomy/scope-tracker.ts
 * 2. RunLimits      — src/autonomy/state-machine.ts
 * 3. ModelCapabilities — src/providers/types.ts
 * 4. ToolCallRequest   — src/tools/types.ts
 * 5. AlixEvent      — src/events/types.ts
 * 6. EventLogContract — src/events/event-log.ts  (class → interface)
 * 7. MemoryEntry    — src/utils/memory/types.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Contract types ──────────────────────────────────────────────────

import type { AgentState } from "../../src/runtime/contracts/agent-contract.js";
import type { RunLimits } from "../../src/runtime/contracts/agent-contract.js";
import type { ModelCapabilities } from "../../src/runtime/contracts/provider-contract.js";
import type { ToolCallRequest } from "../../src/runtime/contracts/tool-contract.js";
import type { AlixEvent } from "../../src/runtime/contracts/event-contract.js";
import type { EventLogContract } from "../../src/runtime/contracts/event-contract.js";
import type { MemoryEntry } from "../../src/runtime/contracts/memory-contract.js";

// ── Source types (aliased for disambiguation) ────────────────────────

import type { AgentState as SourceAgentState } from "../../src/autonomy/scope-tracker.js";
import type { RunLimits as SourceRunLimits } from "../../src/autonomy/state-machine.js";
import type { ModelCapabilities as SourceModelCapabilities } from "../../src/providers/types.js";
import type { ToolCallRequest as SourceToolCallRequest } from "../../src/tools/types.js";
import type { AlixEvent as SourceAlixEvent } from "../../src/events/types.js";
import { EventLog } from "../../src/events/event-log.js";
import type { MemoryEntry as SourceMemoryEntry } from "../../src/utils/memory/types.js";

// ── Tests ────────────────────────────────────────────────────────────

describe("M1.8 — Contract Compatibility Audit", () => {
  // ── 1. AgentState ──────────────────────────────────────────────

  it("Audit 1: AgentState contract matches source type", () => {
    // Structural assignability: source → contract, contract → source
    const sourceToContract = (s: SourceAgentState): AgentState => s;
    const contractToSource = (s: AgentState): SourceAgentState => s;
    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  it("AgentState contract values are valid source values", () => {
    const states: AgentState[] = [
      "idle",
      "planning",
      "executing",
      "verifying",
      "repairing",
      "summarizing",
      "waiting_approval",
      "completed",
      "failed",
      "stopped",
    ];
    assert.equal(states.length, 10);
    for (const state of states) {
      const _source: SourceAgentState = state;
      assert.ok(_source, `state "${state}" is a valid AgentState`);
    }
  });

  // ── 2. RunLimits ───────────────────────────────────────────────

  it("Audit 2: RunLimits contract matches source type", () => {
    const sourceToContract = (r: SourceRunLimits): RunLimits => r;
    const contractToSource = (r: RunLimits): SourceRunLimits => r;
    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  it("RunLimits contract has all 5 fields from source", () => {
    const limits: RunLimits = {
      maxIterations: 10,
      maxRepairs: 3,
      maxFileChanges: 50,
      maxShellCommands: 100,
      maxRuntimeMs: 300_000,
    };
    assert.equal(typeof limits.maxIterations, "number");
    assert.equal(typeof limits.maxRepairs, "number");
    assert.equal(typeof limits.maxFileChanges, "number");
    assert.equal(typeof limits.maxShellCommands, "number");
    assert.equal(typeof limits.maxRuntimeMs, "number");
  });

  // ── 3. ModelCapabilities ───────────────────────────────────────

  it("Audit 3: ModelCapabilities contract matches source type", () => {
    const sourceToContract = (m: SourceModelCapabilities): ModelCapabilities => m;
    const contractToSource = (m: ModelCapabilities): SourceModelCapabilities => m;
    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  it("ModelCapabilities contract shape matches source shape", () => {
    const caps: ModelCapabilities = {
      provider: "test-provider",
      model: "test-model",
      inputTokenLimit: 100_000,
      outputTokenLimit: 4_096,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsVision: false,
    };
    assert.equal(typeof caps.provider, "string");
    assert.equal(typeof caps.model, "string");
    assert.equal(typeof caps.inputTokenLimit, "number");
    assert.equal(typeof caps.outputTokenLimit, "number");
    assert.equal(typeof caps.supportsTools, "boolean");
    assert.equal(typeof caps.supportsStreaming, "boolean");
    assert.equal(typeof caps.supportsStructuredOutput, "boolean");
    assert.equal(typeof caps.supportsVision, "boolean");
  });

  // ── 4. ToolCallRequest ─────────────────────────────────────────

  it("Audit 4: ToolCallRequest contract matches source type", () => {
    const sourceToContract = (t: SourceToolCallRequest): ToolCallRequest => t;
    const contractToSource = (t: ToolCallRequest): SourceToolCallRequest => t;
    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  it("ToolCallRequest contract shape matches source shape", () => {
    const request: ToolCallRequest = {
      toolCallId: "call-001",
      name: "shell.run",
      args: { command: "echo hello" },
      agentId: "agent-alpha",
      sessionId: "session-42",
    };
    assert.equal(typeof request.toolCallId, "string");
    assert.equal(typeof request.name, "string");
    assert.equal(typeof request.args, "object");
    // Optional fields
    assert.equal(request.agentId, "agent-alpha");
    assert.equal(request.sessionId, "session-42");
  });

  it("ToolCallRequest contract allows minimal shape without optional fields", () => {
    const request: ToolCallRequest = {
      toolCallId: "call-002",
      name: "file.read",
      args: { path: "test.ts" },
    };
    assert.equal(request.agentId, undefined);
    assert.equal(request.sessionId, undefined);
  });

  // ── 5. AlixEvent ───────────────────────────────────────────────

  it("Audit 5: AlixEvent contract matches source type", () => {
    const sourceToContract = (e: SourceAlixEvent): AlixEvent => e;
    const contractToSource = (e: AlixEvent): SourceAlixEvent => e;
    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  it("AlixEvent contract shape matches source shape", () => {
    const event: AlixEvent = {
      id: "evt-001",
      seq: 1,
      version: 1,
      sessionId: "session-42",
      timestamp: "2026-07-10T12:00:00.000Z",
      type: "test.event",
      actor: "system",
      payload: { value: 42 },
    };
    assert.equal(typeof event.id, "string");
    assert.equal(typeof event.seq, "number");
    assert.equal(event.version, 1);
    assert.equal(typeof event.sessionId, "string");
    assert.equal(typeof event.timestamp, "string");
    assert.equal(typeof event.type, "string");
    assert.equal(typeof event.actor, "string");
    assert.equal(typeof event.payload, "object");
  });

  it("AlixEvent contract allows optional meta and runId fields", () => {
    const event: AlixEvent = {
      id: "evt-002",
      seq: 2,
      version: 1,
      sessionId: "session-42",
      timestamp: "2026-07-10T12:00:00.000Z",
      type: "test.event",
      actor: "agent",
      payload: {},
      runId: "run-001",
      parentEventId: "evt-001",
      meta: { traceId: "trace-001" },
    };
    assert.equal(event.runId, "run-001");
    assert.equal(event.parentEventId, "evt-001");
    assert.equal(event.meta?.traceId, "trace-001");
  });

  // ── 6. EventLogContract ────────────────────────────────────────

  it("Audit 6: EventLog satisfies EventLogContract interface", () => {
    // Compile-time structural assertion: EventLog must satisfy EventLogContract
    const _check: EventLogContract = null as unknown as EventLog;
    assert.ok(_check !== undefined, "EventLog satisfies EventLogContract");
  });

  it("EventLog instance methods match EventLogContract signatures", () => {
    const proto = EventLog.prototype;
    assert.equal(typeof proto.init, "function");
    assert.equal(typeof proto.append, "function");
    assert.equal(typeof proto.readAll, "function");
    assert.equal(typeof proto.close, "function");
    assert.equal(typeof proto.watch, "function");
    assert.equal(typeof proto.startWatching, "function");

    // Verify path accessor matches contract
    const log = new EventLog("/tmp/test-audit-contract");
    assert.equal(typeof log.path, "string");
  });

  it("EventLog append/readAll round-trip matches EventLogContract", async () => {
    const log = new EventLog("/tmp/test-audit-event-log");
    await log.init();
    try {
      const event = await log.append({
        type: "audit.test",
        actor: "system",
        sessionId: "test-session",
        payload: { check: 6 },
      });
      assert.equal(typeof event.id, "string");
      assert.equal(typeof event.seq, "number");
      assert.equal(event.version, 1);

      const all = await log.readAll();
      assert.ok(all.length >= 1);
      assert.equal(all[all.length - 1].type, "audit.test");
    } finally {
      await log.close();
    }
  });

  // ── 7. MemoryEntry ─────────────────────────────────────────────

  it("Audit 7: MemoryEntry contract matches source type", () => {
    const sourceToContract = (m: SourceMemoryEntry): MemoryEntry => m;
    const contractToSource = (m: MemoryEntry): SourceMemoryEntry => m;
    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  it("MemoryEntry contract shape matches source shape", () => {
    const entry: MemoryEntry = {
      name: "test-entry",
      description: "A test memory entry",
      type: "user",
      content: "Test content",
      createdAt: "2026-07-10T12:00:00.000Z",
      modifiedAt: "2026-07-10T12:00:00.000Z",
      confidence: 0.5,
      confirmations: 0,
    };
    assert.equal(typeof entry.name, "string");
    assert.equal(typeof entry.description, "string");
    assert.equal(typeof entry.type, "string");
    assert.equal(typeof entry.content, "string");
    assert.equal(typeof entry.createdAt, "string");
    assert.equal(typeof entry.modifiedAt, "string");
    assert.equal(typeof entry.confidence, "number");
    assert.equal(typeof entry.confirmations, "number");
  });

  it("MemoryEntry contract allows optional source field", () => {
    const entry: MemoryEntry = {
      name: "entry-with-source",
      description: "desc",
      type: "reference",
      content: "content",
      createdAt: "2026-07-10T12:00:00.000Z",
      modifiedAt: "2026-07-10T12:00:00.000Z",
      confidence: 0.8,
      confirmations: 2,
      source: "https://example.com",
    };
    assert.equal(entry.source, "https://example.com");
  });
});
