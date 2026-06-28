# P10.4b — Executive Proposal Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bridge P10.4a's `create_remediation_proposal` step kind into the existing P5/P9 `AdaptationProposal` lifecycle as a **pending** proposal. P10.4b may not approve, apply, or reject proposals.

**Architecture:** Additive module `src/executive/executive-bridge.ts` with two functions: `buildExecutiveRemediationProposal` (pure) and `bridgeCreateRemediationProposal` (effectful wrapper). `ExecutionEngine.runReadySteps` calls the bridge for `create_remediation_proposal` steps, appends the resulting artifact ref to `StepRuntimeState.generatedArtifacts`, and writes evidence. Idempotency is caller-driven via `generatedArtifacts[]`. Two new evidence event types; one new `ProposalAction` union member; one new `ProposalTarget` discriminator.

**Tech Stack:** TypeScript (strict ESM), vitest, Node 20+, `node:crypto`, `node:fs`. Existing modules: `src/adaptation/adaptation-types.ts`, `src/adaptation/proposal-store.ts`, `src/executive/execution-engine.ts`, `src/workflow/evidence-writer.ts`.

## Global Constraints

These constraints are locked by the SDS (`docs/superpowers/specs/2026-06-25-p10-4b-execution-proposal-bridge-design.md`, commits `b1039e66`, `5f3dbffc`). Every task implicitly includes them.

### Hard governance boundary (verbatim)

```
P10.4b may create pending proposals.
P10.4b may not approve proposals.
P10.4b may not apply proposals.
P10.4b may not reject proposals.
```

### Type-system invariants (verbatim from SDS)

- `provenance: "manual"` — closed union, **no extension**. The new member `"executive"` is Forbidden under ADR-0004 and is unnecessary because `provenance: "auto"` means "eligible for automatic approval" — which the executive bridge is explicitly not.
- New additive `ProposalAction` member: `"executive_remediation_request"`.
- New additive `ProposalTarget.kind`: `{ kind: "executive_remediation"; planId: string; stepId: string; objectiveId: string; subsystem: ExecutiveSubsystemName }`.
- `adaptation-types.ts` is a protected type file. Both additions are **Allowed** under ADR-0004 (additive union members). The protected-type sentinel in `tests/adaptation/adaptation-types-p10-4b-snapshot.vitest.ts` asserts both documented additions are present.

### Runtime invariants (verbatim from SDS)

- Step status stays `"waiting_for_bridge"` after a successful or failed bridge attempt. **No** new `StepRuntimeStatus = "bridge_ready"` value. Derived readiness is a CLI-only view.
- `ExecutionEngine` owns all `StepRuntimeState` mutation. `StepRunner` is **unchanged**.
- The caller of `buildExecutiveRemediationProposal` supplies the canonical proposal ID (e.g., `proposal-${randomUUID()}`). The builder stamps that ID onto the proposal. The bridge does **not** rely on `ProposalStore.save()` mutating the input — `ProposalStore.save()` is `Promise<void>` and validates that `id` is a non-empty string at write time. The wrapper captures `draft.id` (already known, no post-save read).
- The bridge dispatch lives in `ExecutionEngine.executeStepInternal` (the shared internal path), so both `runStep` (manual single-step) and `runReadySteps` (batch) get identical bridge behavior. Do **not** scope the dispatch to `runReadySteps` only.
- Payload shape — no fake typed fields:
  ```ts
  payload: {
    source: "executive_bridge",
    bridgeVersion: EXECUTIVE_BRIDGE_VERSION,   // "1.0"
    planId, stepId, objectiveId, subsystem, riskLevel,
    requiresHumanSpecification: true,
    requestedFields: ["action", "target", "payload"],
  }
  ```
- Idempotency is caller-driven: `ExecutionEngine` checks `stepState.generatedArtifacts` for an existing `{ type: "proposal", id }` ref before calling the bridge. If present, silent no-op — no proposal, no evidence.
- On `ProposalStore.save()` throw: `stepState.warnings.push(...)`; evidence `executive_step_bridge_failed` recorded; status stays `"waiting_for_bridge"`; engine retries on next `runReadySteps` call.

### Evidence contract (verbatim from SDS)

Exactly **two** new evidence event types:

| Event type | When | Payload |
|---|---|---|
| `executive_step_bridged_to_proposal` | Successful bridge, first creation only | `{ planId, stepId, proposalId, bridgeVersion }` |
| `executive_step_bridge_failed` | `ProposalStore.save()` throws | `{ planId, stepId, error }` |

`executive_step_bridge_purged` is **deferred to P10.4c**. Do not reserve it.

### Files NOT modified (explicit)

- `src/executive/step-runner.ts` — unchanged. Engine owns the bridge write.
- `src/executive/executive-plan-types.ts` — no new `StepRuntimeStatus`.

### Existing-code invariants (do not break)

- All 1860 existing tests must continue to pass.
- `tsc --noEmit` must remain clean.
- `ProposalAction` remains a closed union — only the one documented additive member is added.
- `provenance` remains a closed union (`"auto" | "manual"`) — only the documented value `"manual"` is used for executive-bridged proposals.

---

## File structure

| File | Status | Role |
|---|---|---|
| `src/adaptation/adaptation-types.ts` | modify | +1 `ProposalAction` member, +1 `ProposalTarget` kind |
| `src/executive/executive-bridge.ts` | create | Pure builder + effectful wrapper |
| `src/executive/execution-engine.ts` | modify | Add bridge dispatch for `create_remediation_proposal` steps |
| `tests/executive/executive-bridge.vitest.ts` | create | 25 tests across 6 describes |
| `tests/adaptation/adaptation-types-p10-4b-snapshot.vitest.ts` | create | 3 source-text grep sentinel tests |
| `tests/executive/executive-sentinels.vitest.ts` | modify | Add `executive-bridge.ts` to `EXECUTIVE_FILES` allowlist |

---

## Task decomposition rationale

The tasks are ordered so each one compiles and tests green before the next lands. Task 1 extends the protected type file under ADR-0004 with a sentinel that immediately locks the change. Task 2 builds the pure builder (no I/O). Task 3 wraps it with an effectful bridge (no global state mutation). Task 4 wires the engine. Task 5 locks the protected type invariant with source-text greps. Task 6 finalizes the executive purity sentinel and runs the whole suite.

The bridge is intentionally a small surface — the design avoids premature complexity (no retry queue, no batch API, no proposal-store injection into the bridge — the bridge receives the save callback). Future phases (P10.4c) extend the same surface.

---

### Task 1: Extend `adaptation-types.ts` with additive union members

**Files:**
- Modify: `src/adaptation/adaptation-types.ts` (two narrow insertions)
- Test: `tests/adaptation/adaptation-types-p10-4b-snapshot.vitest.ts` (created in Task 5, but Tests 1 and 2 of it apply here)

**Interfaces:**
- Consumes: existing `ProposalAction`, `ProposalTarget` unions.
- Produces: `ProposalAction` now includes `"executive_remediation_request"`. `ProposalTarget` now includes `{ kind: "executive_remediation"; planId: string; stepId: string; objectiveId: string; subsystem: ExecutiveSubsystemName }`.

