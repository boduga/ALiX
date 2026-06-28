# M0.9-A: Event Envelope Adapter

**Status:** ✅ Completed (M0.9) — Plan implemented and committed to main.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adapter that wraps existing EventLog events into the canonical ALiX event envelope, preserving legacy payloads under `payload.legacy` and adding `workflowId`/`graphId`/`nodeId` from the `EventMeta` type (already added in PR 3).

**Architecture:** A new `CanonicalEventSink` that implements `EventSink` interface. It takes existing `AlixEvent` objects and wraps them into the canonical envelope shape (`schemaVersion`, `actorType`, `eventType`, `visibility`, etc.). Legacy payloads are preserved in `payload.legacy`. The sink writes both to the existing JSONL file and to an in-memory buffer for SQLite batch insert. The existing `EventLog.append()` continues to work unchanged — the sink is an additional output path.

**Tech Stack:** TypeScript, node:test.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/kernel/event-envelope.ts` | **Create** | Canonical event types, `EventSink` interface, `CanonicalEventSink` adapter |
| `tests/kernel/event-envelope.test.ts` | **Create** | Adapter tests |

---

### Task 1: Create event envelope adapter

**Files:**
- Create: `src/kernel/event-envelope.ts`
- Reference: `docs/ALiX_Nexus_OS_Docs_v1.6/implementation/m0.9-starter/src/kernel/event-envelope.ts` (scaffold)

- [ ] **Step 1: Write the adapter**

```typescript
/**
 * event-envelope.ts — Canonical ALiX event envelope + adapter.
 *
 * Wraps existing EventLog events into the canonical shape defined in the
 * PRD (schemaVersion, actorType, eventType, visibility, causality, etc.).
 * Legacy payloads are preserved under payload.legacy.
 *
 * The canonical envelope is an ADDITIONAL output path — existing EventLog
 * continues to work unchanged.
 */

import type { AlixEvent, EventMeta } from "../events/types.js";

// ─── Canonical Types ────────────────────────────────────────────────

export type ActorType = "user" | "agent" | "tool" | "model" | "system" | "sidecar" | "policy";
export type EventVisibility = "public" | "internal" | "sensitive";

export interface CanonicalEvent<TPayload = unknown> {
  id: string;
  schemaVersion: "1.0";
  timestamp: string;
  sessionId: string;
  workflowId?: string;
  graphId?: string;
  nodeId?: string;
  actorType: ActorType;
  actorId: string;
  eventType: string;
  payload: TPayload & { legacy?: unknown };
  visibility: EventVisibility;
  causality?: { parentEventId?: string; traceId?: string; spanId?: string };
  integrity?: { payloadHash?: string; previousEventHash?: string };
}

export interface EventSink {
  emit(event: CanonicalEvent): Promise<void>;
}

// ─── Mapping Helpers ────────────────────────────────────────────────

/** Map legacy actor values to canonical ActorType. */
function mapActor(actor: string): ActorType {
  switch (actor) {
    case "user": return "user";
    case "agent": return "agent";
    case "tool": return "tool";
    case "system": return "system";
    case "verifier": return "system";
    case "policy": return "policy";
    case "subagent": return "agent";
    default: return "system";
  }
}

/** Determine visibility based on event type. */
function inferVisibility(eventType: string): EventVisibility {
  if (eventType.includes("secret") || eventType.includes(".sensitive")) return "sensitive";
  if (eventType.startsWith("agent.") || eventType.startsWith("tool.")) return "internal";
  return "public";
}

// ─── Adapter ────────────────────────────────────────────────────────

/** Convert a legacy AlixEvent to a CanonicalEvent. */
export function toCanonicalEvent(
  legacy: AlixEvent,
  meta?: EventMeta,
): CanonicalEvent {
  return {
    id: legacy.id,
    schemaVersion: "1.0",
    timestamp: legacy.timestamp,
    sessionId: legacy.sessionId,
    workflowId: meta?.workflowId ?? legacy.runId,
    graphId: meta?.graphId,
    nodeId: meta?.nodeId,
    actorType: mapActor(legacy.actor),
    actorId: legacy.actor,
    eventType: legacy.type,
    payload: {
      ...(legacy.payload as Record<string, unknown>),
      legacy: legacy.payload,
    },
    visibility: inferVisibility(legacy.type),
    causality: {
      parentEventId: legacy.parentEventId,
      traceId: meta?.traceId,
      spanId: meta?.spanId,
    },
  };
}

/** Write a canonical event to stdout for pipe/shell consumption. */
export function emitJsonLine(event: CanonicalEvent): void {
  process.stdout.write(JSON.stringify(event) + "\n");
}

/**
 * CanonicalEventSink — writes canonical events to an in-memory buffer
 * for batch SQLite insertion, and optionally to stdout.
 */
