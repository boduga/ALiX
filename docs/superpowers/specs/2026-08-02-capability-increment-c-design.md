# Capability Platform — Increment C: ApprovalManager Migration onto ProjectionRuntime

**Status:** Approved (design complete)
**Date:** 2026-08-02
**Branch:** `feat/capability-increment-c`
**Increment goal:** Move the approval panel's read model from the store-backed `ApprovalManager.snapshot()` to the registry-native `ApprovalProjection`, without changing what operators see.

---

## 1. Vocab strategy (LOCKED — Option 1: union-reader projection)

**The EventLog is the source of truth. Projections adapt to the historical reality of the log; emitters are not rewritten to satisfy one consumer.**

Two approval vocabularies exist in the EventLog and must both be read:

| Path | Creation | Resolution |
|---|---|---|
| CLI (`src/policy/approvals.ts`) | `approval.requested` `{approvalId, prompt, choices}` | `approval.resolved` `{approvalId, decision}` |
| Store (`src/approvals/approval-store.ts`, `src/policy/policy-gate.ts`) | `approval.created` `{approvalId, capabilities, ...}` | `approval.resolved` `{approvalId, status}` |

**Roles:**
- **Projection responsibility:** normalize *all* approval event vocabularies into one lifecycle model.
- **Emitter responsibility:** continue emitting domain facts. Store gains missing transition emissions (Section 2).
- **Collector responsibility:** no translation layer. The projection is the normalization boundary.
- **Conflict handling:** reject contradictory approval state transitions (fail closed).

**Normalized lifecycle model** — retain the existing `ApprovalProjectionEntry` shape (no field renames; durable checkpoints stay valid):

```ts
{ approvalId, prompt?, toolName?, status, requestedAt, completedAt? }
// status union extended with 'invalidated':
//   pending | resumed | approved | denied | edited | expired | revoked | consumed | invalidated
```

`prompt` ≡ the user-facing `reason`; `targetPath` is presentation, derived in the adapter (Section 3).

### Event normalization table

| Event | Payload | Projection action |
|---|---|---|
| `approval.requested` (CLI) | `approvalId, prompt` | new pending, or merge-enrich if already pending |
| `approval.created` (store) | `approvalId, capabilities, …` | new pending, or merge-enrich if already pending |
| `approval.reused` (store) | `approvalId, previousApprovalId` | no-op — reuse does not change lifecycle |
| `approval.resolved` (CLI) | `approvalId, decision` ∈ {approved,denied,edited} | pending → terminal, status=decision |
| `approval.resolved` (store) | `approvalId, status` ∈ {approved,denied} | pending → terminal, status=status |
| `approval.resolved` (both) | decision **and** status | conflict-handling below |
| `approval.expired` | `approvalId` | pending → expired |
| `approval.revoked` | `approvalId` | pending → revoked |
| `approval.consumed` | `approvalId` | pending → consumed |
| `approval.invalidated` | `approvalId` | pending → invalidated |
| `approval.resumed` | `approvalId` | pending → resumed (stays pending) |
| `approval.resume.failed` | `approvalId` | no-op (transient) |
| `approval.group.resolved` | `groupId, status` | **not handled** — store emits per-member `approval.resolved` instead (Section 2) |

### Two load-bearing rules

**1. Merge-enrich (fill-missing-only, never overwrite).** policy-gate emits a *sparse* `approval.created` (via `store.request`) *then* a *rich* one, in seq order. On a `created`/`requested` for an already-pending id, enrich any fields the entry lacks (`toolName`, `prompt`). Enrichment may only fill missing fields; it must never overwrite an existing non-null field with a later sparse value. Preserves append-only semantics and is robust to duplicate/partial emissions from every `approval.created` emitter — the store path (`approval-store`, `policy-gate`) in-scope here, plus the CLI/executor path (`replay-executor`, `rollback-executor`, `runtime-index`) which is outside the TUI-approved migration scope but must not break the projection.

**Implementation shape — guard each field, never spread-merge:**
```ts
// CORRECT — fill-missing-only:
if (entry.prompt == null && incoming.prompt != null) entry.prompt = incoming.prompt;
if (entry.toolName == null && incoming.toolName != null) entry.toolName = incoming.toolName;

// WRONG — would let a sparse event erase richer state:
// entry = { ...entry, ...incomingPayload };
```
Invariant: later events may increase knowledge, never decrease knowledge (append-only evidence semantics).

**2. Conflict handling (fail-closed throw).** When both `decision` and `status` are present and contradictory — e.g. `{decision:"approved", status:"denied"}` — the projection throws during `update()`. This is a governance-invariant violation, consistent with existing strict contracts (malformed timestamp → throw, non-monotonic seq → throw, invalid decision → throw). The projection does not rely on `trySnapshot` for this — it throws during `update()`; the collector boundary (`SnapshotBuilder.trySnapshot`) provides the null-safe containment.

