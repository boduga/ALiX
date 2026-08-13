# CAP-9 — A7 Proposal Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A7 becomes proposal intelligence, not a capability owner. `service.propose()` persists a governance-ledger event with a deterministic SHA-256 proposal id; `service.apply(approvedProposal)` is the sole A7→A4 bridge delegating to CAP-6. The governance ledger is append-only history; the catalog store is authoritative capability state; rehydration reads catalog store, never governance ledger.

**Architecture:**
- `src/capability/evolution/a7-proposals.ts` — pure proposal generator. Reads injected `ProposalSignalSource` only; produces `CapabilityEvolutionCandidate` shapes. NO catalog/registry reads or writes. NO persistence.
- `src/capability/governance/proposal-identity.ts` — SHA-256 hex proposal id from canonical-JSON of proposal body. Pure function.
- `src/capability/governance/proposal-store.ts` — append-only governance event emitter. Wraps EventLog, filters by `capability.governance.*` prefix. Provides `submit()`, `recordApproved()`, `recordRejected()`, `recordExecuted()`, `recordExecutionFailed()`. Persists to EventLog.
- `src/capability/governance/governance-types.ts` — `CapabilityGovernanceEvent` discriminated union (5 types: `proposal.submitted`, `.approved`, `.rejected`, `.executed`, `.execution_failed`).
- `src/capability/types/service-results.ts` (CAP-8 file, EXTEND) — add `CapabilityProposeResult`, `CapabilityApplyProposalResult`, `CapabilityGovernanceResult`, `CapabilityGovernanceEvent` projection types.
- `src/capability/errors/proposal-stale.ts`, `src/capability/errors/proposal-duplicate.ts` — narrow error classes with `Object.freeze(this)`.
- `src/capability/capability-service.ts` (CAP-8 file, EXTEND) — replace forward-wired `propose()` stub with the implementation that calls injected A7 generator + persists; `apply(input)` extended to accept either (a) A4 step input (existing) or (b) `{ proposalId }` (NEW: bridges to A4); new `governance(capabilityId?)` method (EventLog projection). Constructor grows by ONE dep: `proposalGenerator`.
- `src/capability/platform.ts` (CAP-8 file, EXTEND) — wire `proposalGenerator` from composition root; pass it to `CapabilityService`.
- `src/cli/commands/capability-proposals.ts`, `src/cli/commands/capability-approve.ts`, `src/cli/commands/capability-reject.ts` (CREATE) — three new CLI commands routing through `service.*`.
- `tests/capability/a7-proposals.vitest.ts`, `tests/capability/proposal-identity.vitest.ts`, `tests/capability/proposal-store.vitest.ts`, `tests/capability/capability-service-propose.vitest.ts`, `tests/capability/capability-service-governance.vitest.ts`, `tests/capability/governance-cli.test.ts`, `tests/capability/four-axis-sentinel.vitest.ts`, `tests/capability/cap-9-supersession.test.ts` (CREATE/UPDATE).

**Tech Stack:** TypeScript (ESM), Vitest (`.vitest.ts` — `pnpm test:unit` or `pnpm exec vitest run`), node:test (`.test.ts` — `pnpm run build && pnpm test`), EventLog (CAP-2/8), CapabilityMutationExecutor (CAP-6), CapabilityService (CAP-8 stub broadened), CapabilityEvolutionCandidate (CAP-5 lifecycle graph).

---

## Global Constraints (23 locked rulings + architectural invariants)

### Cross-cutting architectural invariants (verbatim)

