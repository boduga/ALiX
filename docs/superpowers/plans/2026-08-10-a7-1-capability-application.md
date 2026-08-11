# A7.1 — Capability Lifecycle Application (Apply → Measure) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an approved A7.0 lifecycle transition **true** — bind to the A4 governed execution path, mutate the M-series registry's lifecycle overlay, and measure the outcome, closing the A7 loop.

**Architecture:** The applier is an **A4 binding**, not a gate-then-mutate bespoke executor. It rehydrates the authoritative proposal + full `GovernanceDecision` from the lifecycle ledger's `decided` record, runs A4's pure `authorizeExecution` gate, builds an A4 `ExecutionPlan` (via `createExecutionPlan`, whose `resolveSteps` maps a `changes` array to steps), and drives it through A4's `GovernedExecutionRuntime` with an injected `CapabilityLifecycleStepExecutor`. The executor mutates the registry's lifecycle overlay. A bounded compensating rollback (`executor.rollbackApplied()`) restores pre-state if the `applied` ledger append fails after the runtime has already completed. `measure <id>` produces A5 post-application observation evidence against the pre-application baseline.

**Tech Stack:** TypeScript (strict, ESM), Node 24 `node --test`, existing A4/A5/A7 modules.

## Global Constraints

- **One physical executor operation:** `capability.transition` (`parameters: { capabilityId, to: LifecycleState }`). `promote`/`deprecate` are single transitions; `consolidate` is a **deprecatory consolidation** — a plan of N `capability.transition` steps (one per `relatedCapabilityId` → `deprecated`), preserving the primary. **`register`/`modify` are NOT executable in A7.1** (deferred; applying them → error, exit 1, no mutation, no ledger write).
- **A4 binding:** the applier calls `authorizeExecution` (7 checks), `createExecutionPlan`, and `GovernedExecutionRuntime.execute` with an injected step executor. It does **not** mutate the registry directly.
- **Atomicity:** the `applied` ledger append is the **commit point**. If the append fails **after** the runtime returned `completed`, `executor.rollbackApplied()` restores pre-state (idempotent). A4's in-plan rollback handles mid-plan step failure; the two never fight.
- **Pre-state snapshot** is captured **immediately before execution** and **never recalculated during rollback** — otherwise rollback could restore a later state.
- **Rehydration is authoritative:** the applier uses the **full persisted `GovernanceDecision`** from the `decided` record, and a full `EvolutionProposal`-shaped projection (`toExecutionProposal`) — **no reduced synthesis for authorization**. `EvolutionProposal` is a closed interface (no `changes` field); the `changes` array lives on an explicit `CapabilityExecutionProposal` superset projection.
- **Authority:** the **A7 ledger is authoritative for lifecycle history and governed transition state**; the **M-series `CapabilityRegistry` is authoritative for current runtime capability state**. The registry lifecycle overlay (in-memory) is a runtime projection rehydrated from the ledger after restart.
- **Measurement:** `measure` produces the inputs (pre-application baseline + post-application observation, both referenced on the `measured` record); A5's existing contract judges effectiveness. A7.1 **never re-analyzes** capability health.
- **Registry is current-state authority:** `applyLifecycleTransition(id, to)` throws on unknown id; `register`/`unregister` maintain the overlay map.
- **`EvolutionProposal.beforeHash`/`afterHash` are `string | null`** — the A7 execution projection emits `null`.
- **Module:** `src/evolution/capability-lifecycle/`; tests: `tests/evolution/capability-lifecycle/`.
- **Node 24 test glob form:** `node --test dist/tests/evolution/capability-lifecycle/**/*.test.js`. Build: `pnpm build` (tsc → dist/). A full-suite run needs bash globstar (`shopt -s globstar`) or explicit suites.
- **GitNexus:** run `impact()` before editing a symbol; `detect_changes()` before commit; warn on HIGH/CRITICAL risk.

---

## Task 1: Contract Verification (no code) — ground every A4/A5/A7 signature

**Files:** none created; this task verifies contracts against shipped source and records findings in the ledger.

**Interfaces:**
- Consumes (read-only, must verify exact shapes): `authorizeExecution` (`src/evolution/execution/execution-authorization.ts`), `createExecutionPlan` + `resolveSteps` + `DefaultRollbackResolver` + `createDefaultRollbackResolver` (`src/evolution/execution/execution-planner.ts`), `GovernedExecutionRuntime` + `StepExecutor` (`src/evolution/execution/execution-runtime.ts`), `ExecutionRequest` (`src/evolution/execution/contracts/execution-request.ts`), `CapabilityRegistry` (`src/capability/registry.ts`), `GovernanceDecision` (`src/evolution/governance/contracts/decision-contract.ts`), `JsonlCapabilityLifecycleLedger` + `CapabilityLifecycleLedger` (`src/evolution/capability-lifecycle/capability-lifecycle-ledger.ts`), `toLedgerRecord` (`src/evolution/capability-lifecycle/capability-governance-bridge.ts`), `buildObservationEvidence` (`src/evolution/observation/observation-evidence-bridge.ts`), `CapabilityEvolutionStore` (`src/adaptation/capability-evolution-store.ts`), `canonicalStringify` (`src/security/audit/canonical-json.ts`).
- Produces: no artifacts; a verified contract inventory in the task report + ledger carry-forward for Tasks 2–9.

- [ ] **Step 1: Read the four A4 surfaces and record exact signatures**

Read and record exact signatures for:
- `authorizeExecution(input: AuthorizeInput, config?: AuthorizationConfig): ExecutionAuthorizationResult` where `AuthorizeInput = { request: ExecutionRequest; proposal: EvolutionProposal; decision: GovernanceDecision | undefined; completedExecutionIds?: string[]; now?: number }`.
- `createExecutionPlan(proposal: EvolutionProposal, decision: GovernanceDecision, environment: ExecutionEnvironment, resolver: RollbackResolver, config?: PlannerConfig): ExecutionPlan` — note `resolveSteps` maps `proposal.changes` (duck-typed `"changes" in proposal`) to steps; a closed `EvolutionProposal` yields a generic `apply_proposal` fallback step.
- `GovernedExecutionRuntime.execute(plan: ExecutionPlan, executor: StepExecutor): Promise<ExecutionReport>` — returns a report, **no post-completion rollback handle**; `StepExecutor.executeStep(step, context)` returns `{ success, output, error? }`.
- `DefaultRollbackResolver.registerOperation(operation, resolver)` and `createDefaultRollbackResolver()`.

- [ ] **Step 2: Verify the registry + ledger + decision shapes**

Record: `CapabilityRegistry` has `register/unregister/find/list/query/setStatus/getStatus/watch/export/attach` — **no lifecycle state today**; `CapabilityStatus` is in-memory. `JsonlCapabilityLifecycleLedger` interface (append/list/listByCapability/listByIntent/listLatestForCapability). `GovernanceDecision` required fields (decisionId, proposalId, evolutionId, kind, confidence, reasoning, risks, evidenceId, integrityHash, etc.). `canonicalStringify` exists for the atomicity test.

- [ ] **Step 3: Verify the A5 + P5.5 surfaces**

Record: `buildObservationEvidence(input: ObservationBuildInput): VerificationEvidence`; `CapabilityEvolutionStore.loadLatest(): Promise<CapabilityEvolutionReport | null>`; `CapabilityHealth` carries `lifecycleState` + `capability`.

- [ ] **Step 4: Verify the A7.0 extension points**

Record: `toLedgerRecord(phase, candidate, options)` (decided records currently carry decisionId/decisionKind via `options.outcome`); CLI `propose` appends `intent`/`proposed`/`decided`; `CapabilityLifecycleRecord` already has reserved `executionId?`/`measurementId?` fields and the validator currently rejects `applied`/`measured` and both ids.

- [ ] **Step 5: Report + carry-forward**

Write the report to `task-1-report.md`: the verified signature table, any drift from the plan's assumptions (e.g. exact required-field lists, line numbers), and a carry-forward note that Task 2 must add `applied`/`measured` to `CAPABILITY_LIFECYCLE_EVENT_TYPES` and flip the validator from forbid→require. Commit nothing (no code). Update the ledger with `Task 1: complete (no commits, contract inventory verified)`.

---

## Task 2: Registry lifecycle overlay (M-series mutation surface)

**Files:**
- Modify: `src/capability/registry.ts`
- Test: `tests/capability/registry-lifecycle-overlay.test.ts`

**Interfaces:**
- Consumes: `LifecycleState` from `src/adaptation/capability-evolution-types.js`; `Capability` from `src/capability/types.js`; existing `CapabilityValidationError` from `src/capability/errors.js`.
- Produces: `CapabilityRegistry.applyLifecycleTransition(id: string, to: LifecycleState): void` (throws `CapabilityValidationError` on unknown id); `CapabilityRegistry.getLifecycleState(id: string): LifecycleState | undefined`; `CapabilityRegistry.clearLifecycleState(id: string): void` (idempotent; deletes the overlay entry, no-op on absent id — required by spec §7 for compensating rollback of capabilities that had no prior state); `register`/`unregister` maintain the overlay map. `list()`/`find()`/`describe()` unchanged.

- [ ] **Step 1: Write the failing test**