**3. Terminal immutability.** Once an approval reaches a terminal state, later lifecycle events must NOT reopen it. Any terminal transition attempt is either ignored if idempotent or rejected if contradictory:

| Existing state | Incoming event | Result |
|---|---|---|
| approved | resolved(approved) | no-op (idempotent) |
| approved | resolved(denied) | throw (contradictory) |
| expired | resumed | throw (resurrection) |
| consumed | resolved | throw (resurrection) |

This prevents a replay anomaly where a corrupted or duplicated event stream resurrects governance decisions.

**Projection purity.** The projection never fabricates display values: `toolName` remains `toolName?: string` in `ApprovalProjectionEntry`. The `?? "unknown"` fallback lives only in the adapter (Section 3), keeping the projection a faithful read model.

**Recorded decision:**
```text
ApprovalProjection:
  - Union-reader normalization boundary
  - Existing ApprovalProjectionEntry retained for checkpoint compatibility
  - approval.created/requested support merge-enrichment
  - Enrichment is fill-missing-only, never overwrite
  - Conflicting resolution payloads throw
  - Projection throws invariant violations during update()
  - Terminal states are immutable
  - No group expansion; store emits member resolutions
```

---

## 2. ApprovalStore event-completeness (LOCKED)

The store mutates `approvals.json` in 7 paths; 4 emit events, 5 leave the projection blind. Fix the gaps.

| Store method | Current | After |
|---|---|---|
| `requestBound` / `requestFresh` / `requestOrReusePending` | sparse `approval.created` | **enrich** payload with `reason`, `toolName`, `requestId`, `sessionId` (fill from input) |
| `resolve` | `approval.resolved` (`{status, reason}`) | unchanged — already emits |
| `expireDue` | **no event** | emit `approval.expired` per newly-expired record |
| `revoke` | **no event** | emit `approval.revoked` per record |
| `consumeApproved` | **no event** | emit `approval.consumed` per consumed record |
| `invalidateByPolicyRevision` | **no event** | emit `approval.invalidated` per record |
| `resolveGroup` | **no event** | emit per-member `approval.resolved` (not `approval.group.resolved`) |

**Why `expireDue` is correctness, not completeness:** it runs on a timer; it mutates the record to `expired` in the JSON store, but the projection never sees it, so the operator's pending panel shows an expired approval as still pending and it can't be resolved. The emission fixes store/projection divergence.

**Emission ordering (mandatory):**
```text
persist mutation
        |
        v
append EventLog event
```
The projection must never observe a lifecycle transition that did not successfully commit. Failed mutations emit no lifecycle event.

**`resolveGroup`:** emits **per-member** `approval.resolved`. Projection identity is `approvalId`, not `groupId`; group lifecycle is orchestration, individual approval lifecycle is governance truth. `approval.group.resolved` may remain informational for existing consumers but is not required by the projection.

**Acceptance criterion:**
```text
ApprovalStore event completeness:
- Every persisted approval lifecycle mutation emits exactly one corresponding lifecycle event.
- Emitted lifecycle events occur after durable state mutation succeeds.
- Failed mutations emit no lifecycle event.
```

**Backward tolerance:** the projection must remain tolerant of sparse historical events (old replay `{approvalId}` and new enriched `{approvalId, prompt, toolName, requestId, sessionId}` both produce valid entries). Merge rule preserved.

---

## 3. Adapter boundary: `ApprovalProjectionSnapshot → ApprovalCollector` (LOCKED)

The existing `ApprovalCollector` interface (`snapshot-builder.ts:30`) stays **unchanged** — the UI stays fully intact during migration.

```ts
class ApprovalProjectionCollector implements ApprovalCollector {
  constructor(private runtime: ProjectionRuntime) {}
  async snapshot(): Promise<ApprovalSnapshot | null> {
    const projection = this.runtime.snapshotOf<ApprovalProjectionSnapshot>(ProjectionIds.approval);
    if (!projection) return null;
    return mapApprovalProjectionSnapshot(projection);
  }
}
```

**Migration:**
```text
Before:  ApprovalStore → ApprovalManager → ApprovalCollector → SnapshotBuilder → Views
After:   EventLog → ApprovalProjection → ApprovalProjectionCollector → SnapshotBuilder → Views
```

**Mapping** (`ApprovalProjectionEntry` → `ApprovalRecordSnapshot`):