- [ ] **Step 1: Add `"executive_remediation_request"` to `ProposalAction`**

In `src/adaptation/adaptation-types.ts`, locate the `ProposalAction` union (search for `export type ProposalAction`). Add the new member as the **last** variant:

```ts
export type ProposalAction =
  | "create_agent_card"
  | "update_agent_card"
  | "add_capability"
  | "create_improvement_issue"
  | "adjust_skill_definition"
  | "suggest_routing_weight"
  | "revert_proposal"
  | "governance_change"
  | "executive_remediation_request";   // P10.4b — additive under ADR-0004
```

- [ ] **Step 2: Add the new `ProposalTarget` kind**

In the same file, locate the `ProposalTarget` discriminated union. Add the new variant. The new variant carries the executive context inline so downstream tools can filter by origin without parsing payload:

```ts
export type ProposalTarget =
  | { kind: "agent_card"; agentId: string }
  | { kind: "skill"; skillId: string }
  | { kind: "github_issue"; issueNumber: number }
  | { kind: "routing_weight"; routeKey: string }
  | { kind: "revert"; sourceProposalId: string }
  | { kind: "governance"; recommendationId: string }
  | { kind: "policy_coverage"; policyId: string }
  | {
      kind: "executive_remediation";   // P10.4b — additive under ADR-0004
      planId: string;
      stepId: string;
      objectiveId: string;
      subsystem: ExecutiveSubsystemName;
    };
```

- [ ] **Step 3: Add the `ExecutiveSubsystemName` import**

At the top of `src/adaptation/adaptation-types.ts`, add:

```ts
import type { ExecutiveSubsystemName } from "../executive/executive-health.js";
```

Verify the import path resolves by running:

```bash
test -f src/executive/executive-health.ts && echo "ok"
```

Expected: `ok`.

- [ ] **Step 4: Run `tsc --noEmit` to verify the additive union compiles**

```bash
npx tsc --noEmit
```

Expected: clean exit. The two additive members cause no compile errors; existing tests/usage are unaffected.

- [ ] **Step 5: Run the full test suite to verify no regressions**

```bash
npx vitest run
```

Expected: 1860 passing, 0 failing.

- [ ] **Step 6: Commit**

```bash
git add src/adaptation/adaptation-types.ts
git commit -m "feat(p10-4b): extend adaptation-types.ts with executive_remediation union members"
```

---

### Task 2: `buildExecutiveRemediationProposal` — pure builder

**Files:**
- Create: `src/executive/executive-bridge.ts`
- Create: `tests/executive/executive-bridge.vitest.ts` (skeleton with 15 preconditions + output-shape tests)

**Interfaces:**
- Consumes: a `PersistedExecutionPlan`, an `ExecutionStep` (must have `action === "create_remediation_proposal"`), a `proposalId: string` (caller-supplied canonical ID, e.g., `proposal-${randomUUID()}`), and a `now: string` (ISO timestamp).
- Produces: `AdaptationProposal` with `id: proposalId` (non-empty, satisfies `ProposalStore.validateShape`), `status: "pending"`, `action: "executive_remediation_request"`, `target: { kind: "executive_remediation", planId, stepId, objectiveId, subsystem }`, `provenance: "manual"`, `payload` per SDS, `evidenceFingerprints: []`, `sourceConfidence: 0`, `createdAt: now`.

**Why the caller supplies the ID, not the store:** `ProposalStore.save(proposal)` is `Promise<void>` and validates `proposal.id` as a non-empty string *before* writing (see `src/adaptation/proposal-store.ts:14-28`). It does not mutate the input. The bridge must assign the ID itself; relying on `save()` to backfill would break validation.

- [ ] **Step 1: Write the failing precondition tests**

Create `tests/executive/executive-bridge.vitest.ts` with the precondition block:

```ts
import { describe, expect, it } from "vitest";
import { buildExecutiveRemediationProposal } from "../../src/executive/executive-bridge.js";
import type { PersistedExecutionPlan } from "../../src/executive/executive-plan-types.js";
import type { ExecutionStep } from "../../src/executive/planning-engine.js";

const NOW = "2026-06-25T12:00:00.000Z";
const PROPOSAL_ID = "proposal-test-1";

function makeStep(overrides: Partial<ExecutionStep> = {}): ExecutionStep {
  return {
    id: "step-obj-1-governance-create_remediation_proposal",
    action: "create_remediation_proposal",
    title: "Create remediation proposal",
    stepNumber: 2,
    targetSubsystem: "governance",
    dependsOn: ["step-obj-1-governance-diagnose_root_cause"],
    status: "pending",
    objectiveId: "obj-1",
    priorityScore: 80,
    objectiveScore: 75,
    riskLevel: "high",
    ...overrides,
  };
}

function makePlan(step: ExecutionStep): PersistedExecutionPlan {
  return {
    id: "plan-1",
    objectives: ["obj-1"],
    steps: [step],
    generatedAt: NOW,
    windowDays: 7,
    planStatus: "draft",
    plannerVersion: "1.0",
    planningAlgorithm: "template-v1",
    contentHash: "deadbeef",
  };
}

describe("buildExecutiveRemediationProposal (pure) — preconditions", () => {
  it("throws when step.action is not create_remediation_proposal", () => {
    const step = makeStep({ action: "apply_remediation" });
    const plan = makePlan(step);
    expect(() => buildExecutiveRemediationProposal(plan, step, PROPOSAL_ID, NOW)).toThrow(
      /create_remediation_proposal/,
    );
  });

  it("throws when step.objectiveId is missing", () => {
    const step = makeStep({ objectiveId: "" });
    const plan = makePlan(step);
    expect(() => buildExecutiveRemediationProposal(plan, step, PROPOSAL_ID, NOW)).toThrow(
      /objectiveId/,
    );
  });

  it("throws when step.targetSubsystem is not a valid ExecutiveSubsystemName", () => {
    const step = makeStep({ targetSubsystem: "unknown" as ExecutionStep["targetSubsystem"] });
    const plan = makePlan(step);
    expect(() => buildExecutiveRemediationProposal(plan, step, PROPOSAL_ID, NOW)).toThrow(
      /subsystem/i,
    );
  });

  it("throws when proposalId is empty (ProposalStore.save would reject)", () => {
    const step = makeStep();
    const plan = makePlan(step);
    expect(() => buildExecutiveRemediationProposal(plan, step, "", NOW)).toThrow(
      /proposalId/,
    );
  });
});
```

Run:

```bash
npx vitest run tests/executive/executive-bridge.vitest.ts
```

Expected: FAIL — `Cannot find module '../../src/executive/executive-bridge.js'`.

- [ ] **Step 2: Create the file with the constant and the builder skeleton**

Create `src/executive/executive-bridge.ts`:

```ts
/**
 * P10.4b — Executive Proposal Bridge.
 *
 * Bridges P10.4a `create_remediation_proposal` step kind into the existing
 * P5/P9 `AdaptationProposal` lifecycle as a **pending** proposal.
 *
 * HARD BOUNDARY: this module may only CREATE pending proposals.
 * It may not approve, apply, or reject proposals.
 *
 * Two functions:
 *  - `buildExecutiveRemediationProposal` (pure) — produces an `AdaptationProposal`
 *  - `bridgeCreateRemediationProposal` (effectful) — wraps the pure builder with
 *    a `ProposalStore.save()` callback and captures the saved ID
 *
 * Idempotency is caller-driven: `ExecutionEngine` checks
 * `stepState.generatedArtifacts` before calling the bridge.
 *
 * @module
 */

import type { AdaptationProposal } from "../adaptation/adaptation-types.js";
import type { PersistedExecutionPlan } from "./executive-plan-types.js";
import type { ExecutionStep } from "./planning-engine.js";
import type { ExecutiveSubsystemName } from "./executive-health.js";

/** Bump when the bridge payload schema changes. Persisted on every proposal. */
export const EXECUTIVE_BRIDGE_VERSION = "1.0";

const VALID_SUBSYSTEMS: readonly ExecutiveSubsystemName[] = [
  "governance", "security", "adaptation", "learning",
  "memory", "tools", "workflow", "agents",
];

/**
 * PURE: build a pending `AdaptationProposal` that bridges an executive step
 * into the existing P5/P9 mutation lifecycle.
 *
 * The returned proposal is **intentionally incomplete** — `payload.action`,
 * `payload.target`, and `payload.payload` are filled by a human via the
 * existing `alix adaptation` lifecycle. The proposal surfaces
 * `requiresHumanSpecification: true` and an explicit `requestedFields` list
 * so the human-facing surface can guide the user.
 *
 * The caller supplies the canonical proposal ID — `ProposalStore.save()`
 * validates `id` as a non-empty string and writes under `${id}.json`.
 *
 * @throws when proposalId is empty
 * @throws when step.action is not `create_remediation_proposal`
 * @throws when step.objectiveId is empty
 * @throws when step.targetSubsystem is not a valid ExecutiveSubsystemName
 */
export function buildExecutiveRemediationProposal(
  plan: PersistedExecutionPlan,
  step: ExecutionStep,
  proposalId: string,
  now: string,
): AdaptationProposal {
  if (!proposalId) {
    throw new Error("Executive bridge requires a non-empty proposalId");
  }
  if (step.action !== "create_remediation_proposal") {
    throw new Error(
      `Executive bridge requires action="create_remediation_proposal"; received "${step.action}"`,
    );
  }
  if (!step.objectiveId) {
    throw new Error(
      `Executive bridge requires step.objectiveId; step "${step.id}" has none`,
    );
  }
  if (!VALID_SUBSYSTEMS.includes(step.targetSubsystem)) {
    throw new Error(
      `Executive bridge received invalid subsystem "${String(step.targetSubsystem)}" for step "${step.id}"`,
    );
  }

  return {
    id: proposalId,
    status: "pending",
    action: "executive_remediation_request",
    target: {
      kind: "executive_remediation",
      planId: plan.id,
      stepId: step.id,
      objectiveId: step.objectiveId,
      subsystem: step.targetSubsystem,
    },
    provenance: "manual",
    reason: `Executive remediation requested by plan "${plan.id}" step "${step.id}"`,
    createdAt: now,
    evidenceFingerprints: [],
    sourceConfidence: 0,
    payload: {
      source: "executive_bridge",
      bridgeVersion: EXECUTIVE_BRIDGE_VERSION,
      planId: plan.id,
      stepId: step.id,
      objectiveId: step.objectiveId,
      subsystem: step.targetSubsystem,
      riskLevel: step.riskLevel,
      requiresHumanSpecification: true,
      requestedFields: ["action", "target", "payload"],
    },
  };
}
```

- [ ] **Step 3: Run the precondition tests**

```bash
npx vitest run tests/executive/executive-bridge.vitest.ts
```

Expected: 4/4 precondition tests pass (action + objectiveId + subsystem + proposalId).

- [ ] **Step 4: Append the 12 output-shape tests**

Append to the same `describe` block (after the preconditions):

```ts
describe("buildExecutiveRemediationProposal (pure) — output shape", () => {
  const step = makeStep();
  const plan = makePlan(step);
  const result = buildExecutiveRemediationProposal(plan, step, PROPOSAL_ID, NOW);

  it("emits status='pending'", () => {
    expect(result.status).toBe("pending");
  });

  it("emits action='executive_remediation_request'", () => {
    expect(result.action).toBe("executive_remediation_request");
  });

  it("emits target.kind='executive_remediation' with planId/stepId/objectiveId/subsystem", () => {
    expect(result.target.kind).toBe("executive_remediation");
    if (result.target.kind !== "executive_remediation") return; // narrow for TS
    expect(result.target.planId).toBe("plan-1");
    expect(result.target.stepId).toBe(step.id);
    expect(result.target.objectiveId).toBe("obj-1");
    expect(result.target.subsystem).toBe("governance");
  });

  it("emits provenance='manual'", () => {
    expect(result.provenance).toBe("manual");
  });

  it("emits id=proposalId (caller-supplied canonical ID; ProposalStore.save accepts non-empty id)", () => {
    expect(result.id).toBe(PROPOSAL_ID);
  });

  it("emits createdAt from the supplied now argument", () => {
    expect(result.createdAt).toBe(NOW);
  });

  it("emits payload.source='executive_bridge'", () => {
    expect(result.payload.source).toBe("executive_bridge");
  });

  it("emits payload.bridgeVersion=EXECUTIVE_BRIDGE_VERSION", () => {
    expect(result.payload.bridgeVersion).toBe(EXECUTIVE_BRIDGE_VERSION);
  });

  it("emits payload.requiresHumanSpecification=true", () => {
    expect(result.payload.requiresHumanSpecification).toBe(true);
  });

  it("emits payload.requestedFields=['action','target','payload']", () => {
    expect(result.payload.requestedFields).toEqual(["action", "target", "payload"]);
  });

  it("emits payload.riskLevel from the step", () => {
    expect(result.payload.riskLevel).toBe(step.riskLevel);
  });

  it("emits reason citing planId and stepId", () => {
    expect(result.reason).toContain(plan.id);
    expect(result.reason).toContain(step.id);
  });

  it("emits evidenceFingerprints=[]", () => {
    expect(result.evidenceFingerprints).toEqual([]);
  });

  it("emits sourceConfidence=0", () => {
    expect(result.sourceConfidence).toBe(0);
  });
});
```

- [ ] **Step 5: Run the output-shape tests**

```bash
npx vitest run tests/executive/executive-bridge.vitest.ts
```

Expected: 16/16 pass (4 precondition + 12 output-shape).

- [ ] **Step 6: Commit**

```bash
git add src/executive/executive-bridge.ts tests/executive/executive-bridge.vitest.ts
git commit -m "feat(p10-4b): add pure executive proposal builder"
```

---

### Task 3: `bridgeCreateRemediationProposal` — effectful wrapper

