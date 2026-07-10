import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Contract types ──────────────────────────────────────────────

import type {
  AlixEvent,
  EventActor,
  EventMeta,
  NewEvent,
} from "../../src/runtime/contracts/event-contract.js";
import {
  EVENT_IMMUTABILITY,
  TOOL_EVENT_TYPES,
  PATCH_EVENT_TYPES,
  FILE_EVENT_TYPES,
  AGENT_EVENT_TYPES,
  MCP_EVENT_TYPES,
  OWNERSHIP_EVENT_TYPES,
  COORDINATION_EVENT_TYPES,
  COLLABORATION_EVENT_TYPES,
  CONFLICT_EVENT_TYPES,
  SUBAGENT_EVENT_TYPES,
  CONTEXT_EVENT_TYPES,
  POLICY_EVENT_TYPES,
  ARTIFACT_EVENT_TYPES,
  APPROVAL_EVENT_TYPES,
  REPLAY_EVENT_TYPES,
  ROLLBACK_EVENT_TYPES,
} from "../../src/runtime/contracts/event-contract.js";
import type { EventLogContract } from "../../src/runtime/contracts/event-contract.js";

// ── Source types (for structural comparison) ────────────────────

import type { AlixEvent as SourceAlixEvent } from "../../src/events/types.js";
import type { EventMeta as SourceEventMeta } from "../../src/events/types.js";
import type { NewEvent as SourceNewEvent } from "../../src/events/types.js";
import type { EventActor as SourceEventActor } from "../../src/events/types.js";
import { EventLog } from "../../src/events/event-log.js";

// ── Tests ───────────────────────────────────────────────────────

