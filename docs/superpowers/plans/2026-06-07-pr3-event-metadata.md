# PR 3: Event Metadata Field

**Status:** ✅ Completed (M0.18) — Plan implemented and committed to main.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an additive `meta` field to `AlixEvent` that carries `workflowId`, `graphId`, `nodeId`, `traceId`, and `spanId` — the identifiers M0.9 needs — without breaking any existing event consumers.

**Architecture:** A single optional `meta` field on the `AlixEvent` type. All existing fields (`id`, `seq`, `version`, `sessionId`, `timestamp`, `type`, `actor`, `payload`) remain unchanged. Old events are still readable; new events optionally carry the extra IDs. The `EventLog.append()` method accepts the meta field and stores it. A helper `createEventMeta()` constructs the meta object from context.

**Tech Stack:** TypeScript, node:test.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/events/types.ts` | **Modify** | Add `EventMeta` type and `meta?: EventMeta` to `AlixEvent` |
| `src/events/event-log.ts` | **Modify** | Accept and persist `meta` in `NewEvent` / `append()` |
| `tests/events/event-meta.test.ts` | **Create** | Tests for meta field creation, serialization, backward compat |

---

### Task 1: Add EventMeta type to events/types.ts

**Files:**
- Modify: `src/events/types.ts`

- [ ] **Step 1: Add EventMeta type and update AlixEvent**

Add the new types:

```typescript
/** Optional metadata for M0.9+ event routing and tracing. */
export type EventMeta = {
  workflowId?: string;
  graphId?: string;
  nodeId?: string;
  traceId?: string;
  spanId?: string;
};
```

Update `AlixEvent` to include the optional `meta` field:

```typescript
export type AlixEvent<TType extends string = string, TPayload = unknown> = {
  id: string;
  seq: number;
  version: 1;
  sessionId: string;
  runId?: string;
  parentEventId?: string;
  timestamp: string;
  type: TType;
  actor: EventActor;
  payload: TPayload;
  meta?: EventMeta;           // NEW — additive, optional
};
```

Update `NewEvent` — it should also accept `meta`:

```typescript
export type NewEvent<TType extends string = string, TPayload = unknown> = Omit<
  AlixEvent<TType, TPayload>,
  "id" | "seq" | "version" | "timestamp"
>;
```

(No change needed — `Omit` already allows the new field since it's on `AlixEvent`.)

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: succeeds. If any existing code constructs `AlixEvent` objects inline, it may need to add `meta?: undefined` or simply compile as-is since the field is optional.

- [ ] **Step 3: Commit**

```bash
git add src/events/types.ts
git commit -m "feat(events): add optional EventMeta field to AlixEvent"
```

---

### Task 2: Accept meta in EventLog.append()

**Files:**
- Modify: `src/events/event-log.ts`

- [ ] **Step 1: Ensure EventLog.append() passes meta through**

The current `append()` method signature is:

```typescript
async append<TType extends string, TPayload>(
  event: NewEvent<TType, TPayload>
): Promise<AlixEvent<TType, TPayload>>
```

Since `NewEvent` already derives from `AlixEvent` (via `Omit`), the optional `meta` field is already accepted. Verify that the `append()` method spreads the event into the full event object:

```typescript
const fullEvent: AlixEvent<TType, TPayload> = {
  ...event,
  id: randomUUID(),
  seq: this.nextSeq++,
  version: 1 as const,
  timestamp: new Date().toISOString()
};
```

If this spread is present (it should be — check around line 27-33), `meta` is automatically included. No code change needed.

To confirm, search for `const fullEvent` in `event-log.ts` and verify the spread:

```bash
grep -A8 "const fullEvent" src/events/event-log.ts
```

Expected output shows `...event` in the object literal. If it explicit-lists fields instead of spreading, add `meta: (event as any).meta` to the object.

- [ ] **Step 2: Commit (if changes needed)**

```bash
git add src/events/event-log.ts
git commit -m "fix(events): pass meta field through EventLog.append"
```

(If no change was needed, skip this step.)

---

### Task 3: Write tests

**Files:**
- Create: `tests/events/event-meta.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventLog } from "../../src/events/event-log.js";

describe("EventMeta", () => {
  let tmpDir: string;
  let log: EventLog;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "event-meta-test-"));
    log = new EventLog(tmpDir);
    return log.init();
  });

  after(() => {
    log.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends event without meta (backward compat)", async () => {
    const ev = await log.append({
      sessionId: "test-1",
      actor: "system",
      type: "test.legacy",
      payload: { msg: "old-style event" },
    });
    assert.equal(ev.meta, undefined);
    assert.equal(ev.type, "test.legacy");
  });

  it("appends event with meta containing workflowId", async () => {
    const ev = await log.append({
      sessionId: "test-2",
      actor: "system",
      type: "test.with_meta",
      payload: {},
      meta: { workflowId: "wf_abc123" },
    });
    assert.equal(ev.meta?.workflowId, "wf_abc123");
  });

  it("reads meta from persisted events", async () => {
    // Write
    await log.append({
      sessionId: "test-3",
      actor: "agent",
      type: "test.persist",
      payload: { result: "ok" },
      meta: { workflowId: "wf_persist", graphId: "graph_xyz", nodeId: "node_42" },
    });
    // Read back
    const events = await log.readAll();
    const found = events.filter(e => e.sessionId === "test-3");
    assert.ok(found.length >= 1, "should find the persisted event");
    const metaEvent = found[0];
    assert.equal(metaEvent.meta?.workflowId, "wf_persist");
    assert.equal(metaEvent.meta?.graphId, "graph_xyz");
    assert.equal(metaEvent.meta?.nodeId, "node_42");
  });

  it("supports traceId and spanId for distributed tracing", async () => {
    const ev = await log.append({
      sessionId: "test-4",
      actor: "tool",
      type: "tool.completed",
      payload: { toolCallId: "tc_1" },
      meta: { traceId: "trace_abc", spanId: "span_42" },
    });
    assert.equal(ev.meta?.traceId, "trace_abc");
    assert.equal(ev.meta?.spanId, "span_42");
  });

  it("supports all meta fields simultaneously", async () => {
    const fullMeta = {
      workflowId: "wf_full",
      graphId: "graph_full",
      nodeId: "node_full",
      traceId: "trace_full",
      spanId: "span_full",
    };
    const ev = await log.append({
      sessionId: "test-5",
      actor: "system",
      type: "test.full_meta",
      payload: {},
      meta: fullMeta,
    });
    assert.deepEqual(ev.meta, fullMeta);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
node --test tests/events/event-meta.test.ts 2>&1
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/events/event-meta.test.ts
git commit -m "test(events): event meta field creation, persistence, backward compat"
```