**Files:**
- Modify: `src/executive/executive-bridge.ts` (append the wrapper)
- Modify: `tests/executive/executive-bridge.vitest.ts` (append 5 wrapper tests)

**Interfaces:**
- Consumes: `PersistedExecutionPlan`, `ExecutionStep`, `proposalId: string` (caller-supplied canonical ID), `now: string`, and `append: (proposal: AdaptationProposal) => Promise<void>` (the `ProposalStore.save` callback).
- Produces: `ExecutiveBridgeResult` with `proposal` (the persisted proposal — ID is the same `proposalId` passed in, because `ProposalStore.save` is `Promise<void>` and does not mutate) and `artifactRef: { type: "proposal"; id: proposalId }`.

**Why no "capture saved.id" logic:** `ProposalStore.save()` is `Promise<void>` and validates `id` as non-empty *before* writing. It does not backfill or rewrite. The bridge supplies the canonical ID up-front; `artifactRef.id === proposalId` is known before `append()` runs.

- [ ] **Step 1: Append the wrapper type and function**

Append to `src/executive/executive-bridge.ts`:

```ts
import type { GeneratedArtifactRef } from "./executive-plan-types.js";

/** Result of bridging one executive step into the proposal lifecycle. */
export interface ExecutiveBridgeResult {
  /** The saved proposal — `proposal.id` reflects the canonical ID assigned by `ProposalStore.save`. */
  proposal: AdaptationProposal;
  /** Durable cross-reference key appended to `StepRuntimeState.generatedArtifacts`. */
  artifactRef: GeneratedArtifactRef;
}

/**
 * EFFECTFUL: wrap `buildExecutiveRemediationProposal` with a `ProposalStore.save`
 * callback and return the durable reference the engine should append to
 * `StepRuntimeState.generatedArtifacts`.
 *
 * The wrapper does NOT mutate any global state — the caller drives
 * `StepRuntimeState`. This function only persists one proposal and returns the
 * reference the caller should record.
 *
 * @throws any error thrown by `append` — caller decides whether to retry.
 */
export async function bridgeCreateRemediationProposal(
  plan: PersistedExecutionPlan,
  step: ExecutionStep,
  proposalId: string,
  now: string,
  append: (proposal: AdaptationProposal) => Promise<void>,
): Promise<ExecutiveBridgeResult> {
  const draft = buildExecutiveRemediationProposal(plan, step, proposalId, now);
  await append(draft);
  return {
    proposal: draft,
    artifactRef: { type: "proposal", id: proposalId },
  };
}
```

- [ ] **Step 2: Write the 5 failing wrapper tests**

Append to `tests/executive/executive-bridge.vitest.ts`:

```ts
import {
  bridgeCreateRemediationProposal,
  type ExecutiveBridgeResult,
} from "../../src/executive/executive-bridge.js";

describe("bridgeCreateRemediationProposal (effectful wrapper)", () => {
  const step = makeStep();
  const plan = makePlan(step);

  it("calls append() exactly once with the built proposal", async () => {
    const calls: unknown[] = [];
    const append = async (p: unknown) => {
      calls.push(p);
    };
    await bridgeCreateRemediationProposal(plan, step, PROPOSAL_ID, NOW, append as never);
    expect(calls).toHaveLength(1);
    expect((calls[0] as { action: string }).action).toBe("executive_remediation_request");
    expect((calls[0] as { id: string }).id).toBe(PROPOSAL_ID);
  });

  it("returns ExecutiveBridgeResult with proposal.id === supplied proposalId (ProposalStore does not mutate)", async () => {
    const append = async () => { /* no-op */ };
    const result: ExecutiveBridgeResult = await bridgeCreateRemediationProposal(
      plan, step, PROPOSAL_ID, NOW, append as never,
    );
    expect(result.proposal.id).toBe(PROPOSAL_ID);
  });

  it("returns artifactRef { type: 'proposal', id: proposalId }", async () => {
    const append = async () => { /* no-op */ };
    const result = await bridgeCreateRemediationProposal(plan, step, PROPOSAL_ID, NOW, append as never);
    expect(result.artifactRef).toEqual({ type: "proposal", id: PROPOSAL_ID });
  });

  it("propagates errors thrown by append()", async () => {
    const append = async () => {
      throw new Error("disk full");
    };
    await expect(
      bridgeCreateRemediationProposal(plan, step, PROPOSAL_ID, NOW, append as never),
    ).rejects.toThrow(/disk full/);
  });

  it("does NOT mutate any global state — caller drives StepRuntimeState", async () => {
    const append = async () => { /* no-op */ };
    const result = await bridgeCreateRemediationProposal(plan, step, PROPOSAL_ID, NOW, append as never);
    // The wrapper returns references — it does not touch any module-level state.
    // If global state were introduced later, this test would catch it.
    expect(result.artifactRef.type).toBe("proposal");
  });
});
```

- [ ] **Step 3: Run the wrapper tests**

```bash
npx vitest run tests/executive/executive-bridge.vitest.ts
```

Expected: 21/21 pass (4 + 12 + 5).

- [ ] **Step 4: Commit**

```bash
git add src/executive/executive-bridge.ts tests/executive/executive-bridge.vitest.ts
git commit -m "feat(p10-4b): add effectful bridgeCreateRemediationProposal wrapper"
```

---

### Task 4: Purity invariant tests

**Files:**
- Modify: `tests/executive/executive-bridge.vitest.ts` (append 4 purity tests)

**Purpose:** Source-text greps against `src/executive/executive-bridge.ts` to assert the bridge does not import any mutation-side module. Mirrors the P9.5 purity sentinel pattern.

- [ ] **Step 1: Append the 4 purity tests**

Append to `tests/executive/executive-bridge.vitest.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const BRIDGE_SRC = resolve(REPO_ROOT, "src/executive/executive-bridge.ts");

function readBridgeSource(): string {
  return readFileSync(BRIDGE_SRC, "utf8");
}

describe("P10.4b purity invariants (source-text greps)", () => {
  it("executive-bridge.ts does not import ProposalStore directly", () => {
    const src = readBridgeSource();
    expect(src).not.toMatch(/from\s+["'][^"']*proposal-store/);
    expect(src).not.toMatch(/import\s+\{[^}]*ProposalStore[^}]*\}\s+from/);
  });

  it("executive-bridge.ts does not import ApprovalGate", () => {
    const src = readBridgeSource();
    expect(src).not.toMatch(/ApprovalGate/);
  });

  // Only inspect import lines — docstrings are allowed to mention "apply" (bridge hard-boundary contract).
  it("executive-bridge.ts does not import any applier", () => {
    const src = readBridgeSource();
    const importLines = src
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line));
    const importBlob = importLines.join("\n");
    expect(importBlob).not.toMatch(/Applier/);
    expect(importBlob).not.toMatch(/apply/i);
  });

  it("executive-bridge.ts only depends on types from adaptation-types.ts (plus its own executive types)", () => {
    const src = readBridgeSource();
    // Allowed: adaptation-types (types only), executive-health, executive-plan-types, planning-engine, the file's own directory.
    const forbiddenImportPaths = [
      /from\s+["'][^"']*approval-gate/,
      /from\s+["'][^"']*proposal-store/,
      /from\s+["'][^"']*step-runner/,
      /from\s+["'][^"']*execution-state-store/,
      /from\s+["'][^"']*plan-store/,
    ];
    for (const pattern of forbiddenImportPaths) {
      expect(src).not.toMatch(pattern);
    }
  });
});
```