`tests/capability/registry-lifecycle-overlay.test.ts`:
```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CapabilityRegistry } from "../../src/capability/registry.js";
import { CapabilityValidationError } from "../../src/capability/errors.js";
import type { Capability } from "../../src/capability/types.js";

function makeCapability(id: string): Capability {
  return {
    id, version: "1.0.0", kind: "core", title: id, description: id,
    tags: [], category: "core", risk: "low", requiredPermissions: ["operator"],
    execution: { strategy: "native" },
  };
}

describe("CapabilityRegistry lifecycle overlay", () => {
  it("has no lifecycle state until applied", () => {
    const r = new CapabilityRegistry();
    r.register(makeCapability("core.session.list"));
    assert.equal(r.getLifecycleState("core.session.list"), undefined);
  });

  it("applyLifecycleTransition stores the state", () => {
    const r = new CapabilityRegistry();
    r.register(makeCapability("core.old"));
    r.applyLifecycleTransition("core.old", "deprecated");
    assert.equal(r.getLifecycleState("core.old"), "deprecated");
  });

  it("throws on an unknown id", () => {
    const r = new CapabilityRegistry();
    assert.throws(() => r.applyLifecycleTransition("core.nope", "active"), CapabilityValidationError);
  });

  it("unregister clears the overlay entry", () => {
    const r = new CapabilityRegistry();
    r.register(makeCapability("core.old"));
    r.applyLifecycleTransition("core.old", "deprecated");
    r.unregister("core.old");
    assert.equal(r.getLifecycleState("core.old"), undefined);
  });

  it("register does not pre-seed a lifecycle state", () => {
    const r = new CapabilityRegistry();
    r.register(makeCapability("core.session.list"));
    assert.equal(r.getLifecycleState("core.session.list"), undefined);
  });

  it("clearLifecycleState removes the entry and is a no-op on an absent id", () => {
    const r = new CapabilityRegistry();
    r.register(makeCapability("core.old"));
    r.applyLifecycleTransition("core.old", "deprecated");
    r.clearLifecycleState("core.old");
    assert.equal(r.getLifecycleState("core.old"), undefined);
    r.clearLifecycleState("core.old"); // no-op on absent id
    assert.equal(r.getLifecycleState("core.old"), undefined);
    r.clearLifecycleState("core.never"); // no-op on unknown id
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/capability/registry-lifecycle-overlay.test.js`
Expected: FAIL — `applyLifecycleTransition` / `getLifecycleState` not defined.

- [ ] **Step 3: Implement the overlay**

In `src/capability/registry.ts`:
```ts
import type { LifecycleState } from "../adaptation/capability-evolution-types.js";
// inside class, alongside `private readonly status`:
private readonly lifecycle = new Map<string, LifecycleState>();

/** A7.1 — governed lifecycle overlay. The registry remains the current-state
 *  authority; this is a runtime projection of the A7 lifecycle ledger, and
 *  never a value in the Capability definition. */
applyLifecycleTransition(id: string, to: LifecycleState): void {
  if (!this.byId.has(id)) throw new CapabilityValidationError(`Unknown capability id: ${id}`);
  this.lifecycle.set(id, to);
}

getLifecycleState(id: string): LifecycleState | undefined {
  return this.lifecycle.get(id);
}

/** A7.1 — clear the lifecycle overlay entry (used by compensating rollback).
 *  Idempotent: a no-op on an absent id, so callers may invoke it unconditionally. */
clearLifecycleState(id: string): void {
  this.lifecycle.delete(id);
}
```
In `unregister(id)`, after `this.status.delete(id)`, add `this.lifecycle.delete(id);`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && node --test dist/tests/capability/registry-lifecycle-overlay.test.js`
Expected: PASS (5/5).

- [ ] **Step 5: Impact + commit**

Run `mcp__gitnexus__impact({target: "applyLifecycleTransition", direction: "upstream"})` and `mcp__gitnexus__detect_changes()`. Confirm LOW risk (additive method on the registry; `unregister` gains one line). Commit:
```bash
git add src/capability/registry.ts tests/capability/registry-lifecycle-overlay.test.ts
git commit -m "feat(a7.1): CapabilityRegistry lifecycle overlay (apply/get/clear)
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Lifecycle contract extension — applied/measured events + full decision + projection states

**Files:**
- Modify: `src/evolution/capability-lifecycle/contracts/lifecycle-contract.ts`
- Modify: `src/evolution/capability-lifecycle/capability-governance-bridge.ts` (decided records persist the full decision)
- Test: `tests/evolution/capability-lifecycle/capability-lifecycle-record.test.ts` (add cases) + a new `tests/evolution/capability-lifecycle/capability-lifecycle-contract-a71.test.ts`

**Interfaces:**
- Consumes: `GovernanceDecision` from `src/evolution/governance/contracts/decision-contract.js`; existing `CapabilityLifecycleRecord`/`EventType`/`ProjectionState`/validator/`deriveCapabilityProjectionState`.
- Produces: `CapabilityLifecycleEventType` extends to `"intent"|"proposed"|"decided"|"applied"|"measured"`; `CAPABILITY_LIFECYCLE_EVENT_TYPES` extended; `CapabilityLifecycleRecord` gains `decision?: GovernanceDecision`; validator rules flip (see Step 3); `CapabilityProjectionState` extends to include `"APPLIED"`/`"MEASURED"`; `deriveCapabilityProjectionState` extended; `toLedgerRecord` persists `decision` on `decided` records.

- [ ] **Step 1: Write the failing tests**

In `tests/evolution/capability-lifecycle/capability-lifecycle-contract-a71.test.ts`, assert:
1. `validateCapabilityLifecycleRecord` accepts a valid `applied` record (eventType `applied`, executionId + decisionId present) and rejects one missing `executionId`.
2. accepts a valid `measured` record (measurementId + baselineEvidenceRefs + postObservationRefs) and rejects one missing `measurementId`.
3. a `decided` record carrying `decision` is valid; a `decided` record carrying `executionId` is **rejected** (a decision is not an application).
4. `deriveCapabilityProjectionState` returns `"APPLIED"` for a latest `applied` record and `"MEASURED"` for a latest `measured` record.

In `tests/evolution/capability-lifecycle/capability-governance-bridge.test.ts`, add:
5. `toLedgerRecord("decided", candidate, { proposalId, outcome })` persists `record.decision` equal to `outcome.decision`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm build && node --test dist/tests/evolution/capability-lifecycle/capability-lifecycle-contract-a71.test.js`
Expected: FAIL — `applied`/`measured` not in the event-type union, validator rejects them, projection lacks APPLIED/MEASURED.

- [ ] **Step 3: Implement the contract extension**

In `lifecycle-contract.ts`:
```ts
export type CapabilityLifecycleEventType = "intent" | "proposed" | "decided" | "applied" | "measured";
export const CAPABILITY_LIFECYCLE_EVENT_TYPES: readonly CapabilityLifecycleEventType[] = [
  "intent", "proposed", "decided", "applied", "measured",
];
```
Add `decision?: GovernanceDecision` to `CapabilityLifecycleRecord` (import `GovernanceDecision` type).

Validator changes:
```ts
if (v.eventType === "applied") {
  if (!isNonEmptyString(v.executionId)) errors.push("applied record requires executionId");
  if (!isNonEmptyString(v.decisionId)) errors.push("applied record requires decisionId");
  if (isNonEmptyString(v.measurementId)) errors.push("applied record must not carry measurementId");
}
if (v.eventType === "measured") {
  if (!isNonEmptyString(v.measurementId)) errors.push("measured record requires measurementId");
  if (!Array.isArray(v.baselineEvidenceRefs)) errors.push("measured record requires baselineEvidenceRefs array");
  if (!Array.isArray(v.postObservationRefs)) errors.push("measured record requires postObservationRefs array");
}
if (v.eventType === "decided") {
  // ...existing required checks...
  if (isNonEmptyString(v.executionId)) errors.push("decided record must not carry executionId");
  if (isNonEmptyString(v.measurementId)) errors.push("decided record must not carry measurementId");
}
// Remove the old A7.0 forbid branch that rejected applied/measured/ids entirely.
```
Remove the A7.0 block that rejected `applied`/`measured` and both ids outright (superseded by the per-phase rules above).

Projection:
```ts
export type CapabilityProjectionState =
  | "PROPOSED" | "REJECTED" | "APPROVED_PENDING_APPLICATION" | "APPLIED" | "MEASURED";

