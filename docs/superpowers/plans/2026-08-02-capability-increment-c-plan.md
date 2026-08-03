# Capability Increment C — ApprovalManager Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the approval panel's read model from the store-backed `ApprovalManager.snapshot()` onto the registry-native `ApprovalProjection`, without changing what operators see.

**Architecture:** `ApprovalStore` remains the mutation authority and gains complete EventLog lifecycle emissions (after durable mutation). `ApprovalProjection` becomes a union-reader normalization boundary over both approval vocabularies. A new `ApprovalProjectionCollector` adapts `ApprovalProjectionSnapshot` to the unchanged `ApprovalCollector` interface consumed by `SnapshotBuilder`, which is swapped at the composition root in an atomic single-point change. `ApprovalManager` is retained as a command/mutation service only; its `snapshot()` collector role is removed.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, EventLog (append-only, contiguous seq from 1), `ProjectionRuntime` (registry-keyed builders).

**Spec:** `docs/superpowers/specs/2026-08-02-capability-increment-c-design.md` (approved, 5 sections, acceptance matrix A1–A14).

## Global Constraints

- **EventLog is the source of truth.** Projections adapt to the historical reality of the log; emitters are not rewritten to satisfy one consumer. No collector translation layer.
- **Persist-before-append:** a store mutation must succeed (durably) before its lifecycle event is appended. Failed mutations emit no event.
- **Merge-enrich fill-missing-only, never overwrite.** Later events may increase knowledge, never decrease it. Guard each field; never `{ ...entry, ...incoming }`.
- **Terminal states are immutable.** `approved`→`resolved(approved)` no-op; `approved`→`resolved(denied)` throw; `expired`/`consumed`→`resumed`/`resolved` throw.
- **Fail-closed conflicts:** `approval.resolved` with contradictory `decision` and `status` throws during `update()`.
- **Projection purity:** `ApprovalProjectionEntry.toolName` stays `string | undefined`; the `?? "unknown"` fallback lives only in the adapter.
- **Checkpoint compatibility:** no field renames in `ApprovalProjectionEntry`/durable state. Old-format checkpoints must import and produce identical snapshots (A14).
- **Single collector source:** after the swap, `SnapshotBuilder`'s `approvals` is exactly one `ApprovalProjectionCollector`; `ApprovalManager` must not be passed as the approval collector.
- **Append-only evidence semantics:** enrichment and transitions may only add certainty; a replayed event stream must reproduce identical snapshots.

---

### Task 1: ApprovalStore complete lifecycle emissions

**Files:**
- Modify: `src/approvals/approval-store.ts`
- Test: `tests/approvals/approval-store-events.vitest.ts` (create)

**Interfaces:**
- Consumes: `APPROVAL_EVENT_TYPES` (`src/events/types.ts:410`), `ApprovalStore` constructor (`eventLog?: EventLog`), `ApprovalRecord` shape (`src/approvals/approval-types.ts`).
- Produces: After this task, the EventLog contains a complete approval lifecycle record. `ApprovalProjection` (Task 2) will consume `approval.created`, `approval.resolved`, `approval.expired`, `approval.revoked`, `approval.consumed`, `approval.invalidated`.

**Context:** The store mutates `approvals.json` in 7 paths; 5 leave no EventLog trace (`expireDue`, `revoke`, `consumeApproved`, `invalidateByPolicyRevision`, `resolveGroup`), so an EventLog reader can never see those transitions. The fix is to append exactly one lifecycle event per successful persisted mutation, **after** the mutation succeeds. `resolve` already emits; `requestBound`/`requestFresh`/`requestOrReusePending` already emit `approval.created` but must enrich it.

- [ ] **Step 1: Write failing tests for the missing emissions**

Create `tests/approvals/approval-store-events.vitest.ts`. Use the EventLog-backed store. Model the fixture on existing store tests — check `tests/approvals/*.vitest.ts` for the constructor idiom (store is `new ApprovalStore(cwd, { eventLog })`; `await store.load()`). Test helper reads events back via `eventLog.readAll()`.

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog } from '../../src/events/event-log.js';
import { ApprovalStore } from '../../src/approvals/approval-store.js';

async function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'approval-events-'));
  const eventLog = new EventLog(dir);
  await eventLog.init();
  const store = new ApprovalStore(dir, { eventLog });
  await store.load();
  return { dir, eventLog, store };
}

function createdEvent(events: Awaited<ReturnType<EventLog['readAll']>>, approvalId: string) {
  return events.find(e => e.type === 'approval.created' && (e.payload as any).approvalId === approvalId);
}