describe("M1.1 — Event Contract", () => {
  // ── Structural type compatibility ─────────────────────────────

  it("AlixEvent contract matches source type exactly", () => {
    // Structural typing: verify source is assignable to contract and vice versa.
    // If either direction fails the types have drifted.
    const sourceToContract = <TType extends string = string, TPayload = unknown>(
      e: SourceAlixEvent<TType, TPayload>,
    ): AlixEvent<TType, TPayload> => e;

    const contractToSource = <TType extends string = string, TPayload = unknown>(
      e: AlixEvent<TType, TPayload>,
    ): SourceAlixEvent<TType, TPayload> => e;

    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  it("EventActor contract matches source type exactly", () => {
    const sourceToContract = (a: SourceEventActor): EventActor => a;
    const contractToSource = (a: EventActor): SourceEventActor => a;
    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  it("EventMeta contract matches source type exactly", () => {
    const sourceToContract = (m: SourceEventMeta): EventMeta => m;
    const contractToSource = (m: EventMeta): SourceEventMeta => m;
    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  it("NewEvent contract matches source type exactly", () => {
    const sourceToContract = <TType extends string = string, TPayload = unknown>(
      e: SourceNewEvent<TType, TPayload>,
    ): NewEvent<TType, TPayload> => e;

    const contractToSource = <TType extends string = string, TPayload = unknown>(
      e: NewEvent<TType, TPayload>,
    ): SourceNewEvent<TType, TPayload> => e;

    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  // ── EventLogContract matches EventLog class ───────────────────

  it("EventLogContract interface matches EventLog class structure", () => {
    // Using variable annotation to assert structural compatibility.
    // If EventLog does not satisfy EventLogContract this line won't compile.
    const _check: EventLogContract = null as unknown as EventLog;
    assert.ok(_check !== undefined, "EventLog satisfies EventLogContract");
  });

  it("EventLog instance methods match contract signatures", () => {
    // Runtime assertion: EventLog prototype has all contract methods
    const proto = EventLog.prototype;

    assert.equal(typeof proto.init, "function");
    assert.equal(typeof proto.append, "function");
    assert.equal(typeof proto.readAll, "function");
    assert.equal(typeof proto.close, "function");
    assert.equal(typeof proto.watch, "function");
    assert.equal(typeof proto.startWatching, "function");

    // Contract path is readonly string
    const log = new EventLog("/tmp/test-event-contract");
    assert.equal(typeof log.path, "string");
  });

  it("EventLog append signature accepts NewEvent and returns AlixEvent", async () => {
    const log = new EventLog("/tmp/test-event-contract-append");
    await log.init();
    const event = await log.append({
      type: "test.event" as const,
      actor: "system",
      sessionId: "test-session",
      payload: { value: 42 },
    });
    // Return type is AlixEvent — verify required fields
    assert.ok(typeof event.id === "string");
    assert.ok(typeof event.seq === "number");
    assert.equal(event.version, 1);
    assert.ok(typeof event.timestamp === "string");
    assert.equal(event.type, "test.event");
    assert.equal(event.actor, "system");
    assert.deepEqual(event.payload, { value: 42 });
    assert.equal(event.sessionId, "test-session");
    // Cleanup
    await log.close();
  });

  // ── Event immutability invariants ──────────────────────────

  it("EVENT_IMMUTABILITY documents all immutability rules", () => {
    assert.equal(EVENT_IMMUTABILITY.appendOnly, true);
    assert.equal(EVENT_IMMUTABILITY.noRewrite, true);
    assert.equal(EVENT_IMMUTABILITY.noDelete, true);
    assert.equal(EVENT_IMMUTABILITY.noMutation, true);
    assert.equal(EVENT_IMMUTABILITY.seqMonotonic, true);
    assert.equal(EVENT_IMMUTABILITY.appendAtomic, true);
    assert.equal(EVENT_IMMUTABILITY.writeOnceIdentity, true);

    // All keys are readonly literal true — verify the shape
    const keys = Object.keys(EVENT_IMMUTABILITY) as Array<keyof typeof EVENT_IMMUTABILITY>;
    for (const key of keys) {
      assert.equal(EVENT_IMMUTABILITY[key], true, `immutability rule "${key}" must be true`);
    }
  });

  // ── Event type constants are re-exported ───────────────────

  it("re-exports all 16 event type constant groups", () => {
    assert.ok(typeof TOOL_EVENT_TYPES.REQUESTED === "string");
    assert.ok(typeof PATCH_EVENT_TYPES.PROPOSED === "string");
    assert.ok(typeof FILE_EVENT_TYPES.CREATED === "string");
    assert.ok(typeof AGENT_EVENT_TYPES.MESSAGE === "string");
    assert.ok(typeof MCP_EVENT_TYPES.TOOL_INVOKED === "string");

    assert.ok(typeof OWNERSHIP_EVENT_TYPES.ACQUIRED === "string");
    assert.ok(typeof COORDINATION_EVENT_TYPES.AGGREGATE_STARTED === "string");
    assert.ok(typeof COLLABORATION_EVENT_TYPES.FINDING_PUBLISHED === "string");
    assert.ok(typeof CONFLICT_EVENT_TYPES.DETECTED === "string");
    assert.ok(typeof SUBAGENT_EVENT_TYPES.STARTED === "string");

    assert.ok(typeof CONTEXT_EVENT_TYPES.REPO_MAP_CREATED === "string");
    assert.ok(typeof POLICY_EVENT_TYPES.DECISION === "string");
    assert.ok(typeof ARTIFACT_EVENT_TYPES.CREATED === "string");

    assert.ok(typeof APPROVAL_EVENT_TYPES.CREATED === "string");
    assert.ok(typeof REPLAY_EVENT_TYPES.PLAN_CREATED === "string");
    assert.ok(typeof ROLLBACK_EVENT_TYPES.PLAN_CREATED === "string");

    // Verify the values match the source exactly
    assert.equal(TOOL_EVENT_TYPES.REQUESTED, "tool.requested");
    assert.equal(PATCH_EVENT_TYPES.ROLLED_BACK, "patch.rolled_back");
    assert.equal(AGENT_EVENT_TYPES.REASONING, "agent.reasoning");
    assert.equal(OWNERSHIP_EVENT_TYPES.ACQUIRED, "ownership.acquired");
  });
});