- [ ] **Step 2: Run the purity tests**

```bash
npx vitest run tests/executive/executive-bridge.vitest.ts
```

Expected: 25/25 pass (4 + 12 + 5 + 4).

- [ ] **Step 3: Commit**

```bash
git add tests/executive/executive-bridge.vitest.ts
git commit -m "test(p10-4b): add purity invariant source-text grep tests"
```

---

### Task 5: Wire the bridge into `ExecutionEngine.executeStepInternal` (shared internal path)

**Files:**
- Modify: `src/executive/execution-engine.ts` (add bridge dispatch in the shared internal path used by both `runStep` and `runReadySteps`)

**Why the shared path, not `runReadySteps`:** Both `runStep(planId, stepId)` (manual single-step) and `runReadySteps(planId)` (batch) delegate to the same private method `executeStepInternal(planId, stepId, executionId)` (see `src/executive/execution-engine.ts:127`). Inserting the bridge dispatch in `executeStepInternal` ensures both entry points produce identical behavior for `create_remediation_proposal` steps. Inserting only in `runReadySteps` would create a silent inconsistency where `runStep` skips the bridge.

**Interfaces:**
- Consumes: existing `ExecutionEngine.executeStepInternal`. Steps with `action === "create_remediation_proposal"` get a new branch: idempotency check → `bridgeCreateRemediationProposal` → `generatedArtifacts.push(...)` → evidence write. On throw: `warnings.push(...)` → `executive_step_bridge_failed` evidence → status unchanged.

- [ ] **Step 1: Add the import to `execution-engine.ts`**

At the top of `src/executive/execution-engine.ts`, add:

```ts
import { randomUUID } from "node:crypto";
import { bridgeCreateRemediationProposal, EXECUTIVE_BRIDGE_VERSION } from "./executive-bridge.js";
```

(`randomUUID` is already imported in the file; verify and skip if present. Add it if missing.)

- [ ] **Step 2: Add `proposalStore` as an optional constructor parameter**

In `src/executive/execution-engine.ts`, locate the `ExecutionEngine` constructor. Add `proposalStore` as the **last** optional parameter. Existing constructors that pass fewer arguments must still work.

```ts
import type { ProposalStore } from "../adaptation/proposal-store.js";

// In the class signature:
constructor(
  private readonly planStore: PlanStore,
  private readonly stateStore: ExecutionStateStore,
  private readonly stepRunner: StepRunner,
  private readonly evidenceWriter: EvidenceEventWriter,
  private readonly proposalStore?: ProposalStore,  // P10.4b — optional for backward compat
) {}
```

If `proposalStore` is absent, the bridge branch is skipped (the step falls through to standard execution). This preserves backward compatibility for any existing tests/fixtures that don't pass `proposalStore`.

- [ ] **Step 3: Insert the bridge dispatch in `executeStepInternal`**

In `src/executive/execution-engine.ts`, locate the private method `executeStepInternal(planId, stepId, executionId)` (around line 127). The current code is:

```ts
// Execute via StepRunner (planId + executionId passed, never generated here)
const result = await this.runner.execute(planId, step, executionId);

// Mark terminal based on runner result
const finalState = this.stateStore.update( ... );
```

Insert the bridge dispatch **between the runner call and the state-update call**, with a guard for the optional `proposalStore`. The dispatch is a no-op when the action is anything other than `create_remediation_proposal`:

```ts
// Execute via StepRunner (planId + executionId passed, never generated here)
const result = await this.runner.execute(planId, step, executionId);

// ─── P10.4b executive bridge dispatch ─────────────────────────────
// Bridge `create_remediation_proposal` steps into the existing P5/P9
// proposal lifecycle. Idempotent: silent no-op if generatedArtifacts
// already contains a { type: "proposal" } ref. The status stays
// "waiting_for_bridge" — a human completes the proposal via the
// existing alix adaptation lifecycle.
if (step.action === "create_remediation_proposal" && this.proposalStore) {
  const stepState = this.stateStore.load(planId)?.stepStates[stepId];
  const existingRef = stepState?.generatedArtifacts.find(
    (a) => a.type === "proposal",
  );
  if (!existingRef) {
    const proposalId = `proposal-${randomUUID()}`;
    const now = new Date().toISOString();
    try {
      const bridgeResult = await bridgeCreateRemediationProposal(
        plan, step, proposalId, now,
        (proposal) => this.proposalStore!.save(proposal),
      );
      this.stateStore.update(
        planId,
        { from: state.status, to: state.status, executionId },
        s => {
          if (s.stepStates[stepId]) {
            s.stepStates[stepId].generatedArtifacts.push(bridgeResult.artifactRef);
          }
          return s;
        },
      );
      await this.evidenceWriter.append({
        type: "executive_step_bridged_to_proposal",
        payload: {
          planId: plan.id,
          stepId: step.id,
          proposalId: bridgeResult.proposal.id,
          bridgeVersion: EXECUTIVE_BRIDGE_VERSION,
        },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.stateStore.update(
        planId,
        { from: state.status, to: state.status, executionId },
        s => {
          if (s.stepStates[stepId]) {
            s.stepStates[stepId].warnings.push(`executive bridge failed: ${msg}`);
            // status stays "waiting_for_bridge" — engine retries on next execution
          }
          return s;
        },
      );
      await this.evidenceWriter.append({
        type: "executive_step_bridge_failed",
        payload: { planId: plan.id, stepId: step.id, error: msg },
      });
    }
  }
}

// Mark terminal based on runner result (status may remain "waiting_for_bridge"
// for create_remediation_proposal steps — that is intentional).
const finalState = this.stateStore.update( ... );
```

**Why this insertion point (before the terminal-state write, not after):** the runner's `result.newStepStatus` for `create_remediation_proposal` is already `"waiting_for_bridge"` (per P10.4a `STEP_BEHAVIOR`), so the terminal-state write preserves that. Inserting the bridge before the write lets the bridge mutate `generatedArtifacts` and `warnings` via the same `stateStore.update` pattern the rest of the engine uses — keeping `StepRuntimeState` mutations funneled through one mechanism.

- [ ] **Step 4: Run `tsc --noEmit` to verify the dispatch compiles**

```bash
npx tsc --noEmit
```

Expected: clean exit.

- [ ] **Step 5: Run the full test suite**

```bash
npx vitest run
```