export function deriveCapabilityProjectionState(latestDecision: CapabilityLifecycleRecord | null): CapabilityProjectionState {
  if (!latestDecision || latestDecision.eventType === "intent" || latestDecision.eventType === "proposed") return "PROPOSED";
  if (latestDecision.eventType === "applied") return "APPLIED";
  if (latestDecision.eventType === "measured") return "MEASURED";
  if (latestDecision.decisionKind === "REJECT") return "REJECTED";
  return "APPROVED_PENDING_APPLICATION"; // APPROVE / MONITOR / REQUEST_MORE_EVIDENCE
}
```

In `capability-governance-bridge.ts`, `toLedgerRecord`:
```ts
if (phase === "decided" && options.outcome) {
  record.decisionId = options.outcome.decision.decisionId;
  record.decisionKind = options.outcome.decision.kind as GovernanceDecisionKind;
  record.decision = options.outcome.decision;   // A7.1 — persist the full A3 artifact
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm build && node --test dist/tests/evolution/capability-lifecycle/capability-lifecycle-contract-a71.test.js dist/tests/evolution/capability-lifecycle/capability-lifecycle-record.test.js dist/tests/evolution/capability-lifecycle/capability-governance-bridge.test.js`
Expected: PASS — new tests + the existing 13/13 record + 4/4 bridge still green (the validator flip must not break the existing A7.0 decided/intent/proposed cases).

- [ ] **Step 5: Full A7 suite regression + impact + commit**

Run the full A7 suite (globstar form). Run `impact({target: "deriveCapabilityProjectionState", direction: "upstream"})` — expect LOW. Commit:
```bash
git add src/evolution/capability-lifecycle/contracts/lifecycle-contract.ts src/evolution/capability-lifecycle/capability-governance-bridge.ts tests/evolution/capability-lifecycle/
git commit -m "feat(a7.1): lifecycle contract — applied/measured events, full decision, projection states
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Rehydration projection — `toExecutionProposal` + `CapabilityExecutionProposal` + `CapabilityChangeStep`

**Files:**
- Create: `src/evolution/capability-lifecycle/capability-execution-projection.ts`
- Test: `tests/evolution/capability-lifecycle/capability-execution-projection.test.ts`

**Interfaces:**
- Consumes: `EvolutionProposal`, `EvolutionIntent`, `EvolutionTarget` from `src/evolution/contracts/evolution-contract.js`; `LifecycleState` from `src/adaptation/capability-evolution-types.js`; `CapabilityLifecycleRecord` from `./contracts/lifecycle-contract.js`.
- Produces:
  - `interface CapabilityChangeStep { operation: "capability.transition"; parameters: { capabilityId: string; to: LifecycleState }; idempotent: true; preconditions: Record<string, unknown>; postconditions: Record<string, unknown> }`
  - `type CapabilityExecutionProposal = EvolutionProposal & { changes: CapabilityChangeStep[] }`
  - `function toExecutionProposal(decided: CapabilityLifecycleRecord): CapabilityExecutionProposal` — builds a full `EvolutionProposal` (beforeHash/afterHash `null`) + `changes`:
    - `promote`/`deprecate` → one step: `{ capabilityId: decided.target.capabilityId, to: decided.proposedLifecycleState }`
    - `consolidate` → one step per `decided.target.relatedCapabilityIds ?? []` → `{ capabilityId: rel, to: "deprecated" }`
    - `register`/`modify` → **throws** `CapabilityNotExecutableError` (see Task 5 for the error class; this task throws `new Error("capability:<intent> is not executable in A7.1")`).

- [ ] **Step 1: Write the failing test**

`tests/evolution/capability-lifecycle/capability-execution-projection.test.ts`:
```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toExecutionProposal } from "../../src/evolution/capability-lifecycle/capability-execution-projection.js";
import type { CapabilityLifecycleRecord } from "../../src/evolution/capability-lifecycle/contracts/lifecycle-contract.js";

function decidedRecord(over: Partial<CapabilityLifecycleRecord>): CapabilityLifecycleRecord {
  return {
    recordId: "clr-test", target: { capabilityId: "core.old" }, intent: "deprecate",
    eventType: "decided", timestamp: "2026-08-10T00:00:00.000Z",
    proposalId: "prop-a7-abc", decisionId: "govd-abc", decisionKind: "APPROVE",
    evidenceRefs: [], observedLifecycleState: "declining", proposedLifecycleState: "deprecated",
    ...over,
  };
}

describe("toExecutionProposal", () => {
  it("promote → single capability.transition step", () => {
    const r = decidedRecord({ intent: "promote", proposedLifecycleState: "active" });
    const p = toExecutionProposal(r);
    assert.equal(p.proposalId, r.proposalId);
    assert.equal(p.evolutionId, r.proposalId);
    assert.equal(p.change, "promote: core.old → active");
    assert.equal(p.beforeHash, null);
    assert.equal(p.afterHash, null);
    assert.equal(p.changes.length, 1);
    assert.equal(p.changes[0].operation, "capability.transition");
    assert.deepEqual(p.changes[0].parameters, { capabilityId: "core.old", to: "active" });
    assert.equal(p.changes[0].idempotent, true);
  });

  it("deprecate → single step to deprecated", () => {
    const p = toExecutionProposal(decidedRecord({}));
    assert.equal(p.changes.length, 1);
    assert.deepEqual(p.changes[0].parameters, { capabilityId: "core.old", to: "deprecated" });
  });

  it("consolidate → deprecate each related capability, preserve primary", () => {
    const r = decidedRecord({
      intent: "consolidate",
      target: { capabilityId: "core.session", relatedCapabilityIds: ["core.session.a", "core.session.b"] },
    });
    const p = toExecutionProposal(r);
    assert.deepEqual(p.changes.map((c) => c.parameters), [
      { capabilityId: "core.session.a", to: "deprecated" },
      { capabilityId: "core.session.b", to: "deprecated" },
    ]);
  });

  it("register → throws not-executable", () => {
    const r = decidedRecord({ intent: "register", target: { capabilityId: "core.new" }, proposedLifecycleState: "emerging" });
    assert.throws(() => toExecutionProposal(r), /not executable in A7\.1/);
  });

  it("modify → throws not-executable", () => {
    const r = decidedRecord({ intent: "modify", proposedLifecycleState: "mature" });
    assert.throws(() => toExecutionProposal(r), /not executable in A7\.1/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/evolution/capability-lifecycle/capability-execution-projection.test.js`
Expected: FAIL — `toExecutionProposal` not defined.

- [ ] **Step 3: Implement the projection**

Create `src/evolution/capability-lifecycle/capability-execution-projection.ts`:
```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import type { EvolutionProposal } from "../contracts/evolution-contract.js";
import type { LifecycleState } from "../../adaptation/capability-evolution-types.js";
import type { CapabilityLifecycleRecord } from "./contracts/lifecycle-contract.js";

export interface CapabilityChangeStep {
  operation: "capability.transition";
  parameters: { capabilityId: string; to: LifecycleState };
  idempotent: true;
  preconditions: Record<string, unknown>;
  postconditions: Record<string, unknown>;
}

/** A7.1 execution projection — `EvolutionProposal` is a closed interface (no
 *  `changes` field); the changes array lives here so A4's `resolveSteps` maps
 *  them to plan steps. */
export type CapabilityExecutionProposal = EvolutionProposal & { changes: CapabilityChangeStep[] };

const INTENT_TO_STATE: Record<string, (r: CapabilityLifecycleRecord) => CapabilityChangeStep[]> = {
  promote: (r) => [step(r.target.capabilityId, r.proposedLifecycleState)],
  deprecate: (r) => [step(r.target.capabilityId, r.proposedLifecycleState)],
  consolidate: (r) => (r.target.relatedCapabilityIds ?? []).map((rel) => step(rel, "deprecated")),
};

function step(capabilityId: string, to: LifecycleState): CapabilityChangeStep {
  return { operation: "capability.transition", parameters: { capabilityId, to }, idempotent: true, preconditions: {}, postconditions: {} };
}

export function toExecutionProposal(decided: CapabilityLifecycleRecord): CapabilityExecutionProposal {
  const builder = INTENT_TO_STATE[decided.intent];
  if (!builder) {
    throw new Error(`capability:${decided.intent} is not executable in A7.1`);
  }
  const changes = builder(decided);
  const change = `${decided.intent}: ${decided.target.capabilityId} → ${decided.proposedLifecycleState}`;
  return {
    proposalId: decided.proposalId!,
    evolutionId: decided.proposalId!,
    title: `${decided.intent} capability ${decided.target.capabilityId}`,
    description: `Governed ${decided.intent} for ${decided.target.capabilityId}`,
    change,
    beforeHash: null,
    afterHash: null,
    createdAt: decided.timestamp,
    changes,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && node --test dist/tests/evolution/capability-lifecycle/capability-execution-projection.test.js`
Expected: PASS (5/5).

- [ ] **Step 5: Impact + commit**

Run `impact({target: "toExecutionProposal", direction: "upstream"})` — expect LOW (new module, only import is types). Commit:
```bash
git add src/evolution/capability-lifecycle/capability-execution-projection.ts tests/evolution/capability-lifecycle/capability-execution-projection.test.ts
git commit -m "feat(a7.1): capability execution projection — toExecutionProposal + changes
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: `CapabilityLifecycleStepExecutor` + `capability.transition` rollback resolver

**Files:**
- Create: `src/evolution/capability-lifecycle/capability-lifecycle-step-executor.ts`
- Modify: `src/evolution/execution/execution-planner.ts` (register a `capability.transition` rollback op)
- Test: `tests/evolution/capability-lifecycle/capability-lifecycle-step-executor.test.ts`

**Interfaces:**
- Consumes: `StepExecutor` from `src/evolution/execution/execution-runtime.js`; `CapabilityRegistry` from `src/capability/registry.js`; `LifecycleState`; `ExecutionStep` from `src/evolution/execution/contracts/execution-contract.js`.
- Produces: `class CapabilityLifecycleStepExecutor implements StepExecutor` with `executeStep(step, context)` and `rollbackApplied(): void` (idempotent compensation restoring every touched id to its pre-execution value, or clearing it if it had none); `DefaultRollbackResolver` gains a registered `capability.transition` → automatic safe rollback.

- [ ] **Step 1: Write the failing tests**

`tests/evolution/capability-lifecycle/capability-lifecycle-step-executor.test.ts`:
```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { CapabilityRegistry } from "../../src/capability/registry.js";
import { CapabilityLifecycleStepExecutor } from "../../src/evolution/capability-lifecycle/capability-lifecycle-step-executor.js";
import type { Capability } from "../../src/capability/types.js";
import type { ExecutionStep } from "../../src/evolution/execution/contracts/execution-contract.js";

function makeCapability(id: string): Capability {
  return { id, version: "1.0.0", kind: "core", title: id, description: id, tags: [], category: "core",
    risk: "low", requiredPermissions: ["operator"], execution: { strategy: "native" } };
}
function trans(capabilityId: string, to: string): ExecutionStep {
  return { stepId: "s1", operation: "capability.transition", parameters: { capabilityId, to },
    idempotent: true, preconditions: {}, postconditions: {} };
}

describe("CapabilityLifecycleStepExecutor", () => {
  let registry: CapabilityRegistry;
  beforeEach(() => {
    registry = new CapabilityRegistry();
    registry.register(makeCapability("core.session"));
    registry.register(makeCapability("core.session.a"));
    registry.register(makeCapability("core.session.b"));
  });

  it("applies a single transition", async () => {
    const ex = new CapabilityLifecycleStepExecutor(registry);
    const res = await ex.executeStep(trans("core.session", "active"), {});
    assert.equal(res.success, true);
    assert.equal(registry.getLifecycleState("core.session"), "active");
  });

  it("consolidation all-or-nothing: second step fails → BOTH restored", async () => {
    const ex = new CapabilityLifecycleStepExecutor(registry);
    registry.applyLifecycleTransition("core.session", "active");
    // B succeeds, C's transition is a no-op success — simulate a mid-plan failure by
    // executing B then asserting rollbackApplied restores both A and B.
    await ex.executeStep(trans("core.session.a", "deprecated"), {});
    await ex.executeStep(trans("core.session.b", "deprecated"), {});
    assert.equal(registry.getLifecycleState("core.session.a"), "deprecated");
    assert.equal(registry.getLifecycleState("core.session.b"), "deprecated");
    ex.rollbackApplied();
    assert.equal(registry.getLifecycleState("core.session.a"), undefined); // restored (was undefined)
    assert.equal(registry.getLifecycleState("core.session.b"), undefined); // restored
    assert.equal(registry.getLifecycleState("core.session"), "active");   // primary preserved
  });

  it("rollbackApplied is idempotent", async () => {
    const ex = new CapabilityLifecycleStepExecutor(registry);
    await ex.executeStep(trans("core.session.a", "deprecated"), {});
    ex.rollbackApplied();
    ex.rollbackApplied(); // second call is a no-op
    assert.equal(registry.getLifecycleState("core.session.a"), undefined);
  });

  it("rollback restores the PRE-execution value, not a later state", async () => {
    const ex = new CapabilityLifecycleStepExecutor(registry);
    registry.applyLifecycleTransition("core.session.a", "deprecated"); // pre-state = deprecated
    await ex.executeStep(trans("core.session.a", "active"), {});        // displace to active
    ex.rollbackApplied();
    assert.equal(registry.getLifecycleState("core.session.a"), "deprecated"); // restores deprecated, not undefined
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/evolution/capability-lifecycle/capability-lifecycle-step-executor.test.js`
Expected: FAIL — class not defined.

- [ ] **Step 3: Implement the executor**

Create `src/evolution/capability-lifecycle/capability-lifecycle-step-executor.ts`:
```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import type { StepExecutor } from "../execution/execution-runtime.js";
import type { ExecutionStep } from "../execution/contracts/execution-contract.js";
import type { CapabilityRegistry } from "../../capability/registry.js";
import type { LifecycleState } from "../../adaptation/capability-evolution-types.js";

/** A7.1 — capability lifecycle step executor (A4 binding). Drives the single
 *  `capability.transition` operation. Captures pre-state at construction;
 *  `rollbackApplied()` is the bounded compensating rollback for a post-completion
 *  ledger-append failure. Pre-state is NEVER recalculated during rollback. */
export class CapabilityLifecycleStepExecutor implements StepExecutor {
  /** Pre-execution lifecycle state per touched capability id (undefined = absent). */
  private readonly preState = new Map<string, LifecycleState | undefined>();
  private readonly appliedIds: string[] = [];
  private readonly registry: CapabilityRegistry;

  constructor(registry: CapabilityRegistry, initialPreState?: Map<string, LifecycleState | undefined>) {
    this.registry = registry;
    if (initialPreState) {
      for (const [id, v] of initialPreState) this.preState.set(id, v);
    }
  }

  async executeStep(step: ExecutionStep, _context: Record<string, unknown>): Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
    if (step.operation !== "capability.transition") {
      return { success: false, output: {}, error: `Unknown operation: ${step.operation}` };
    }
    const { capabilityId, to } = step.parameters as { capabilityId: string; to: LifecycleState };
    if (!this.preState.has(capabilityId)) {
      this.preState.set(capabilityId, this.registry.getLifecycleState(capabilityId)); // capture ONLY if not already
    }
    try {
      this.registry.applyLifecycleTransition(capabilityId, to);
      this.appliedIds.push(capabilityId);
      return { success: true, output: { capabilityId, to } };
    } catch (err) {
      return { success: false, output: {}, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Compensating rollback — restore every applied id to its pre-execution value,
   *  or clear it if it had none. Idempotent: after the first call, appliedIds is
   *  drained. `clearLifecycleState` is a no-op on an absent id. */
  rollbackApplied(): void {
    while (this.appliedIds.length > 0) {
      const id = this.appliedIds.pop()!;
      const prev = this.preState.get(id);
      if (prev === undefined) this.registry.clearLifecycleState(id);
      else this.registry.applyLifecycleTransition(id, prev);
    }
  }
}
```

- [ ] **Step 4: Add the `capability.transition` rollback resolver**

In `src/evolution/execution/execution-planner.ts`, in `createDefaultRollbackResolver()`, register a `capability.transition` operation:
```ts
resolver.registerOperation("capability.transition", (step) => {
  const { capabilityId, to } = step.parameters as { capabilityId: string; to: string };
  return {
    stepId: `rb-${step.stepId}`,
    forwardStepId: step.stepId,
    operation: "capability.restore_transition",
    parameters: { capabilityId, to: to === "deprecated" ? "active" : "active" }, // A7.1 overlay has no prior-state record in the plan; see note
    rollbackType: "automatic" as const,
    safe: true,
  };
});
```
> **Note:** A4's in-plan rollback restores an *approximate* overlay value (there is no plan-time prior state). The authoritative restoration for the A7 commit failure is `rollbackApplied()` (Task 6), which captures the true pre-state. Document this in a code comment.

- [ ] **Step 5: Run tests + impact + commit**

Run the executor test + registry test + a quick planner smoke (`pnpm build && node --test dist/tests/evolution/execution/execution-planner.test.js` if present). Run `impact({target: "CapabilityLifecycleStepExecutor", direction: "upstream"})` (expect LOW). Commit:
```bash
git add src/evolution/capability-lifecycle/capability-lifecycle-step-executor.ts src/evolution/execution/execution-planner.ts src/capability/registry.ts tests/evolution/capability-lifecycle/capability-lifecycle-step-executor.test.ts tests/capability/registry-lifecycle-overlay.test.ts
git commit -m "feat(a7.1): capability step executor + capability.transition rollback resolver
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Applier — the A4 binding (authorize → plan → execute → compensating rollback)

**Files:**
- Create: `src/evolution/capability-lifecycle/capability-lifecycle-applier.ts`
- Create: `src/evolution/capability-lifecycle/errors.ts` (`CapabilityNotExecutableError`)
- Test: `tests/evolution/capability-lifecycle/capability-lifecycle-applier.test.ts`

**Interfaces:**
- Consumes: `CapabilityLifecycleLedger`; `toExecutionProposal`; `CapabilityLifecycleStepExecutor`; `authorizeExecution`; `createExecutionPlan` + `createDefaultRollbackResolver`; `GovernedExecutionRuntime`; `ExecutionRequest`/`ExecutionEnvironment`/`ExecutionPlan` types; `CapabilityRegistry`.
- Produces: `class CapabilityLifecycleApplier` with `apply(capabilityId: string): Promise<{ status: "applied"; executionId: string } | { status: "blocked"; reason: string }>` and `rollbackApplied(): void` delegating to the executor. Deps: `{ ledger; registry; runtime?; resolver?; requestId?; environment? }`.

- [ ] **Step 1: Write the failing test**

`tests/evolution/capability-lifecycle/capability-lifecycle-applier.test.ts`:
```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityRegistry } from "../../src/capability/registry.js";
import { JsonlCapabilityLifecycleLedger } from "../../src/evolution/capability-lifecycle/capability-lifecycle-ledger.js";
import { CapabilityLifecycleApplier } from "../../src/evolution/capability-lifecycle/capability-lifecycle-applier.js";
import { toLedgerRecord } from "../../src/evolution/capability-lifecycle/capability-governance-bridge.js";
import { runCapabilityGovernance } from "../../src/evolution/capability-lifecycle/capability-governance-bridge.js";
import type { CapabilityLifecycleCandidate } from "../../src/evolution/capability-lifecycle/contracts/lifecycle-contract.js";
import type { Capability } from "../../src/capability/types.js";

function makeCapability(id: string): Capability {
  return { id, version: "1.0.0", kind: "core", title: id, description: id, tags: [], category: "core",
    risk: "low", requiredPermissions: ["operator"], execution: { strategy: "native" } };
}
function candidate(intent: "deprecate" | "promote" | "consolidate" | "register", id: string, related: string[] = []): CapabilityLifecycleCandidate {
  return {
    intent, target: { capabilityId: id, ...(related.length ? { relatedCapabilityIds: related } : {}) },
    confidence: 0.9, rationale: ["r"], evidenceRefs: [], observedLifecycleState: "declining",
    proposedLifecycleState: intent === "deprecate" ? "deprecated" : intent === "promote" ? "active" : intent === "consolidate" ? "deprecated" : "emerging",
  };
}

let dir: string;
let ledger: JsonlCapabilityLifecycleLedger;
let registry: CapabilityRegistry;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "a7-applier-"));
  ledger = new JsonlCapabilityLifecycleLedger(join(dir, "lifecycle.jsonl"));
  registry = new CapabilityRegistry();
  registry.register(makeCapability("core.old"));
  registry.register(makeCapability("core.session"));
  registry.register(makeCapability("core.session.a"));
  registry.register(makeCapability("core.session.b"));
});

afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("CapabilityLifecycleApplier", () => {
  async function seedDecided(intent: "deprecate" | "promote" | "consolidate" | "register", id: string, related: string[] = []) {
    const c = candidate(intent, id, related);
    const outcome = runCapabilityGovernance(c, "prop-a7-abc");
    await ledger.append(toLedgerRecord("intent", c));
    await ledger.append(toLedgerRecord("proposed", c, { proposalId: "prop-a7-abc" }));
    await ledger.append(toLedgerRecord("decided", c, { proposalId: "prop-a7-abc", outcome }));
    return { c, outcome };
  }

  it("deprecate: gate allowed → overlay mutated + applied record with executionId", async () => {
    await seedDecided("deprecate", "core.old");
    const applier = new CapabilityLifecycleApplier({ ledger, registry });
    const res = await applier.apply("core.old");
    assert.equal(res.status, "applied");
    assert.ok(res.executionId);
    assert.equal(registry.getLifecycleState("core.old"), "deprecated");
    const applied = await ledger.listLatestForCapability("core.old");
    assert.equal(applied?.eventType, "applied");
    assert.ok(applied?.executionId);
    assert.ok(applied?.decisionId);
  });

  it("register → not-executable, no mutation, no write", async () => {
    await seedDecided("register", "core.new");
    const applier = new CapabilityLifecycleApplier({ ledger, registry });
    const res = await applier.apply("core.new");
    assert.equal(res.status, "blocked");
    assert.match(res.reason, /not executable in A7\.1/);
    assert.equal(registry.getLifecycleState("core.new"), undefined);
    assert.equal((await ledger.listByCapability("core.new")).filter((r) => r.eventType === "applied").length, 0);
  });

  it("REJECT decision → blocked, no mutation", async () => {
    const c = candidate("deprecate", "core.old");
    const low = { ...c, confidence: 0.2 };
    const outcome = runCapabilityGovernance(low, "prop-a7-abc");
    await ledger.append(toLedgerRecord("decided", low, { proposalId: "prop-a7-abc", outcome }));
    const applier = new CapabilityLifecycleApplier({ ledger, registry });
    const res = await applier.apply("core.old");
    assert.equal(res.status, "blocked");
    assert.equal(registry.getLifecycleState("core.old"), undefined);
  });

  it("duplicate application is blocked (no second applied record)", async () => {
    await seedDecided("deprecate", "core.old");
    const applier = new CapabilityLifecycleApplier({ ledger, registry });
    await applier.apply("core.old");
    const res = await applier.apply("core.old");
    assert.equal(res.status, "blocked");
    assert.match(res.reason, /already completed|duplicate|executed/i);
    assert.equal((await ledger.listByCapability("core.old")).filter((r) => r.eventType === "applied").length, 1);
  });

  it("consolidate: both related deprecated, primary preserved", async () => {
    await seedDecided("consolidate", "core.session", ["core.session.a", "core.session.b"]);
    registry.applyLifecycleTransition("core.session", "active");
    const applier = new CapabilityLifecycleApplier({ ledger, registry });
    const res = await applier.apply("core.session");
    assert.equal(res.status, "applied");
    assert.equal(registry.getLifecycleState("core.session"), "active");
    assert.equal(registry.getLifecycleState("core.session.a"), "deprecated");
    assert.equal(registry.getLifecycleState("core.session.b"), "deprecated");
  });

  it("atomicity: ledger append failure → registry byte-identical after rollback", async () => {
    await seedDecided("deprecate", "core.old");
    registry.applyLifecycleTransition("core.old", "declining"); // pre-state snapshot
    const before = JSON.stringify(registry.list());
    const failing = {
      ...ledger,
      append: async () => { throw new Error("append failed"); },
    } as unknown as JsonlCapabilityLifecycleLedger;
    const applier = new CapabilityLifecycleApplier({ ledger: failing, registry });
    await assert.rejects(applier.apply("core.old"), /append failed/);
    assert.equal(JSON.stringify(registry.list()), before);
    assert.equal(registry.getLifecycleState("core.old"), "declining"); // restored to pre-execution value
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/evolution/capability-lifecycle/capability-lifecycle-applier.test.js`
Expected: FAIL — applier not defined.

- [ ] **Step 3: Implement the applier**

Create `src/evolution/capability-lifecycle/errors.ts`:
```ts
export class CapabilityNotExecutableError extends Error {
  constructor(intent: string) { super(`capability:${intent} is not executable in A7.1`); }
}
```

Create `src/evolution/capability-lifecycle/capability-lifecycle-applier.ts`:
```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import type { CapabilityLifecycleLedger } from "./capability-lifecycle-ledger.js";
import { toExecutionProposal } from "./capability-execution-projection.js";
import { CapabilityLifecycleStepExecutor } from "./capability-lifecycle-step-executor.js";
import { authorizeExecution } from "../execution/execution-authorization.js";
import { createExecutionPlan, createDefaultRollbackResolver } from "../execution/execution-planner.js";
import { GovernedExecutionRuntime } from "../execution/execution-runtime.js";
import type { ExecutionEnvironment, ExecutionRequest } from "../execution/contracts/execution-contract.js";
import type { CapabilityRegistry } from "../../capability/registry.js";
import { CapabilityNotExecutableError } from "./errors.js";

export interface CapabilityApplierDeps {
  ledger: CapabilityLifecycleLedger;
  registry: CapabilityRegistry;
  runtime?: GovernedExecutionRuntime;
  resolver?: ReturnType<typeof createDefaultRollbackResolver>;
  requestId?: string;
  environment?: ExecutionEnvironment;
}

export interface ApplyResult {
  status: "applied" | "blocked";
  executionId?: string;
  reason?: string;
}

export class CapabilityLifecycleApplier {
  private executor?: CapabilityLifecycleStepExecutor;
  constructor(private readonly deps: CapabilityApplierDeps) {}

  async apply(capabilityId: string): Promise<ApplyResult> {
    const { ledger, registry } = this.deps;
    const latest = await ledger.listLatestForCapability(capabilityId);
    if (!latest || latest.eventType !== "decided") {
      return { status: "blocked", reason: `No decided transition for ${capabilityId}` };
    }
    if (latest.decisionKind !== "APPROVE") {
      return { status: "blocked", reason: `Decision for ${capabilityId} is ${latest.decisionKind}, not APPROVE` };
    }
    if (latest.intent === "register" || latest.intent === "modify") {
      return { status: "blocked", reason: new CapabilityNotExecutableError(latest.intent).message };
    }
    if (!latest.decision) {
      return { status: "blocked", reason: `Decided record for ${capabilityId} has no persisted decision (A7.1 requires it)` };
    }

    // Authoritative rehydration
    let proposal;
    try { proposal = toExecutionProposal(latest); } catch (err) {
      return { status: "blocked", reason: err instanceof Error ? err.message : String(err) };
    }

    // Dedup: decisionIds already applied for this capability
    const all = await ledger.listByCapability(capabilityId);
    const completedExecutionIds = all.filter((r) => r.eventType === "applied" && r.decisionId).map((r) => r.decisionId!);

    const request: ExecutionRequest = {
      requestId: this.deps.requestId ?? `req-${capabilityId}`,
      evolutionId: proposal.evolutionId,
      requestedBy: "alix",
      requestedAt: new Date().toISOString(),
    };

    const auth = authorizeExecution({ request, proposal, decision: latest.decision, completedExecutionIds });
    if (!auth.allowed) {
      return { status: "blocked", reason: auth.reason };
    }

    // Pre-state snapshot captured immediately before execution — NEVER recalculated.
    const preState = new Map<string, import("../../adaptation/capability-evolution-types.js").LifecycleState | undefined>();
    preState.set(latest.target.capabilityId, registry.getLifecycleState(latest.target.capabilityId));
    for (const rel of latest.target.relatedCapabilityIds ?? []) {
      preState.set(rel, registry.getLifecycleState(rel));
    }

    const env = this.deps.environment ?? {
      environmentId: "a7-capability", environmentHash: "a7-capability",
      runtimeVersion: "1.0.0", agentConfiguration: {}, baselineMetrics: {},
      capabilityFingerprint: "a7",
    };
    const resolver = this.deps.resolver ?? createDefaultRollbackResolver();
    const plan = createExecutionPlan(proposal, latest.decision, env, resolver);
    const executor = new CapabilityLifecycleStepExecutor(registry, preState);
    this.executor = executor;
    const runtime = this.deps.runtime ?? new GovernedExecutionRuntime();
    const report = await runtime.execute(plan, executor);

    if (report.status !== "completed") {
      executor.rollbackApplied();
      return { status: "blocked", reason: `Execution ${report.status}` };
    }

    // COMMIT POINT — the applied ledger append
    try {
      const appliedRecord = {
        target: { ...latest.target },
        intent: latest.intent,
        eventType: "applied" as const,
        timestamp: new Date().toISOString(),
        proposalId: latest.proposalId,
        decisionId: latest.decisionId,
        executionId: report.executionId,
        evidenceRefs: [...latest.evidenceRefs],
        observedLifecycleState: latest.observedLifecycleState,
        proposedLifecycleState: latest.proposedLifecycleState,
      };
      await ledger.append(appliedRecord);
      return { status: "applied", executionId: report.executionId };
    } catch (err) {
      executor.rollbackApplied(); // compensating rollback — restore pre-state
      return { status: "blocked", reason: `Ledger append failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  rollbackApplied(): void { this.executor?.rollbackApplied(); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && node --test dist/tests/evolution/capability-lifecycle/capability-lifecycle-applier.test.js`
Expected: PASS (6/6). If the atomicity test fails, confirm `rollbackApplied()` is restoring the pre-state (the executor captured `preState` before mutation; the append-throwing ledger triggers the catch → rollback).

- [ ] **Step 5: Full A7 suite + impact + commit**

Run the full A7 suite (globstar). Run `impact({target: "CapabilityLifecycleApplier", direction: "upstream"})` — expect LOW (new module). Commit:
```bash
git add src/evolution/capability-lifecycle/capability-lifecycle-applier.ts src/evolution/capability-lifecycle/errors.ts tests/evolution/capability-lifecycle/capability-lifecycle-applier.test.ts
git commit -m "feat(a7.1): capability lifecycle applier — A4 binding + compensating rollback
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: Measurer — A5 post-application observation vs baseline

**Files:**
- Create: `src/evolution/capability-lifecycle/capability-lifecycle-measurer.ts`
- Test: `tests/evolution/capability-lifecycle/capability-lifecycle-measurer.test.ts`

**Interfaces:**
- Consumes: `CapabilityLifecycleLedger`; `CapabilityEvolutionStore`; `buildObservationEvidence` from `src/evolution/observation/observation-evidence-bridge.js`; `LifecycleState`.
- Produces: `class CapabilityLifecycleMeasurer` with `measure(capabilityId: string): Promise<{ status: "measured"; measurementId: string; stateTransition: string } | { status: "blocked"; reason: string }>`. Deps: `{ ledger; store }`.

- [ ] **Step 1: Write the failing test**

`tests/evolution/capability-lifecycle/capability-lifecycle-measurer.test.ts`:
```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlCapabilityLifecycleLedger } from "../../src/evolution/capability-lifecycle/capability-lifecycle-ledger.js";
import { CapabilityLifecycleMeasurer } from "../../src/evolution/capability-lifecycle/capability-lifecycle-measurer.js";
import { CapabilityEvolutionStore } from "../../src/adaptation/capability-evolution-store.js";
import type { CapabilityEvolutionReport, CapabilityHealth } from "../../src/adaptation/capability-evolution-types.js";

function health(capability: string, lifecycleState: string): CapabilityHealth {
  return { capability, agentCount: 0, resolutionCount: 2, resolutionCountRecent: 0,
    resolutionCountPrior: 1, proposalCountRecent: 0, proposalCountPrior: 2, demandScore: 0.1,
    keepRate: 0.2, revertRate: 0.4, proposalCount: 2, lifecycleState: lifecycleState as never, rationale: "r" };
}

let dir: string;
let ledger: JsonlCapabilityLifecycleLedger;
let store: CapabilityEvolutionStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "a7-measurer-"));
  ledger = new JsonlCapabilityLifecycleLedger(join(dir, "lifecycle.jsonl"));
  store = new CapabilityEvolutionStore(join(dir, "evolution"));
});

afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("CapabilityLifecycleMeasurer", () => {
  it("measures a capability with an applied record → measured with measurementId + refs", async () => {
    await ledger.append({ target: { capabilityId: "core.old" }, intent: "deprecate", eventType: "applied",
      timestamp: new Date().toISOString(), decisionId: "govd-abc", executionId: "a7-exec-x",
      evidenceRefs: [], observedLifecycleState: "declining", proposedLifecycleState: "deprecated" });
    await store.save({
      generatedAt: new Date().toISOString(), totalCapabilities: 1,
      healthAnalysis: [health("core.old", "deprecated")], gapAnalysis: [], overlapAnalysis: [],
      driftAnalysis: [], lifecycleDistribution: {}, executiveSummary: "s",
    } as CapabilityEvolutionReport);

    const measurer = new CapabilityLifecycleMeasurer({ ledger, store });
    const res = await measurer.measure("core.old");
    assert.equal(res.status, "measured");
    assert.match(res.measurementId, /^a7-meas-/);
    const latest = await ledger.listLatestForCapability("core.old");
    assert.equal(latest?.eventType, "measured");
    assert.ok(latest?.measurementId);
    assert.ok(latest?.baselineEvidenceRefs);
    assert.ok(latest?.postObservationRefs);
    assert.match(res.stateTransition, /declining → deprecated/);
  });

  it("no applied record → blocked, no write", async () => {
    const measurer = new CapabilityLifecycleMeasurer({ ledger, store });
    const res = await measurer.measure("core.old");
    assert.equal(res.status, "blocked");
    assert.match(res.reason, /No applied/);
    assert.equal((await ledger.list()).length, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/evolution/capability-lifecycle/capability-lifecycle-measurer.test.js`
Expected: FAIL — measurer not defined.

- [ ] **Step 3: Implement the measurer**

Create `src/evolution/capability-lifecycle/capability-lifecycle-measurer.ts`:
```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { createHash } from "node:crypto";
import type { CapabilityLifecycleLedger } from "./capability-lifecycle-ledger.js";
import { CapabilityEvolutionStore } from "../../adaptation/capability-evolution-store.js";
import { buildObservationEvidence } from "../observation/observation-evidence-bridge.js";

export interface CapabilityMeasurerDeps { ledger: CapabilityLifecycleLedger; store: CapabilityEvolutionStore; }
export interface MeasureResult { status: "measured" | "blocked"; measurementId?: string; stateTransition?: string; reason?: string; }

export class CapabilityLifecycleMeasurer {
  constructor(private readonly deps: CapabilityMeasurerDeps) {}

  async measure(capabilityId: string): Promise<MeasureResult> {
    const { ledger, store } = this.deps;
    const latest = await ledger.listLatestForCapability(capabilityId);
    if (!latest || latest.eventType !== "applied") {
      return { status: "blocked", reason: `No applied transition for ${capabilityId}` };
    }

    const report = await store.loadLatest();
    const post = report?.healthAnalysis.find((h) => h.capability === capabilityId);
    const postState = post?.lifecycleState ?? latest.observedLifecycleState;

    // A5 post-application observation evidence
    const evidence = buildObservationEvidence({
      proposalId: latest.proposalId ?? "a7-measure",
      evolutionId: latest.proposalId ?? "a7-measure",
      environmentHash: "a7-capability",
      observations: [{
        observationId: `a7-obs-${capabilityId}`,
        provider: "capability-lifecycle",
        description: `post-application lifecycle state for ${capabilityId}`,
        status: "pass", observed: postState, expected: latest.proposedLifecycleState, confidence: 1,
      } as never],
    });

    const measurementId = `a7-meas-${hash16(`a7-meas|${capabilityId}|${latest.executionId ?? ""}`)}`;
    const stateTransition = `${latest.observedLifecycleState ?? "none"} → ${postState}`;

    const measured = {
      target: { ...latest.target }, intent: latest.intent, eventType: "measured" as const,
      timestamp: new Date().toISOString(), proposalId: latest.proposalId, decisionId: latest.decisionId,
      executionId: latest.executionId, measurementId,
      baselineEvidenceRefs: [latest.decisionId ?? "a7-baseline"], postObservationRefs: [evidence.evidenceId],
      evidenceRefs: [...latest.evidenceRefs], observedLifecycleState: latest.observedLifecycleState,
      proposedLifecycleState: latest.proposedLifecycleState,
    };
    await ledger.append(measured);
    return { status: "measured", measurementId, stateTransition };
  }
}

function hash16(input: string): string { return createHash("sha256").update(input, "utf-8").digest("hex").slice(0, 16); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && node --test dist/tests/evolution/capability-lifecycle/capability-lifecycle-measurer.test.js`
Expected: PASS (2/2). If `buildObservationEvidence`'s `ObservationResult` type rejects the cast, loosen to a local `ObservationResult`-compatible object (match the actual shape in `src/evolution/observation/contracts/observation-contract.js`).

- [ ] **Step 5: Impact + commit**

Run `impact({target: "CapabilityLifecycleMeasurer", direction: "upstream"})` — expect LOW. Commit:
```bash
git add src/evolution/capability-lifecycle/capability-lifecycle-measurer.ts tests/evolution/capability-lifecycle/capability-lifecycle-measurer.test.ts
git commit -m "feat(a7.1): capability lifecycle measurer — A5 post-application observation vs baseline
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: CLI — `apply` and `measure` subcommands

**Files:**
- Modify: `src/evolution/capability-lifecycle/capability-lifecycle-cli.ts`
- Modify: `src/evolution/capability-lifecycle/index.ts` (barrel — re-export applier/measurer/executor/projection)
- Modify: `tests/evolution/capability-lifecycle/capability-cli.test.ts` (add `apply`/`measure` cases)

**Interfaces:**
- Consumes: `CapabilityLifecycleApplier`; `CapabilityLifecycleMeasurer`; existing `CapabilitiesCLIDeps` (gains `store` already present; registry already present).
- Produces: `alix capabilities apply <id>` and `alix capabilities measure <id>`.

- [ ] **Step 1: Add failing tests**

Append to `capability-cli.test.ts`:
```ts
it("apply with no decided record blocks", async () => {
  const { stdout } = await capture(() => handleCapabilitiesCommand(["apply", "core.old"], deps));
  assert.ok(stdout.includes("No decided") || stdout.includes("not"));
});

it("measure with no applied record blocks", async () => {
  const { stdout } = await capture(() => handleCapabilitiesCommand(["measure", "core.old"], deps));
  assert.ok(stdout.includes("No applied"));
});
```
(Use `deps.registry`, `deps.ledger` — the CLI constructs the applier/measurer from deps.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/evolution/capability-lifecycle/capability-cli.test.js`
Expected: FAIL — `apply`/`measure` unknown subcommands (fall to `default` → usage).

- [ ] **Step 3: Wire the subcommands**

In `capability-lifecycle-cli.ts`:
```ts
import { CapabilityLifecycleApplier } from "./capability-lifecycle-applier.js";
import { CapabilityLifecycleMeasurer } from "./capability-lifecycle-measurer.js";
// in the switch:
case "apply":
  return runApply(rest[0], ledger, registry, deps);
case "measure":
  return runMeasure(rest[0], ledger, store, deps);
```
Add handlers (mirror the existing `renderInspect` error pattern — missing id → error + `process.exitCode = 1; return;`):
```ts
async function runApply(id, ledger, registry, deps, jsonMode) {
  if (!id) { console.error("Usage: alix capabilities apply <id>"); process.exitCode = 1; return; }
  const applier = new CapabilityLifecycleApplier({ ledger, registry, requestId: `req-${id}` });
  const res = await applier.apply(id);
  if (res.status === "blocked") {
    if (jsonMode) console.log(JSON.stringify({ ok: false, reason: res.reason }));
    else { console.error(res.reason); process.exitCode = 1; }
    return;
  }
  if (jsonMode) console.log(JSON.stringify({ ok: true, capabilityId: id, executionId: res.executionId }));
  else console.log(`applied ${id} (execution ${res.executionId})`);
}
async function runMeasure(id, ledger, store, jsonMode) {
  if (!id) { console.error("Usage: alix capabilities measure <id>"); process.exitCode = 1; return; }
  const measurer = new CapabilityLifecycleMeasurer({ ledger, store });
  const res = await measurer.measure(id);
  if (res.status === "blocked") {
    if (jsonMode) console.log(JSON.stringify({ ok: false, reason: res.reason }));
    else { console.error(res.reason); process.exitCode = 1; }
    return;
  }
  if (jsonMode) console.log(JSON.stringify({ ok: true, capabilityId: id, measurementId: res.measurementId, stateTransition: res.stateTransition }));
  else console.log(`measured ${id}: ${res.stateTransition} (measurement ${res.measurementId})`);
}
```
Add `apply`/`measure` to the `USAGE` string.

In `index.ts`, add:
```ts
export * from "./capability-execution-projection.js";
export * from "./capability-lifecycle-step-executor.js";
export * from "./capability-lifecycle-applier.js";
export * from "./capability-lifecycle-measurer.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm build && node --test dist/tests/evolution/capability-lifecycle/capability-cli.test.js`
Expected: PASS (existing 6 + new 2).

- [ ] **Step 5: Real-CLI smoke + impact + commit**

Smoke-test the real CLI for exit codes (fatal → 1, non-error → 0):
```bash
node dist/cli.js capabilities apply core.old; echo "exit=$?"   # expect exit 1, "No decided"
node dist/cli.js capabilities measure core.old; echo "exit=$?" # expect exit 1, "No applied"
```
Run `impact({target: "handleCapabilitiesCommand", direction: "upstream"})` — expect LOW. Commit:
```bash
git add src/evolution/capability-lifecycle/capability-lifecycle-cli.ts src/evolution/capability-lifecycle/index.ts tests/evolution/capability-lifecycle/capability-cli.test.ts
git commit -m "feat(a7.1): alix capabilities apply/measure subcommands
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: Integration + invariant tests

**Files:**
- Test: `tests/evolution/capability-lifecycle/integration/a7-1-capability-application-integration.test.ts`

**Interfaces:**
- Consumes: every module from Tasks 2–8; `CapabilityRegistry`; `JsonlCapabilityLifecycleLedger`; `runCapabilityGovernance`/`toLedgerRecord`; `CapabilityEvolutionStore`; `deriveCapabilityProjectionState`; `canonicalStringify`.

- [ ] **Step 1: Write the test**

`tests/evolution/capability-lifecycle/integration/a7-1-capability-application-integration.test.ts`:
```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityRegistry } from "../../../../src/capability/registry.js";
import { JsonlCapabilityLifecycleLedger } from "../../../../src/evolution/capability-lifecycle/capability-lifecycle-ledger.js";
import { analyzeCapabilityLifecycle } from "../../../../src/evolution/capability-lifecycle/capability-lifecycle-analyzer.js";
import { buildCapabilityProposals } from "../../../../src/evolution/capability-lifecycle/capability-proposal-builder.js";
import { runCapabilityGovernance, toLedgerRecord } from "../../../../src/evolution/capability-lifecycle/capability-governance-bridge.js";
import { CapabilityLifecycleApplier } from "../../../../src/evolution/capability-lifecycle/capability-lifecycle-applier.js";
import { CapabilityLifecycleMeasurer } from "../../../../src/evolution/capability-lifecycle/capability-lifecycle-measurer.js";
import { deriveCapabilityProjectionState } from "../../../../src/evolution/capability-lifecycle/contracts/lifecycle-contract.js";
import { CapabilityEvolutionStore } from "../../../../src/adaptation/capability-evolution-store.js";
import { canonicalStringify } from "../../../../src/security/audit/canonical-json.js";
import type { CapabilitySignalInputs } from "../../../../src/evolution/capability-lifecycle/contracts/lifecycle-contract.js";
import type { CapabilityHealth } from "../../../../src/adaptation/capability-evolution-types.js";
import type { Capability } from "../../../../src/capability/types.js";

function makeCapability(id: string): Capability {
  return { id, version: "1.0.0", kind: "core", title: id, description: id, tags: [], category: "core",
    risk: "low", requiredPermissions: ["operator"], execution: { strategy: "native" } };
}
function stagnantHealth(capability: string): CapabilityHealth {
  return { capability, agentCount: 0, resolutionCount: 2, resolutionCountRecent: 0, resolutionCountPrior: 1,
    proposalCountRecent: 0, proposalCountPrior: 2, demandScore: 0.1, keepRate: 0.2, revertRate: 0.4,
    proposalCount: 2, lifecycleState: "stagnant", rationale: "no recent use" };
}

let dir: string;
let ledger: JsonlCapabilityLifecycleLedger;
let registry: CapabilityRegistry;
let store: CapabilityEvolutionStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "a7-1-int-"));
  ledger = new JsonlCapabilityLifecycleLedger(join(dir, "lifecycle.jsonl"));
  store = new CapabilityEvolutionStore(join(dir, "evolution"));
  registry = new CapabilityRegistry();
  registry.register(makeCapability("core.session.list"));
  registry.register(makeCapability("core.old"));
});

afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("A7.1 end-to-end capability application", () => {
  it("full deprecate: analyze → govern → decide → apply → measure walks every projection", async () => {
    const inputs: CapabilitySignalInputs = { health: [stagnantHealth("core.old")], gaps: [], overlap: [], drift: [],
      adoption: {}, outcome: [], patterns: [] };
    const candidates = analyzeCapabilityLifecycle(inputs);
    assert.equal(candidates.length, 1);
    const [artifacts] = buildCapabilityProposals(candidates, [{ evidenceId: "a7-p55-report", source: "p55" }]);
    const outcome = runCapabilityGovernance(artifacts.candidate, artifacts.proposal.proposalId);
    assert.equal(outcome.decision.kind, "APPROVE");
    await ledger.append(toLedgerRecord("intent", artifacts.candidate));
    await ledger.append(toLedgerRecord("proposed", artifacts.candidate, { proposalId: artifacts.proposal.proposalId }));
    await ledger.append(toLedgerRecord("decided", artifacts.candidate, { proposalId: artifacts.proposal.proposalId, outcome }));

    // Decided → APPROVED_PENDING_APPLICATION
    assert.equal(deriveCapabilityProjectionState(await ledger.listLatestForCapability("core.old")), "APPROVED_PENDING_APPLICATION");

    const applier = new CapabilityLifecycleApplier({ ledger, registry });
    const applied = await applier.apply("core.old");
    assert.equal(applied.status, "applied");
    assert.equal(deriveCapabilityProjectionState(await ledger.listLatestForCapability("core.old")), "APPLIED");
    assert.equal(registry.getLifecycleState("core.old"), "deprecated");

    // Post-apply P5.5 health reflects the new state
    await store.save({ generatedAt: new Date().toISOString(), totalCapabilities: 2,
      healthAnalysis: [stagnantHealth("core.old"), { ...stagnantHealth("core.session.list"), lifecycleState: "active" }],
      gapAnalysis: [], overlapAnalysis: [], driftAnalysis: [], lifecycleDistribution: {}, executiveSummary: "s" } as never);

    const measurer = new CapabilityLifecycleMeasurer({ ledger, store });
    const measured = await measurer.measure("core.old");
    assert.equal(measured.status, "measured");
    assert.equal(deriveCapabilityProjectionState(await ledger.listLatestForCapability("core.old")), "MEASURED");
    const latest = await ledger.listLatestForCapability("core.old");
    assert.ok(latest?.baselineEvidenceRefs?.length);
    assert.ok(latest?.postObservationRefs?.length);

    // Final record chain
    const chain = (await ledger.listByCapability("core.old")).map((r) => r.eventType);
    assert.deepEqual(chain, ["intent", "proposed", "decided", "applied", "measured"]);
  });

  it("atomicity: ledger append failure after runtime completed → registry byte-identical", async () => {
    const inputs: CapabilitySignalInputs = { health: [stagnantHealth("core.old")], gaps: [], overlap: [], drift: [],
      adoption: {}, outcome: [], patterns: [] };
    const candidates = analyzeCapabilityLifecycle(inputs);
    const [artifacts] = buildCapabilityProposals(candidates, [{ evidenceId: "a7-p55-report", source: "p55" }]);
    const outcome = runCapabilityGovernance(artifacts.candidate, artifacts.proposal.proposalId);
    await ledger.append(toLedgerRecord("intent", artifacts.candidate));
    await ledger.append(toLedgerRecord("proposed", artifacts.candidate, { proposalId: artifacts.proposal.proposalId }));
    await ledger.append(toLedgerRecord("decided", artifacts.candidate, { proposalId: artifacts.proposal.proposalId, outcome }));

    registry.applyLifecycleTransition("core.old", "declining"); // pre-state
    const before = canonicalStringify(registry.list());
    const failingLedger = {
      ...ledger,
      append: async () => { throw new Error("disk full"); },
    } as unknown as JsonlCapabilityLifecycleLedger;
    const applier = new CapabilityLifecycleApplier({ ledger: failingLedger, registry });
    const res = await applier.apply("core.old");
    assert.equal(res.status, "blocked");
    assert.equal(canonicalStringify(registry.list()), before); // byte-identical
    assert.equal(registry.getLifecycleState("core.old"), "declining"); // restored, not deprecated
  });

  it("rehydration: overlay rebuilt from the ledger after a simulated restart", async () => {
    // Seed a decided → applied via a first applier, then build a FRESH registry (restart)
    const inputs: CapabilitySignalInputs = { health: [stagnantHealth("core.old")], gaps: [], overlap: [], drift: [],
      adoption: {}, outcome: [], patterns: [] };
    const candidates = analyzeCapabilityLifecycle(inputs);
    const [artifacts] = buildCapabilityProposals(candidates, [{ evidenceId: "a7-p55-report", source: "p55" }]);
    const outcome = runCapabilityGovernance(artifacts.candidate, artifacts.proposal.proposalId);
    await ledger.append(toLedgerRecord("intent", artifacts.candidate));
    await ledger.append(toLedgerRecord("proposed", artifacts.candidate, { proposalId: artifacts.proposal.proposalId }));
    await ledger.append(toLedgerRecord("decided", artifacts.candidate, { proposalId: artifacts.proposal.proposalId, outcome }));
    await new CapabilityLifecycleApplier({ ledger, registry }).apply("core.old");

    const restarted = new CapabilityRegistry();
    restarted.register(makeCapability("core.session.list"));
    restarted.register(makeCapability("core.old"));
    // Rehydrate the overlay from the ledger: every applied record → applyLifecycleTransition
    for (const r of await ledger.list()) {
      if (r.eventType === "applied") restarted.applyLifecycleTransition(r.target.capabilityId, r.proposedLifecycleState);
    }
    assert.equal(restarted.getLifecycleState("core.old"), "deprecated");
  });

  it("register is approved-but-not-executable: blocked, no mutation, stays APPROVED_PENDING_APPLICATION", async () => {
    const c = { intent: "register" as const, target: { capabilityId: "core.new" }, confidence: 0.9,
      rationale: ["gap"], evidenceRefs: [], observedLifecycleState: null, proposedLifecycleState: "emerging" };
    const outcome = runCapabilityGovernance(c, "prop-a7-reg");
    await ledger.append(toLedgerRecord("decided", c, { proposalId: "prop-a7-reg", outcome }));
    const applier = new CapabilityLifecycleApplier({ ledger, registry });
    const res = await applier.apply("core.new");
    assert.equal(res.status, "blocked");
    assert.match(res.reason, /not executable in A7\.1/);
    assert.equal(registry.getLifecycleState("core.new"), undefined);
    assert.equal(deriveCapabilityProjectionState(await ledger.listLatestForCapability("core.new")), "APPROVED_PENDING_APPLICATION");
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm build && node --test dist/tests/evolution/capability-lifecycle/integration/a7-1-capability-application-integration.test.js`
Expected: PASS (4/4).

- [ ] **Step 3: Full A7 + A0 regression + detect_changes**

Run the full A7 suite (globstar) + A0 core contracts:
```bash
shopt -s globstar
pnpm build && node --test dist/tests/evolution/capability-lifecycle/**/*.test.js
node --test dist/tests/evolution/contracts/*.test.js
```
Run `mcp__gitnexus__detect_changes()` and confirm the affected scope is the A7 module + the registry + the A4 planner + CLI + tests — no unexpected execution flows.

- [ ] **Step 4: Commit**

```bash
git add tests/evolution/capability-lifecycle/integration/a7-1-capability-application-integration.test.ts
git commit -m "test(a7.1): end-to-end application + invariant tests

Covers: full deprecate walk through every projection state, atomicity
(byte-identical registry on ledger-append failure), overlay rehydration
from the ledger after restart, and register approved-but-not-executable.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: Closure — checkpoint, tag, roadmap

**Files:**
- Create: `docs/architecture/checkpoints/2026-08-10-a7-1-capability-application-checkpoint.md`
- Modify: `docs/roadmap/a-series-autonomous-evolution.md` (A7 row → note A7.1 closes the loop; frontier remains A8/A9)
- Tag: `alix-a7-1-capability-application-complete`

- [ ] **Step 1: Write the closure checkpoint**

Create `docs/architecture/checkpoints/2026-08-10-a7-1-capability-application-checkpoint.md` mirroring the A7.0 checkpoint format (`docs/architecture/checkpoints/2026-08-10-a7-capability-marketplace-checkpoint.md`): purpose, what shipped (registry overlay, contract extension, rehydration projection, step executor + rollback resolver, applier, measurer, CLI apply/measure, integration tests), the A7.1 boundary invariants (one physical op; register/modify deferred; compensating rollback; byte-identical registry on failed apply; pre-state never recalculated; ledger authority vs registry authority), test evidence (per-suite counts).

- [ ] **Step 2: Update the roadmap**

In `docs/roadmap/a-series-autonomous-evolution.md`, update the A7 row to note A7.1 closes the lifecycle loop (Apply → Measure), and keep the frontier at A8/A9 ("designed at roadmap level only").

- [ ] **Step 3: Full A7 suite + detect_changes**

Run the full A7 suite (globstar). Run `mcp__gitnexus__detect_changes()` and confirm affected scope is the A7 module + registry + A4 planner + CLI + tests.

- [ ] **Step 4: Commit + tag**

```bash
git add docs/architecture/checkpoints/2026-08-10-a7-1-capability-application-checkpoint.md docs/roadmap/a-series-autonomous-evolution.md
git commit -m "docs(a7.1): A7.1 closure checkpoint + roadmap update

A7 — Capability Marketplace: A7.1 Capability Lifecycle Application
(Apply -> Measure) complete. A4 binding + registry lifecycle overlay +
A5 post-application measurement. register/modify deferred. tag:
alix-a7-1-capability-application-complete.

Co-Authored-By: Claude <noreply@anthropic.com>"
git tag -a alix-a7-1-capability-application-complete -m "A7.1 Capability Lifecycle Application complete"
```
> **Do NOT push.** The human approves pushes separately.

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task: §4 intent boundary → Task 5/6; §5.1-5.4 contract extension → Task 3; §5.5 registry overlay → Task 2; §6 A4 binding → Tasks 4-6; §7 atomicity + compensating rollback → Tasks 5-6 + Task 9 atomicity test; §8 authority model → Task 9 rehydration test; §9 measurement vs baseline → Task 7; §10 CLI → Task 8; §11 error handling → Tasks 6-8; §12 testing → Tasks 2-9; §13 implementation order → Task 1→10. Pre-state-never-recalculated → Task 5 test + Task 6 code.

**2. Placeholder scan** — every step has concrete code or an exact command. The two "if the shape differs" notes (ObservationResult cast, planner smoke) are conditional checks against reality with explicit alternatives, not placeholders.

**3. Type consistency** — `CapabilityChangeStep`/`CapabilityExecutionProposal`/`toExecutionProposal` defined once (Task 4) and used identically in Tasks 6/9. `CapabilityLifecycleStepExecutor` defined in Task 5, used in Task 6. `CapabilityLifecycleApplier.apply()` + `MeasureResult` used identically in Tasks 6/8/9. `CapabilityLifecycleMeasurer.measure()` used identically in Tasks 7/8/9. `executionId`/`measurementId`/`decision`/`baselineEvidenceRefs`/`postObservationRefs` field names consistent across Tasks 3/6/7/9.