| `ApprovalSnapshot` field | Source |
|---|---|
| `pending` | `proj.pending` (request-seq order preserved) |
| `.id` | `entry.approvalId` |
| `.toolName` | `entry.toolName ?? 'unknown'` |
| `.targetPath` | derived from `entry.prompt` via shared `extractTarget()` |
| `.args` | `{}` |
| `.requestedAt` | `entry.requestedAt` (EventLog timestamp is the lifecycle authority; NO store fallback) |
| `.requestedBy` | `'system'` |
| `recentlyResolved` | `proj.completed` mapped to `ApprovalRecordSnapshot`, newest-first (becomes real, not `[]`) |
| `totalPending` | `proj.pending.length` |
| `totalResolved` | `proj.completed.length` |

**Status distinction** (lives in the projection, enforced by list membership): `ApprovalRecordSnapshot` (the adapter's output type, `snapshot.ts:85`) carries **no `status` field** — the UI contract has none, and no consumer reads one. The live/terminal distinction the projection maintains is expressed through *which list* an entry appears in:

| Projection lifecycle | Adapter output |
|---|---|
| `pending` / `resumed` | appears in `pending` |
| `approved` / `denied` / `edited` / `expired` / `revoked` / `consumed` / `invalidated` | appears in `recentlyResolved` |

`pending` includes only live states (`pending`, `resumed`) — the projection moves terminal entries to `completed`, so the adapter's `pending` can never contain a terminal state. The terminal-collapse mapping (`edited`/`expired`/`revoked`/`consumed`/`invalidated` → `denied`) is the projection's internal lifecycle model (`ApprovalProjectionEntry.status`), **not** a field the adapter emits. The adapter maps `ApprovalProjectionEntry` → `ApprovalRecordSnapshot` fields only (`id`, `toolName`, `targetPath`, `args`, `requestedAt`, `requestedBy`); no `status` field is produced.

**`extractTarget` sharing:** move `extractTarget(reason)` from `src/tui/approval-manager.ts` to `src/approvals/extract-target.ts`, consumed by both `ApprovalProjectionCollector` and `ApprovalManager`.

**Acceptance criterion:**
```text
Approval UI parity:
- Before and after migration, identical EventLog fixtures produce equivalent ApprovalSnapshot output.
- Pending ordering remains stable.
- Agent-tab approval resolution continues to operate without modification.
```

---

## 4. Projection registration + migration sequence (LOCKED)

`ApprovalProjection` is **already registered and fed** on the outer runtime collector (`tui.ts:133`), running and warming — but unread. The swap is **atomic — no mixed-mode period**.

**Registration changes:**
1. Extract the inline `createProjectionRuntime` at `tui.ts:131` into a variable shared by the outer collector and the adapter (same instance — a second runtime would create two independent projection states).
2. Construct `ApprovalProjectionCollector` with that shared instance; swap it into `SnapshotBuilder`'s `approvals` slot (`tui.ts:227`).
3. Do **not** populate `RuntimeSnapshot.projections` — YAGNI; the adapter reads the runtime directly.

**ApprovalManager is NOT replaced.** It keeps command/mutation (`a`/`d`, `/approve`, `/deny`, `/approvals` → store `resolve()`/`listPending()`). Only its `snapshot()` collector role is removed (`snapshot-builder.ts:130` is its sole caller).

**Ordered commits** (this ordering is what guarantees at-swap equivalence):

| # | Commit | Why first |
|---|---|---|
| 1 | Store event-completeness (Section 2) | Store mutations mirrored in EventLog; projection can see expirations/revokes/consumptions |
| 2 | Projection union-reader (Section 1) | Projection fully reconstructs store lifecycle from the log |
| 3 | Adapter + swap (Section 3) | Flipping the panel source; at this point store & projection agree |
| 4 | Parity test | Before/after equivalence on identical fixtures |

Commits 1–2 land with the projection still unread (no behavior change, no risk). Only commit 3 changes observable behavior.

**Migration guard:**
```text
After the swap, SnapshotBuilder must have exactly one ApprovalCollector source.
ApprovalManager must not be passed as the approval collector dependency.
```

**Consistency model (accepted, not a regression):** the projection advances on the collector's poll cycle, so the panel is eventually-consistent with store writes by a beat. `/approvals` reads the store directly for authoritative live state. Operator dashboards → projections; mutation commands → authoritative stores.

---

## 5. Testing strategy and acceptance matrix (LOCKED)

The migration's risk is proving behavioral equivalence between the old store snapshot path and the new projection path. Three suites, each tied to a commit.

### Suite 1 — Store event-completeness (`tests/approvals/approval-store-events.vitest.ts`, new; commit 1)
- For each of `expireDue`/`revoke`/`consumeApproved`/`invalidateByPolicyRevision`/`resolveGroup`: given a pending store record, after the mutation the EventLog contains **exactly one** `approval.{expired|revoked|consumed|invalidated|resolved}` event, only when the persisted transition succeeded.
- **Failed mutation → no event:** a no-op mutation (revoke on non-pending, consume with wrong binding key) emits **zero** events.
- **Enriched `approval.created`:** `requestBound` with `reason`/`toolName` emits them in the payload; store tolerant of sparse historical events.

### Suite 2 — Projection union-reader (extend `tests/tui/runtime/approval-projection.vitest.ts`; commit 2)
- Mixed log (CLI `requested`+`resolved`-decision, store `created`+`resolved`-status, `reused`, `invalidated`, `expired`, `consumed`, `revoked`, `resumed`, `resume.failed`) → correct pending/completed.
- **Merge-enrich:** sparse→rich `created` fills `toolName`/`prompt`; rich→sparse never overwrites.
- **Conflict fail-closed:** `{decision:"approved", status:"denied"}` → throws.
- **Terminal immutability:** `approved`+`resolved(denied)` → throws; `expired`+`resumed` → throws; idempotent re-`resolved(approved)` → no-op.
- **Replay determinism:** same fixture replayed twice → identical snapshots.
- `approval.created` → pending; `approval.reused` → no-op.
- **Historical sparse events readable** (A12): replay fixture without enriched payload fields.

### Suite 3 — Adapter parity (`tests/tui/runtime/approval-projection-collector.vitest.ts`, new; commit 3)
- **Parity oracle (the core equivalence proof):** build `ApprovalSnapshot` from the same fixture both ways — existing store/`ApprovalManager` path and new projection→adapter path — deep-equal. Compare normalized only where the adapter intentionally changes representation (e.g. projection `expired` → UI `denied`). NOT allowed to differ: ids, pending ordering, timestamps, missing resolved entries.
- **Full-lifecycle fixture (A13):** `created → resumed → resolved(approved) → attempted revoke → attempted consume`. Terminal state stays approved; no illegal mutation leaks into projection; adapter output matches store snapshot.
- Pending ordering stable; status mapping per Section 3 table; `recentlyResolved` real; `requestedAt` from `entry.requestedAt` only.
- **Swap guard:** assert `SnapshotBuilder`'s `approvals` is an `ApprovalProjectionCollector` (not `ApprovalManager`).
- **Checkpoint backward compat (A14):** build projection state via the old `ApprovalProjection` format, export the checkpoint, import with the new implementation, verify snapshot equivalence — protects the "no field rename" guarantee.

### Acceptance matrix

| # | Criterion | Test |
|---|---|---|
| A1 | Store emits lifecycle event iff mutation persisted | Store suite, failure-emits-nothing |
| A2 | Projection normalizes both vocabularies | Projection suite, mixed log |
| A3 | Enrichment fills-missing, never overwrites | Projection suite, merge-enrich |
| A4 | Contradictory resolution throws (fail-closed) | Projection suite, conflict |
| A5 | Terminal states immutable | Projection suite, terminal-immutability |
| A6 | Replay deterministic | Projection suite, replay |
| A7 | **UI parity: identical fixtures → equivalent snapshot** | Adapter suite, parity oracle |
| A8 | Pending ordering stable | Adapter suite |
| A9 | Agent-tab `a`/`d` resolution unmodified | Adapter suite swap-guard + existing store tests green |
| A10 | No mixed-mode (exactly one collector source) | Adapter suite swap-guard |
| A11 | Projection failure does not crash UI snapshot | SnapshotBuilder trySnapshot regression |
| A12 | Historical sparse events remain readable | Projection suite, replay without enriched fields |
| A13 | Full-lifecycle fixture: terminal stays terminal under attempted reopen | Adapter suite, full-lifecycle |
| A14 | **Durable checkpoint backward compatibility:** old-format checkpoint → new projection → same snapshot | Adapter/projection suite, checkpoint round-trip |

### Regression net
Run the full TUI vitest suite (`pnpm vitest run tests/tui`) — the swap touches the composition root.

---

## Architecture summary

```text
ApprovalStore
    |
    | emits complete lifecycle events (after durable mutation)
    v
EventLog  ── (CLI path emits approval.requested/resolved with decision)
    |
    | union-reader normalization (ApprovalProjection)
    v
ApprovalProjectionSnapshot
    |
    | adapter (ApprovalProjectionCollector → ApprovalCollector)
    v
Existing TUI views (unchanged)

Roles:
  Store         = mutation authority
  EventLog      = complete lifecycle record
  Projection    = read authority (normalization boundary)
  ApprovalManager = command + mutation service (NOT replaced)
  Collector adapter = single approval-collector source for SnapshotBuilder
```