Expected: 1860+ passing (existing tests unaffected because `proposalStore` is optional and the branch only fires when present, and because the step's existing `newStepStatus` is already `"waiting_for_bridge"` so the terminal-state write is unchanged for the happy path).

- [ ] **Step 6: Commit**

```bash
git add src/executive/execution-engine.ts
git commit -m "feat(p10-4b): wire executive bridge dispatch into ExecutionEngine.executeStepInternal"
```

---

### Task 5b: Engine dispatch integration test (idempotency + failure + runStep parity)

**Files:**
- Create: `tests/executive/execution-engine-bridge-dispatch.vitest.ts`

**Purpose:** Integration test that exercises the engine's new dispatch branch end-to-end with a fake `StepRunner`, a fake `ProposalStore`, and a fake `EvidenceEventWriter`. Validates: (a) success path through `runReadySteps` writes one proposal + one bridge evidence; (b) idempotency — second call silent; (c) failure path — warning + failed evidence, status unchanged; (d) **`runStep` parity** — manual single-step entry point produces identical bridge behavior to `runReadySteps`. This test catches the "wire only into `runReadySteps`" bug explicitly.

The fake `StepRunner` must match the actual signature `execute(planId, step, executionId): Promise<StepRunnerResult>` (see `src/executive/step-runner.ts:31`). The fake stores must match what `executeStepInternal` actually calls: `planStore.load(planId)`, `stateStore.load(planId)`, `stateStore.update(planId, transition, mutator)`.

- [ ] **Step 1: Write the 4 dispatch tests**

Create `tests/executive/execution-engine-bridge-dispatch.vitest.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { ExecutionEngine } from "../../src/executive/execution-engine.js";
import type { PlanStore } from "../../src/executive/plan-store.js";
import type { ExecutionStateStore } from "../../src/executive/execution-state-store.js";
import type { StepRunner, StepRunnerResult } from "../../src/executive/step-runner.js";
import type { EvidenceEventWriter } from "../../src/workflow/evidence-writer.js";
import type { ProposalStore } from "../../src/adaptation/proposal-store.js";
import type {
  PersistedExecutionPlan,
  PlanExecutionState,
  StepRuntimeState,
  PlanTransition,
} from "../../src/executive/executive-plan-types.js";
import type { ExecutionStep } from "../../src/executive/planning-engine.js";
import type { AdaptationProposal } from "../../src/adaptation/adaptation-types.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NOW = "2026-06-25T12:00:00.000Z";
const STEP_ID = "step-obj-1-governance-create_remediation_proposal";

function makeStep(): ExecutionStep {
  return {
    id: STEP_ID,
    action: "create_remediation_proposal",
    title: "Create remediation proposal",
    stepNumber: 2,
    targetSubsystem: "governance",
    dependsOn: [],
    status: "pending",
    objectiveId: "obj-1",
    priorityScore: 80,
    objectiveScore: 75,
    riskLevel: "high",
  };
}

function makePlan(): PersistedExecutionPlan {
  return {
    id: "plan-1",
    objectives: ["obj-1"],
    steps: [makeStep()],
    generatedAt: NOW,
    windowDays: 7,
    planStatus: "draft",
    plannerVersion: "1.0",
    planningAlgorithm: "template-v1",
    contentHash: "deadbeef",
  };
}

interface FakeStores {
  engine: ExecutionEngine;
  planStore: PlanStore;
  stateStore: ExecutionStateStore & {
    _state: PlanExecutionState;
  };
  evidenceEvents: Array<{ type: string; payload: Record<string, unknown> }>;
  proposalStore: ProposalStore & { _saved: AdaptationProposal[] };
}

function makeEngine(opts: {
  proposalSaveImpl?: (p: AdaptationProposal) => Promise<void>;
  initialPlanStatus?: "draft" | "approved" | "running";
} = {}): FakeStores & { tmpDir: string } {
  const evidenceEvents: FakeStores["evidenceEvents"] = [];
  const saved: AdaptationProposal[] = [];
  const tmpDir = mkdtempSync(join(tmpdir(), "p10-4b-test-"));

  const plan = makePlan();
  const planStore = {
    load(id: string) {
      return id === "plan-1" ? plan : null;
    },
  } as unknown as PlanStore;

  const initialState: PlanExecutionState = {
    planId: "plan-1",
    status: opts.initialPlanStatus ?? "running",
    approval: { status: "approved" },
    stepStates: {
      [STEP_ID]: {
        status: "pending",
        evidenceIds: [],
        generatedArtifacts: [],
        warnings: [],
      },
    },
    planTransitions: [],
    timestamps: { createdAt: NOW },
  };

  const stateStore = {
    _state: initialState,
    load(planId: string) {
      return planId === "plan-1" ? this._state : null;
    },
    update(
      _planId: string,
      _transition: PlanTransition,
      mutator: (s: PlanExecutionState) => PlanExecutionState,
    ) {
      this._state = mutator(this._state);
      return this._state;
    },
  } as unknown as ExecutionStateStore & { _state: PlanExecutionState };

  const stepRunner: StepRunner = {
    async execute(_planId: string, _step: ExecutionStep, _executionId: string): Promise<StepRunnerResult> {
      return {
        outcome: "intent_recorded",
        durationMs: 1,
        generatedArtifacts: [],
        evidenceIds: [],
        warnings: [],
        retryable: false,
        newStepStatus: "waiting_for_bridge",
      };
    },
  } as unknown as StepRunner;

  const evidenceWriter = {
    async append(ev: { type: string; payload: Record<string, unknown> }) {
      evidenceEvents.push(ev);
    },
  } as unknown as EvidenceEventWriter;

  const proposalSaveImpl =
    opts.proposalSaveImpl ??
    (async (p: AdaptationProposal) => {
      saved.push(p);
    });

  const proposalStore = {
    _saved: saved,
    async save(p: AdaptationProposal) {
      await proposalSaveImpl(p);
    },
  } as unknown as ProposalStore & { _saved: AdaptationProposal[] };

  const engine = new ExecutionEngine(
    planStore, stateStore, stepRunner, evidenceWriter, proposalStore,
  );

  return { engine, planStore, stateStore, evidenceEvents, proposalStore, tmpDir };
}

describe("ExecutionEngine — executive bridge dispatch", () => {
  let stores: FakeStores & { tmpDir: string };

  beforeEach(() => {
    stores = makeEngine();
  });

  afterEach(() => {
    rmSync(stores.tmpDir, { recursive: true, force: true });
  });

  it("runReadySteps writes one proposal + one bridge evidence on first run", async () => {
    await stores.engine.runReadySteps("plan-1");
    expect(stores.proposalStore._saved).toHaveLength(1);
    expect(stores.proposalStore._saved[0].action).toBe("executive_remediation_request");
    expect(stores.proposalStore._saved[0].status).toBe("pending");
    expect(stores.proposalStore._saved[0].provenance).toBe("manual");
    const stepState = stores.stateStore._state.stepStates[STEP_ID];
    expect(stepState.generatedArtifacts).toHaveLength(1);
    expect(stepState.generatedArtifacts[0].type).toBe("proposal");
    expect(stores.evidenceEvents).toContainEqual(
      expect.objectContaining({ type: "executive_step_bridged_to_proposal" }),
    );
  });

  it("is idempotent — second runReadySteps writes nothing and no new evidence", async () => {
    await stores.engine.runReadySteps("plan-1");
    const firstCount = stores.proposalStore._saved.length;
    const firstEvidenceCount = stores.evidenceEvents.length;
    await stores.engine.runReadySteps("plan-1");
    expect(stores.proposalStore._saved).toHaveLength(firstCount);
    expect(stores.evidenceEvents).toHaveLength(firstEvidenceCount);
  });

  it("on save failure: appends warning + bridge_failed evidence; status stays waiting_for_bridge", async () => {
    const failing = makeEngine({
      proposalSaveImpl: async () => { throw new Error("disk full"); },
    });
    await failing.engine.runReadySteps("plan-1");
    const stepState = failing.stateStore._state.stepStates[STEP_ID];
    expect(stepState.warnings).toHaveLength(1);
    expect(stepState.warnings[0]).toMatch(/disk full/);
    expect(stepState.status).toBe("waiting_for_bridge");
    expect(failing.evidenceEvents).toContainEqual(
      expect.objectContaining({
        type: "executive_step_bridge_failed",
        payload: expect.objectContaining({ error: expect.stringMatching(/disk full/) }),
      }),
    );
    expect(failing.evidenceEvents).not.toContainEqual(
      expect.objectContaining({ type: "executive_step_bridged_to_proposal" }),
    );
  });

  it("runStep (manual single-step) gets identical bridge behavior to runReadySteps", async () => {
    // This test directly catches the "wire only into runReadySteps" bug.
    // If someone refactors the bridge dispatch back into runReadySteps alone,
    // runStep will skip the bridge and this test will fail (saved.length === 0).
    const single = makeEngine();
    await single.engine.runStep("plan-1", STEP_ID);
    expect(single.proposalStore._saved).toHaveLength(1);
    expect(single.proposalStore._saved[0].action).toBe("executive_remediation_request");
    const stepState = single.stateStore._state.stepStates[STEP_ID];
    expect(stepState.generatedArtifacts).toHaveLength(1);
    expect(single.evidenceEvents).toContainEqual(
      expect.objectContaining({ type: "executive_step_bridged_to_proposal" }),
    );
  });
});
```

- [ ] **Step 2: Run the dispatch tests**

```bash
npx vitest run tests/executive/execution-engine-bridge-dispatch.vitest.ts
```

Expected: 4/4 pass. **Critically: Test 4 passes only if the bridge lives in `executeStepInternal` (the shared path), not in `runReadySteps` alone.**

- [ ] **Step 3: Commit**

```bash
git add tests/executive/execution-engine-bridge-dispatch.vitest.ts
git commit -m "test(p10-4b): add ExecutionEngine bridge dispatch integration tests (incl. runStep parity)"
```

---

### Task 6: Source-text snapshot sentinel for `adaptation-types.ts`

**Files:**
- Create: `tests/adaptation/adaptation-types-p10-4b-snapshot.vitest.ts`

**Purpose:** Asserts both documented additions to the protected `adaptation-types.ts` are present. Uses the same source-text grep pattern as `tests/adaptation/outcome-sentinels.vitest.ts` (NOT the `protected-baselines.ts` snapshot-equal pattern — that is a future evolution per the SDS).

- [ ] **Step 1: Create the sentinel file**

Create `tests/adaptation/adaptation-types-p10-4b-snapshot.vitest.ts`:

```ts
/**
 * P10.4b — adaptation-types.ts additive invariant sentinel.
 *
 * Source-text greps assert that BOTH documented P10.4b additions are present
 * in src/adaptation/adaptation-types.ts:
 *  1. ProposalAction includes "executive_remediation_request"
 *  2. ProposalTarget includes { kind: "executive_remediation", ... }
 *
 * Per ADR-0004: protected type files are structurally protected, not byte-identical.
 * Additive union members are Allowed. The sentinel asserts presence of the
 * documented additions; it does not (and cannot, via source-text grep) prove
 * no other additions were made. Snapshot-equal sentinel pattern with
 * protected-baselines.ts is a future evolution.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const ADAPTATION_TYPES_PATH = resolve(REPO_ROOT, "src/adaptation/adaptation-types.ts");

function readAdaptationTypesSource(): string {
  return readFileSync(ADAPTATION_TYPES_PATH, "utf8");
}

describe("P10.4b — adaptation-types.ts additive invariant", () => {
  it("ProposalAction includes 'executive_remediation_request'", () => {
    const src = readAdaptationTypesSource();
    expect(src).toMatch(/"executive_remediation_request"/);
  });

  it("ProposalTarget includes 'executive_remediation' kind", () => {
    const src = readAdaptationTypesSource();
    expect(src).toMatch(/kind:\s*"executive_remediation"/);
  });

  it("executive-bridge.ts is in the executive directory allowlist", () => {
    // Cross-check: the new file is registered for executive-purity scanning.
    const allowlistPath = resolve(REPO_ROOT, "tests/executive/executive-sentinels.vitest.ts");
    const allowlistSrc = readFileSync(allowlistPath, "utf8");
    expect(allowlistSrc).toMatch(/"src\/executive\/executive-bridge\.ts"/);
  });
});
```

- [ ] **Step 2: Run the sentinel tests**

```bash
npx vitest run tests/adaptation/adaptation-types-p10-4b-snapshot.vitest.ts
```

Expected: 3/3 pass. (Tests 1 and 2 verify Task 1's additions. Test 3 will pass only after Task 7 adds the allowlist entry — run it again after Task 7 to confirm.)

- [ ] **Step 3: Commit**

```bash
git add tests/adaptation/adaptation-types-p10-4b-snapshot.vitest.ts
git commit -m "test(p10-4b): add source-text grep sentinel for adaptation-types.ts additions"
```

---

### Task 7: Add `executive-bridge.ts` to executive purity sentinel allowlist

**Files:**
- Modify: `tests/executive/executive-sentinels.vitest.ts` (one line added to `EXECUTIVE_FILES`)

- [ ] **Step 1: Add the allowlist entry**

In `tests/executive/executive-sentinels.vitest.ts`, locate the `EXECUTIVE_FILES` array. Add `"src/executive/executive-bridge.ts"` as the **last** entry before the closing `]`:

```ts
const EXECUTIVE_FILES = [
  "src/executive/executive-health.ts",
  "src/executive/priority-engine.ts",
  "src/executive/trend-store.ts",
  "src/executive/adapters/agent-health.ts",
  "src/executive/adapters/tool-health.ts",
  "src/executive/adapters/workflow-health.ts",
  "src/executive/adapters/memory-health.ts",
  "src/executive/adapters/security-health.ts",
  "src/executive/adapters/adaptation-health.ts",
  "src/cli/commands/executive-dashboard-renderer.ts",
  "src/cli/commands/executive-dashboard-handler.ts",
  "src/cli/commands/executive.ts",
  "src/executive/planning-engine.ts",
  "src/executive/objective-engine.ts",
  // P10.4a files
  "src/executive/step-behavior.ts",
  "src/executive/executive-plan-types.ts",
  "src/executive/plan-store.ts",
  "src/executive/execution-state-store.ts",
  "src/executive/plan-approval-gate.ts",
  "src/executive/step-runner.ts",
  "src/executive/execution-engine.ts",
  // P10.4b
  "src/executive/executive-bridge.ts",
];
```

- [ ] **Step 2: Run the executive sentinel tests**

```bash
npx vitest run tests/executive/executive-sentinels.vitest.ts
```

Expected: all existing executive-sentinel tests still pass + any new per-file scan over `executive-bridge.ts` (if the sentinel template iterates one test per file).

- [ ] **Step 3: Re-run the P10.4b sentinel test that checks the allowlist**

```bash
npx vitest run tests/adaptation/adaptation-types-p10-4b-snapshot.vitest.ts
```

Expected: 3/3 pass (Test 3 now also passes — the allowlist entry exists).

- [ ] **Step 4: Run the full test suite**

```bash
npx vitest run
```

Expected: 1860 + ~30 new tests pass, 0 failures.

- [ ] **Step 5: Run `tsc --noEmit`**

```bash
npx tsc --noEmit
```

Expected: clean exit.

- [ ] **Step 6: Commit**

```bash
git add tests/executive/executive-sentinels.vitest.ts
git commit -m "test(p10-4b): add executive-bridge.ts to executive purity sentinel allowlist"
```

---

### Task 8: Whole-branch review and PR

**Purpose:** Before merging, dispatch the broad code review skill to catch any cross-slice issues. Then merge via the finishing-a-development-branch skill.

- [ ] **Step 1: Run the full suite + tsc one final time**

```bash
npx vitest run && npx tsc --noEmit
```

Expected: green.

- [ ] **Step 2: Dispatch the final whole-branch review**

Use the code-review skill with `mode: recall-biased, scope: cross-slice`. Hand the reviewer the package for `merge_base..HEAD` so they see every commit in this branch.

- [ ] **Step 3: Address any Critical/Important findings**

If the reviewer returns findings, dispatch a single fix subagent (per the subagent-driven-development skill) with the complete findings list. Re-run the full suite after fixes.

- [ ] **Step 4: Merge the PR + tag**

Use the finishing-a-development-branch skill. Push the branch, open the PR, merge via squash, and tag `alix-p10-4b-complete`.

- [ ] **Step 5: Write memory file**

Append a memory file at `/home/babasola/.claude/projects/-home-babasola-Projects-Monolith/memory/p10-4b-executive-proposal-bridge-complete.md` following the project convention (cross-link to [[p10-4a-executive-execution-engine-complete]] and [[adr-0004-protected-type-files]]). Add a one-line pointer to `MEMORY.md`.

---

## Self-review (post-write checklist)

This plan was written against the locked SDS. Cross-checking:

1. **Spec coverage** — every locked invariant in the SDS is reflected in a task:
   - Hard boundary ✓ (Global Constraints + Task 1 type design)
   - `provenance: "manual"` (closed union, no extension) ✓ (Task 1 builder)
   - Step status stays `"waiting_for_bridge"` ✓ (Task 5 dispatch — `runner.execute` already returns `newStepStatus: "waiting_for_bridge"` for `create_remediation_proposal`, and the bridge does not transition status)
   - `ExecutionEngine` owns `StepRuntimeState` mutation ✓ (Task 5 — bridge funnels through `stateStore.update`)
   - **Caller supplies canonical `proposalId`** ✓ (Task 2 builder takes `proposalId` param — correction from SDS based on `ProposalStore.save()` validating non-empty id)
   - Bridge dispatch in **shared internal path** so `runStep` and `runReadySteps` both bridge ✓ (Task 5 inserts in `executeStepInternal`; Task 5b Test 4 asserts parity)
   - Payload shape with `requiresHumanSpecification: true` + `requestedFields` ✓ (Task 2 builder)
   - 2 evidence event types ✓ (Task 5 dispatch + Tasks 2–3 tests)
   - Idempotency caller-driven ✓ (Task 5 dispatch `generatedArtifacts.find(...)` + Task 5b Test 2)
   - Failure: warning + bridge_failed evidence, status unchanged ✓ (Task 5 catch block + Task 5b Test 3)
   - Sentinel for both documented additions ✓ (Task 6)

2. **Plan deviations from SDS, both justified by code reality:**
   - **Deviation 1: `bridgeCreateRemediationProposal` signature.** SDS line 130/159: `(plan, step, now, append)`. Plan: `(plan, step, proposalId, now, append)`. Justification: `ProposalStore.save()` is `Promise<void>` and validates `id` as a non-empty string at write time (`src/adaptation/proposal-store.ts:14-28`). The bridge cannot pass `id: ""` and rely on `save()` to backfill. The caller supplies a `proposal-${randomUUID()}` ID; the wrapper is unchanged in behavior, just takes the ID as an explicit parameter. **Follow-up: amend the SDS lines 130 and 159 to match the plan's signature, otherwise future readers will see two contradictory contracts.**
   - **Deviation 2: bridge dispatch site.** SDS line 147: "All bridge state mutation lives in `ExecutionEngine.runReadySteps()`". Plan: lives in `executeStepInternal` (the shared internal method called by both `runStep` and `runReadySteps`). Justification: scoping to `runReadySteps` alone creates a silent inconsistency where manual `runStep` skips the bridge. The shared path is the only correct site. **Follow-up: amend SDS line 147 to "lives in `ExecutionEngine.executeStepInternal()` (shared internal path called by both `runStep` and `runReadySteps`)."**

3. **Placeholder scan** — no "TBD", no "TODO", no "add appropriate error handling" stubs. Every step has either exact code or an exact command.

4. **Type consistency** —
   - `EXECUTIVE_BRIDGE_VERSION` defined once in Task 2, referenced in Task 3, Task 5.
   - `ExecutiveBridgeResult` defined in Task 3, used in Task 3 + Task 5 tests.
   - `bridgeCreateRemediationProposal(plan, step, proposalId, now, append)` is the single canonical signature used in Tasks 2, 3, 5.
   - `buildExecutiveRemediationProposal(plan, step, proposalId, now)` is the single canonical signature used in Tasks 2, 3, 5.
   - `proposalStore` is an optional `ExecutionEngine` constructor param with backward-compatible default.
   - `StepRunner.execute(planId, step, executionId)` is the actual signature (Task 5b fakes match it).
   - `PlanExecutionState` is the type used in `stateStore.load()` return shape (Task 5b fakes match it).
   - `StepRuntimeState` is the type for `state.stepStates[stepId]` (Task 5b fakes match it).

5. **Files NOT modified** — explicitly listed in Global Constraints. Plan never touches `step-runner.ts` or `executive-plan-types.ts`.

6. **Risk check** — `tsc` and full-suite runs are explicitly required at the end of every task that adds code. Idempotency, success, failure, and `runStep`-parity paths are all covered by Task 5b.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-25-p10-4b-execution-proposal-bridge.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?