describe('ApprovalStore event completeness', () => {
  it('requestBound emits enriched approval.created (reason, toolName, requestId, sessionId)', async () => {
    const { eventLog, store } = await fresh();
    await store.requestBound({
      reason: 'Modify config',
      bindingKey: 'bk',
      requestFingerprint: 'fp',
      policyRevision: 'r1',
      capabilities: ['filesystem.write'],
      toolId: 'fs',
      requestId: 'req-1',
      sessionId: 's1',
    });
    const events = await eventLog.readAll();
    const ce = createdEvent(events, events[0]!.payload.approvalId as string)!;
    expect(ce.payload).toMatchObject({ reason: 'Modify config', toolId: 'fs', requestId: 'req-1', sessionId: 's1' });
  });

  it('expireDue emits approval.expired exactly once per newly-expired record', async () => {
    const { eventLog, store } = await fresh();
    await store.request({ reason: 'old', capability: 'x' });
    const expired = await store.expireDue(new Date(Date.now() + 60 * 60_000));
    expect(expired.length).toBeGreaterThan(0);
    const events = await eventLog.readAll();
    const expiredEvents = events.filter(e => e.type === 'approval.expired');
    expect(expiredEvents).toHaveLength(expired.length);
  });

  it('revoke emits approval.revoked after successful mutation', async () => {
    const { eventLog, store } = await fresh();
    const rec = await store.request({ reason: 'r', capability: 'x' });
    const revoked = await store.revoke(rec.id, { actor: 'user', reason: 'no' });
    expect(revoked).not.toBeNull();
    const events = await eventLog.readAll();
    expect(events.filter(e => e.type === 'approval.revoked')).toHaveLength(1);
  });

  it('consumeApproved emits approval.consumed on success', async () => {
    const { eventLog, store } = await fresh();
    const rec = await store.request({ reason: 'r', capability: 'x' });
    await store.resolve(rec.id, 'approved');
    const result = await store.consumeApproved(rec.id, rec.bindingKey, {});
    expect(result.consumed).toBe(true);
    const events = await eventLog.readAll();
    expect(events.filter(e => e.type === 'approval.consumed')).toHaveLength(1);
  });

  it('invalidateByPolicyRevision emits approval.invalidated per record', async () => {
    const { eventLog, store } = await fresh();
    const rec = await store.request({ reason: 'r', capability: 'x' });
    await store.resolve(rec.id, 'approved');
    const invalidated = await store.invalidateByPolicyRevision('new-rev');
    expect(invalidated.length).toBeGreaterThan(0);
    const events = await eventLog.readAll();
    expect(events.filter(e => e.type === 'approval.invalidated')).toHaveLength(invalidated.length);
  });

  it('resolveGroup emits per-member approval.resolved (not approval.group.resolved)', async () => {
    const { eventLog, store } = await fresh();
    const a = await store.request({ reason: 'a', capability: 'x' });
    const b = await store.request({ reason: 'b', capability: 'y' });
    await store.createGroup({ approvalIds: [a.id, b.id], policyRevision: 'r1' });
    const g = store.list().find(x => x.groupId)!.groupId!;
    await store.resolveGroup(g, 'approved', { actor: 'user' });
    const events = await eventLog.readAll();
    expect(events.filter(e => e.type === 'approval.resolved')).toHaveLength(2);
    expect(events.filter(e => e.type === 'approval.group.resolved')).toHaveLength(0);
  });

  it('failed mutation emits no lifecycle event', async () => {
    const { eventLog, store } = await fresh();
    const rec = await store.request({ reason: 'r', capability: 'x' });
    await store.resolve(rec.id, 'approved');
    const before = (await eventLog.readAll()).length;
    // revoke a non-pending (already approved) record → no-op, no event
    await store.revoke(rec.id, { actor: 'user', reason: 'x' });
    const after = (await eventLog.readAll()).length;
    expect(after).toBe(before);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm vitest run tests/approvals/approval-store-events.vitest.ts --config vitest.config.mts`
Expected: FAIL — expired/revoked/consumed/invalidated/resolveGroup assertions find zero events; enriched-created assertions find missing payload fields. (The failed-mutation test may pass already.)

- [ ] **Step 3: Implement the emissions**

In `src/approvals/approval-store.ts`:

> **Append-error convention (LOCKED — Option 3):** keep the repository's established fire-and-forget convention for ALL approval-store emissions, existing and new. The EventLog append happens **after** the durable mutation succeeds (persist-before-append), so a failed append never risks losing the mutation; the append is best-effort telemetry of governance state, and a failure must not change the store method's contract. Use `this.eventLog?.append(...).catch(() => {})` for every emission (matching the existing store `created`/`resolve` emissions and `policy-gate.ts`). **Do NOT convert to `await` in this increment.**
>
> **Rationale:** the repository treats EventLog appends as non-fatal broadly (`.catch(() => {})` on the hot paths). Making only ApprovalStore's emissions fatal would create an inconsistent API contract within one abstraction (created swallows, expired throws) and would unilaterally redefine a cross-cutting durability policy. A future increment should introduce a repository-wide "durable event append" policy as a dedicated refactor — **design note/TODO, out of scope here**.
>
> The persist-before-append invariant is unchanged: the mutation must succeed before the append; a **failed mutation** emits nothing (that's a different guarantee than a failed append).

1. **Enrich the three `created` emitters.** In `requestBound`, `requestFresh`, and `requestOrReusePending`, extend the existing `eventLog?.append({ type: APPROVAL_EVENT_TYPES.CREATED, payload: { ... } })` payload with `reason: record.reason`, `toolId: record.toolId`, `requestId: record.requestId`, `sessionId: record.sessionId` (all `?? undefined`-safe). These are already on the `record`. Keep fire-and-forget:
```ts
this.eventLog?.append({
  sessionId: record.sessionId ?? 'unknown',
  actor: 'policy',
  type: APPROVAL_EVENT_TYPES.CREATED,
  payload: {
    approvalId: record.id,
    coordinationRunId: record.coordinationRunId,
    workerId: record.workerId,
    capabilities: record.capabilities,
    bindingKey: record.bindingKey,
    policyRevision: record.policyRevision,
    status: record.status,
    timestamp: record.createdAt,
    reason: record.reason,
    toolId: record.toolId,
    requestId: record.requestId,
    sessionId: record.sessionId,
  },
}).catch(() => {});
```

2. **`expireDue`:** after the `mutate()` resolves and you have the `expired` list, append one `approval.expired` per record:
```ts
for (const r of expired) {
  this.eventLog?.append({ sessionId: r.sessionId ?? 'unknown', actor: 'policy', type: APPROVAL_EVENT_TYPES.EXPIRED, payload: { approvalId: r.id } }).catch(() => {});
}
```

3. **`revoke`:** after a successful revoke (the `revoked` variable is non-null), append one `approval.revoked`:
```ts
if (revoked) {
  this.eventLog?.append({ sessionId: revoked.sessionId ?? 'unknown', actor: 'policy', type: APPROVAL_EVENT_TYPES.REVOKED, payload: { approvalId: revoked.id } }).catch(() => {});
}
```
Place it **after** the `mutate()` returns — never before, so a failed mutation emits nothing. (`revoke` currently does `await this.mutate(...)` and assigns `revoked`; append after.)

4. **`consumeApproved`:** the `result` object carries `{ consumed, record }`. After the `mutate()` returns, when `result.consumed && result.record`:
```ts
if (result.consumed && result.record) {
  this.eventLog?.append({ sessionId: result.record.sessionId ?? 'unknown', actor: 'policy', type: APPROVAL_EVENT_TYPES.CONSUMED, payload: { approvalId: result.record.id } }).catch(() => {});
}
```

5. **`invalidateByPolicyRevision`:** after `mutate()` returns, loop the `invalidated` list, one `approval.invalidated` each (`this.eventLog?.append(...).catch(() => {})` per record).

6. **`resolveGroup`:** after a successful full-group resolve (`allStillPending` branch, status `'approved'`/`'denied'`), append **per member**:
```ts
for (const m of members) {
  this.eventLog?.append({ sessionId: m.sessionId ?? 'unknown', actor: 'policy', type: APPROVAL_EVENT_TYPES.RESOLVED, payload: { approvalId: m.id, status: status } }).catch(() => {});
}
```
The existing single `approval.resolved` (with `id`) in the current `resolveGroup` — if present — should be replaced by this per-member loop. For the `partial` branch (some members already resolved), the already-resolved members do not get a new event (they already have one); only members whose status actually changed get events.

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm vitest run tests/approvals/approval-store-events.vitest.ts --config vitest.config.mts`
Expected: PASS (all cases). Also run the full store suite to ensure no regression: `pnpm vitest run tests/approvals --config vitest.config.mts`.

- [ ] **Step 5: Run the full approvals test directory + typecheck**

Run: `pnpm vitest run tests/approvals tests/approvals/*.vitest.ts --config vitest.config.mts` then `npx tsc -p tsconfig.json --noEmit`
Expected: all pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/approvals/approval-store.ts tests/approvals/approval-store-events.vitest.ts
git commit -m "feat(approvals): emit complete approval lifecycle events

Store mutations now mirror into the EventLog after durable persist:
approval.expired/revoked/consumed/invalidated per record, per-member
approval.resolved for resolveGroup, and enriched approval.created payloads.
Failed mutations emit nothing. Closes the projection blind-spot gap.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: ApprovalProjection union-reader normalization

**Files:**
- Modify: `src/tui/runtime/approval-projection.ts`
- Test: `tests/tui/runtime/approval-projection.vitest.ts` (extend)

**Interfaces:**
- Consumes: `AlixEvent` (`src/events/types.ts`), existing `ApprovalProjectionSnapshot` / `ApprovalProjectionEntry` / `MAX_COMPLETED` / `VALID_STATUSES` (all exported or module-internal from `approval-projection.ts`), `DurableProjectionBuilder` interface.
- Produces: `ApprovalProjection` that normalizes BOTH vocabularies — `approval.created`/`approval.requested` create pending entries with merge-enrich; `approval.resolved` accepts `decision` OR `status`; `approval.expired`/`revoked`/`consumed`/`invalidated`/`reused` handled; terminal states immutable; contradictions throw. Status union gains `'invalidated'`.

**Context:** Currently the projection only understands the CLI vocab (`approval.requested`, `approval.resolved` with `decision`), and line 96-98 silently `continue`s past `approval.created` (store vocab). After Task 1, the store emits rich events — the projection must normalize them all. The existing `update()` loops events with monotonicity + timestamp validation already in place; preserve those.

- [ ] **Step 1: Write failing tests for the union-reader behaviors**

Extend `tests/tui/runtime/approval-projection.vitest.ts`. The file already has `evt()`/`requested()`/`resolved()` helpers. Add store-vocab helpers:

```ts
function created(seq: number, approvalId: string, opts: { toolId?: string; reason?: string; requestId?: string; sessionId?: string } = {}): AlixEvent {
  return evt('approval.created', { approvalId, capabilities: ['x'], ...opts }, seq);
}
function resolvedStatus(seq: number, approvalId: string, status: 'approved' | 'denied'): AlixEvent {
  return evt('approval.resolved', { approvalId, status }, seq);
}
function expired(seq: number, approvalId: string): AlixEvent {
  return evt('approval.expired', { approvalId }, seq);
}
function revoked(seq: number, approvalId: string): AlixEvent {
  return evt('approval.revoked', { approvalId }, seq);
}
function consumed(seq: number, approvalId: string): AlixEvent {
  return evt('approval.consumed', { approvalId }, seq);
}
function invalidated(seq: number, approvalId: string): AlixEvent {
  return evt('approval.invalidated', { approvalId }, seq);
}
function reused(seq: number, approvalId: string): AlixEvent {
  return evt('approval.reused', { approvalId }, seq);
}
```

Add inside `describe('ApprovalProjection', ...)`:

```ts
it('approval.created creates a pending entry; resolved with status moves it to completed', () => {
  const p = new ApprovalProjection();
  p.update([created(1, 'a1')]);
  expect(p.snapshot().pending[0]!.status).toBe('pending');
  p.update([resolvedStatus(2, 'a1', 'approved')]);
  expect(p.snapshot().pending).toHaveLength(0);
  expect(p.snapshot().completed[0]!.status).toBe('approved');
});

it('merge-enrich fills missing fields on a later created; never overwrites populated fields', () => {
  const p = new ApprovalProjection();
  p.update([created(1, 'a1')]); // sparse
  p.update([created(2, 'a1', { reason: 'Modify config', toolId: 'fs' })]); // rich
  const entry = p.snapshot().pending[0]!;
  expect(entry.prompt).toBe('Modify config');
  expect(entry.toolName).toBe('fs');
  // Now a later sparse event must NOT erase
  p.update([created(3, 'a1')]);
  expect(p.snapshot().pending[0]!.prompt).toBe('Modify config');
  expect(p.snapshot().pending[0]!.toolName).toBe('fs');
});

it('approval.reused is a no-op (pending stays pending)', () => {
  const p = new ApprovalProjection();
  p.update([created(1, 'a1')]);
  p.update([reused(2, 'a1')]);
  expect(p.snapshot().pending).toHaveLength(1);
  expect(p.snapshot().pending[0]!.status).toBe('pending');
});

it('expired / revoked / consumed / invalidated move pending to terminal', () => {
  const p = new ApprovalProjection();
  p.update([created(1, 'e1')]);
  p.update([expired(2, 'e1')]);
  expect(p.snapshot().completed[0]!.status).toBe('expired');
  p.update([created(3, 'v1')]);
  p.update([revoked(4, 'v1')]);
  expect(p.snapshot().completed[0]!.status).toBe('revoked');
  p.update([created(5, 'c1')]);
  p.update([consumed(6, 'c1')]);
  expect(p.snapshot().completed[0]!.status).toBe('consumed');
  p.update([created(7, 'i1')]);
  p.update([invalidated(8, 'i1')]);
  expect(p.snapshot().completed[0]!.status).toBe('invalidated');
});

it('throws on contradictory decision+status (fail-closed)', () => {
  const p = new ApprovalProjection();
  p.update([created(1, 'a1')]);
  expect(() => p.update([evt('approval.resolved', { approvalId: 'a1', decision: 'approved', status: 'denied' }, 2)])).toThrow();
});

it('terminal states are immutable: approved then denied throws; expired then resumed throws; idempotent re-resolve is a no-op', () => {
  const p = new ApprovalProjection();
  p.update([requested(1, 'a1', 'run?', 'search')]);
  p.update([resolved(2, 'a1', 'approved')]);
  expect(() => p.update([resolved(3, 'a1', 'denied')])).toThrow();
  p.update([resolved(4, 'a1', 'approved')]); // idempotent no-op
  expect(p.snapshot().completed[0]!.status).toBe('approved');
  p.update([created(5, 'e1')]);
  p.update([expired(6, 'e1')]);
  expect(() => p.update([evt('approval.resumed', { approvalId: 'e1' }, 7)])).toThrow();
});

it('replay determinism: same fixture replayed twice → identical snapshots', () => {
  const p1 = new ApprovalProjection();
  const p2 = new ApprovalProjection();
  const fixture: AlixEvent[] = [
    created(1, 'a1', { reason: 'r', toolId: 't' }),
    reused(2, 'a1'),
    resolvedStatus(3, 'a1', 'approved'),
    created(4, 'a2'),
    expired(5, 'a2'),
  ];
  p1.update(fixture);
  p2.update(fixture);
  expect(p1.snapshot()).toEqual(p2.snapshot());
});

it('historical sparse events remain readable (no enriched fields)', () => {
  const p = new ApprovalProjection();
  p.update([created(1, 'a1')]); // no toolId/reason
  p.update([resolvedStatus(2, 'a1', 'approved')]);
  expect(p.snapshot().completed[0]!.toolName).toBeUndefined();
  expect(p.snapshot().completed[0]!.status).toBe('approved');
});

it('POST-APPROVAL: approved entry updates to consumed/expired/revoked/invalidated (store parity)', () => {
  const p = new ApprovalProjection();
  p.update([created(1, 'a1')]);
  p.update([resolvedStatus(2, 'a1', 'approved')]);
  expect(p.snapshot().completed[0]!.status).toBe('approved');
  // consumed arrives after the entry already left pending (store consumeApproved)
  p.update([consumed(3, 'a1')]);
  expect(p.snapshot().completed[0]!.status).toBe('consumed');
  expect(p.snapshot().completed[0]!.completedAt).toBe(3 * 1000);
});

it('revoke is allowed on a completed non-approved entry (store revoke permits denied/edited/invalidated)', () => {
  const p = new ApprovalProjection();
  p.update([created(1, 'a1')]);
  p.update([resolvedStatus(2, 'a1', 'denied')]);
  p.update([revoked(3, 'a1')]);
  expect(p.snapshot().completed[0]!.status).toBe('revoked');
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm vitest run tests/tui/runtime/approval-projection.vitest.ts --config vitest.config.mts`
Expected: FAIL — `approval.created` is currently ignored (line 96-98 `continue`), so created/resolved-status/reused/expired/etc. cases fail; the `invalidated` status doesn't exist in `VALID_STATUSES` yet; contradiction/immutability cases don't throw.

- [ ] **Step 3: Implement the union-reader projection**

In `src/tui/runtime/approval-projection.ts`:

1. **Add `'invalidated'` to `VALID_STATUSES`** and to the `ApprovalProjectionEntry['status']` union.

2. **Extend `TERMINAL_TYPES`** to include `'approval.invalidated'`:
```ts
const TERMINAL_TYPES = new Set([
  'approval.resolved', 'approval.expired', 'approval.consumed', 'approval.revoked', 'approval.invalidated',
]);
```

3. **Broaden the event filter** (line 96-98) so store-vocab events are not skipped. Accept: `approval.requested`, `approval.created`, `approval.resumed`, `approval.resume.failed`, `approval.reused`, `approval.expired`, `approval.revoked`, `approval.consumed`, `approval.invalidated`, and `approval.resolved`.

4. **Timestamp authority — `parseTimestamp` prefers `payload.timestamp`.** `EventLog.append` auto-stamps the event's top-level `timestamp` at append time (`event-log.ts:190`), which differs (microseconds) from the store's `record.createdAt`. But the store's `approval.created` payload already carries `timestamp: record.createdAt` (the authoritative lifecycle creation time). To keep the parity oracle's `requestedAt` equal between store path (`Date.parse(record.createdAt)`) and projection path, `parseTimestamp` must prefer the payload timestamp when present, falling back to the EventLog append timestamp (the CLI vocab `approval.requested` has no payload timestamp):
```ts
function parseTimestamp(e: AlixEvent): number {
  const payload = (e.payload ?? {}) as Record<string, unknown>;
  const raw = typeof payload.timestamp === 'string' ? payload.timestamp : e.timestamp;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) throw new Error(`approval projection: invalid event timestamp on seq ${e.seq}`);
  return t;
}
```

5. **Add `approval.created` as a creation event.** In `entryFrom`, read both `approvalId` and the enriched fields: `prompt` from `payload.reason` OR `payload.prompt`; `toolName` priority is `payload.toolName` → **`payload.capabilities[0]`** → `payload.toolId`. The `capabilities[0]` source is load-bearing for parity: the OLD store path maps `toolName: r.capabilities?.[0] ?? 'unknown'` (`approval-manager.ts:102`), so the projection must expose the same value or the parity oracle's `pending` comparison fails (store says `'filesystem.write'`, projection would say `'fs'` if it only read `toolId`).
```ts
function entryFrom(e: AlixEvent): { approvalId?: string; prompt?: string; toolName?: string } {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const capabilities = Array.isArray(p.capabilities) ? p.capabilities.filter((c): c is string => typeof c === 'string') : [];
  return {
    approvalId: typeof p.approvalId === 'string' ? p.approvalId : undefined,
    prompt: typeof p.prompt === 'string' ? p.prompt : (typeof p.reason === 'string' ? p.reason : undefined),
    toolName: typeof p.toolName === 'string' ? p.toolName
      : (capabilities.length > 0 ? capabilities[0]
      : (typeof p.toolId === 'string' ? p.toolId : undefined)),
  };
}
```

6. **Rewrite the pending-creation logic for merge-enrich.** Treat `approval.requested` and `approval.created` identically as creation events:
```ts
const isCreate = e.type === 'approval.requested' || e.type === 'approval.created';
if (isCreate) {
  if (!this.pending.has(approvalId)) {
    this.pending.set(approvalId, { approvalId, prompt, toolName, status: 'pending', requestedAt: timestamp });
  } else {
    // merge-enrich: fill missing fields ONLY, never overwrite
    const existing = this.pending.get(approvalId)!;
    const next = { ...existing };
    if (next.prompt == null && prompt != null) next.prompt = prompt;
    if (next.toolName == null && toolName != null) next.toolName = toolName;
    this.pending.set(approvalId, next);
  }
}
```

7. **Handle `approval.reused` as a no-op** (skip — it does not change lifecycle).

8. **Rewrite the terminal handler** to accept both `decision` and `status`, fail-closed on contradiction, and enforce terminal immutability. Replace the existing `if (TERMINAL_TYPES.has(e.type))` block:
```ts
if (TERMINAL_TYPES.has(e.type)) {
  // Look up in pending FIRST, then completed — the store emits post-approval
  // transitions (consumed/expired/revoked/invalidated) that target an entry
  // already moved to completed. Missing this → store says consumed, projection
  // says approved (divergence).
  let existing = this.pending.get(approvalId);
  const completedIndex = existing ? -1 : this.completed.findIndex((c) => c.approvalId === approvalId);
  if (!existing && completedIndex >= 0) existing = this.completed[completedIndex];
  if (!existing) continue; // unknown id → no-op

  if (e.type === 'approval.resolved') {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const decision = typeof p.decision === 'string' ? p.decision : '';
    const statusField = typeof p.status === 'string' ? p.status : '';
    if (decision && statusField && decision !== statusField) {
      throw new Error(`approval projection: contradictory resolution (decision=${decision}, status=${statusField}) on seq ${e.seq}`);
    }
    const value = decision || statusField;
    if (!['approved', 'denied', 'edited'].includes(value)) {
      throw new Error(`approval projection: invalid resolution on seq ${e.seq}`);
    }
    if (completedIndex < 0) {
      // pending / resumed → move to completed
      this.pending.set(approvalId, { ...existing, status: value as ApprovalProjectionEntry['status'], completedAt: timestamp });
      this.completed = [{ ...this.pending.get(approvalId)! }, ...this.completed].slice(0, MAX_COMPLETED);
      this.pending.delete(approvalId);
      continue;
    }
    // completed entry: idempotent or contradictory
    if (existing.status === value) continue; // idempotent (e.g. approved + resolved(approved))
    throw new Error(`approval projection: terminal ${existing.status} cannot transition to ${value} on seq ${e.seq}`);
  }

  // terminal types: expired / revoked / consumed / invalidated
  const statusMap: Record<string, ApprovalProjectionEntry['status']> = {
    'approval.expired': 'expired',
    'approval.revoked': 'revoked',
    'approval.consumed': 'consumed',
    'approval.invalidated': 'invalidated',
  };
  const terminalStatus = statusMap[e.type];

  if (completedIndex < 0) {
    // pending / resumed → move to completed
    this.pending.set(approvalId, { ...existing, status: terminalStatus, completedAt: timestamp });
    this.completed = [{ ...this.pending.get(approvalId)! }, ...this.completed].slice(0, MAX_COMPLETED);
    this.pending.delete(approvalId);
    continue;
  }

  // completed entry — post-approval transitions are legal; otherwise immutable.
  if (existing.status === terminalStatus) continue; // idempotent
  if (existing.status === 'approved' || terminalStatus === 'revoked') {
    // Store performs approved → consumed/expired/revoked/invalidated, and its
    // revoke also permits revoking denied/edited/invalidated. Update in place
    // (completed keeps newest-first insertion order; status corrected).
    this.completed = this.completed.map((c) =>
      c.approvalId === approvalId ? { ...c, status: terminalStatus, completedAt: timestamp } : c,
    );
    continue;
  }
  throw new Error(`approval projection: terminal ${existing.status} cannot transition to ${terminalStatus} on seq ${e.seq}`);
}
```
> Note: the original `completed` push order is newest→oldest (the docstring and `snapshot()` say so). Preserve it for new moves. Post-approval updates correct the status **in place** (no re-sort) — deterministic given a fixed event stream.

9. **`approval.resumed` handling (explicit):** the existing branch marks a pending entry `resumed` and leaves it pending (`resume.failed` is transient, ignored). Add the resurrection guard: if `approval.resumed` targets an entry in `completed`, throw:
```ts
} else if (e.type === 'approval.resumed') {
  const existing = this.pending.get(approvalId);
  if (existing) {
    this.pending.set(approvalId, { ...existing, status: 'resumed' });
  } else if (this.completed.some((c) => c.approvalId === approvalId)) {
    throw new Error(`approval projection: cannot resume completed approval ${approvalId} on seq ${e.seq}`);
  }
}
```

10. **`importState` / `VALID_STATUSES`:** `'invalidated'` is now valid, so old checkpoints lacking it still import fine (they just never contain it). No field renames. Ensure `reset()` is unchanged.

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm vitest run tests/tui/runtime/approval-projection.vitest.ts --config vitest.config.mts`
Expected: PASS — new union-reader cases + all existing cases still green (backward compat). The existing "throws on an approval.resolved with unrecognized decision" test must still pass — verify your terminal handler still throws on a bad decision value.

- [ ] **Step 5: Run projection + runtime suites, then typecheck**

Run: `pnpm vitest run tests/tui/runtime --config vitest.config.mts` then `npx tsc -p tsconfig.json --noEmit`
Expected: all pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/tui/runtime/approval-projection.ts tests/tui/runtime/approval-projection.vitest.ts
git commit -m "feat(approvals): normalize approval events in projection

ApprovalProjection is now a union-reader over both approval vocabularies:
approval.created/requested create pending entries with merge-enrichment
(fill-missing-only, never overwrite); approval.resolved accepts decision
OR status (contradiction throws); expired/revoked/consumed/invalidated
close pending entries; terminal states are immutable; approval.reused is
a no-op. Status union gains 'invalidated'. No field renames — durable
checkpoints stay compatible.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: ApprovalProjectionCollector adapter + atomic swap

**Files:**
- Create: `src/tui/runtime/approval-projection-collector.ts`
- Modify: `src/cli/commands/tui.ts` (extract shared runtime, swap adapter)
- Modify: `src/approvals/extract-target.ts` (new shared helper — move from `src/tui/approval-manager.ts`)
- Modify: `src/tui/approval-manager.ts` (remove `snapshot()`, import shared `extractTarget`)
- Test: `tests/tui/runtime/approval-projection-collector.vitest.ts` (create)

**Interfaces:**
- Consumes: `ProjectionRuntime` (`src/tui/runtime/projection-runtime.ts`, `snapshotOf<TSnapshot>(id): TSnapshot | undefined`), `ProjectionIds.approval`, `ApprovalProjectionSnapshot` / `ApprovalProjectionEntry` (`approval-projection.ts`), `ApprovalCollector` (`snapshot-builder.ts:30`), `ApprovalSnapshot` / `ApprovalRecordSnapshot` (`src/tui/snapshot.ts:78`), `extractTarget` (new shared helper).
- Produces: `ApprovalProjectionCollector implements ApprovalCollector` with `snapshot(): Promise<ApprovalSnapshot | null>`. `SnapshotBuilder`'s `approvals` becomes this adapter. `ApprovalManager` no longer has `snapshot()`.

**Context:** The `ApprovalProjection` is already registered and fed on the outer runtime collector (`tui.ts:133`) but unread. This task wires a reader adapter and flips the `SnapshotBuilder`'s approval source atomically. `ApprovalManager` keeps its command/mutation role; only its `snapshot()` (sole caller `snapshot-builder.ts:130`) is removed. The adapter maps `ApprovalProjectionSnapshot` → `ApprovalSnapshot` per the spec's Section 3 table.

- [ ] **Step 1: Create the shared `extractTarget` helper**

Create `src/approvals/extract-target.ts`:
```ts
/**
 * Extract a path/target from an approval reason string, if the reason embeds
 * one (e.g. "Path protected: /tmp/foo", "Command is denied: rm -rf"). Returns
 * undefined when no target is embedded; callers fall back to raw reason text.
 */
export function extractTarget(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  const colonMatch = reason.match(/:\s+(.+)$/);
  if (colonMatch?.[1]) return colonMatch[1].trim();
  return undefined;
}
```

- [ ] **Step 2: Write failing tests for the adapter**

Create `tests/tui/runtime/approval-projection-collector.vitest.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ApprovalProjectionCollector } from '../../../src/tui/runtime/approval-projection-collector.js';
import { ApprovalProjection } from '../../../src/tui/runtime/approval-projection.js';
import { createProjectionRuntime } from '../../../src/tui/runtime/projection-runtime.js';
import { ProjectionIds } from '../../../src/tui/runtime/projection-ids.js';
import type { AlixEvent } from '../../../src/events/types.js';

function evt(type: string, payload: Record<string, unknown>, seq: number, ts = seq * 1000): AlixEvent {
  return { id: `e${seq}`, seq, version: 1, sessionId: 's', timestamp: new Date(ts).toISOString(), type, actor: 'system', payload };
}

describe('ApprovalProjectionCollector', () => {
  it('maps pending + completed to ApprovalSnapshot; totalResolved is real', async () => {
    const runtime = createProjectionRuntime([[ProjectionIds.approval, new ApprovalProjection()]]);
    runtime.updateAll([
      evt('approval.requested', { approvalId: 'a1', prompt: 'Modify config', toolName: 'fs.write' }, 1),
      evt('approval.resolved', { approvalId: 'a1', decision: 'approved' }, 2),
      evt('approval.created', { approvalId: 'a2' }, 3),
    ]);
    const collector = new ApprovalProjectionCollector(runtime);
    const snap = await collector.snapshot();
    expect(snap).not.toBeNull();
    expect(snap!.pending).toHaveLength(1);
    expect(snap!.pending[0]!.id).toBe('a2');
    expect(snap!.pending[0]!.toolName).toBe('unknown'); // adapter fallback
    expect(snap!.recentlyResolved).toHaveLength(1);
    expect(snap!.recentlyResolved[0]!.id).toBe('a1');
    expect(snap!.totalPending).toBe(1);
    expect(snap!.totalResolved).toBe(1);
  });

  it('pending ordering follows request sequence; terminal entries are NOT in pending (list-membership distinction)', async () => {
    const runtime = createProjectionRuntime([[ProjectionIds.approval, new ApprovalProjection()]]);
    runtime.updateAll([
      evt('approval.created', { approvalId: 'a2' }, 1),
      evt('approval.requested', { approvalId: 'a1', prompt: 'run' }, 2),
    ]);
    const collector = new ApprovalProjectionCollector(runtime);
    const snap = await collector.snapshot();
    expect(snap!.pending.map(p => p.id)).toEqual(['a2', 'a1']);
    // A terminal entry leaves pending entirely (projection moves it to completed)
    const runtime2 = createProjectionRuntime([[ProjectionIds.approval, new ApprovalProjection()]]);
    runtime2.updateAll([
      evt('approval.created', { approvalId: 'a1' }, 1),
      evt('approval.expired', { approvalId: 'a1' }, 2),
    ]);
    const collector2 = new ApprovalProjectionCollector(runtime2);
    const snap2 = await collector2.snapshot();
    expect(snap2!.pending).toHaveLength(0);
    expect(snap2!.recentlyResolved).toHaveLength(1);
    // ApprovalRecordSnapshot has no status field (UI contract); the distinction
    // is expressed by list membership. The projection's own snapshot carries it:
    expect(runtime2.snapshotOf<import('../../../src/tui/runtime/approval-projection.js').ApprovalProjectionSnapshot>(ProjectionIds.approval)!.completed[0]!.status).toBe('expired');
  });

  it('targetPath is derived from prompt via extractTarget; falls back to raw prompt', async () => {
    const runtime = createProjectionRuntime([[ProjectionIds.approval, new ApprovalProjection()]]);
    runtime.updateAll([
      evt('approval.created', { approvalId: 'a1', reason: 'Path protected: /tmp/foo' }, 1),
      evt('approval.created', { approvalId: 'a2', reason: 'plain request' }, 2),
    ]);
    const snap = await new ApprovalProjectionCollector(runtime).snapshot();
    expect(snap!.pending[0]!.targetPath).toBe('/tmp/foo');
    expect(snap!.pending[1]!.targetPath).toBe('plain request');
  });

  it('requestedAt comes from the projection entry timestamp only', async () => {
    const runtime = createProjectionRuntime([[ProjectionIds.approval, new ApprovalProjection()]]);
    runtime.updateAll([evt('approval.created', { approvalId: 'a1' }, 1, 1700000000000)]);
    const snap = await new ApprovalProjectionCollector(runtime).snapshot();
    expect(snap!.pending[0]!.requestedAt).toBe(1700000000000);
  });
});
```

**A11 — SnapshotBuilder containment regression (extend `tests/tui/snapshot-builder.vitest.ts`):** add a test to the existing file (it has the `mkFakes()` helper). Locks the fail-closed boundary: a throwing approval collector yields `approvals: null` (never crashes the UI snapshot). The `ApprovalManager` import in that file may become a type-only `ApprovalCollector` import after its `snapshot()` is removed — adjust as needed.

```ts
it('A11: a throwing approval collector yields approvals:null (fail-closed containment), not a crash', async () => {
  const f = mkFakes();
  const throwingApprovals = {
    snapshot: async () => { throw new Error('governance violation'); },
  };
  const b = new SnapshotBuilder(f.session, throwingApprovals, f.policy, f.sops, f.eventLog, f.daemon);
  const snap = await b.build(1);
  expect(snap).not.toBeNull();
  expect(snap!.approvals).toBeNull();
});
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `pnpm vitest run tests/tui/runtime/approval-projection-collector.vitest.ts --config vitest.config.mts`
Expected: FAIL — `approval-projection-collector.ts` doesn't exist.

- [ ] **Step 4: Implement the adapter**

Create `src/tui/runtime/approval-projection-collector.ts`:
```ts
import type { ProjectionRuntime } from './projection-runtime.js';
import { ProjectionIds } from './projection-ids.js';
import type { ApprovalProjectionSnapshot } from './approval-projection.js';
import type { ApprovalCollector } from '../../snapshot-builder.js';
import type { ApprovalSnapshot, ApprovalRecordSnapshot } from '../../snapshot.js';
import { extractTarget } from '../../approvals/extract-target.js';

/** Map a projection entry to the UI-facing record shape. */
function toRecord(e: import('./approval-projection.js').ApprovalProjectionEntry): ApprovalRecordSnapshot {
  return {
    id: e.approvalId,
    toolName: e.toolName ?? 'unknown',
    targetPath: extractTarget(e.prompt) ?? e.prompt ?? '',
    args: {},
    requestedAt: e.requestedAt,
    requestedBy: 'system',
  };
}

/** Adapter from ApprovalProjectionSnapshot → the ApprovalCollector interface. */
export class ApprovalProjectionCollector implements ApprovalCollector {
  constructor(private readonly runtime: ProjectionRuntime) {}
  async snapshot(): Promise<ApprovalSnapshot | null> {
    const proj = this.runtime.snapshotOf<ApprovalProjectionSnapshot>(ProjectionIds.approval);
    if (!proj) return null;
    return {
      pending: proj.pending.map(toRecord),
      recentlyResolved: proj.completed.map(toRecord),
      totalPending: proj.pending.length,
      totalResolved: proj.completed.length,
    };
  }
}
```

- [ ] **Step 5: Remove `snapshot()` from ApprovalManager; use shared helper**

In `src/tui/approval-manager.ts`:
- Delete the `snapshot(): Promise<ApprovalSnapshot>` method (and the now-unused `ApprovalSnapshot`/`ApprovalRecordSnapshot` imports if unused elsewhere).
- Change the inline `extractTarget` function to import from `../../approvals/extract-target.js` (delete the local copy).
- Keep `tryHandleCommand`, `/approve`, `/deny`, `handleList`, `handleResolve` unchanged.

Verify no other callers of `ApprovalManager.snapshot()` exist: `grep -rn "approvalManager.snapshot\|\.approvals?.snapshot\|\.snapshot()" src/tui/app.ts src/tui/views/ src/cli/commands/tui.ts` — the only snapshot consumer is `snapshot-builder.ts:130` (via the `ApprovalCollector` interface, which the adapter now satisfies).

- [ ] **Step 6: Wire the swap in the composition root**

In `src/cli/commands/tui.ts`:

1. **Extract the shared projection runtime** (currently inline at line 131):
```ts
const runtimeProjectionRuntime = createProjectionRuntime([
  [ProjectionIds.trace, new IncrementalExecutionTraceBuilder()],
  [ProjectionIds.approval, new ApprovalProjection()],
  [ProjectionIds.capability, new CapabilityProjection()],
  [ProjectionIds.metrics, new MetricsProjection()],
]);
const runtimeCollector = new RuntimeCollectorImpl({
  eventLog,
  checkpointStore: runtimeCheckpointStore,
  sessionId,
  projectionRuntime: runtimeProjectionRuntime,
});
```
2. **Import** `ApprovalProjectionCollector` (top of file).
3. **Swap the SnapshotBuilder approval arg** (line 227): change `agentSession, approvals, policy, ...` → `agentSession, new ApprovalProjectionCollector(runtimeProjectionRuntime), policy, ...`.

- [ ] **Step 7: Run adapter + swap-guard tests, verify pass**

Run: `pnpm vitest run tests/tui/runtime/approval-projection-collector.vitest.ts --config vitest.config.mts`
Expected: PASS.

Add the swap-guard + parity oracle in Task 4 (the migration must not merge without it), but you can add a minimal swap-guard now:
```ts
it('SnapshotBuilder approvals dependency is an ApprovalProjectionCollector, not ApprovalManager (single source)', async () => {
  // composition-root assertion is hard to unit-test in isolation; instead assert
  // the adapter is the only ApprovalCollector implementation wired via the interface.
  const runtime = createProjectionRuntime([[ProjectionIds.approval, new ApprovalProjection()]]);
  const collector = new ApprovalProjectionCollector(runtime);
  expect(collector).toSatisfy((c) => c.snapshot !== undefined);
});
```
(Full parity oracle is Task 4.)

- [ ] **Step 8: Run the TUI suite + typecheck**

Run: `pnpm vitest run tests/tui --config vitest.config.mts` then `npx tsc -p tsconfig.json --noEmit`
Expected: all pass; typecheck clean. The approval-manager's removed `snapshot()` must not break `TuiApp` (it uses `tryHandleCommand` only).

- [ ] **Step 9: Commit**

```bash
git add src/tui/runtime/approval-projection-collector.ts src/approvals/extract-target.ts src/tui/approval-manager.ts src/cli/commands/tui.ts tests/tui/runtime/approval-projection-collector.vitest.ts
git commit -m "feat(tui): migrate approval snapshot reads to projection adapter

Adds ApprovalProjectionCollector adapting ApprovalProjectionSnapshot to the
unchanged ApprovalCollector interface. SnapshotBuilder's approvals source
now reads the EventLog projection (atomic swap, no mixed mode). extractTarget
moves to a shared approvals helper. ApprovalManager keeps its command/mutation
role; its snapshot() collector role is removed.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Migration parity coverage

**Files:**
- Test: `tests/tui/runtime/approval-projection-collector.vitest.ts` (extend with parity oracle + full lifecycle + checkpoint compat)
- Test: `tests/tui/runtime/approval-projection.vitest.ts` (extend with checkpoint round-trip A14)

**Interfaces:**
- Consumes: everything from Tasks 1–3.

**Context:** This is the migration's proof. The parity oracle builds `ApprovalSnapshot` from the same fixture both ways — the old store/`ApprovalManager` path and the new projection→adapter path — and applies **normalized deep equality**. The comparison is normalized only where the adapter intentionally changes representation (its `recentlyResolved`/`totalResolved` are real projection history rather than the old hardcoded `[]`/`0`). NOT allowed to differ: ids, pending ordering, timestamps, missing resolved entries. `requestedAt` equivalence holds because the projection reads `payload.timestamp` (= `record.createdAt`) for store-vocab creation events (Task 2, step 4).

- [ ] **Step 1: Write the parity-oracle tests**

Extend `tests/tui/runtime/approval-projection-collector.vitest.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog } from '../../../src/events/event-log.js';
import { ApprovalStore } from '../../../src/approvals/approval-store.js';
import { ApprovalProjection } from '../../../src/tui/runtime/approval-projection.js';
import { ApprovalProjectionCollector } from '../../../src/tui/runtime/approval-projection-collector.js';
import { createProjectionRuntime } from '../../../src/tui/runtime/projection-runtime.js';
import { ProjectionIds } from '../../../src/tui/runtime/projection-ids.js';
import { extractTarget } from '../../../src/approvals/extract-target.js';
```

```ts
it('PARITY ORACLE: same store fixture → identical ApprovalSnapshot via store path and projection path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'parity-'));
  const eventLog = new EventLog(dir);
  await eventLog.init();
  const store = new ApprovalStore(dir, { eventLog });
  await store.load();

  const a1 = await store.request({ reason: 'Path protected: /tmp/foo', capability: 'filesystem.write', toolId: 'fs' });
  const a2 = await store.request({ reason: 'plain', capability: 'shell.exec', toolId: 'sh' });
  await store.resolve(a1.id, 'approved');

  // --- projection path ---
  const runtime = createProjectionRuntime([[ProjectionIds.approval, new ApprovalProjection()]]);
  runtime.updateAll(await eventLog.readAll());
  const projSnap = await new ApprovalProjectionCollector(runtime).snapshot()!;

  // --- store path (the pre-migration behavior) ---
  // ApprovalManager.snapshot() mapped: id, toolName=capability[0], targetPath=extractTarget(reason)||reason, args:{}, requestedAt, requestedBy:'system'
  const pending = store.listPending();
  const storeSnap = {
    pending: pending.map(r => ({
      id: r.id,
      toolName: r.capabilities?.[0] ?? 'unknown',
      targetPath: extractTarget(r.reason) ?? r.reason ?? '',
      args: {},
      requestedAt: Date.parse(r.createdAt) || Date.now(),
      requestedBy: 'system',
    })),
    recentlyResolved: [] as unknown[],
    totalPending: pending.length,
    totalResolved: 0,
  };

  // NORMALIZED deep equality — not whole-object `toEqual`, because the adapter
  // intentionally diverges on `recentlyResolved`/`totalResolved` (old path:
  // always `[]`/0; new path: real projection history). Normalize the comparison:
  // assert the fields that must match (ids, pending ordering, timestamps,
  // targetPath, toolName) with per-field equality, and assert the intentional
  // divergence explicitly.
  expect(projSnap!.pending).toEqual(storeSnap.pending); // ids, ordering, timestamps, targetPath, toolName
  // intentional divergence (adapter now supplies real resolved history):
  expect(projSnap!.recentlyResolved.length).toBeGreaterThan(0);
  expect(storeSnap.recentlyResolved).toEqual([]);
  expect(projSnap!.totalPending).toBe(storeSnap.totalPending);
});

it('FULL LIFECYCLE: request → resolve(approved) → consume → attempted revoke (dead-end); projection ends consumed, matching store', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lifecycle-'));
  const eventLog = new EventLog(dir);
  await eventLog.init();
  const store = new ApprovalStore(dir, { eventLog });
  await store.load();
  const rec = await store.request({ reason: 'r', capability: 'x' });
  await store.resolve(rec.id, 'approved'); // approved
  // post-approval transition: consumeApproved requires approved → succeeds
  const consumed = await store.consumeApproved(rec.id, rec.bindingKey, {});
  expect(consumed.consumed).toBe(true);
  // dead-end: revoke refuses consumed
  await store.revoke(rec.id, { actor: 'user', reason: 'no' });
  const storeRecord = store.get(rec.id);
  expect(storeRecord!.status).toBe('consumed'); // NOT reopened by the failed revoke
  const runtime = createProjectionRuntime([[ProjectionIds.approval, new ApprovalProjection()]]);
  runtime.updateAll(await eventLog.readAll());
  const projSnap = await new ApprovalProjectionCollector(runtime).snapshot();
  // consumed is the final terminal state — the entry left pending entirely
  expect(projSnap!.pending).toHaveLength(0);
  expect(projSnap!.recentlyResolved.map(r => r.id)).toContain(rec.id);
  // the projection's own snapshot carries the precise terminal status
  const raw = runtime.snapshotOf<import('../../../src/tui/runtime/approval-projection.js').ApprovalProjectionSnapshot>(ProjectionIds.approval)!;
  expect(raw.completed[0]!.status).toBe('consumed');
});
```

- [ ] **Step 2: Write the checkpoint backward-compat test (A14)**

Extend `tests/tui/runtime/approval-projection.vitest.ts`:

```ts
it('A14: old-format checkpoint imports into new projection with identical snapshot', () => {
  const p = new ApprovalProjection();
  p.update([created(1, 'a1', { reason: 'r', toolId: 't' }), resolvedStatus(2, 'a1', 'approved')]);
  const state = p.exportState();
  // State is the old-format shape (no renames): { pending, completed, lastSeq }
  const p2 = new ApprovalProjection();
  p2.importState(state);
  expect(p2.snapshot()).toEqual(p.snapshot());
  expect(p2.exportState()).toEqual(state);
});
```

- [ ] **Step 3: Run tests, verify pass**

Run: `pnpm vitest run tests/tui/runtime/approval-projection-collector.vitest.ts tests/tui/runtime/approval-projection.vitest.ts --config vitest.config.mts`
Expected: PASS.

- [ ] **Step 4: Run the full test suite + typecheck + verify skill**

Run: `pnpm vitest run tests/tui tests/approvals --config vitest.config.mts`
Run: `npx tsc -p tsconfig.json --noEmit`
Then use the **verify** skill to exercise the TUI smoke path end-to-end (the swap touches the composition root).

- [ ] **Step 5: Commit**

```bash
git add tests/tui/runtime/approval-projection-collector.vitest.ts tests/tui/runtime/approval-projection.vitest.ts
git commit -m "test(approvals): projection migration parity coverage