export class CanonicalEventSink implements EventSink {
  private buffer: CanonicalEvent[] = [];
  private stdout: boolean;

  constructor(opts?: { stdout?: boolean }) {
    this.stdout = opts?.stdout ?? false;
  }

  async emit(event: CanonicalEvent): Promise<void> {
    this.buffer.push(event);
    if (this.stdout) {
      emitJsonLine(event);
    }
  }

  /** Return buffered events and clear. */
  flush(): CanonicalEvent[] {
    const events = [...this.buffer];
    this.buffer = [];
    return events;
  }

  /** Return buffered events without clearing. */
  peek(): CanonicalEvent[] {
    return [...this.buffer];
  }

  get size(): number {
    return this.buffer.length;
  }
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/kernel/event-envelope.ts
git commit -m "feat(kernel): canonical event envelope and EventSink adapter"
```

---

### Task 2: Write tests

**Files:**
- Create: `tests/kernel/event-envelope.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toCanonicalEvent, CanonicalEventSink } from "../../src/kernel/event-envelope.js";
import type { AlixEvent } from "../../src/events/types.js";

describe("toCanonicalEvent", () => {

  const legacy: AlixEvent = {
    id: "evt_123",
    seq: 1,
    version: 1,
    sessionId: "session_abc",
    timestamp: "2026-06-07T00:00:00.000Z",
    type: "tool.requested",
    actor: "tool",
    payload: { toolCallId: "tc_1", toolName: "file.read" },
  };

  it("maps actor correctly", () => {
    const canonical = toCanonicalEvent(legacy);
    assert.equal(canonical.actorType, "tool");
    assert.equal(canonical.actorId, "tool");
  });

  it("preserves legacy payload under payload.legacy", () => {
    const canonical = toCanonicalEvent(legacy);
    assert.deepEqual(canonical.payload.legacy, legacy.payload);
  });

  it("adds schemaVersion and eventType", () => {
    const canonical = toCanonicalEvent(legacy);
    assert.equal(canonical.schemaVersion, "1.0");
    assert.equal(canonical.eventType, "tool.requested");
  });

  it("includes meta fields when provided", () => {
    const canonical = toCanonicalEvent(legacy, {
      workflowId: "wf_abc",
      graphId: "graph_xyz",
      nodeId: "node_42",
    });
    assert.equal(canonical.workflowId, "wf_abc");
    assert.equal(canonical.graphId, "graph_xyz");
    assert.equal(canonical.nodeId, "node_42");
  });

  it("includes traceId and spanId from meta", () => {
    const canonical = toCanonicalEvent(legacy, {
      traceId: "trace_1",
      spanId: "span_2",
    });
    assert.equal(canonical.causality?.traceId, "trace_1");
    assert.equal(canonical.causality?.spanId, "span_2");
  });

  it("maps system events to public visibility", () => {
    const evt: AlixEvent = { ...legacy, type: "session.started", actor: "system" };
    const canonical = toCanonicalEvent(evt);
    assert.equal(canonical.visibility, "public");
  });

  it("maps secret events to sensitive visibility", () => {
    const evt: AlixEvent = { ...legacy, type: "secret.scanned", actor: "policy" };
    const canonical = toCanonicalEvent(evt);
    assert.equal(canonical.visibility, "sensitive");
  });

  it("maps agent events to internal visibility", () => {
    const evt: AlixEvent = { ...legacy, type: "agent.message", actor: "agent" };
    const canonical = toCanonicalEvent(evt);
    assert.equal(canonical.visibility, "internal");
  });
});

describe("CanonicalEventSink", () => {

  it("buffers emitted events", async () => {
    const sink = new CanonicalEventSink();
    const legacy: AlixEvent = {
      id: "evt_1", seq: 1, version: 1,
      sessionId: "s", timestamp: "2026-01-01T00:00:00.000Z",
      type: "test.event", actor: "system", payload: {},
    };
    await sink.emit(toCanonicalEvent(legacy));
    assert.equal(sink.size, 1);
  });

  it("flush returns and clears buffer", async () => {
    const sink = new CanonicalEventSink();
    const legacy: AlixEvent = {
      id: "evt_2", seq: 1, version: 1,
      sessionId: "s", timestamp: "2026-01-01T00:00:00.000Z",
      type: "test.event", actor: "system", payload: {},
    };
    await sink.emit(toCanonicalEvent(legacy));
    const flushed = sink.flush();
    assert.equal(flushed.length, 1);
    assert.equal(sink.size, 0);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
node --test dist/tests/kernel/event-envelope.test.js 2>&1
```

Expected: 9+ tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/kernel/event-envelope.test.ts
git commit -m "test(kernel): event envelope adapter tests"
```