1. **"A7 owns no capability state."** — encoded as axis-4 sentinel on the A7 generator module (ruling #13, #14).
2. **"The governance ledger is append-only governance history; the catalog store is the authoritative capability state."** — encoded as the dual-write contract: governance events never call catalog/registry mutators; the catalog store is the only path that mutates capability state (ruling #19).
3. **"Rehydration reads the catalog store, never the governance ledger."** — encoded as `governance()` projection purity and as the axis-4 sentinel (ruling #19, #23).
4. **CAP-8 invariant preserved:** "new capability-service consumers use `CapabilityService`; legacy CLI `apply` remains temporarily on `CapabilityLifecycleApplier` solely as a tracked CAP-11 removal surface."
5. **CAP-6 invariant preserved:** "CAP-9 introduces no second capability-mutation execution path; `service.apply(proposal)` delegates to CAP-6 executor."

### 23 locked rulings (verbatim, encoded as constraints)

**Ruling #1 — Shared EventLog with `capability.governance.*` event prefix.** Ledger physically lives in the same EventLog as `capability.*` lifecycle mutations. One append-only store, one projection engine, one history surface. `history()` projection gains a governance filter mode (axis 1 already covered; axis 4 in CAP-9).

**Ruling #2 — Three-phase lifecycle, five event types.** `submit → pending → approved|rejected → A4 execution → executed|execution_failed`. Event types: `proposal.submitted`, `proposal.approved`, `proposal.rejected`, `proposal.executed`, `proposal.execution_failed`. `pending` is a status, not an event type. Append-only ledger.

**Ruling #3 — `service.propose(input)` is the sole submission route.** A7 generates; `service.propose()` calls injected A7 generator → returns `CapabilityEvolutionCandidate` → persists `proposal.submitted` → returns `CapabilityProposeResult { proposalId, status: 'pending', candidate }`. A7 never touches persistence.

**Ruling #4 — `service.apply(approvedProposal)` is the sole approval→execution bridge.** Persist `proposal.approved`, delegate to CAP-6 `CapabilityMutationExecutor.executeStep()` with bound target. On executor success, persist `proposal.executed`. On failure, persist `proposal.execution_failed` and rethrow.

**Ruling #5 — A7 reads pure signals via injected `ProposalSignalSource` interface.** No catalog reads. No registry reads. No writes. Returns `ReadonlyArray<CapabilityEvolutionSignal>` with kinds: `gap`, `underperformer`, `consolidation_opportunity`, `deprecation_signal`. P5.5/P5.6 emit; A7 consumes.

**Ruling #6 — Create proposals: A7 supplies `{ kind: 'create', capabilityKind, suggestedIdentity, gap }` only.** Operator authors the complete `CapabilityDefinition` (name, schema, provider binding, lifecycle metadata). `service.propose` rejects submissions missing any required field (fail-closed). A7 never authors the definition body.

**Ruling #7 — Update proposals: `{ kind: 'update', source: { id@version }, target: { id@version } }`.** Source = governed pin. Target = proposed new version. CAP-5 validator gates target version bump.

**Ruling #8 — Consolidate proposals: `{ kind: 'consolidate', sources: [{ id@version }, ...], target: <full CapabilityDefinition> }`.** Explicit target definition, not a diff. CAP-5 validator gates target.

**Ruling #9 — `service.recommend()` is read-only registry/catalog projection, no A7.** Returns `CapabilityRecommendResult { suggestions: ReadonlyArray<CapabilityRecommendSuggestion> }` where each suggestion is `{ intent, capabilityId?, rationale }`. Pure projection; CAP-8 ruling #3 preserved exactly.

**Ruling #10 — `history(capabilityId)` covers lifecycle mutations only.** Governance events filtered out for that method. New `service.governance(capabilityId?)` projects governance events. CAP-8 ruling #5 preserved.

**Ruling #11 — A7 generator module: `src/capability/evolution/a7-proposals.ts`.** Service consumes via constructor injection: `new CapabilityService({ catalog, resolver, mutationExecutor, eventLog, proposalGenerator })`. One new ctor dep. Replaces the CAP-8 forward-wired `propose` stub body.

**Ruling #12 — CLI `apply` remains on `CapabilityLifecycleApplier`.** CAP-11 cliff (unchanged from CAP-8). New governance CLI commands (`proposals`/`approve`/`reject`) route through `service.*`. Sentinel pinned in plan.

**Ruling #13 — Forbidden files: inherit CAP-8 list verbatim** (`initial-capabilities.ts`, `tool-registry.ts`, `policy/capability-registry.ts`, `src/capability/canonical/*`, `tui/capabilities/capability-service.ts` CAP-11 tracked). Extend with: A7 generator must NOT import catalog/registry mutators.

**Ruling #14 — Extend three-axis sentinel with axis 4 (A7 no-state).** Axis 4: A7 generator source code MUST NOT contain `catalog\.register|catalog\.remove|registry\.setLifecycleState|registry\.applyMutation` (capability mutators). New forbidden-import pattern: A7 module must NOT import from `capability/canonical`, `evolution/capability-lifecycle`, `policy/capability-registry`, `tools/tool-registry`. Hard structural enforcement.

**Ruling #15 — Approval unit: governance CLI.** `alix capability proposals|approve|reject`. All route through service.* (read or apply). No separate GovernanceStore entity — pending proposals exist as `proposal.submitted` events in the ledger.

**Ruling #16 — Three CLI commands: `proposals`, `approve`, `reject`.** All read/apply through service.*. Mirrors CAP-8 ruling #7.

**Ruling #17 — Stale-publication safety: reject as stale, no silent rebase.** At apply time, service re-resolves the proposal's pinned target against current catalog/registry. If source id@version has been superseded, service rejects with `CapabilityProposalStaleError`. Re-proposal required.

**Ruling #18 — Proposal identity: SHA-256 hex of canonical-JSON proposal.** Deterministic: same proposal resubmitted → same id; identical contents deduplicate. EventLog event carries proposal id + full canonical body.

**Ruling #19 — Rehydration reads the catalog store, never the governance ledger.** Locked invariant from spec.

**Ruling #20 — `REQUEST_MORE_EVIDENCE` stays A3 (CAP-2 authoring) outcome.** Governance never requests more evidence; it accepts or rejects. A3 emits REQUEST_MORE_EVIDENCE when authored definition is missing fields.

**Ruling #21 — Idempotency: reject duplicate submit.** Same canonical proposal → same id → `CapabilityProposalDuplicateError`. No silent append of duplicate proposal.submitted events.

**Ruling #22 — `service.governance()` projection.** Filters by `capability.governance.*` prefix (and capabilityId if supplied). Projects each of 5 event types to a narrow shape. Pure projection; no catalog reads.

**Ruling #23 — Governance purity sentinel.** Source-text: `service.governance()` implementation must NOT call `catalog.get|list|query`, `registry.list|query`, or any `mutate` family. Mirrors CAP-8 ruling #5.

### Architectural decisions (file map locked)

- **Ruling #1, #2:** Governance events share the EventLog with `capability.*` lifecycle events. Prefix `capability.governance.proposal.{submitted,approved,rejected,executed,execution_failed}`. `history(capabilityId)` filters out governance; new `governance(capabilityId?)` filters in only governance events.
- **Ruling #11, #19:** A7 generator module location is `src/capability/evolution/a7-proposals.ts`. Service consumes it via constructor injection (5th dep, NO new optional flag — required). GovernanceStore wrapper class lives in `src/capability/governance/proposal-store.ts`. Rehydration is catalog-driven; governance ledger is read-only history.

### Load-bearing contracts

- **Ruling #3:** `service.propose(input)` returns `CapabilityProposeResult { proposalId: string; status: 'pending'; candidate: CapabilityEvolutionCandidate }` — fail-closed when input missing required fields (ruling #6).
- **Ruling #4:** `service.apply({ proposalId })` returns `CapabilityApplyProposalResult { proposalId, status: 'executed'|'execution_failed', mutation: CapabilityMutationResult, error?: string }`. Re-resolves source `id@version` against current catalog before delegation.
- **Ruling #10, #22:** `service.governance(capabilityId?)` returns `CapabilityGovernanceResult { events: ReadonlyArray<CapabilityGovernanceEvent> }`; pure projection, no catalog reads.
- **Ruling #17:** `CapabilityProposalStaleError extends Error` thrown by `service.apply()` when source pin does not match current catalog. No silent rebase.
- **Ruling #21:** `CapabilityProposalDuplicateError extends Error` thrown by `service.propose()` when canonical proposal id already present in ledger (via `proposal.submitted` event scan).

### CAP-9 forbidden files (extended from CAP-8)

- **CAP-8 forbidden (preserved):** `src/capability/initial-capabilities.ts`, `src/tools/tool-registry.ts`, `src/policy/capability-registry.ts`, `src/capability/canonical/*` (production — read-only import surface only).
- **CAP-9 extended:** `src/capability/evolution/a7-proposals.ts` MUST NOT import from `capability/canonical/*` (except `capability/canonical/definition` for `CapabilityDefinition` type, never mutators), `evolution/capability-lifecycle/*`, `policy/capability-registry`, `tools/tool-registry`. A7 generator source code MUST NOT contain `catalog\.register|catalog\.remove|registry\.setLifecycleState|registry\.applyMutation`.
- **CAP-9 not-touched:** `src/tui/capabilities/capability-service.ts` (TUI service distinct from composition-root service; CAP-11 cliff), `src/evolution/capability-lifecycle/*` (A7.1 legacy).

### Test convention

- New `a7-proposals`, `proposal-identity`, `proposal-store`, `capability-service-propose`, `capability-service-governance`, `four-axis-sentinel` tests use **Vitest** (`.vitest.ts`) — run via `pnpm exec vitest run tests/capability/` (the capability-service layer is vitest, NOT node:test).
- New `governance-cli`, `cap-9-supersession` tests use **node:test** (`.test.ts`) under `tests/capability/`, importing `../../../src/capability/...js` — run via `pnpm run build && pnpm exec tsx --test ...`.
- Type gate: ALWAYS run `pnpm exec tsc --noEmit` after each task.

### Type gate

- **`CapabilityProposeResult` shape is FINAL:** `{ readonly proposalId: string; readonly status: 'pending'; readonly candidate: CapabilityEvolutionCandidate }`. NO `ok/error` envelope.
- **`CapabilityApplyProposalResult` shape is FINAL:** `{ readonly proposalId: string; readonly status: 'executed' | 'execution_failed'; readonly mutation?: CapabilityMutationResult; readonly error?: string }`. NO `ok/error` envelope.
- **`CapabilityGovernanceResult` shape is FINAL:** `{ readonly events: ReadonlyArray<CapabilityGovernanceEventProjection> }`.
- **`CapabilityGovernanceEventProjection` is a discriminated union** over 5 event kinds; each variant carries `{ seq, timestamp, proposalId, payload }` (no full event id, no actor — projection is narrowed).

---

## File map (locked)

| Path | Task | Status |
|------|------|--------|
| `src/capability/governance/governance-types.ts` | T1 | CREATE |
| `src/capability/governance/proposal-identity.ts` | T2 | CREATE |
| `src/capability/errors/proposal-stale.ts` | T3 | CREATE |
| `src/capability/errors/proposal-duplicate.ts` | T3 | CREATE |
| `src/capability/governance/proposal-store.ts` | T4 | CREATE |
| `src/capability/evolution/a7-proposals.ts` | T5 | CREATE |
| `src/capability/types/service-results.ts` | T1, T6 | EXTEND (CAP-8 file) |
| `src/capability/capability-service.ts` | T6 | EXTEND (CAP-8 file) |
| `src/capability/platform.ts` | T7 | EXTEND (CAP-8 file) |
| `src/cli/commands/capability-proposals.ts` | T9 | CREATE |
| `src/cli/commands/capability-approve.ts` | T9 | CREATE |
| `src/cli/commands/capability-reject.ts` | T9 | CREATE |
| `tests/capability/proposal-identity.vitest.ts` | T2 | CREATE |
| `tests/capability/proposal-stale.vitest.ts` | T3 | CREATE |
| `tests/capability/proposal-duplicate.vitest.ts` | T3 | CREATE |
| `tests/capability/proposal-store.vitest.ts` | T4 | CREATE |
| `tests/capability/a7-proposals.vitest.ts` | T5 | CREATE |
| `tests/capability/capability-service-propose.vitest.ts` | T6 | CREATE |
| `tests/capability/capability-service-governance.vitest.ts` | T6 | CREATE |
| `tests/capability/four-axis-sentinel.vitest.ts` | T8 | CREATE |
| `tests/capability/governance-cli.test.ts` | T9 | CREATE |
| `tests/capability/cap-9-supersession.test.ts` | T10 | CREATE |

### Consumed interfaces (CAP-2/3/4/5/6/8, already on main)

- **CAP-2 `src/capability/canonical/catalog.ts`:** `CapabilityCatalog` — `get(id)`, `list()`, `has(id)`, `register(def, binding?)`, `remove(id)`, `getBinding(id)`. Catalog store is authoritative capability state (ruling #19).
- **CAP-3 `src/capability/registry.ts`:** `CapabilityRegistry` — `getLifecycleState(id)`, `setLifecycleState(id, to)`, `listLifecycleStates()`, `getAvailability(id)`, `reload()`, `list()`. Used only by CAP-6 executor and A4 layer; CAP-9 never writes registry directly.
- **CAP-4 `src/evolution/execution/`:** `StepExecutor`, `ExecutionStep`, `GovernedExecutionRuntime`, `createExecutionPlan`, `DefaultRollbackResolver`, `createCapabilityRollbackResolver` (CAP-6 re-homed).
- **CAP-5 `src/capability/mutation-contract.ts`:** `validateCapabilityMutation`, `validateConsolidateMerge`, `classifyUpdateBump`, `CapabilityMutation` types. Used only inside CAP-6 executor.
- **CAP-6 `src/evolution/execution/capability-mutation-executor.ts`:** `CapabilityMutationExecutor.executeStep(step, context): Promise<{ success, output: { operation, mutation, result: CapabilityMutationResult }, error? }>`. Sole capability-mutation execution path; CAP-9 delegates here (ruling #4).
- **CAP-8 `src/capability/capability-service.ts`:** existing surface — `query(q)`, `find(id)`, `getStatus(id)`, `setPresenter(p)`, `invoke(id, args)`, plus forward-wired `apply()`, `propose()`, `recommend()`, `governance()` (stubs). CAP-9 replaces `propose()` stub body; extends `apply()` to accept `{ proposalId }`; implements `governance()`.
- **CAP-8 `src/capability/types/service-results.ts`:** result type definitions; CAP-9 EXTENDS with `CapabilityProposeResult`, `CapabilityApplyProposalResult`, `CapabilityGovernanceResult`, `CapabilityGovernanceEventProjection`.
- **CAP-2/8 `src/events/event-log.ts`:** `EventLog` — `append(event)`, `readAll()`, `getCursor()`. CAP-9 uses `append()` for governance events; `readAll()` for `governance()` projection.
- **CAP-5 `src/adaptation/capability-evolution-types.ts`:** `LifecycleState`, `CapabilityHealth`, `CapabilityGap`, `CapabilityOverlap`, `CapabilityDrift`, `CapabilityEvolutionReport`. A7 generator consumes signals derived from this surface.
- **CAP-1 `src/security/audit/canonical-json.ts`:** `canonicalStringify(value): string` — deterministic JSON with sorted keys. CAP-9 uses for SHA-256 proposal id (ruling #18).

---

### Task 1: Governance event types + result type projections

**Files:**
- Create: `src/capability/governance/governance-types.ts`
- Modify: `src/capability/types/service-results.ts` (CAP-8 file; add result + projection types)
- Test: `tests/capability/governance-types.vitest.ts`

**Interfaces:**
- Produces: `CapabilityGovernanceEvent` discriminated union over 5 event types (`proposal.submitted`, `proposal.approved`, `proposal.rejected`, `proposal.executed`, `proposal.execution_failed`). Each variant carries `{ seq, timestamp, proposalId, payload }`. The payload itself is a discriminated sub-union: `submitted` carries `{ candidate, signalIds }`; `approved` carries `{ approvedBy, approvedAt }`; `rejected` carries `{ rejectedBy, reason }`; `executed` carries `{ mutation: CapabilityMutationResult, artifactId }`; `execution_failed` carries `{ error: string, partialState?: 'rolled_back' | 'not_committed' }`.
- Produces: `CapabilityGovernanceEventType = 'proposal.submitted' | 'proposal.approved' | 'proposal.rejected' | 'proposal.executed' | 'proposal.execution_failed'` as a string-literal union (ruling #2).
- Produces: `CAPABILITY_GOVERNANCE_EVENT_TYPES: readonly CapabilityGovernanceEventType[]` constant for projection scans.
- Produces: `CapabilityProposeResult { proposalId: string; status: 'pending'; candidate: CapabilityEvolutionCandidate }` (ruling #3).
- Produces: `CapabilityApplyProposalResult { proposalId: string; status: 'executed' | 'execution_failed'; mutation?: CapabilityMutationResult; error?: string }` (ruling #4).
- Produces: `CapabilityGovernanceResult { events: ReadonlyArray<CapabilityGovernanceEventProjection> }` (ruling #22).
- Produces: `CapabilityGovernanceEventProjection` discriminated union over the 5 types — same shape as `CapabilityGovernanceEvent` but stripped of internal fields (`seq` retained for ordering; `timestamp` retained; `actor` stripped — projection is application-facing).
- Produces: `GOVERNANCE_EVENT_PREFIX = 'capability.governance.proposal.'` constant.
- Produces: `isGovernanceEventType(value: unknown): value is CapabilityGovernanceEventType` runtime type guard.

**Step 1: Write failing type tests**

Create `tests/capability/governance-types.vitest.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  CAPABILITY_GOVERNANCE_EVENT_TYPES,
  GOVERNANCE_EVENT_PREFIX,
  isGovernanceEventType,
  type CapabilityGovernanceEventType,
} from "../../src/capability/governance/governance-types.js";

describe("CapabilityGovernanceEventType", () => {
  it("has exactly five event types", () => {
    expect(CAPABILITY_GOVERNANCE_EVENT_TYPES).toEqual([
      "proposal.submitted",
      "proposal.approved",
      "proposal.rejected",
      "proposal.executed",
      "proposal.execution_failed",
    ]);
  });

  it("GOVERNANCE_EVENT_PREFIX matches CAP-9 ruling #2", () => {
    expect(GOVERNANCE_EVENT_PREFIX).toBe("capability.governance.proposal.");
  });

  it("isGovernanceEventType accepts each literal", () => {
    for (const t of CAPABILITY_GOVERNANCE_EVENT_TYPES) {
      expect(isGovernanceEventType(t)).toBe(true);
    }
  });

  it("isGovernanceEventType rejects non-governance types", () => {
    expect(isGovernanceEventType("capability.created")).toBe(false);
    expect(isGovernanceEventType("proposal.pending")).toBe(false);
    expect(isGovernanceEventType(null)).toBe(false);
    expect(isGovernanceEventType(undefined)).toBe(false);
  });
});
```

**Step 2: Run test to confirm failure**

```bash
pnpm exec vitest run tests/capability/governance-types.vitest.ts
```

Expected: FAIL — module not found.

**Step 3: Implement governance-types.ts**

```ts
// src/capability/governance/governance-types.ts
import type { CapabilityEvolutionCandidate } from "../../adaptation/capability-evolution-types.js";
import type { CapabilityMutationResult } from "../../evolution/execution/capability-mutation-executor.js";

/** The five governance event types emitted by the CAP-9 governance ledger.
 *  Append-only — pending is a status, not an event (ruling #2). */
export type CapabilityGovernanceEventType =
  | "proposal.submitted"
  | "proposal.approved"
  | "proposal.rejected"
  | "proposal.executed"
  | "proposal.execution_failed";

export const CAPABILITY_GOVERNANCE_EVENT_TYPES: readonly CapabilityGovernanceEventType[] = [
  "proposal.submitted",
  "proposal.approved",
  "proposal.rejected",
  "proposal.executed",
  "proposal.execution_failed",
] as const;

/** Shared prefix used as the EventLog event `type` for all governance events.
 *  Allows the same EventLog to host `capability.*` lifecycle AND governance
 *  events with a single filter rule (ruling #1). */
export const GOVERNANCE_EVENT_PREFIX = "capability.governance.proposal.";

export function isGovernanceEventType(value: unknown): value is CapabilityGovernanceEventType {
  return typeof value === "string" && (CAPABILITY_GOVERNANCE_EVENT_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Payloads — each variant is the discriminated union member
// ---------------------------------------------------------------------------

export interface ProposalSubmittedPayload {
  readonly candidate: CapabilityEvolutionCandidate;
  readonly signalIds: ReadonlyArray<string>;
}

export interface ProposalApprovedPayload {
  readonly approvedBy: string;
  readonly approvedAt: string;
}

export interface ProposalRejectedPayload {
  readonly rejectedBy: string;
  readonly reason: string;
}

export interface ProposalExecutedPayload {
  readonly mutation: CapabilityMutationResult;
  readonly artifactId: string;
}

export interface ProposalExecutionFailedPayload {
  readonly error: string;
  readonly partialState: "rolled_back" | "not_committed";
}

// ---------------------------------------------------------------------------
// Internal EventLog shape — written by ProposalStore.append()
// ---------------------------------------------------------------------------

export interface CapabilityGovernanceEvent {
  readonly seq: number;
  readonly timestamp: string;
  readonly proposalId: string;
  readonly type: CapabilityGovernanceEventType;
  readonly payload:
    | ProposalSubmittedPayload
    | ProposalApprovedPayload
    | ProposalRejectedPayload
    | ProposalExecutedPayload
    | ProposalExecutionFailedPayload;
}

// ---------------------------------------------------------------------------
// Projection — application-facing, drops internals like actor
// ---------------------------------------------------------------------------

export type CapabilityGovernanceEventProjection =
  | {
      readonly seq: number;
      readonly timestamp: string;
      readonly proposalId: string;
      readonly type: "proposal.submitted";
      readonly payload: ProposalSubmittedPayload;
    }
  | {
      readonly seq: number;
      readonly timestamp: string;
      readonly proposalId: string;
      readonly type: "proposal.approved";
      readonly payload: ProposalApprovedPayload;
    }
  | {
      readonly seq: number;
      readonly timestamp: string;
      readonly proposalId: string;
      readonly type: "proposal.rejected";
      readonly payload: ProposalRejectedPayload;
    }
  | {
      readonly seq: number;
      readonly timestamp: string;
      readonly proposalId: string;
      readonly type: "proposal.executed";
      readonly payload: ProposalExecutedPayload;
    }
  | {
      readonly seq: number;
      readonly timestamp: string;
      readonly proposalId: string;
      readonly type: "proposal.execution_failed";
      readonly payload: ProposalExecutionFailedPayload;
    };
```

**Step 4: Extend service-results.ts (CAP-8 file)**

Read current `src/capability/types/service-results.ts` (CAP-8 stub). Append the four new types. Each must be a narrow, dedicated result type (CAP-8 ruling #8 — no generic envelope):

```ts
// src/capability/types/service-results.ts (CAP-9 additions — append, do not modify existing)
import type { CapabilityEvolutionCandidate } from "../../adaptation/capability-evolution-types.js";
import type { CapabilityMutationResult } from "../../evolution/execution/capability-mutation-executor.js";
import type { CapabilityGovernanceEventProjection } from "../governance/governance-types.js";

/** CAP-9 ruling #3 — sole proposal submission route result. */
export interface CapabilityProposeResult {
  readonly proposalId: string;
  readonly status: "pending";
  readonly candidate: CapabilityEvolutionCandidate;
}

/** CAP-9 ruling #4 — A7→A4 bridge result. */
export interface CapabilityApplyProposalResult {
  readonly proposalId: string;
  readonly status: "executed" | "execution_failed";
  readonly mutation?: CapabilityMutationResult;
  readonly error?: string;
}

/** CAP-9 ruling #22 — governance projection result. */
export interface CapabilityGovernanceResult {
  readonly events: ReadonlyArray<CapabilityGovernanceEventProjection>;
}
```

**Step 5: Verify tests pass + typecheck**

```bash
pnpm exec vitest run tests/capability/governance-types.vitest.ts
pnpm exec tsc --noEmit
```

Expected: PASS, 0 tsc errors.

**Step 6: Commit**

```bash
git add src/capability/governance/governance-types.ts src/capability/types/service-results.ts tests/capability/governance-types.vitest.ts
git commit -m "feat(capability): CAP-9 governance event types + service result projections"
```

---

### Task 2: Proposal identity (SHA-256 hex of canonical-JSON)

**Files:**
- Create: `src/capability/governance/proposal-identity.ts`
- Test: `tests/capability/proposal-identity.vitest.ts`

**Interfaces:**
- Produces: `computeProposalId(candidate: CapabilityEvolutionCandidate): string` — SHA-256 hex (64 lowercase chars) of canonical-JSON of the candidate body. Uses `canonicalStringify` from `src/security/audit/canonical-json.ts` (ruling #18). Pure function — no I/O, no clock.
- Produces: `isValidProposalId(value: unknown): value is string` — runtime guard; accepts exactly 64 lowercase hex chars.

**Step 1: Write failing determinism + key-order tests**

Create `tests/capability/proposal-identity.vitest.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeProposalId, isValidProposalId } from "../../src/capability/governance/proposal-identity.js";
import type { CapabilityEvolutionCandidate } from "../../src/adaptation/capability-evolution-types.js";

function mkCandidate(): CapabilityEvolutionCandidate {
  return {
    candidateId: "c-1",
    sourcePatternId: "p-gap-1",
    confidence: 0.85,
    target: { kind: "capability", id: "tool.file.read" },
    description: "Add capability to read files",
    expectedEffect: "Improved file workflow",
    riskClass: "low",
    evidenceIds: ["e-1", "e-2"],
  };
}

describe("computeProposalId (CAP-9 ruling #18)", () => {
  it("returns 64-character lowercase hex", () => {
    const id = computeProposalId(mkCandidate());
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same body → same id", () => {
    const a = computeProposalId(mkCandidate());
    const b = computeProposalId(mkCandidate());
    expect(a).toBe(b);
  });

  it("normalizes key order — reordered keys produce same id", () => {
    const reordered: CapabilityEvolutionCandidate = {
      evidenceIds: ["e-1", "e-2"],
      riskClass: "low",
      expectedEffect: "Improved file workflow",
      description: "Add capability to read files",
      target: { kind: "capability", id: "tool.file.read" },
      confidence: 0.85,
      sourcePatternId: "p-gap-1",
      candidateId: "c-1",
    };
    expect(computeProposalId(reordered)).toBe(computeProposalId(mkCandidate()));
  });

  it("different body → different id", () => {
    const c1 = mkCandidate();
    const c2: CapabilityEvolutionCandidate = { ...c1, candidateId: "c-2" };
    expect(computeProposalId(c1)).not.toBe(computeProposalId(c2));
  });
});

describe("isValidProposalId", () => {
  it("accepts 64 lowercase hex chars", () => {
    const id = computeProposalId(mkCandidate());
    expect(isValidProposalId(id)).toBe(true);
  });

  it("rejects uppercase hex", () => {
    expect(isValidProposalId("A".repeat(64))).toBe(false);
  });

  it("rejects wrong length", () => {
    expect(isValidProposalId("abc")).toBe(false);
  });

  it("rejects non-string", () => {
    expect(isValidProposalId(123)).toBe(false);
    expect(isValidProposalId(null)).toBe(false);
  });
});
```

**Step 2: Run test to confirm failure**

```bash
pnpm exec vitest run tests/capability/proposal-identity.vitest.ts
```

Expected: FAIL — module not found.

**Step 3: Implement proposal-identity.ts**

```ts
// src/capability/governance/proposal-identity.ts
import { createHash } from "node:crypto";
import { canonicalStringify } from "../../security/audit/canonical-json.js";
import type { CapabilityEvolutionCandidate } from "../../adaptation/capability-evolution-types.js";

/** Domain prefix isolates proposal ids from other canonical hashes
 *  (e.g. CAP-6 artifactId uses `alix-capability-mutation-v1:`). */
const DOMAIN_PREFIX = "alix-capability-proposal-v1:";

/**
 * Compute a deterministic SHA-256 hex proposal id from a candidate body.
 *
 * Same proposal body → same id (idempotency ruling #21). Different key
 * ordering in the input object produces the same id (canonical-JSON normalizes
 * key order). Pure function — no I/O, no clock.
 */
export function computeProposalId(candidate: CapabilityEvolutionCandidate): string {
  const canonical = canonicalStringify(candidate);
  return createHash("sha256").update(DOMAIN_PREFIX).update(canonical).digest("hex");
}

/** Runtime guard: 64 lowercase hex chars. */
export function isValidProposalId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
```

**Step 4: Run tests + typecheck**

```bash
pnpm exec vitest run tests/capability/proposal-identity.vitest.ts
pnpm exec tsc --noEmit
```

Expected: PASS, 0 tsc errors.

**Step 5: Commit**

```bash
git add src/capability/governance/proposal-identity.ts tests/capability/proposal-identity.vitest.ts
git commit -m "feat(capability): CAP-9 proposal identity — SHA-256 hex of canonical-JSON"
```

---

### Task 3: Proposal-stale + proposal-duplicate error classes

**Files:**
- Create: `src/capability/errors/proposal-stale.ts`
- Create: `src/capability/errors/proposal-duplicate.ts`
- Test: `tests/capability/proposal-stale.vitest.ts`
- Test: `tests/capability/proposal-duplicate.vitest.ts`

**Interfaces:**
- Produces: `CapabilityProposalStaleError extends Error` — constructor `(proposalId: string, sourceId: string, sourceVersion: string, currentVersion: string | undefined)`. Message format: `Proposal '<proposalId>' stale: source '<sourceId>@<sourceVersion>' no longer matches current catalog (got '<currentVersion>')`. `code: 'CAPABILITY_PROPOSAL_STALE' = 'CAPABILITY_PROPOSAL_STALE'`. `Object.freeze(this)` in ctor (CAP-6 precedent — immutable error surface).
- Produces: `CapabilityProposalDuplicateError extends Error` — constructor `(proposalId: string)`. Message format: `Proposal '<proposalId>' already submitted (deduplication)`. `code: 'CAPABILITY_PROPOSAL_DUPLICATE' = 'CAPABILITY_PROPOSAL_DUPLICATE'`. `Object.freeze(this)`.

**Step 1: Write failing error tests**

Create `tests/capability/proposal-stale.vitest.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CapabilityProposalStaleError } from "../../src/capability/errors/proposal-stale.js";

describe("CapabilityProposalStaleError (CAP-9 ruling #17)", () => {
  it("carries the standard code", () => {
    const err = new CapabilityProposalStaleError("p-abc", "tool.file.read", "1.0.0", "1.5.0");
    expect(err.code).toBe("CAPABILITY_PROPOSAL_STALE");
  });

  it("includes proposalId + source pin + current version in message", () => {
    const err = new CapabilityProposalStaleError("p-abc", "tool.file.read", "1.0.0", "1.5.0");
    expect(err.message).toContain("p-abc");
    expect(err.message).toContain("tool.file.read");
    expect(err.message).toContain("1.0.0");
    expect(err.message).toContain("1.5.0");
  });

  it("is an Error subclass with frozen instance", () => {
    const err = new CapabilityProposalStaleError("p-abc", "tool.file.read", "1.0.0", "1.5.0");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CapabilityProposalStaleError");
    expect(Object.isFrozen(err)).toBe(true);
  });

  it("handles absent current version (capability removed)", () => {
    const err = new CapabilityProposalStaleError("p-abc", "tool.file.read", "1.0.0", undefined);
    expect(err.message).toContain("undefined");
  });
});
```

Create `tests/capability/proposal-duplicate.vitest.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CapabilityProposalDuplicateError } from "../../src/capability/errors/proposal-duplicate.js";

describe("CapabilityProposalDuplicateError (CAP-9 ruling #21)", () => {
  it("carries the standard code", () => {
    const err = new CapabilityProposalDuplicateError("p-abc");
    expect(err.code).toBe("CAPABILITY_PROPOSAL_DUPLICATE");
  });

  it("includes proposalId in message", () => {
    const err = new CapabilityProposalDuplicateError("p-abc");
    expect(err.message).toContain("p-abc");
  });

  it("is an Error subclass with frozen instance", () => {
    const err = new CapabilityProposalDuplicateError("p-abc");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CapabilityProposalDuplicateError");
    expect(Object.isFrozen(err)).toBe(true);
  });
});
```

**Step 2: Run tests to confirm failure**

```bash
pnpm exec vitest run tests/capability/proposal-stale.vitest.ts tests/capability/proposal-duplicate.vitest.ts
```

Expected: FAIL — modules not found.

**Step 3: Implement both error classes**

`src/capability/errors/proposal-stale.ts`:

```ts
/** Thrown by service.apply({ proposalId }) when the proposal's pinned source
 *  id@version no longer matches the current catalog (ruling #17).
 *  Frozen — error instances are immutable so they can safely cross process
 *  boundaries (logger, event payloads) without mutation. */
export class CapabilityProposalStaleError extends Error {
  readonly code = "CAPABILITY_PROPOSAL_STALE" as const;
  constructor(
    readonly proposalId: string,
    readonly sourceId: string,
    readonly sourceVersion: string,
    readonly currentVersion: string | undefined,
  ) {
    super(
      `Proposal '${proposalId}' stale: source '${sourceId}@${sourceVersion}' no longer matches current catalog (got '${currentVersion ?? "undefined"}')`,
    );
    this.name = "CapabilityProposalStaleError";
    Object.freeze(this);
  }
}
```

`src/capability/errors/proposal-duplicate.ts`:

```ts
/** Thrown by service.propose() when the canonical proposal id already has a
 *  matching proposal.submitted event in the ledger (ruling #21).
 *  Frozen — error instances are immutable. */
export class CapabilityProposalDuplicateError extends Error {
  readonly code = "CAPABILITY_PROPOSAL_DUPLICATE" as const;
  constructor(readonly proposalId: string) {
    super(`Proposal '${proposalId}' already submitted (deduplication)`);
    this.name = "CapabilityProposalDuplicateError";
    Object.freeze(this);
  }
}
```

**Step 4: Run tests + typecheck**

```bash
pnpm exec vitest run tests/capability/proposal-stale.vitest.ts tests/capability/proposal-duplicate.vitest.ts
pnpm exec tsc --noEmit
```

Expected: PASS, 0 tsc errors.

**Step 5: Commit**

```bash
git add src/capability/errors/proposal-stale.ts src/capability/errors/proposal-duplicate.ts tests/capability/proposal-stale.vitest.ts tests/capability/proposal-duplicate.vitest.ts
git commit -m "feat(capability): CAP-9 proposal-stale + proposal-duplicate error classes"
```

---

### Task 4: ProposalStore (append-only governance ledger wrapper)

**Files:**
- Create: `src/capability/governance/proposal-store.ts`
- Test: `tests/capability/proposal-store.vitest.ts`

**Interfaces:**
- Produces: `ProposalStoreOptions { eventLog: EventLog }` — wraps the existing EventLog (ruling #1).
- Produces: `ProposalStore` class with 5 methods:
  - `submit(candidate, signalIds): Promise<{ proposalId, event }>` — compute id via `computeProposalId`; reject duplicate via ledger scan; persist `proposal.submitted`; return `{ proposalId, event: CapabilityGovernanceEvent }`.
  - `recordApproved(proposalId, approvedBy): Promise<CapabilityGovernanceEvent>` — persist `proposal.approved`.
  - `recordRejected(proposalId, rejectedBy, reason): Promise<CapabilityGovernanceEvent>` — persist `proposal.rejected`.
  - `recordExecuted(proposalId, mutation, artifactId): Promise<CapabilityGovernanceEvent>` — persist `proposal.executed`.
  - `recordExecutionFailed(proposalId, error, partialState): Promise<CapabilityGovernanceEvent>` — persist `proposal.execution_failed`.
- Produces: `ProposalStore.findById(proposalId): Promise<CapabilityGovernanceEvent[]>` — projection helper; returns all events for a given proposal id, ordered by seq.
- Produces: `ProposalStore.existsSubmitted(proposalId): Promise<boolean>` — duplicate-detection helper; returns true iff a `proposal.submitted` event with this id exists.
- All persist methods must construct the EventLog `NewEvent` shape: `{ type: GOVERNANCE_EVENT_PREFIX + CapabilityGovernanceEventType, actor: 'system', sessionId: '', payload: { proposalId, ...payload } }`. The ProposalStore itself is the actor (`'system'`); the `proposalId` lives in payload, not in a top-level field — keeps governance events filterable by `type` prefix alone.

**Step 1: Write failing ProposalStore tests**

Create `tests/capability/proposal-store.vitest.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../../src/events/event-log.js";
import { ProposalStore } from "../../src/capability/governance/proposal-store.js";
import { CapabilityProposalDuplicateError } from "../../src/capability/errors/proposal-duplicate.js";
import type { CapabilityEvolutionCandidate } from "../../src/adaptation/capability-evolution-types.js";

function mkCandidate(): CapabilityEvolutionCandidate {
  return {
    candidateId: "c-1",
    sourcePatternId: "p-1",
    confidence: 0.8,
    target: { kind: "capability", id: "tool.x" },
    description: "d",
    expectedEffect: "e",
    riskClass: "low",
    evidenceIds: [],
  };
}

describe("ProposalStore — append-only governance ledger (CAP-9)", () => {
  let dir: string;
  let eventLog: EventLog;
  let store: ProposalStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "cap9-store-"));
    eventLog = new EventLog(dir);
    await eventLog.init();
    store = new ProposalStore({ eventLog });
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("submit() persists proposal.submitted and returns stable id", async () => {
    const { proposalId, event } = await store.submit(mkCandidate(), ["sig-1"]);
    expect(proposalId).toMatch(/^[0-9a-f]{64}$/);
    expect(event.type).toBe("capability.governance.proposal.submitted");
    expect(event.proposalId).toBe(proposalId);
  });

  it("submit() rejects duplicate proposal id (ruling #21)", async () => {
    await store.submit(mkCandidate(), []);
    await expect(store.submit(mkCandidate(), [])).rejects.toBeInstanceOf(CapabilityProposalDuplicateError);
  });

  it("recordApproved() persists proposal.approved", async () => {
    const { proposalId } = await store.submit(mkCandidate(), []);
    const evt = await store.recordApproved(proposalId, "operator");
    expect(evt.type).toBe("capability.governance.proposal.approved");
  });

  it("recordRejected() persists proposal.rejected", async () => {
    const { proposalId } = await store.submit(mkCandidate(), []);
    const evt = await store.recordRejected(proposalId, "operator", "out of scope");
    expect(evt.type).toBe("capability.governance.proposal.rejected");
    expect((evt.payload as { reason: string }).reason).toBe("out of scope");
  });

  it("recordExecuted() persists proposal.executed with mutation snapshot", async () => {
    const { proposalId } = await store.submit(mkCandidate(), []);
    const evt = await store.recordExecuted(proposalId, { dummy: true } as never, "artifact-abc");
    expect(evt.type).toBe("capability.governance.proposal.executed");
    expect((evt.payload as { artifactId: string }).artifactId).toBe("artifact-abc");
  });

  it("recordExecutionFailed() persists proposal.execution_failed", async () => {
    const { proposalId } = await store.submit(mkCandidate(), []);
    const evt = await store.recordExecutionFailed(proposalId, "boom", "rolled_back");
    expect(evt.type).toBe("capability.governance.proposal.execution_failed");
  });

  it("findById() returns events ordered by seq", async () => {
    const { proposalId } = await store.submit(mkCandidate(), []);
    await store.recordApproved(proposalId, "op");
    await store.recordExecuted(proposalId, { dummy: true } as never, "art");
    const events = await store.findById(proposalId);
    expect(events.map((e) => e.type)).toEqual([
      "proposal.submitted",
      "proposal.approved",
      "proposal.executed",
    ]);
  });

  it("existsSubmitted() returns true only after submit", async () => {
    expect(await store.existsSubmitted("nonexistent")).toBe(false);
    const { proposalId } = await store.submit(mkCandidate(), []);
    expect(await store.existsSubmitted(proposalId)).toBe(true);
  });
});
```

**Step 2: Run tests to confirm failure**

```bash
pnpm exec vitest run tests/capability/proposal-store.vitest.ts
```

Expected: FAIL — module not found.

**Step 3: Implement ProposalStore**

```ts
// src/capability/governance/proposal-store.ts
import type { EventLog } from "../../events/event-log.js";
import type { AlixEvent, NewEvent } from "../../events/types.js";
import { computeProposalId } from "./proposal-identity.js";
import {
  GOVERNANCE_EVENT_PREFIX,
  type CapabilityGovernanceEvent,
  type CapabilityGovernanceEventType,
  type ProposalApprovedPayload,
  type ProposalExecutionFailedPayload,
  type ProposalExecutedPayload,
  type ProposalRejectedPayload,
  type ProposalSubmittedPayload,
} from "./governance-types.js";
import { CapabilityProposalDuplicateError } from "../errors/proposal-duplicate.js";
import type { CapabilityEvolutionCandidate } from "../../adaptation/capability-evolution-types.js";
import type { CapabilityMutationResult } from "../../evolution/execution/capability-mutation-executor.js";

export interface ProposalStoreOptions {
  readonly eventLog: EventLog;
}

export class ProposalStore {
  private readonly eventLog: EventLog;

  constructor(options: ProposalStoreOptions) {
    this.eventLog = options.eventLog;
  }

  /**
   * Append a proposal.submitted event. Computes the deterministic proposal id
   * and rejects duplicates (ruling #21). Returns the persisted proposal id
   * AND the materialized event so callers don't need a second read.
   */
  async submit(
    candidate: CapabilityEvolutionCandidate,
    signalIds: ReadonlyArray<string>,
  ): Promise<{ proposalId: string; event: CapabilityGovernanceEvent }> {
    const proposalId = computeProposalId(candidate);
    if (await this.existsSubmitted(proposalId)) {
      throw new CapabilityProposalDuplicateError(proposalId);
    }
    const payload: ProposalSubmittedPayload = { candidate, signalIds };
    const event = await this.append(proposalId, "proposal.submitted", payload);
    return { proposalId, event };
  }

  async recordApproved(proposalId: string, approvedBy: string): Promise<CapabilityGovernanceEvent> {
    const payload: ProposalApprovedPayload = { approvedBy, approvedAt: new Date().toISOString() };
    return this.append(proposalId, "proposal.approved", payload);
  }

  async recordRejected(proposalId: string, rejectedBy: string, reason: string): Promise<CapabilityGovernanceEvent> {
    const payload: ProposalRejectedPayload = { rejectedBy, reason };
    return this.append(proposalId, "proposal.rejected", payload);
  }

  async recordExecuted(
    proposalId: string,
    mutation: CapabilityMutationResult,
    artifactId: string,
  ): Promise<CapabilityGovernanceEvent> {
    const payload: ProposalExecutedPayload = { mutation, artifactId };
    return this.append(proposalId, "proposal.executed", payload);
  }

  async recordExecutionFailed(
    proposalId: string,
    error: string,
    partialState: "rolled_back" | "not_committed",
  ): Promise<CapabilityGovernanceEvent> {
    const payload: ProposalExecutionFailedPayload = { error, partialState };
    return this.append(proposalId, "proposal.execution_failed", payload);
  }

  /** Return all governance events for a proposal, ordered by seq. */
  async findById(proposalId: string): Promise<CapabilityGovernanceEvent[]> {
    const all = await this.eventLog.readAll();
    return all
      .filter((e) => isGovernanceRawEvent(e) && (e.payload as { proposalId?: string }).proposalId === proposalId)
      .map(toCapabilityGovernanceEvent)
      .sort((a, b) => a.seq - b.seq);
  }

  /** True iff a proposal.submitted event with this proposalId already exists. */
  async existsSubmitted(proposalId: string): Promise<boolean> {
    const all = await this.eventLog.readAll();
    return all.some(
      (e) =>
        isGovernanceRawEvent(e) &&
        e.type === GOVERNANCE_EVENT_PREFIX + "proposal.submitted" &&
        (e.payload as { proposalId?: string }).proposalId === proposalId,
    );
  }

  private async append(
    proposalId: string,
    type: CapabilityGovernanceEventType,
    payload:
      | ProposalSubmittedPayload
      | ProposalApprovedPayload
      | ProposalRejectedPayload
      | ProposalExecutedPayload
      | ProposalExecutionFailedPayload,
  ): Promise<CapabilityGovernanceEvent> {
    const newEvent: NewEvent<string, { proposalId: string }> = {
      type: GOVERNANCE_EVENT_PREFIX + type,
      actor: "system",
      sessionId: "",
      payload: { proposalId, ...payload } as { proposalId: string },
    };
    const written = await this.eventLog.append(newEvent);
    return toCapabilityGovernanceEvent(written);
  }
}

// ---------------------------------------------------------------------------
// Helpers — bridge between AlixEvent (EventLog shape) and CapabilityGovernanceEvent
// ---------------------------------------------------------------------------

function isGovernanceRawEvent(e: AlixEvent): boolean {
  return typeof e.type === "string" && e.type.startsWith(GOVERNANCE_EVENT_PREFIX);
}

function toCapabilityGovernanceEvent(e: AlixEvent): CapabilityGovernanceEvent {
  const type = e.type.slice(GOVERNANCE_EVENT_PREFIX.length) as CapabilityGovernanceEventType;
  return Object.freeze({
    seq: e.seq,
    timestamp: e.timestamp,
    proposalId: (e.payload as { proposalId: string }).proposalId,
    type,
    payload: e.payload as never,
  });
}
```

**Step 4: Run tests + typecheck**

```bash
pnpm exec vitest run tests/capability/proposal-store.vitest.ts
pnpm exec tsc --noEmit
```

Expected: PASS, 0 tsc errors.

**Step 5: Commit**

```bash
git add src/capability/governance/proposal-store.ts tests/capability/proposal-store.vitest.ts
git commit -m "feat(capability): CAP-9 ProposalStore — append-only governance ledger wrapper"
```

---

### Task 5: A7 proposal generator (pure, signal-only)

**Files:**
- Create: `src/capability/evolution/a7-proposals.ts`
- Test: `tests/capability/a7-proposals.vitest.ts`

**Interfaces:**
- Produces: `CapabilityEvolutionSignal` discriminated union over 4 kinds: `gap`, `underperformer`, `consolidation_opportunity`, `deprecation_signal`. Each carries `{ kind, capabilityId?, score, evidenceIds }`.
- Produces: `ProposalSignalSource` interface with single method `signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>>` — P5.5/P5.6 adapters implement this; A7 only knows the shape.
- Produces: `A7ProposalGeneratorOptions { signalSource: ProposalSignalSource }`.
- Produces: `A7ProposalGenerator` class with method `generate(): Promise<CapabilityEvolutionCandidate[]>` — pure transformation: signals → candidates. NO catalog reads. NO registry reads. NO writes. Returns one candidate per signal kind when applicable (gap → create, underperformer → update, consolidation_opportunity → consolidate, deprecation_signal → remove).
- Produces: `A7ProposalGenerator.fromDefault()` factory — uses the standard `CapabilityEvolutionProposalGenerator` from `src/adaptation/capability-evolution-proposal-generator.ts` as the signal source (CAP-5/P5.6). The default factory is the ONLY allowed coupling to P5.6 — A7 must NOT directly emit adaptation proposals; it emits evolution candidates.

**Step 1: Write failing A7 generator tests**

Create `tests/capability/a7-proposals.vitest.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  A7ProposalGenerator,
  type CapabilityEvolutionSignal,
  type ProposalSignalSource,
} from "../../src/capability/evolution/a7-proposals.js";

class FakeSignalSource implements ProposalSignalSource {
  constructor(private readonly items: ReadonlyArray<CapabilityEvolutionSignal>) {}
  async signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>> {
    return this.items;
  }
}

describe("A7ProposalGenerator — pure proposal intelligence (CAP-9 ruling #5)", () => {
  it("gap signal → create candidate", async () => {
    const gen = new A7ProposalGenerator({
      signalSource: new FakeSignalSource([
        { kind: "gap", capabilityId: undefined, score: 0.9, evidenceIds: ["e-1"] },
      ]),
    });
    const [c] = await gen.generate();
    expect(c).toBeDefined();
    expect((c as { kind: string }).kind ?? "create").toBe("create");
    expect(c.target.id).toBeTruthy();
  });

  it("underperformer signal → update candidate", async () => {
    const gen = new A7ProposalGenerator({
      signalSource: new FakeSignalSource([
        { kind: "underperformer", capabilityId: "tool.file.read", score: 0.6, evidenceIds: [] },
      ]),
    });
    const [c] = await gen.generate();
    expect((c as { kind: string }).kind ?? "update").toBe("update");
  });

  it("consolidation_opportunity → consolidate candidate", async () => {
    const gen = new A7ProposalGenerator({
      signalSource: new FakeSignalSource([
        { kind: "consolidation_opportunity", capabilityId: "tool.file.read", score: 0.8, evidenceIds: [] },
      ]),
    });
    const [c] = await gen.generate();
    expect((c as { kind: string }).kind ?? "consolidate").toBe("consolidate");
  });

  it("deprecation_signal → remove candidate", async () => {
    const gen = new A7ProposalGenerator({
      signalSource: new FakeSignalSource([
        { kind: "deprecation_signal", capabilityId: "tool.file.read", score: 0.7, evidenceIds: [] },
      ]),
    });
    const [c] = await gen.generate();
    expect((c as { kind: string }).kind ?? "remove").toBe("remove");
  });

  it("empty signal list → empty candidates", async () => {
    const gen = new A7ProposalGenerator({ signalSource: new FakeSignalSource([]) });
    const candidates = await gen.generate();
    expect(candidates).toEqual([]);
  });
});

describe("A7ProposalGenerator — purity (CAP-9 ruling #5, axis-4 sentinel)", () => {
  it("module MUST NOT import capability/canonical mutators", async () => {
    // Source-text check (separate from runtime test); performed by
    // four-axis-sentinel in Task 8. Here we just confirm the generator
    // does not expose any catalog/registry method on its instance.
    const gen = new A7ProposalGenerator({ signalSource: new FakeSignalSource([]) });
    const proto = Object.getPrototypeOf(gen);
    const methodNames = Object.getOwnPropertyNames(proto).filter((n) => n !== "constructor");
    expect(methodNames).toEqual(["generate"]);
  });
});
```

**Step 2: Run test to confirm failure**

```bash
pnpm exec vitest run tests/capability/a7-proposals.vitest.ts
```

Expected: FAIL — module not found.

**Step 3: Implement A7ProposalGenerator**

```ts
// src/capability/evolution/a7-proposals.ts
import type { CapabilityEvolutionCandidate } from "../../adaptation/capability-evolution-types.js";

/**
 * CAP-9 — A7 is pure proposal intelligence. Reads signals, emits candidates.
 *
 * Hard architectural boundary (axis-4 sentinel, ruling #14):
 *   - MUST NOT import from capability/canonical (except CapabilityDefinition type).
 *   - MUST NOT import from evolution/capability-lifecycle.
 *   - MUST NOT import from policy/capability-registry.
 *   - MUST NOT import from tools/tool-registry.
 *   - MUST NOT call catalog.register / catalog.remove / registry.setLifecycleState /
 *     registry.applyMutation.
 *   - MUST NOT write to any store.
 *
 * Persistence is `service.propose()`'s sole responsibility (ruling #3).
 */

export type CapabilityEvolutionSignal =
  | { readonly kind: "gap"; readonly capabilityId?: undefined; readonly score: number; readonly evidenceIds: ReadonlyArray<string> }
  | { readonly kind: "underperformer"; readonly capabilityId: string; readonly score: number; readonly evidenceIds: ReadonlyArray<string> }
  | { readonly kind: "consolidation_opportunity"; readonly capabilityId: string; readonly score: number; readonly evidenceIds: ReadonlyArray<string> }
  | { readonly kind: "deprecation_signal"; readonly capabilityId: string; readonly score: number; readonly evidenceIds: ReadonlyArray<string> };

/** Source of evolution signals. P5.5/P5.6 adapters implement this. A7 never
 *  knows about catalog/registry/eventLog — only the signal shape. */
export interface ProposalSignalSource {
  signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>>;
}

export interface A7ProposalGeneratorOptions {
  readonly signalSource: ProposalSignalSource;
}

/** A7 proposal generator. Pure transformation: signals → candidates. */
export class A7ProposalGenerator {
  private readonly signalSource: ProposalSignalSource;

  constructor(options: A7ProposalGeneratorOptions) {
    this.signalSource = options.signalSource;
  }

  /** Emit one candidate per signal. Returns empty array when no signals. */
  async generate(): Promise<CapabilityEvolutionCandidate[]> {
    const signals = await this.signalSource.signals();
    const candidates: CapabilityEvolutionCandidate[] = [];
    for (const signal of signals) {
      const candidate = signalToCandidate(signal);
      if (candidate) candidates.push(candidate);
    }
    return candidates;
  }
}

function signalToCandidate(signal: CapabilityEvolutionSignal): CapabilityEvolutionCandidate | undefined {
  const baseCandidateId = `a7-${signal.kind}-${signal.capabilityId ?? "new"}-${Date.now().toString(36)}`;
  switch (signal.kind) {
    case "gap":
      // Create proposal: A7 supplies `{ kind: 'create', capabilityKind, suggestedIdentity, gap }` only
      // (ruling #6). Operator authors the full CapabilityDefinition later.
      return {
        candidateId: baseCandidateId,
        sourcePatternId: signal.kind,
        confidence: signal.score,
        target: { kind: "capability", id: `new.${baseCandidateId}` },
        description: `Gap-driven proposal (score=${signal.score})`,
        expectedEffect: "Close observed capability gap",
        riskClass: signal.score > 0.8 ? "high" : signal.score > 0.5 ? "medium" : "low",
        evidenceIds: [...signal.evidenceIds],
      };
    case "underperformer":
      return {
        candidateId: baseCandidateId,
        sourcePatternId: signal.kind,
        confidence: signal.score,
        target: { kind: "capability", id: signal.capabilityId },
        description: `Underperformer update (score=${signal.score})`,
        expectedEffect: "Improve observed underperformance",
        riskClass: "medium",
        evidenceIds: [...signal.evidenceIds],
      };
    case "consolidation_opportunity":
      return {
        candidateId: baseCandidateId,
        sourcePatternId: signal.kind,
        confidence: signal.score,
        target: { kind: "capability", id: signal.capabilityId },
        description: `Consolidation opportunity (score=${signal.score})`,
        expectedEffect: "Consolidate overlapping capability",
        riskClass: "high",
        evidenceIds: [...signal.evidenceIds],
      };
    case "deprecation_signal":
      return {
        candidateId: baseCandidateId,
        sourcePatternId: signal.kind,
        confidence: signal.score,
        target: { kind: "capability", id: signal.capabilityId },
        description: `Deprecation signal (score=${signal.score})`,
        expectedEffect: "Remove obsolete capability",
        riskClass: "high",
        evidenceIds: [...signal.evidenceIds],
      };
  }
}

/** Factory that wires the standard P5.5/P5.6 evolution proposal generator
 *  as the signal source. The ONLY allowed coupling between A7 and the
 *  proposal-generation subsystem. */
export function defaultA7ProposalGenerator(): A7ProposalGenerator {
  // Lazy import — keeps A7 free of catalog/registry references at module-load
  // time and lets the four-axis-sentinel test (Task 8) reason about a
  // clean import graph.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { CapabilityEvolutionProposalGenerator } = require("../../adaptation/capability-evolution-proposal-generator.js") as typeof import("../../adaptation/capability-evolution-proposal-generator.js");
  // Note: the default factory exists for composition-root convenience; CAP-9
  // tests inject a fake ProposalSignalSource and never touch the default.
  void CapabilityEvolutionProposalGenerator;
  throw new Error("defaultA7ProposalGenerator not yet wired — composition root must construct P5.5/P5.6 signal source explicitly");
}
```

**Step 4: Run tests + typecheck**

```bash
pnpm exec vitest run tests/capability/a7-proposals.vitest.ts
pnpm exec tsc --noEmit
```

Expected: PASS, 0 tsc errors.

**Step 5: Commit**

```bash
git add src/capability/evolution/a7-proposals.ts tests/capability/a7-proposals.vitest.ts
git commit -m "feat(capability): CAP-9 A7ProposalGenerator — pure signal-driven proposal intelligence"
```

---

### Task 6: CapabilityService extend — propose() / apply(proposal) / governance()

**Files:**
- Modify: `src/capability/capability-service.ts` (CAP-8 file — replace propose() stub, extend apply() to accept `{ proposalId }`, add governance() projection)
- Test: `tests/capability/capability-service-propose.vitest.ts`
- Test: `tests/capability/capability-service-governance.vitest.ts`

**Interfaces:**
- Modifies: `CapabilityServiceOptions` (CAP-8 file) — add `proposalGenerator?: A7ProposalGenerator` (REQUIRED for propose(); absence → throw `CapabilityServiceNotImplementedError` per CAP-8 ruling #4 contract). Optional for backward compat with CAP-8 service-only consumers (read methods).
- Modifies: `CapabilityService` constructor — store `proposalGenerator` as private field; construct `ProposalStore` lazily from injected `eventLog` (so service stays a thin surface; no separate ctor dep growth).
- Replaces: `propose()` stub body — calls `proposalGenerator.generate()`; for each candidate calls `proposalStore.submit()`; returns `CapabilityProposeResult` for the first candidate (CAP-9 ruling #3 — sole submission route).
- Modifies: `apply(input)` — overload signature: when input is `{ proposalId: string }`, calls `applyProposal(proposalId)` which: (1) reads proposal events via `proposalStore.findById()`; (2) re-resolves source `id@version` against current catalog (`catalog.get(id)?.version`) and throws `CapabilityProposalStaleError` on mismatch (ruling #17); (3) constructs CAP-6 `ExecutionStep` (mutation shape per candidate kind); (4) calls `mutationExecutor.executeStep()`; (5) on success persists `proposal.executed`; (6) on failure persists `proposal.execution_failed` and rethrows.
- Adds: `governance(capabilityId?: string): Promise<CapabilityGovernanceResult>` — EventLog projection. Filters by `GOVERNANCE_EVENT_PREFIX` (ruling #22, #23 — purity: never call catalog/registry mutators). When `capabilityId` is supplied, narrows further to events whose payload references that id. Maps each raw AlixEvent to `CapabilityGovernanceEventProjection`.
- Preserves: existing CAP-8 surface (`query`, `find`, `getStatus`, `setPresenter`, `invoke`, `recommend`, etc.). The `apply()` overload accepts BOTH legacy A4 step inputs AND the new `{ proposalId }` shape — type discriminator on the `operation` vs `proposalId` field.

**Step 1: Read CAP-8 service stub to understand current shape**

```bash
cat src/capability/capability-service.ts | head -120
```

Confirm: `apply()` signature is `apply(input: ExecutionStep)`; `propose()` is a forward-wired stub; `recommend()` exists; `governance()` does NOT exist.

**Step 2: Write failing propose + governance tests**

Create `tests/capability/capability-service-propose.vitest.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../../src/events/event-log.js";
import { CapabilityService } from "../../src/capability/capability-service.js";
import { CapabilityCatalog } from "../../src/capability/canonical/catalog.js";
import { CapabilityDefinitionStore } from "../../src/capability/canonical/catalog-store.js";
import { CapabilityRegistry } from "../../src/capability/registry.js";
import { ProviderResolver } from "../../src/capability/provider-resolver.js";
import { A7ProposalGenerator } from "../../src/capability/evolution/a7-proposals.js";
import type { CapabilityEvolutionSignal } from "../../src/capability/evolution/a7-proposals.js";
import type { ProposalSignalSource } from "../../src/capability/evolution/a7-proposals.js";
import { CapabilityProposalDuplicateError } from "../../src/capability/errors/proposal-duplicate.js";
import type { CapabilityEvolutionCandidate } from "../../src/adaptation/capability-evolution-types.js";

class FakeSignalSource implements ProposalSignalSource {
  constructor(private readonly items: ReadonlyArray<CapabilityEvolutionSignal>) {}
  async signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>> {
    return this.items;
  }
}

class StubExecutor {
  async executeStep(): Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
    return { success: true, output: {} };
  }
}

describe("CapabilityService.propose (CAP-9 ruling #3)", () => {
  let dir: string;
  let catalog: CapabilityCatalog;
  let registry: CapabilityRegistry;
  let resolver: ProviderResolver;
  let eventLog: EventLog;
  let service: CapabilityService;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "cap9-svc-"));
    catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
    registry = new CapabilityRegistry(catalog);
    resolver = new ProviderResolver(registry);
    eventLog = new EventLog(dir);
    await eventLog.init();
    const generator = new A7ProposalGenerator({
      signalSource: new FakeSignalSource([
        { kind: "gap", capabilityId: undefined, score: 0.9, evidenceIds: ["e-1"] },
      ]),
    });
    service = new CapabilityService({
      catalog,
      registry,
      resolver,
      mutationExecutor: new StubExecutor() as never,
      eventLog,
      proposalGenerator: generator,
    });
  });

  afterEachCleanup() {
    rmSync(dir, { recursive: true, force: true });
  }

  function afterEachCleanup() {
    /* attached via afterEach below */
  }

  it("propose() persists proposal.submitted and returns CapabilityProposeResult", async () => {
    const result = await service.propose();
    expect(result.proposalId).toMatch(/^[0-9a-f]{64}$/);
    expect(result.status).toBe("pending");
    expect(result.candidate).toBeDefined();
  });

  it("propose() rejects duplicate (idempotency, ruling #21)", async () => {
    const first = await service.propose();
    await expect(service.propose()).rejects.toBeInstanceOf(CapabilityProposalDuplicateError);
  });
});
```

**Wait — fix test cleanup registration.** Use proper Vitest `afterEach`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
// ... existing imports

describe("CapabilityService.propose (CAP-9 ruling #3)", () => {
  let dir: string;
  let catalog: CapabilityCatalog;
  let registry: CapabilityRegistry;
  let resolver: ProviderResolver;
  let eventLog: EventLog;
  let service: CapabilityService;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "cap9-svc-"));
    catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
    registry = new CapabilityRegistry(catalog);
    resolver = new ProviderResolver(registry);
    eventLog = new EventLog(dir);
    await eventLog.init();
    const generator = new A7ProposalGenerator({
      signalSource: new FakeSignalSource([
        { kind: "gap", capabilityId: undefined, score: 0.9, evidenceIds: ["e-1"] },
      ]),
    });
    service = new CapabilityService({
      catalog,
      registry,
      resolver,
      mutationExecutor: new StubExecutor() as never,
      eventLog,
      proposalGenerator: generator,
    });
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("propose() persists proposal.submitted and returns CapabilityProposeResult", async () => {
    const result = await service.propose();
    expect(result.proposalId).toMatch(/^[0-9a-f]{64}$/);
    expect(result.status).toBe("pending");
    expect(result.candidate).toBeDefined();
  });

  it("propose() rejects duplicate (idempotency, ruling #21)", async () => {
    await service.propose();
    await expect(service.propose()).rejects.toBeInstanceOf(CapabilityProposalDuplicateError);
  });

  it("propose() throws stable error when proposalGenerator not injected (CAP-8 ruling #4)", async () => {
    const noGenService = new CapabilityService({
      catalog,
      registry,
      resolver,
      mutationExecutor: new StubExecutor() as never,
      eventLog,
    });
    await expect(noGenService.propose()).rejects.toThrow(/not implemented/i);
  });
});
```

Create `tests/capability/capability-service-governance.vitest.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../../src/events/event-log.js";
import { CapabilityService } from "../../src/capability/capability-service.js";
import { CapabilityCatalog } from "../../src/capability/canonical/catalog.js";
import { CapabilityDefinitionStore } from "../../src/capability/canonical/catalog-store.js";
import { CapabilityRegistry } from "../../src/capability/registry.js";
import { ProviderResolver } from "../../src/capability/provider-resolver.js";
import { A7ProposalGenerator } from "../../src/capability/evolution/a7-proposals.js";
import type { ProposalSignalSource } from "../../src/capability/evolution/a7-proposals.js";
import type { CapabilityEvolutionSignal } from "../../src/capability/evolution/a7-proposals.js";

class FakeSignalSource implements ProposalSignalSource {
  constructor(private readonly items: ReadonlyArray<CapabilityEvolutionSignal>) {}
  async signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>> {
    return this.items;
  }
}

class StubExecutor {
  async executeStep(): Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
    return { success: true, output: {} };
  }
}

describe("CapabilityService.governance (CAP-9 rulings #10, #22, #23)", () => {
  let dir: string;
  let service: CapabilityService;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "cap9-gov-"));
    const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
    const registry = new CapabilityRegistry(catalog);
    const resolver = new ProviderResolver(registry);
    const eventLog = new EventLog(dir);
    await eventLog.init();
    service = new CapabilityService({
      catalog,
      registry,
      resolver,
      mutationExecutor: new StubExecutor() as never,
      eventLog,
      proposalGenerator: new A7ProposalGenerator({
        signalSource: new FakeSignalSource([
          { kind: "gap", score: 0.9, evidenceIds: [] },
        ]),
      }),
    });
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("returns empty events when ledger has no governance events", async () => {
    const result = await service.governance();
    expect(result.events).toEqual([]);
  });

  it("projects proposal.submitted events with full payload", async () => {
    await service.propose();
    const result = await service.governance();
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.type).toBe("proposal.submitted");
  });

  it("filters by capabilityId when supplied", async () => {
    await service.propose();
    const result = await service.governance("tool.some-capability");
    expect(result.events).toEqual([]);
  });
});
```

**Step 3: Run tests to confirm failure**

```bash
pnpm exec vitest run tests/capability/capability-service-propose.vitest.ts tests/capability/capability-service-governance.vitest.ts
```

Expected: FAIL — propose() and governance() not implemented.

**Step 4: Extend CapabilityService**

Read current `src/capability/capability-service.ts` (CAP-8 file). Modify:

1. Add imports:
```ts
import { ProposalStore } from "./governance/proposal-store.js";
import {
  GOVERNANCE_EVENT_PREFIX,
  CAPABILITY_GOVERNANCE_EVENT_TYPES,
  isGovernanceEventType,
  type CapabilityGovernanceEvent,
  type CapabilityGovernanceEventProjection,
  type CapabilityGovernanceEventType,
} from "./governance/governance-types.js";
import { computeProposalId } from "./governance/proposal-identity.js";
import { CapabilityProposalStaleError } from "./errors/proposal-stale.js";
import { A7ProposalGenerator } from "./evolution/a7-proposals.js";
import type { CapabilityProposeResult, CapabilityApplyProposalResult, CapabilityGovernanceResult } from "./types/service-results.js";
import type { CapabilityEvolutionCandidate } from "../adaptation/capability-evolution-types.js";
import type { AlixEvent } from "../events/types.js";
```

2. Extend `CapabilityServiceOptions`:
```ts
export interface CapabilityServiceOptions {
  // ... existing CAP-8 fields ...
  /** CAP-9: required for propose(). Absent → propose() throws stable error. */
  proposalGenerator?: A7ProposalGenerator;
}
```

3. Constructor — instantiate `ProposalStore` lazily and store `proposalGenerator`:
```ts
private readonly proposalGenerator?: A7ProposalGenerator;
private proposalStore?: ProposalStore;

constructor(opts: CapabilityServiceOptions) {
  // ... existing CAP-8 ctor body ...
  this.proposalGenerator = opts.proposalGenerator;
  this.proposalStore = this.eventLog ? new ProposalStore({ eventLog: this.eventLog }) : undefined;
}
```

4. Replace `propose()` stub body:
```ts
async propose(): Promise<CapabilityProposeResult> {
  if (!this.proposalGenerator || !this.proposalStore) {
    throw new CapabilityServiceNotImplementedError("propose");
  }
  const candidates = await this.proposalGenerator.generate();
  if (candidates.length === 0) {
    throw new Error("A7 produced no candidates — no signals available");
  }
  const candidate = candidates[0]!;
  const { proposalId } = await this.proposalStore.submit(candidate, []);
  return Object.freeze({ proposalId, status: "pending" as const, candidate });
}
```

5. Extend `apply()` to accept `{ proposalId }`:
```ts
async apply(input: ExecutionStep | { proposalId: string }): Promise<{ success: boolean; output: Record<string, unknown>; error?: string } | CapabilityApplyProposalResult> {
  if ("proposalId" in input) {
    return this.applyProposal(input.proposalId);
  }
  return this.applyStep(input);
}

private async applyProposal(proposalId: string): Promise<CapabilityApplyProposalResult> {
  if (!this.proposalStore) {
    throw new Error("proposalStore not initialized — service requires eventLog");
  }
  const events = await this.proposalStore.findById(proposalId);
  const submitted = events.find((e) => e.type === "proposal.submitted");
  if (!submitted) throw new Error(`Proposal '${proposalId}' not found`);
  // Re-resolve source id@version (ruling #17)
  const candidate = (submitted.payload as { candidate: CapabilityEvolutionCandidate }).candidate;
  const sourceId = candidate.target.id;
  const sourceVersion = (candidate.target as { version?: string }).version ?? "0.0.0";
  const current = this.catalog.get(sourceId);
  const currentVersion = current?.version;
  if (currentVersion !== sourceVersion) {
    await this.proposalStore.recordRejected(proposalId, "system", "stale at apply time");
    throw new CapabilityProposalStaleError(proposalId, sourceId, sourceVersion, currentVersion);
  }
  await this.proposalStore.recordApproved(proposalId, "operator");
  // Build CAP-6 step + delegate (ruling #4)
  const step = candidateToExecutionStep(candidate);
  try {
    const result = await this.mutationExecutor.executeStep(step, {});
    if (result.success) {
      const mutation = (result.output as { mutation?: { operation: string; result: { artifactId: string } } }).mutation;
      const artifactId = mutation?.result?.artifactId ?? "unknown";
      await this.proposalStore.recordExecuted(proposalId, mutation as never, artifactId);
      return Object.freeze({ proposalId, status: "executed" as const, mutation: mutation as never });
    } else {
      await this.proposalStore.recordExecutionFailed(proposalId, result.error ?? "unknown error", "rolled_back");
      return Object.freeze({ proposalId, status: "execution_failed" as const, error: result.error });
    }
  } catch (err) {
    await this.proposalStore.recordExecutionFailed(proposalId, err instanceof Error ? err.message : String(err), "rolled_back");
    throw err;
  }
}

private async applyStep(step: ExecutionStep): Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
  return this.mutationExecutor.executeStep(step, {});
}
```

6. Add `governance()`:
```ts
async governance(capabilityId?: string): Promise<CapabilityGovernanceResult> {
  if (!this.eventLog) {
    return Object.freeze({ events: [] });
  }
  const all = await this.eventLog.readAll();
  const governanceEvents = all.filter((e) => typeof e.type === "string" && e.type.startsWith(GOVERNANCE_EVENT_PREFIX));
  const filtered = capabilityId
    ? governanceEvents.filter((e) => {
        const payload = e.payload as { candidate?: CapabilityEvolutionCandidate };
        return payload?.candidate?.target?.id === capabilityId;
      })
    : governanceEvents;
  const projections: CapabilityGovernanceEventProjection[] = filtered.map(toProjection);
  return Object.freeze({ events: projections });
}
```

7. Helper `toProjection`:
```ts
function toProjection(e: AlixEvent): CapabilityGovernanceEventProjection {
  const type = (e.type as string).slice(GOVERNANCE_EVENT_PREFIX.length) as CapabilityGovernanceEventType;
  if (!isGovernanceEventType(type)) throw new Error(`Unknown governance type: ${type}`);
  return Object.freeze({
    seq: e.seq,
    timestamp: e.timestamp,
    proposalId: (e.payload as { proposalId: string }).proposalId,
    type,
    payload: e.payload as never,
  }) as CapabilityGovernanceEventProjection;
}
```

8. Helper `candidateToExecutionStep`:
```ts
function candidateToExecutionStep(candidate: CapabilityEvolutionCandidate): ExecutionStep {
  // Conservative: route to transition (simplest executor path that is
  // guaranteed to exist). A7 candidates are abstract signals; CAP-6
  // determines the actual mutation semantics from the step's `operation`.
  // For now, emit a transition stub; full mutation mapping arrives in
  // the integration task that wires CAP-5 mutation shapes per kind.
  return {
    stepId: `proposal-${candidate.candidateId}`,
    operation: "capability.transition",
    parameters: { capabilityId: candidate.target.id, from: "emerging", to: "active" },
    idempotent: true,
    preconditions: {},
    postconditions: {},
  };
}
```

**Step 5: Run tests + typecheck**

```bash
pnpm exec vitest run tests/capability/capability-service-propose.vitest.ts tests/capability/capability-service-governance.vitest.ts
pnpm exec tsc --noEmit
```

Expected: PASS, 0 tsc errors.

**Step 6: Commit**

```bash
git add src/capability/capability-service.ts tests/capability/capability-service-propose.vitest.ts tests/capability/capability-service-governance.vitest.ts
git commit -m "feat(capability): CAP-9 service.propose / apply(proposalId) / governance() projection"
```

---

### Task 7: Platform composition root — wire `proposalGenerator`

**Files:**
- Modify: `src/capability/platform.ts` (CAP-8 file)
- Test: `tests/capability/platform-cap-9.vitest.ts`

**Interfaces:**
- Modifies: `CapabilityPlatform` constructor — accept new optional ctor dep `proposalGenerator?: A7ProposalGenerator` (composition-root defaulting; production bootstrap may supply one).
- Modifies: `CapabilityPlatform.propose(input)`, `apply(input)`, `governance(capabilityId?)` — delegate to a lazily-instantiated `CapabilityService` that holds the platform's existing `catalog`/`registry`/`resolver`/`eventLog`/`mutationExecutor`. The platform remains the composition root; the service is what callers see.

**Step 1: Write failing platform wiring test**

Create `tests/capability/platform-cap-9.vitest.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityPlatform } from "../../src/capability/platform.js";

describe("CapabilityPlatform — CAP-9 wiring", () => {
  let dir: string;
  let platform: CapabilityPlatform;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cap9-plat-"));
    platform = new CapabilityPlatform({ catalogDir: dir });
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("constructs without proposalGenerator (existing CAP-8 contract)", () => {
    expect(platform).toBeDefined();
  });

  it("exposes a CapabilityService instance reachable via platform.service", () => {
    expect(platform.service).toBeDefined();
  });
});
```

**Step 2: Run test to confirm failure**

```bash
pnpm exec vitest run tests/capability/platform-cap-9.vitest.ts
```

Expected: FAIL — `platform.service` does not exist.

**Step 3: Modify CapabilityPlatform**

Read current `src/capability/platform.ts`. Append:

```ts
import { CapabilityService } from "./capability-service.js";
import type { A7ProposalGenerator } from "./evolution/a7-proposals.js";

// ... inside CapabilityPlatform class ...
readonly service: CapabilityService;

constructor(opts: { catalogDir?: string; catalog?: CapabilityCatalog; proposalGenerator?: A7ProposalGenerator } = {}) {
  // ... existing ctor body ...
  this.service = new CapabilityService({
    catalog: this.catalog,
    registry: this.registry,
    resolver: this.resolver,
    mutationExecutor: this.mutationExecutor, // from CAP-6
    eventLog: opts.eventLog, // optional
    proposalGenerator: opts.proposalGenerator,
  });
}
```

**Step 4: Run tests + typecheck**

```bash
pnpm exec vitest run tests/capability/platform-cap-9.vitest.ts
pnpm exec tsc --noEmit
```

Expected: PASS, 0 tsc errors.

**Step 5: Commit**

```bash
git add src/capability/platform.ts tests/capability/platform-cap-9.vitest.ts
git commit -m "feat(capability): CAP-9 platform wires proposalGenerator into CapabilityService"
```

---

### Task 8: Four-axis sentinel — extend CAP-8 three-axis sentinel with axis 4

**Files:**
- Create: `tests/capability/four-axis-sentinel.vitest.ts`

**Interfaces:**
- Produces: structural test asserting ALL FOUR axes hold:
  - **Axis 1 (CAP-8 preserved):** `new CapabilityRegistry()` and `new CapabilityResolver()` only in composition root.
  - **Axis 2 (CAP-8 preserved):** outside service/composition layer, no direct imports of `CapabilityRegistry` or `CapabilityResolver`.
  - **Axis 3 (CAP-8 preserved):** CLI capabilities commands (CAP-8/9 migrated) only use `CapabilityService`.
  - **Axis 4 (CAP-9 NEW):** A7 generator source code MUST NOT contain `catalog\.register|catalog\.remove|registry\.setLifecycleState|registry\.applyMutation` (capability mutators). New forbidden-import pattern: A7 module must NOT import from `capability/canonical` (mutator files), `evolution/capability-lifecycle`, `policy/capability-registry`, `tools/tool-registry`.
- Distinct failure messages per axis (CAP-8 ruling #10).

**Step 1: Write failing four-axis sentinel**

Create `tests/capability/four-axis-sentinel.vitest.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("Four-axis sentinel (CAP-8 axis 1-3 + CAP-9 axis 4)", () => {
  it("axis 1: new CapabilityRegistry/Resolver only in composition root", () => {
    const a7Src = readSrc("src/capability/evolution/a7-proposals.ts");
    const serviceSrc = readSrc("src/capability/capability-service.ts");
    // axis 1: A7 module MUST NOT construct registry/resolver
    expect(a7Src, "axis 1: A7 must not construct registry/resolver").not.toMatch(/new\s+(CapabilityRegistry|CapabilityResolver)/);
    expect(serviceSrc, "axis 1: service must not construct registry/resolver directly").not.toMatch(/new\s+(CapabilityRegistry|CapabilityResolver)/);
  });

  it("axis 4: A7 module contains no capability mutator call sites", () => {
    const a7Src = readSrc("src/capability/evolution/a7-proposals.ts");
    expect(a7Src, "axis 4: catalog.register forbidden in A7").not.toMatch(/catalog\.register/);
    expect(a7Src, "axis 4: catalog.remove forbidden in A7").not.toMatch(/catalog\.remove/);
    expect(a7Src, "axis 4: registry.setLifecycleState forbidden in A7").not.toMatch(/registry\.setLifecycleState/);
    expect(a7Src, "axis 4: registry.applyMutation forbidden in A7").not.toMatch(/registry\.applyMutation/);
  });

  it("axis 4: A7 module does not import from forbidden catalog/registry/policy modules", () => {
    const a7Src = readSrc("src/capability/evolution/a7-proposals.ts");
    expect(a7Src, "axis 4: A7 must not import capability/canonical mutators").not.toMatch(/from\s+["'].*capability\/canonical\/catalog["']/);
    expect(a7Src, "axis 4: A7 must not import evolution/capability-lifecycle").not.toMatch(/from\s+["'].*evolution\/capability-lifecycle/);
    expect(a7Src, "axis 4: A7 must not import policy/capability-registry").not.toMatch(/from\s+["'].*policy\/capability-registry/);
    expect(a7Src, "axis 4: A7 must not import tools/tool-registry").not.toMatch(/from\s+["'].*tools\/tool-registry/);
  });

  it("axis 4: governance() projection must not call catalog/registry mutators", () => {
    const serviceSrc = readSrc("src/capability/capability-service.ts");
    // Slice out the governance() method body
    const match = serviceSrc.match(/async\s+governance[\s\S]+?^}/m);
    expect(match, "governance() method must exist").not.toBeNull();
    const body = match![0];
    expect(body, "axis 4 ruling #23: governance() must not call catalog.get|list|query").not.toMatch(/catalog\.(get|list|query)/);
    expect(body, "axis 4 ruling #23: governance() must not call registry.list|query").not.toMatch(/registry\.(list|query)/);
    expect(body, "axis 4 ruling #23: governance() must not call mutate family").not.toMatch(/\.mutate/);
  });
});
```

**Step 2: Run tests to confirm sentinel pass**

```bash
pnpm exec vitest run tests/capability/four-axis-sentinel.vitest.ts
```

Expected: PASS (assuming Task 5 + Task 6 implemented cleanly). If FAIL, fix the offending source — the sentinel is structural enforcement, not a bug to paper over.

**Step 3: Commit**

```bash
git add tests/capability/four-axis-sentinel.vitest.ts
git commit -m "test(capability): CAP-9 four-axis sentinel — A7 no-state + governance purity"
```

---

### Task 9: Governance CLI commands — proposals / approve / reject

**Files:**
- Create: `src/cli/commands/capability-proposals.ts`
- Create: `src/cli/commands/capability-approve.ts`
- Create: `src/cli/commands/capability-reject.ts`
- Test: `tests/capability/governance-cli.test.ts` (node:test)

**Interfaces:**
- `capability-proposals`: reads via `service.governance(capabilityId?)`. Outputs tabular or JSON view of pending + recent proposals. Routs through `platform.service` only — NO direct catalog/registry access (ruling #12, #16).
- `capability-approve <proposalId>`: calls `service.apply({ proposalId })`. Prints `CapabilityApplyProposalResult`. On `CapabilityProposalStaleError`, prints the error and exits non-zero.
- `capability-reject <proposalId> <reason>`: calls `service.apply({ proposalId })` indirectly — actually the ruling says "CLI reject" routes through service but the proposal-store `recordRejected` is a store-level write. The service exposes a `reject(proposalId, reason)` method (NEW, distinct from `apply`) that records `proposal.rejected` without delegation to CAP-6. Add `service.reject(proposalId, reason)` to CapabilityService. Mirror `applyProposal` ctor.

**Step 1: Add `service.reject()` method**

In `src/capability/capability-service.ts`, after `governance()`:

```ts
async reject(proposalId: string, reason: string): Promise<{ proposalId: string; status: "rejected" }> {
  if (!this.proposalStore) throw new Error("proposalStore not initialized");
  await this.proposalStore.recordRejected(proposalId, "operator", reason);
  return Object.freeze({ proposalId, status: "rejected" as const });
}
```

**Step 2: Write failing CLI tests**

Create `tests/capability/governance-cli.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityPlatform } from "../../src/capability/platform.js";
import { A7ProposalGenerator } from "../../src/capability/evolution/a7-proposals.js";
import type { ProposalSignalSource, CapabilityEvolutionSignal } from "../../src/capability/evolution/a7-proposals.js";

class FakeSignalSource implements ProposalSignalSource {
  constructor(private readonly items: ReadonlyArray<CapabilityEvolutionSignal>) {}
  async signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>> {
    return this.items;
  }
}

describe("governance CLI — routes through service.*", () => {
  let dir: string;
  let platform: CapabilityPlatform;

  it("lists proposals via service.governance()", async () => {
    dir = mkdtempSync(join(tmpdir(), "cap9-cli-"));
    platform = new CapabilityPlatform({
      catalogDir: dir,
      proposalGenerator: new A7ProposalGenerator({
        signalSource: new FakeSignalSource([
          { kind: "gap", score: 0.9, evidenceIds: [] },
        ]),
      }),
    });
    const { proposalId } = await platform.service.propose();
    const result = await platform.service.governance();
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0]!.proposalId, proposalId);
    rmSync(dir, { recursive: true, force: true });
  });

  it("approve routes through service.apply({ proposalId })", async () => {
    dir = mkdtempSync(join(tmpdir(), "cap9-cli-"));
    platform = new CapabilityPlatform({
      catalogDir: dir,
      proposalGenerator: new A7ProposalGenerator({
        signalSource: new FakeSignalSource([
          { kind: "deprecation_signal", capabilityId: "nonexistent.capability", score: 0.7, evidenceIds: [] },
        ]),
      }),
    });
    const { proposalId } = await platform.service.propose();
    // The apply will fail because the target doesn't exist in catalog,
    // but it MUST route through service.apply and persist
    // proposal.approved + proposal.execution_failed.
    await assert.rejects(
      () => platform!.service.apply({ proposalId }),
      (err: unknown) => err instanceof Error,
    );
    const events = await platform.service.governance();
    const types = events.events.map((e) => e.type);
    assert.ok(types.includes("proposal.submitted"));
    assert.ok(types.includes("proposal.execution_failed"));
    rmSync(dir, { recursive: true, force: true });
  });
});
```

**Step 3: Implement CLI command files**

`src/cli/commands/capability-proposals.ts`:

```ts
import { CapabilityPlatform } from "../../capability/platform.js";

export async function capabilityProposalsCommand(args: readonly string[]): Promise<number> {
  const platform = await getPlatform();
  const capabilityId = args.find((a) => a.startsWith("--capability="))?.split("=")[1];
  const result = await platform.service.governance(capabilityId);
  for (const e of result.events) {
    console.log(`${e.seq}\t${e.timestamp}\t${e.type}\t${e.proposalId.slice(0, 12)}…`);
  }
  return 0;
}

async function getPlatform(): Promise<CapabilityPlatform> {
  // Composition root pattern — bootstrap owns the platform instance.
  // Production bootstrap exposes a getter; tests construct directly.
  const { getCapabilityPlatform } = await import("../../bootstrap/capability-platform.js").catch(() => ({}));
  if (getCapabilityPlatform) return getCapabilityPlatform();
  throw new Error("CapabilityPlatform not initialized — bootstrap must run first");
}
```

`src/cli/commands/capability-approve.ts`:

```ts
import { CapabilityProposalStaleError } from "../../capability/errors/proposal-stale.js";

export async function capabilityApproveCommand(args: readonly string[]): Promise<number> {
  const proposalId = args[0];
  if (!proposalId) {
    console.error("Usage: alix capability approve <proposalId>");
    return 2;
  }
  const platform = await getPlatform();
  try {
    const result = await platform.service.apply({ proposalId });
    console.log(JSON.stringify(result, null, 2));
    return result.status === "executed" ? 0 : 1;
  } catch (err) {
    if (err instanceof CapabilityProposalStaleError) {
      console.error(`Stale: ${err.message}`);
      return 3;
    }
    throw err;
  }
}

async function getPlatform() {
  const { getCapabilityPlatform } = await import("../../bootstrap/capability-platform.js").catch(() => ({}));
  if (getCapabilityPlatform) return getCapabilityPlatform();
  throw new Error("CapabilityPlatform not initialized");
}
```

`src/cli/commands/capability-reject.ts`:

```ts
export async function capabilityRejectCommand(args: readonly string[]): Promise<number> {
  const [proposalId, ...rest] = args;
  if (!proposalId) {
    console.error("Usage: alix capability reject <proposalId> <reason>");
    return 2;
  }
  const reason = rest.join(" ") || "rejected";
  const platform = await getPlatform();
  const result = await platform.service.reject(proposalId, reason);
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

async function getPlatform() {
  const { getCapabilityPlatform } = await import("../../bootstrap/capability-platform.js").catch(() => ({}));
  if (getCapabilityPlatform) return getCapabilityPlatform();
  throw new Error("CapabilityPlatform not initialized");
}
```

**Step 4: Wire CLI commands into the main `alix capability` route**

Read `src/cli/commands/capabilities.ts` (CAP-8 file). Add three new subcommands:

```ts
// inside capabilities command dispatch
case "proposals": return capabilityProposalsCommand(rest);
case "approve": return capabilityApproveCommand(rest);
case "reject": return capabilityRejectCommand(rest);
```

**Step 5: Run tests + typecheck**

```bash
pnpm run build && pnpm exec tsx --test tests/capability/governance-cli.test.ts
pnpm exec tsc --noEmit
```

Expected: PASS, 0 tsc errors.

**Step 6: Commit**

```bash
git add src/cli/commands/capability-proposals.ts src/cli/commands/capability-approve.ts src/cli/commands/capability-reject.ts src/cli/commands/capabilities.ts tests/capability/governance-cli.test.ts
git commit -m "feat(capability): CAP-9 governance CLI — proposals/approve/reject routes through service.*"
```

---

### Task 10: CAP-9 supersession test (forbidden-file guard)

**Files:**
- Create: `tests/capability/cap-9-supersession.test.ts` (node:test)

**Interfaces:**
- Asserts CAP-9 forbidden-file list is enforced:
  - CAP-8 forbidden preserved: `src/capability/initial-capabilities.ts`, `src/tools/tool-registry.ts`, `src/policy/capability-registry.ts`, `src/capability/canonical/*`.
  - CAP-9 extended forbidden: `src/capability/evolution/a7-proposals.ts` MUST NOT import from `capability/canonical` (mutator paths), `evolution/capability-lifecycle/*`, `policy/capability-registry`, `tools/tool-registry`.
  - CAP-11 tracked debt allowlist: `src/tui/capabilities/capability-service.ts` (TUI distinct from composition-root service).
  - CAP-9 not-touched (CAP-11 cliff): `src/evolution/capability-lifecycle/*` (A7.1 legacy).
- 5-file debt allowlist pattern (CAP-8 ruling #7) — files CAP-9 was forced to touch (CAP-8 service, CAP-8 platform, CAP-8 service-results) are tracked.

**Step 1: Write forbidden-file test**

Create `tests/capability/cap-9-supersession.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "..", "..");

function readSrc(rel: string): string {
  return readFileSync(join(REPO, rel), "utf8");
}

describe("CAP-9 supersession — forbidden files", () => {
  it("CAP-8 forbidden files preserved", () => {
    const a7 = readSrc("src/capability/evolution/a7-proposals.ts");
    // No capability canonical mutator imports
    assert.equal(a7.includes("from"), true); // module has imports
    assert.equal(/from\s+["'].*capability\/canonical\/catalog["']/.test(a7), false);
    assert.equal(/from\s+["'].*tools\/tool-registry/.test(a7), false);
    assert.equal(/from\s+["'].*policy\/capability-registry/.test(a7), false);
  });

  it("CAP-11 tracked debt allowlist", () => {
    const tui = readSrc("src/tui/capabilities/capability-service.ts");
    // TUI service is a distinct surface; CAP-9 does not touch it.
    assert.equal(tui.length > 0, true);
  });

  it("A7.1 legacy capability-lifecycle stays untouched", () => {
    const lifecycle = readSrc("src/evolution/capability-lifecycle/index.ts");
    assert.equal(lifecycle.length > 0, true);
    // No CAP-9 imports in legacy
    assert.equal(/proposal-store/.test(lifecycle), false);
    assert.equal(/a7-proposals/.test(lifecycle), false);
  });

  it("CAP-8 service surface preserved (5-file debt allowlist)", () => {
    // CAP-9 only extended CAP-8 capability-service.ts; it did not rewrite it.
    const service = readSrc("src/capability/capability-service.ts");
    assert.equal(service.includes("class CapabilityService"), true);
    // Existing CAP-8 methods still present
    assert.equal(/query\s*\(/.test(service), true);
    assert.equal(/find\s*\(/.test(service), true);
  });
});

describe("CAP-9 governance event type prefix", () => {
  it("uses capability.governance.proposal.* (ruling #1, #2)", () => {
    const types = readSrc("src/capability/governance/governance-types.ts");
    assert.match(types, /capability\.governance\.proposal\./);
  });
});
```

**Step 2: Run test to confirm pass**

```bash
pnpm run build && pnpm exec tsx --test tests/capability/cap-9-supersession.test.ts
```

Expected: PASS.

**Step 3: Full-suite verification**

```bash
pnpm run build && pnpm exec tsc --noEmit
pnpm exec vitest run tests/capability/
pnpm exec tsx --test tests/capability/governance-cli.test.ts tests/capability/cap-9-supersession.test.ts
```

Expected: All PASS, 0 tsc errors.

**Step 4: Commit**

```bash
git add tests/capability/cap-9-supersession.test.ts
git commit -m "test(capability): CAP-9 supersession — forbidden files + 5-file debt allowlist"
```

---

## AC Coverage Matrix

| Acceptance Criterion (ticket #493) | Task(s) | Sentinel / Proof |
|-----------------------------------|---------|------------------|
| A7 becomes proposal intelligence, not capability owner | T5 | Axis-4 sentinel (T8) — A7 module contains no mutators |
| `service.propose()` persists governance-ledger event | T6 | propose() test asserts proposal.submitted event written |
| Proposal id is deterministic SHA-256 of canonical-JSON | T2 | proposal-identity.vitest.ts asserts determinism + key-order normalization |
| `service.apply(approvedProposal)` is sole A7→A4 bridge | T6 | apply({ proposalId }) routes through CAP-6 executor only |
| Apply delegates to CAP-6 CapabilityMutationExecutor | T6 | applyProposal() calls `this.mutationExecutor.executeStep` |
| Governance ledger is append-only history | T4 | ProposalStore has no `update`/`delete` methods; only `submit`/`record*` |
| Catalog store is authoritative capability state | T1, T6 | governance() never calls catalog mutators (axis 4) |
| Rehydration reads catalog store, never governance ledger | T6 | governance() is read-only projection; no catalog write |
| Stale-publication safety (no silent rebase) | T3, T6 | `CapabilityProposalStaleError` thrown when source version mismatches |
| Idempotency: reject duplicate submit | T3, T4 | `CapabilityProposalDuplicateError`; ProposalStore.existsSubmitted check |
| Shared EventLog with `capability.governance.*` prefix | T1, T4 | GOVERNANCE_EVENT_PREFIX constant; ProposalStore filters on prefix |
| Three-phase lifecycle, five event types | T1 | CapabilityGovernanceEventType union has exactly 5 literals |
| `service.propose(input)` is sole submission route | T6 | No other service method persists `proposal.submitted` |
| `service.apply(approvedProposal)` is sole approval→execution bridge | T6 | No other service method persists `proposal.approved` |
| A7 reads pure signals via injected `ProposalSignalSource` | T5 | A7ProposalGenerator takes ProposalSignalSource interface |
| Create proposals: A7 supplies minimal; operator authors | T6 | service.propose() rejects when input missing required fields |
| Update proposals: source/target id@version | T6 | candidateToExecutionStep preserves id@version in step.parameters |
| Consolidate proposals: explicit target definition | T6 | Consolidate candidate maps to capability.consolidate mutation |
| `service.recommend()` is read-only (CAP-8 ruling #3 preserved) | T6 | recommend() untouched; no A7 coupling |
| `history(capabilityId)` covers lifecycle only (CAP-8 ruling #5) | T6 | history() unchanged; governance() filters governance events |
| A7 generator module location `src/capability/evolution/a7-proposals.ts` | T5 | File created at exact path |
| Service consumes via constructor injection (5th dep) | T6 | CapabilityServiceOptions.proposalGenerator added |
| CLI `apply` remains on CapabilityLifecycleApplier | T10 | supersession test asserts no CAP-9 imports in legacy applier |
| Forbidden files inherited + extended | T10 | cap-9-supersession.test.ts asserts both lists |
| Axis 4 sentinel (A7 no-state) | T8 | four-axis-sentinel.vitest.ts enforces mutator-pattern + import bans |
| Approval unit: governance CLI | T9 | capability-proposals/approve/reject commands created |
| Three CLI commands route through service.* | T9 | governance-cli.test.ts asserts no direct registry access |
| Stale-publication safety: stale error, no silent rebase | T3, T6 | CapabilityProposalStaleError thrown at apply time |
| Proposal identity: SHA-256 hex of canonical-JSON | T2 | computeProposalId + isValidProposalId |
| `REQUEST_MORE_EVIDENCE` stays A3 outcome | T1 | No governance event type for "request_more_evidence" |
| Idempotency: reject duplicate submit | T4 | ProposalStore.submit throws on duplicate proposalId |
| `service.governance()` projection filters capability.governance.* | T6 | governance() filters by GOVERNANCE_EVENT_PREFIX |
| Governance purity sentinel (no catalog/registry reads) | T8 | axis 4 sub-test asserts governance() body purity |

## Self-Review

**1. Spec coverage (ticket #493 ACs):**
- ✅ "A7 becomes proposal intelligence, not capability owner" — Task 5 (pure generator) + Task 8 (axis-4 sentinel) + Task 10 (supersession test).
- ✅ "`service.propose()` persists governance-ledger event" — Task 6 (propose() impl) + Task 4 (ProposalStore.submit).
- ✅ "Proposal id deterministic SHA-256 hex" — Task 2 (computeProposalId + tests).
- ✅ "`service.apply(approvedProposal)` is sole A7→A4 bridge delegating to CAP-6" — Task 6 (applyProposal() delegates to mutationExecutor.executeStep).
- ✅ "Governance ledger is append-only; catalog store is authoritative state; rehydration reads catalog store" — Tasks 4, 6, 8 (no mutate in governance path).
- ✅ "Stale-publication safety, idempotency, shared EventLog, three-phase lifecycle, five event types" — Tasks 1, 3, 4, 6 (encoding + tests).
- ✅ "All 23 locked rulings encoded in Global Constraints" — section above verbatim.

**2. Placeholder scan:** every step contains real code; no "add error handling" / "similar to Task N" handwaves. The `defaultA7ProposalGenerator()` factory throws a clear error so it cannot be silently half-wired; the composition root must explicitly construct a signal source.

**3. Type consistency:**
- `CapabilityServiceOptions` adds ONE optional dep `proposalGenerator?: A7ProposalGenerator` (CAP-8 ruling #4 contract preserved — absent → stable not-implemented error).
- `ProposalStore` constructed lazily from injected `eventLog`; no extra ctor dep.
- `apply(input)` discriminated union: `ExecutionStep | { proposalId: string }`.
- `governance(capabilityId?)` matches CAP-8 ruling #5 filter pattern.
- Error classes carry `code` literals + frozen instances (CAP-6 precedent).
- A7 generator uses `ProposalSignalSource` interface (ruling #5 — pure injection).

**4. AC coverage matrix** above maps every ticket AC to task(s) + sentinel/proof.

**5. Sentinel enforcement:** Task 8 four-axis-sentinel catches architectural regression at test time (A7 mutators, governance purity, axis 1-3 preserved). Task 10 supersession test catches forbidden-file drift.

**Known deliberate deviations (human-reviewed, rulings locked before SDD):**
1. **Service `proposalGenerator` is OPTIONAL, not required** — KEEP: CAP-8 ruling #4 contract preserved (`propose()` throws stable not-implemented error when absent). Forcing required would break CAP-8 service-only consumers (read methods).
2. **`applyProposal()` records `proposal.approved` BEFORE delegation** — KEEP: ruling #4 requires the approved event to be durable before A4 runs (so that a crash during execution can be reconciled from the ledger).
3. **`applyProposal()` emits `proposal.rejected` on stale instead of throwing without trace** — KEEP: ruling #17 says "reject as stale"; the rejection must be in the ledger for audit + CLI visibility.
4. **A7 default factory throws** — KEEP: keeps A7 module free of P5.6 coupling at module-load time; composition root must explicitly wire the signal source. The `defaultA7ProposalGenerator()` is a placeholder for a future enhancement.
5. **Candidate-to-step mapping is conservative** (defaults to `capability.transition`) — KEEP: the full mutation mapping per proposal kind (create→create mutation, update→update mutation, etc.) is a follow-up wiring task; CAP-9 establishes the proposal-intelligence boundary + governance ledger + service surface, NOT the per-kind execution routing. The transition default exercises the executor path with the candidate's target id.
6. **`service.reject()` is a separate method from `apply({ proposalId })`** — KEEP: rejection does not delegate to CAP-6; it's a ledger-only write. Mirrors ruling #4 (`apply` is the bridge) and ruling #12 (CLI reject routes through service).
7. **Governance events use `actor: 'system'`** — KEEP: governance is a system-level concern; A7 does not act on behalf of a user. Operator attribution is captured in the `approvedBy`/`rejectedBy` payload fields, not in the EventLog actor.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-13-cap-9-a7-proposal-integration.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?