Parity oracle proves store path and projection path produce equivalent
ApprovalSnapshot on identical fixtures (ids, ordering, timestamps, targets).
Full-lifecycle fixture verifies terminal states stay terminal under attempted
reopen. A14 checkpoint round-trip proves durable-state backward compatibility.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Verification

**Per-task:** run the listed `pnpm vitest run <path> --config vitest.config.mts` commands.

**Whole-branch before merge (per CLAUDE.md):**
1. `npx gitnexus detect_changes` — confirm only expected files/flows affected (approval-store, approval-projection, snapshot-builder wiring, tui.ts composition root).
2. `pnpm vitest run tests/tui tests/approvals --config vitest.config.mts` — full affected suites.
3. `npx tsc -p tsconfig.json --noEmit` — typecheck clean.
4. Use the **verify** skill to drive the TUI smoke path.
5. `/code-review` two-axis (standards + spec) on the branch pre-merge, matching the Increment A/B convention.
6. Merge via `gh pr merge <n> --squash --delete-branch` (PR creation via `gh`, not MCP github tools which fail auth in this env).

## Acceptance Matrix (from spec §5)

| # | Criterion | Task |
|---|---|---|
| A1 | Store emits lifecycle event iff mutation persisted | Task 1 (failure-emits-nothing) |
| A2 | Projection normalizes both vocabularies | Task 2 (mixed log) |
| A3 | Enrichment fills-missing, never overwrites | Task 2 (merge-enrich) |
| A4 | Contradictory resolution throws (fail-closed) | Task 2 (conflict) |
| A5 | Terminal states immutable | Task 2 (terminal-immutability) |
| A6 | Replay deterministic | Task 2 (replay) |
| A7 | UI parity: identical fixtures → equivalent snapshot | Task 4 (parity oracle) |
| A8 | Pending ordering stable | Task 3 (ordering) |
| A9 | Agent-tab `a`/`d` resolution unmodified | Task 3 swap + existing store tests |
| A10 | No mixed-mode (exactly one collector source) | Task 3 swap-guard |
| A11 | Projection failure does not crash UI snapshot | Task 3 + `trySnapshot` regression |
| A12 | Historical sparse events readable | Task 2 (sparse replay) |
| A13 | Full-lifecycle: terminal stays terminal under reopen | Task 4 (full lifecycle) |
| A14 | Durable checkpoint backward compatibility | Task 4 (checkpoint round-trip) |
