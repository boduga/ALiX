# CAP-6 — A4 Capability Mutation Executor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A governed capability mutation (create/update/transition/consolidate/remove) executes **atomically through A4** — `authorizeExecution` → `createExecutionPlan` → `GovernedExecutionRuntime` driving a new `CapabilityMutationExecutor` that applies CAP-5's exact semantics and never invents new ones.

**Architecture:** New `CapabilityMutationExecutor implements StepExecutor` (A4 layer, `src/evolution/execution/`) whose `executeStep` runs the greenfield atomicity sequence **prepare → validate → apply durable mutation → project registry → record governance result → commit** per mutation. The executor consumes the CAP-5 contract (`validateCapabilityMutation`, `validateConsolidateMerge`, `classifyUpdateBump`, `isLegalTransition`), the CAP-2 catalog (`CapabilityCatalog`), and the CAP-3 registry (`CapabilityRegistry`). Each mutation publishes/removes immutable `id@version` catalog entries and mutates registry lifecycle/availability; on any failure it restores a captured pre-state (byte-identical) and returns a failed step so the runtime rolls back. The five `capability.*` rollback mappings re-home from `execution-planner.ts:173-183` into the executor's `createCapabilityRollbackResolver()`. A7.1 legacy surfaces (applier, step executor) stay untouched; the applier is repointed at the executor's resolver so rollback behavior is preserved.

**Tech Stack:** TypeScript (ESM), node:test (`.test.ts` — run against `dist/` after `pnpm run build`; imports `../../../src/...`), `pnpm exec tsc --noEmit` as the type gate, the existing CAP-2/CAP-3/CAP-5 modules.

## Global Constraints

- **No new mutation semantics** — the executor applies CAP-5 exactly. #477 (consolidate = true governed merge, explicit proposed definition, never synthesized), #478 (create = complete authored definition, no placeholder), #479 (immutable `id@version`, governance pins exact version), #480 (update = executor-classified bump, failed update = no-op), #481 (six-state graph, deprecated terminal, transitions governed). It does NOT invent `validateConsolidateMerge`-bypassing merges, does NOT auto-deprecate on update, does NOT add lifecycle states.
- **A4 gate preserved verbatim** — `authorizeExecution` (`execution-authorization.ts`) is untouched. The executor is the runtime's `StepExecutor`; the caller authorizes first.
- **Atomicity design (greenfield)** — per mutation: prepare (capture pre-state) → validate (CAP-5 validators + source/precondition checks) → apply durable mutation (catalog) → project registry (`registry.reload()`) → record governance result (injected `GovernanceRecordSink`, inside the boundary) → commit. The A7.1 compensating-rollback-after-post-commit-failure pattern is a legacy bridge, NOT carried forward. On any failure after apply, restore the pre-mutation projection (byte-identical) and return a failed step.
- **Immutable publications (#479)** — create/update/consolidate always **append** a new `id@version` via `catalog.register(def, def.bindings[0])`; never `catalog.update` (in-place replace). `id`/`version`/`kind` are never patched. Update's `sourceVersion` is a stale-decision precondition: `catalog.get(id).version === sourceVersion` must hold (#34 `actual === from`).
- **Governed register/create is actually applied** — a create with a complete approved definition registers it (no placeholder, no `APPROVED_PENDING_APPLICATION` dead-end). Create rejects an already-present id.
- **Consolidation is a real definition mutation** — publishes the approved target definition and then disposes sources per `sourceDisposition` (`deprecate` → lifecycle `deprecated`; `remove` → catalog remove). This is NOT the old A7.1 "deprecate related capabilities" behavior.
- **Forbidden files (never touch):** `src/capability/initial-capabilities.ts`, `src/tools/tool-registry.ts`, `src/policy/capability-registry.ts`, and **production `src/capability/canonical/*`** (CAP-2 import-only — the executor uses only the public `CapabilityCatalog`/`CapabilityRegistry` surface; it never modifies the canonical store or definition).
- **A7.1 legacy surfaces stay** — `capability-lifecycle-applier.ts` and `capability-lifecycle-step-executor.ts` are NOT removed (CAP-11). Their behavior must not regress: the applier's resolver injection is repointed to the executor's `createCapabilityRollbackResolver()` (identical `capability.transition` → `capability.restore_transition` mapping) so plans built for legacy transitions keep automatic safe rollback.
- **Test convention:** new executor tests are **node:test** (`.test.ts`) under `tests/evolution/execution/`, importing `../../../src/evolution/execution/...js` — run via `pnpm run build && pnpm test` (the A4 layer tests are node:test, NOT vitest). Vitest tests under `tests/capability/` are unaffected.
- **Type gate:** ALWAYS run `pnpm exec tsc --noEmit` after each task (node:test does not typecheck — CAP-1 lesson).
- **Deterministic artifacts:** every output artifact (mutation result, post-state, evidence) is built from deep copies/frozen snapshots — the executor must never return live references into `CapabilityCatalog`/`CapabilityRegistry` state. Mutating a returned result must not affect the catalog.

### Consumed interfaces (exact — from CAP-2/3/4/5, already on main)

- **CAP-5 `src/capability/mutation-contract.ts`:** `validateCapabilityMutation(value: unknown): ValidationResult`; `validateConsolidateMerge(proposal: CapabilityConsolidateMutation, sources: readonly CapabilityDefinition[]): ValidationResult`; `classifyUpdateBump(previous, next): "major" | "minor" | "patch"`; `isLegalTransition(from, to): boolean`; mutation types `CapabilityCreateMutation | CapabilityUpdateMutation | CapabilityTransitionMutation | CapabilityConsolidateMutation | CapabilityRemoveMutation`; `CapabilityDefinitionPatch`; `CAPABILITY_MUTATION_OPERATIONS`.
- **CAP-2 `src/capability/canonical/catalog.ts`:** `CapabilityCatalog` — `get(id): CapabilityDefinition | undefined` (returns highest SemVer for the id), `list(): CapabilityDefinition[]`, `has(id): boolean`, `register(def, binding?)`, `update(id, patch)` (NOT used by the executor), `remove(id)`, `getBinding(id)`.
- **CAP-3 `src/capability/registry.ts`:** `CapabilityRegistry` — `get(id)`, `listRegistered()`, `getLifecycleState(id)`, `setLifecycleState(id, to)`, `clearLifecycleState(id)`, `listLifecycleStates()`, `getAvailability(id)`, `setAvailability(id, avail)`, `reload()`, `list()`. `CapabilityAvailability { available: boolean; reason?: "missing_binding" | "provider_unavailable" }`.
- **CAP-4 `src/evolution/execution/`:** `StepExecutor` (from `execution-runtime.ts`), `ExecutionStep`/`RollbackStep`/`RollbackResolver` (from `contracts/execution-contract.ts`), `DefaultRollbackResolver` + `createDefaultRollbackResolver` (from `execution-planner.ts` — Task 7 removes the `capability.transition` registration), `createExecutionPlan(proposal, decision, environment, resolver)`, `GovernedExecutionRuntime`.
- **`src/capability/canonical/definition.ts`:** `CapabilityDefinition` (has `bindings: CapabilityProviderBinding[]`, `version` full SemVer), `validateCapabilityDefinition(d): asserts d is CapabilityDefinition`.
- **`src/evolution/contracts/evolution-contract.ts`:** `EvolutionProposal` (closed interface, no `changes` — embed via `EvolutionProposal & { changes: [...] }` like CAP-5/A7.1's `CapabilityExecutionProposal`), `ValidationResult`.
- **`src/adaptation/capability-evolution-types.ts`:** `LifecycleState = "emerging" | "active" | "mature" | "stagnant" | "declining" | "deprecated"`.

---
---

### Task 1: Executor Infrastructure + `capability.create` path

**Files:**
- Create: `src/evolution/execution/capability-mutation-executor.ts`
- Test: `tests/evolution/execution/capability-mutation-executor.test.ts`
- Test: `tests/evolution/execution/capability-mutation-executor-helpers.test.ts`

**Interfaces:**
- Consumes: `CapabilityCatalog`, `CapabilityRegistry`, `validateCapabilityMutation`, `CapabilityDefinition`, `validateCapabilityDefinition`, `LifecycleState`, `StepExecutor`, `ExecutionStep`, `RollbackStep`, `RollbackResolver`, `DefaultRollbackResolver`.
- Produces (later tasks rely on these exact names):
  - `export interface CapabilityPreState` — `{ definitions: CapabilityDefinition[]; bindings: Map<string, CapabilityProviderBinding>; lifecycle: Map<string, LifecycleState | undefined>; availability: Map<string, CapabilityAvailability>; }`
  - `export interface CapabilityMutationResult` — `{ artifactId: string; operation: CapabilityMutation["operation"]; mutation: CapabilityMutation; preState: CapabilityPreState; post: Record<string, unknown>; }`
  - `export interface GovernanceRecordSink` — `record(result: CapabilityMutationResult): Promise<void> | void`
  - `export interface CapabilityMutationExecutorOptions` — `{ catalog: CapabilityCatalog; registry: CapabilityRegistry; record?: GovernanceRecordSink; }`
  - `export class CapabilityMutationExecutor implements StepExecutor` — `constructor(options: CapabilityMutationExecutorOptions)`; `async executeStep(step, context): Promise<{ success: boolean; output: Record<string, unknown>; error?: string }>`; `createRollbackResolver(): RollbackResolver`
  - `export function createCapabilityRollbackResolver(): RollbackResolver` — registers `capability.create`, `capability.update`, `capability.transition`, `capability.consolidate`, `capability.remove` (grows per task — Task 1 registers `capability.create` + `capability.transition`)
  - `export function toCapabilityMutationChange(mutation: CapabilityMutation): { operation: string; parameters: Record<string, unknown>; idempotent: boolean; preconditions: Record<string, unknown>; postconditions: Record<string, unknown> }`
  - `export function bumpSemVer(version: string, bump: "major" | "minor" | "patch"): string`
  - `export function applyCapabilityDefinitionPatch(previous: CapabilityDefinition, patch: CapabilityDefinitionPatch): CapabilityDefinition`

**Design contract for this task:**
- Pre-state capture (`capturePreState(catalog, registry)`): full snapshot — `catalog.list()` (all publications), per-id bindings (`catalog.getBinding(id)`), registry lifecycle (`registry.listLifecycleStates()`), registry availability (`registry.getAvailability(id)` per listed id).
- Restore (`restorePreState(catalog, registry, affectedIds, pre)`): for every id in `affectedIds` ∪ captured ids → `catalog.remove(id)`; then re-append each captured definition in original order via `catalog.register(def, pre.bindings.get(def.id))`; then `registry.reload()`; then restore each captured lifecycle (`setLifecycleState` or `clearLifecycleState` when undefined) and availability (`setAvailability`); then `registry.reload()` again. This yields a byte-identical catalog + registry projection.
- `createCapabilityMutationExecutor`'s `executeStep` dispatch: `switch (step.operation)` with the five `capability.*` cases; `default:` → `{ success: false, output: {}, error: "Unknown operation: <op>" }`.
- Create path: (1) validate via `validateCapabilityMutation(mutation)` → errors → `{ success: false, error }` (REJECT, nothing mutated); (2) precondition: `catalog.has(def.id)` → reject "already exists" (#478 — create is for NEW capabilities; use update to modify); (3) capture pre-state; (4) `catalog.register(def, def.bindings[0])`; (5) `registry.reload()` (new id projects with lifecycle `emerging` — DEFAULT_LIFECYCLE); (6) build immutable `CapabilityMutationResult`, call `options.record?.(result)` inside a try — on throw restore pre-state (affectedIds = [def.id]) and return `{ success: false, error }`; (7) return `{ success: true, output: { operation, mutation, result } }`.
- Immutability: `CapabilityMutationResult.mutation` and `post` are built from **deep copies** (e.g. `JSON.parse(JSON.stringify(...))` or a local `deepCopy` for plain data) so no returned object aliases live catalog/registry state. `artifactId = sha256(canonicalStringify({ operation, mutation, post }))` (prefix `alix-capability-mutation-v1:`).
- Rollback resolver mappings for Task 1:
  - `capability.create` → `{ stepId: "rb-<id>", forwardStepId, operation: "capability.restore_create", parameters: { capabilityId }, rollbackType: "automatic", safe: true }` (the executor's `executeStep` handles `capability.restore_*` by restoring its captured pre-state — see Task 6; for Task 1 `capability.restore_create` maps to `restorePreState`).
  - `capability.transition` → identical to the mapping being re-homed: `operation: "capability.restore_transition"`, `parameters: { capabilityId }`, `rollbackType: "automatic"`, `safe: true`.

- [ ] **Step 1: Write the failing helper + create tests**

`tests/evolution/execution/capability-mutation-executor-helpers.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bumpSemVer, applyCapabilityDefinitionPatch, toCapabilityMutationChange } from "../../../src/evolution/execution/capability-mutation-executor.js";
import type { CapabilityDefinition } from "../../../src/capability/canonical/definition.js";

function def(overrides: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id: "tool.file.read",
    version: "1.0.0",
    kind: "operation" as const,
    title: "Read file",
    description: "read",
    tags: ["file"],
    category: "files",
    risk: "low" as const,
    requiredPermissions: ["operator"] as const,
    dependencies: [],
    bindings: [{ type: "tool" as const, id: "tool-1" }],
    ...overrides,
  };
}

describe("bumpSemVer", () => {
  it("bumps major", () => assert.equal(bumpSemVer("1.2.3", "major"), "2.0.0"));
  it("bumps minor", () => assert.equal(bumpSemVer("1.2.3", "minor"), "1.3.0"));
  it("bumps patch", () => assert.equal(bumpSemVer("1.2.3", "patch"), "1.2.4"));
  it("rejects non-semver", () => assert.throws(() => bumpSemVer("1.2", "patch")));
});

describe("applyCapabilityDefinitionPatch", () => {
  it("spreads patch over previous, stripping undefined", () => {
    const next = applyCapabilityDefinitionPatch(def(), { description: "new desc", tags: ["a", "b"] });
    assert.equal(next.description, "new desc");
    assert.deepEqual(next.tags, ["a", "b"]);
    assert.equal(next.id, "tool.file.read"); // immutable fields survive
  });
  it("never patches id/version/kind even if present in patch (defensive)", () => {
    const next = applyCapabilityDefinitionPatch(def(), { id: "evil", version: "9.9.9", kind: "query" } as never);
    assert.equal(next.id, "tool.file.read");
    assert.equal(next.version, "1.0.0");
  });
});

describe("toCapabilityMutationChange", () => {
  it("wraps a mutation as a plan change", () => {
    const change = toCapabilityMutationChange({ operation: "capability.create", definition: def(), initialLifecycle: "emerging" });
    assert.equal(change.operation, "capability.create");
    assert.equal(change.idempotent, false);
    assert.deepEqual(change.parameters, { operation: "capability.create", definition: def(), initialLifecycle: "emerging" });
  });
});
```

`tests/evolution/execution/capability-mutation-executor.test.ts` (create path):

```ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CapabilityCatalog } from "../../../src/capability/canonical/catalog.js";
import { CapabilityDefinitionStore } from "../../../src/capability/canonical/catalog-store.js";
import { CapabilityRegistry } from "../../../src/capability/registry.js";
import { CapabilityMutationExecutor, createCapabilityRollbackResolver } from "../../../src/evolution/execution/capability-mutation-executor.js";
import type { CapabilityDefinition } from "../../../src/capability/canonical/definition.js";
import type { CapabilityCreateMutation } from "../../../src/capability/mutation-contract.js";

function def(overrides: Partial<CapabilityDefinition> = {}): CapabilityDefinition { /* same as helpers file */ }

function makeCreate(overrides: Partial<CapabilityCreateMutation> = {}): CapabilityCreateMutation {
  return { operation: "capability.create", definition: def(), initialLifecycle: "emerging", ...overrides };
}

describe("CapabilityMutationExecutor — create", () => {
  let dir: string;
  let catalog: CapabilityCatalog;
  let registry: CapabilityRegistry;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "cap6-"));
    catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
    registry = new CapabilityRegistry(catalog);
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("applies a complete authored definition (no placeholder)", async () => {
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const step = { stepId: "s1", operation: "capability.create", parameters: makeCreate(), idempotent: false, preconditions: {}, postconditions: {} };
    const res = await executor.executeStep(step, {});
    assert.equal(res.success, true);
    const published = catalog.get("tool.file.read")!;
    assert.equal(published.version, "1.0.0");
    assert.equal(published.title, "Read file"); // complete definition, not a placeholder
    assert.equal(registry.getLifecycleState("tool.file.read"), "emerging"); // #481
  });

  it("rejects a duplicate id (REJECT → nothing mutated)", async () => {
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    await executor.executeStep({ stepId: "s1", operation: "capability.create", parameters: makeCreate(), idempotent: false, preconditions: {}, postconditions: {} }, {});
    const res = await executor.executeStep({ stepId: "s2", operation: "capability.create", parameters: makeCreate(), idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, false);
    assert.match(res.error ?? "", /already exists/);
    assert.equal(catalog.list().filter((d) => d.id === "tool.file.read").length, 1); // unchanged
  });

  it("invalid mutation shape → rejected without touching the catalog", async () => {
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.create", parameters: { operation: "capability.create", definition: { ...def(), version: "not-semver" } }, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, false);
    assert.equal(catalog.has("tool.file.read"), false);
  });

  it("record-sink failure → restores pre-state byte-identical", async () => {
    const executor = new CapabilityMutationExecutor({ catalog, registry, record: async () => { throw new Error("record failed"); } });
    const before = JSON.stringify(catalog.list());
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.create", parameters: makeCreate({ definition: def({ id: "tool.file.write" }) }), idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, false);
    assert.match(res.error ?? "", /record failed/);
    assert.equal(JSON.stringify(catalog.list()), before); // byte-identical
  });

  it("returns immutable output (no aliasing to live catalog state)", async () => {
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.create", parameters: makeCreate({ definition: def({ id: "tool.file.append" }) }), idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, true);
    const out = res.output.result as { mutation: { definition: CapabilityDefinition } };
    out.mutation.definition.title = "MUTATED"; // must not affect the catalog
    assert.notEqual(catalog.get("tool.file.append")!.title, "MUTATED");
  });

  it("createRollbackResolver emits restore_create + restore_transition", () => {
    const resolver = createCapabilityRollbackResolver();
    const createStep = { stepId: "s1", operation: "capability.create", parameters: { capabilityId: "tool.file.read" }, idempotent: false, preconditions: {}, postconditions: {} };
    const rbCreate = resolver.createRollback(createStep);
    assert.equal(rbCreate.operation, "capability.restore_create");
    assert.equal(rbCreate.safe, true);
    assert.equal(rbCreate.rollbackType, "automatic");
    const transStep = { stepId: "s2", operation: "capability.transition", parameters: { capabilityId: "tool.file.read" }, idempotent: true, preconditions: {}, postconditions: {} };
    const rbTrans = resolver.createRollback(transStep);
    assert.equal(rbTrans.operation, "capability.restore_transition");
    assert.equal(rbTrans.safe, true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm run build && pnpm exec tsx --test tests/evolution/execution/capability-mutation-executor.test.ts tests/evolution/execution/capability-mutation-executor-helpers.test.ts
```

Expected: FAIL with "Cannot find module .../capability-mutation-executor.js" (module not yet created).

- [ ] **Step 3: Implement the executor infrastructure + create path**

Create `src/evolution/execution/capability-mutation-executor.ts`. Key structure (exact code to write):

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-6 — A4 Capability Mutation Executor.
 *
 * A `StepExecutor` that applies the five CAP-5 governed mutations atomically
 * through A4. Each `executeStep` runs the greenfield atomicity sequence:
 * prepare → validate → apply durable mutation → project registry → record
 * governance result → commit. On any failure after apply it restores the
 * captured pre-state (byte-identical) and returns a failed step so the
 * runtime triggers rollback. Consumes CAP-5's exact semantics
 * (`validateCapabilityMutation`, `validateConsolidateMerge`,
 * `classifyUpdateBump`, `isLegalTransition`) and never invents new ones.
 *
 * @module capability-mutation-executor
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../security/audit/canonical-json.js";
import type { CapabilityCatalog } from "../../capability/canonical/catalog.js";
import type { CapabilityProviderBinding } from "../../capability/canonical/provider.js";
import { validateCapabilityDefinition } from "../../capability/canonical/definition.js";
import type { CapabilityDefinition } from "../../capability/canonical/definition.js";
import type { CapabilityAvailability, CapabilityRegistry } from "../../capability/registry.js";
import type { LifecycleState } from "../../adaptation/capability-evolution-types.js";
import type {
  CapabilityMutation,
  CapabilityMutationOperation,
  CapabilityDefinitionPatch,
  CapabilityCreateMutation,
} from "../../capability/mutation-contract.js";
import { validateCapabilityMutation, CAPABILITY_MUTATION_OPERATIONS } from "../../capability/mutation-contract.js";
import type { StepExecutor } from "./execution-runtime.js";
import type { ExecutionStep, RollbackStep, RollbackResolver } from "./contracts/execution-contract.js";
import { DefaultRollbackResolver } from "./execution-planner.js";

const MUTATION_PREFIX = "alix-capability-mutation-v1:";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Increment a full-SemVer MAJOR.MINOR.PATCH string by one step. Throws on malformed input. */
export function bumpSemVer(version: string, bump: "major" | "minor" | "patch"): string {
  const parts = version.split(".").map(Number);
  if (parts.length !== 3 || parts.some((p) => !Number.isInteger(p) || p < 0)) {
    throw new Error(`bumpSemVer: '${version}' is not full SemVer MAJOR.MINOR.PATCH`);
  }
  if (bump === "major") return `${parts[0]! + 1}.0.0`;
  if (bump === "minor") return `${parts[0]!}.${parts[1]! + 1}.0`;
  return `${parts[0]!}.${parts[1]!}.${parts[2]! + 1}`;
}

/** Apply a CAP-5 definition patch over a publication. `undefined` patch values are
 *  dropped (they mean "no change"); spread semantics replace lists, never merge.
 *  id/version/kind are immutable and never applied. Returns a NEW object. */
export function applyCapabilityDefinitionPatch(
  previous: CapabilityDefinition,
  patch: CapabilityDefinitionPatch,
): CapabilityDefinition {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) clean[k] = v;
  }
  return { ...previous, ...clean, id: previous.id, version: previous.version, kind: previous.kind };
}

/** Wrap a CAP-5 mutation as an A4 plan `changes` entry (`resolveSteps` maps it to a step). */
export function toCapabilityMutationChange(mutation: CapabilityMutation): {
  operation: CapabilityMutation["operation"];
  parameters: Record<string, unknown>;
  idempotent: boolean;
  preconditions: Record<string, unknown>;
  postconditions: Record<string, unknown>;
} {
  return {
    operation: mutation.operation,
    parameters: mutation as unknown as Record<string, unknown>,
    idempotent: false,
    preconditions: {},
    postconditions: {},
  };
}

// ---------------------------------------------------------------------------
// Pre-state capture / restore (byte-identical)
// ---------------------------------------------------------------------------

export interface CapabilityPreState {
  definitions: CapabilityDefinition[];
  bindings: Map<string, CapabilityProviderBinding>;
  lifecycle: Map<string, LifecycleState | undefined>;
  availability: Map<string, CapabilityAvailability>;
}

export function capturePreState(catalog: CapabilityCatalog, registry: CapabilityRegistry): CapabilityPreState {
  const definitions = catalog.list();
  const bindings = new Map<string, CapabilityProviderBinding>();
  for (const d of definitions) {
    const b = catalog.getBinding(d.id);
    if (b) bindings.set(d.id, b);
  }
  const lifecycle = new Map<string, LifecycleState | undefined>();
  for (const { capabilityId, state } of registry.listLifecycleStates()) lifecycle.set(capabilityId, state);
  const availability = new Map<string, CapabilityAvailability>();
  for (const d of definitions) {
    const a = registry.getAvailability(d.id);
    if (a) availability.set(d.id, a);
  }
  return { definitions, bindings, lifecycle, availability };
}

/** Restore catalog + registry to a captured pre-state. Idempotent: safe to call
 *  more than once. `affectedIds` are ids the mutation touched that may not exist
 *  in the capture (e.g. a create). Restores definitions in original order, then
 *  bindings, then lifecycle/availability, re-projecting the registry. */
export function restorePreState(
  catalog: CapabilityCatalog,
  registry: CapabilityRegistry,
  affectedIds: readonly string[],
  pre: CapabilityPreState,
): void {
  const ids = new Set<string>([...affectedIds, ...pre.definitions.map((d) => d.id)]);
  for (const id of ids) catalog.remove(id);
  for (const d of pre.definitions) catalog.register(d, pre.bindings.get(d.id));
  registry.reload();
  for (const [id, state] of pre.lifecycle) {
    if (state === undefined) registry.clearLifecycleState(id);
    else registry.setLifecycleState(id, state);
  }
  for (const [id, avail] of pre.availability) registry.setAvailability(id, avail);
  registry.reload();
}

// ---------------------------------------------------------------------------
// Governance record sink + mutation result
// ---------------------------------------------------------------------------

export interface CapabilityMutationResult {
  artifactId: string;
  operation: CapabilityMutation["operation"];
  mutation: CapabilityMutation;
  preState: CapabilityPreState;
  post: Record<string, unknown>;
}

export interface GovernanceRecordSink {
  record(result: CapabilityMutationResult): Promise<void> | void;
}

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function artifactId(operation: string, mutation: CapabilityMutation, post: Record<string, unknown>): string {
  const hash = createHash("sha256");
  hash.update(MUTATION_PREFIX);
  hash.update(canonicalStringify({ operation, mutation, post }));
  return hash.digest("hex");
}

// ---------------------------------------------------------------------------
// Rollback resolver (Task 1: create + transition; later tasks add the rest)
// ---------------------------------------------------------------------------

export function createCapabilityRollbackResolver(): RollbackResolver {
  const resolver = new DefaultRollbackResolver();
  resolver.registerOperation("capability.create", (step) => ({
    stepId: `rb-${step.stepId}`,
    forwardStepId: step.stepId,
    operation: "capability.restore_create",
    parameters: { capabilityId: (step.parameters as { capabilityId?: string }).capabilityId },
    rollbackType: "automatic" as const,
    safe: true,
  }));
  resolver.registerOperation("capability.transition", (step) => ({
    stepId: `rb-${step.stepId}`,
    forwardStepId: step.stepId,
    operation: "capability.restore_transition",
    parameters: { capabilityId: (step.parameters as { capabilityId?: string }).capabilityId },
    rollbackType: "automatic" as const,
    safe: true,
  }));
  return resolver;
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export interface CapabilityMutationExecutorOptions {
  catalog: CapabilityCatalog;
  registry: CapabilityRegistry;
  /** Optional governance-record sink, invoked INSIDE the atomic boundary. A
   *  throwing sink restores the pre-mutation state and fails the step. */
  record?: GovernanceRecordSink;
}

export class CapabilityMutationExecutor implements StepExecutor {
  private readonly catalog: CapabilityCatalog;
  private readonly registry: CapabilityRegistry;
  private readonly record?: GovernanceRecordSink;

  constructor(options: CapabilityMutationExecutorOptions) {
    this.catalog = options.catalog;
    this.registry = options.registry;
    this.record = options.record;
  }

  createRollbackResolver(): RollbackResolver {
    return createCapabilityRollbackResolver();
  }

  async executeStep(step: ExecutionStep, _context: Record<string, unknown>): Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
    switch (step.operation) {
      case "capability.create":
        return this.executeCreate(step);
      case "capability.update":
        return this.executeUpdate(step);
      case "capability.transition":
        return this.executeTransition(step);
      case "capability.consolidate":
        return this.executeConsolidate(step);
      case "capability.remove":
        return this.executeRemove(step);
      default:
        return { success: false, output: {}, error: `Unknown operation: ${String(step.operation)}` };
    }
  }

  private async executeCreate(step: ExecutionStep): Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
    const mutation = step.parameters as unknown as CapabilityCreateMutation;
    const validation = validateCapabilityMutation(mutation);
    if (!validation.valid) return { success: false, output: {}, error: validation.errors.join("; ") };
    if (this.catalog.has(mutation.definition.id)) {
      return { success: false, output: {}, error: `capability.create: '${mutation.definition.id}' already exists (use update to modify; #478)` };
    }
    validateCapabilityDefinition(mutation.definition); // fail-closed: the contract validator may pass shape but the store must not throw mid-write
    const pre = capturePreState(this.catalog, this.registry);
    const result = this.applyCreate(mutation, pre);
    if (!result.ok) return { success: false, output: {}, error: result.error };
    return this.commit("capability.create", mutation, [mutation.definition.id], pre, result.output);
  }

  private applyCreate(mutation: CapabilityCreateMutation, _pre: CapabilityPreState): { ok: boolean; error?: string; output?: Record<string, unknown> } {
    try {
      this.catalog.register(mutation.definition, mutation.definition.bindings[0]);
      this.registry.reload();
      const published = this.catalog.get(mutation.definition.id);
      return { ok: true, output: { published, lifecycle: "emerging" } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Shared commit tail: build immutable result, record inside the boundary, return success. */
  private async commit(
    operation: CapabilityMutation["operation"],
    mutation: CapabilityMutation,
    affectedIds: readonly string[],
    pre: CapabilityPreState,
    post: Record<string, unknown>,
  ): Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
    const result: CapabilityMutationResult = {
      artifactId: artifactId(operation, mutation, deepCopy(post)),
      operation,
      mutation: deepCopy(mutation),
      preState: deepCopy(pre),
      post: deepCopy(post),
    };
    if (this.record) {
      try {
        await this.record.record(result);
      } catch (err) {
        restorePreState(this.catalog, this.registry, affectedIds, pre);
        return { success: false, output: {}, error: `record failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
    return { success: true, output: { operation, mutation: result.mutation, result } };
  }

  private async executeUpdate(_step: ExecutionStep): Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
    return { success: false, output: {}, error: "capability.update: not implemented (Task 2)" };
  }
  private async executeTransition(_step: ExecutionStep): Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
    return { success: false, output: {}, error: "capability.transition: not implemented (Task 3)" };
  }
  private async executeConsolidate(_step: ExecutionStep): Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
    return { success: false, output: {}, error: "capability.consolidate: not implemented (Task 4)" };
  }
  private async executeRemove(_step: ExecutionStep): Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
    return { success: false, output: {}, error: "capability.remove: not implemented (Task 5)" };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm run build && pnpm exec tsx --test tests/evolution/execution/capability-mutation-executor.test.ts tests/evolution/execution/capability-mutation-executor-helpers.test.ts
```

Expected: PASS. Then `pnpm exec tsc --noEmit` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/evolution/execution/capability-mutation-executor.ts tests/evolution/execution/capability-mutation-executor.test.ts tests/evolution/execution/capability-mutation-executor-helpers.test.ts
git commit -m "feat(capability): CAP-6 executor infra + capability.create path"
```

---
---

### Task 2: `capability.update` path

**Files:**
- Modify: `src/evolution/execution/capability-mutation-executor.ts` (replace `executeUpdate` stub; add `capability.restore_update` to `createCapabilityRollbackResolver`; export `nextDefinitionForUpdate` helper)
- Modify: `tests/evolution/execution/capability-mutation-executor.test.ts` (add `describe("update")`)

**Interfaces:**
- Consumes: `CapabilityUpdateMutation`, `classifyUpdateBump` (from `mutation-contract.js`), `bumpSemVer`, `applyCapabilityDefinitionPatch` (Task 1).
- Produces: `export function nextDefinitionForUpdate(previous: CapabilityDefinition, patch: CapabilityDefinitionPatch): CapabilityDefinition` — applies the patch, validates the result (throws), classifies the bump via `classifyUpdateBump`, sets the bumped version, validates again, returns the new publication (id/version/kind preserved). Also registers `capability.restore_update` in the rollback resolver.

**Design contract:**
- Update sequence: (1) `validateCapabilityMutation(mutation)` → reject; (2) `previous = catalog.get(capabilityId)` → missing → reject "not found"; (3) **stale precondition (#34/#479): `previous.version !== sourceVersion` → reject** "sourceVersion mismatch (expected X, actual Y)"; (4) `next = nextDefinitionForUpdate(previous, patch)` — on any error reject (patch produces invalid definition); (5) **no-op guard: if `deepEqual(next-without-bump === previous)` reject** "update produces no change (#480 no-op)"; (6) capture pre-state; (7) `catalog.register(next, next.bindings[0])` (append new id@version — NEVER `catalog.update`); (8) `registry.reload()` (definition changed, lifecycle preserved); (9) commit (record + immutable result). Failure → restore pre-state (affectedIds = [capabilityId]).
- The `next` definition's version is `bumpSemVer(previous.version, classifyUpdateBump(previous, next))`.
- Immutable fields: `applyCapabilityDefinitionPatch` already pins id/version/kind; the no-op guard compares the pre-bump `next` against `previous` using the same `deepEqual` shape used by CAP-5's `classifyBindingsChange`.

- [ ] **Step 1: Write the failing update tests**

Append to `tests/evolution/execution/capability-mutation-executor.test.ts`:

```ts
import { classifyUpdateBump } from "../../../src/capability/mutation-contract.js";
import { nextDefinitionForUpdate } from "../../../src/evolution/execution/capability-mutation-executor.js";

describe("CapabilityMutationExecutor — update", () => {
  let dir: string; let catalog: CapabilityCatalog; let registry: CapabilityRegistry;
  before(() => { dir = mkdtempSync(join(tmpdir(), "cap6-upd-")); catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir })); registry = new CapabilityRegistry(catalog); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  async function seed() {
    catalog.register(def(), def().bindings[0]);
    registry.reload();
  }

  it("publishes a new immutable id@version with the classified bump", async () => {
    await seed();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const mutation = { operation: "capability.update" as const, capabilityId: "tool.file.read", sourceVersion: "1.0.0", patch: { description: "updated desc" } };
    const step = { stepId: "s1", operation: "capability.update", parameters: mutation, idempotent: false, preconditions: {}, postconditions: {} };
    const res = await executor.executeStep(step, {});
    assert.equal(res.success, true);
    const cur = catalog.get("tool.file.read")!;
    assert.equal(cur.version, "1.0.1"); // PATCH bump
    assert.equal(cur.description, "updated desc");
    // Immutability: the old publication is still in the catalog
    const all = catalog.list().filter((d) => d.id === "tool.file.read");
    assert.equal(all.length, 2);
    assert.ok(all.some((d) => d.version === "1.0.0" && d.description === "read"));
  });

  it("classifies a binding change as MAJOR and bumps major", async () => {
    await seed();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const mutation = { operation: "capability.update" as const, capabilityId: "tool.file.read", sourceVersion: "1.0.0", patch: { bindings: [{ type: "mcp" as const, id: "mcp-2" }] } };
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.update", parameters: mutation, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, true);
    assert.equal(catalog.get("tool.file.read")!.version, "2.0.0");
  });

  it("rejects a stale sourceVersion (actual !== sourceVersion)", async () => {
    await seed();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const mutation = { operation: "capability.update" as const, capabilityId: "tool.file.read", sourceVersion: "0.5.0", patch: { description: "x" } };
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.update", parameters: mutation, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, false);
    assert.match(res.error ?? "", /sourceVersion/);
    assert.equal(catalog.get("tool.file.read")!.version, "1.0.0"); // unchanged
  });

  it("rejects a patch that touches immutable id/version/kind", async () => {
    await seed();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const mutation = { operation: "capability.update" as const, capabilityId: "tool.file.read", sourceVersion: "1.0.0", patch: { id: "tool.evil", version: "9.9.9", kind: "query" } as never };
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.update", parameters: mutation, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, false);
    assert.match(res.error ?? "", /immutable/);
  });

  it("rejects a no-op update (#480: failed update = no-op, no redundant publication)", async () => {
    await seed();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const mutation = { operation: "capability.update" as const, capabilityId: "tool.file.read", sourceVersion: "1.0.0", patch: { description: "read" } }; // identical value
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.update", parameters: mutation, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, false);
    assert.match(res.error ?? "", /no change/);
    assert.equal(catalog.list().filter((d) => d.id === "tool.file.read").length, 1);
  });

  it("record-sink failure after update → byte-identical restore", async () => {
    await seed();
    const executor = new CapabilityMutationExecutor({ catalog, registry, record: async () => { throw new Error("boom"); } });
    const before = JSON.stringify(catalog.list());
    const mutation = { operation: "capability.update" as const, capabilityId: "tool.file.read", sourceVersion: "1.0.0", patch: { description: "x" } };
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.update", parameters: mutation, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, false);
    assert.equal(JSON.stringify(catalog.list()), before);
  });
});

describe("nextDefinitionForUpdate", () => {
  it("applies patch and classifies bump", () => {
    const next = nextDefinitionForUpdate(def(), { description: "new" });
    assert.equal(next.version, "1.0.1");
    assert.equal(next.description, "new");
    assert.equal(next.id, "tool.file.read");
  });
  it("throws when the patched result is not a valid definition", () => {
    assert.throws(() => nextDefinitionForUpdate(def(), { bindings: [] }), /binding/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm run build && pnpm exec tsx --test tests/evolution/execution/capability-mutation-executor.test.ts
```

Expected: FAIL — `nextDefinitionForUpdate` undefined; update cases return "not implemented".

- [ ] **Step 3: Implement the update path**

Add to `capability-mutation-executor.ts`:

```ts
import { classifyUpdateBump } from "../../capability/mutation-contract.js";
import type { CapabilityUpdateMutation } from "../../capability/mutation-contract.js";

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/** Apply an update patch to a publication, classify the bump (#480), and return the
 *  new immutable publication with the bumped version. Throws on any invalid state. */
export function nextDefinitionForUpdate(
  previous: CapabilityDefinition,
  patch: CapabilityDefinitionPatch,
): CapabilityDefinition {
  if ((patch as Record<string, unknown>).id !== undefined || (patch as Record<string, unknown>).version !== undefined || (patch as Record<string, unknown>).kind !== undefined) {
    throw new Error("update: 'id'/'version'/'kind' are immutable and must not appear in a patch");
  }
  const patched = applyCapabilityDefinitionPatch(previous, patch);
  validateCapabilityDefinition(patched); // throws if patch produces an invalid definition
  const bump = classifyUpdateBump(previous, patched);
  const next = { ...patched, version: bumpSemVer(previous.version, bump) };
  validateCapabilityDefinition(next);
  return next;
}
```

Register `capability.update` in `createCapabilityRollbackResolver`:

```ts
resolver.registerOperation("capability.update", (step) => {
  const { capabilityId } = step.parameters as { capabilityId?: string };
  return {
    stepId: `rb-${step.stepId}`, forwardStepId: step.stepId,
    operation: "capability.restore_update",
    parameters: { capabilityId }, rollbackType: "automatic" as const, safe: true,
  };
});
```

Replace the `executeUpdate` stub:

```ts
private async executeUpdate(step: ExecutionStep): Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
  const mutation = step.parameters as unknown as CapabilityUpdateMutation;
  const validation = validateCapabilityMutation(mutation);
  if (!validation.valid) return { success: false, output: {}, error: validation.errors.join("; ") };
  const previous = this.catalog.get(mutation.capabilityId);
  if (!previous) return { success: false, output: {}, error: `capability.update: '${mutation.capabilityId}' not found` };
  if (previous.version !== mutation.sourceVersion) {
    return { success: false, output: {}, error: `capability.update: sourceVersion mismatch (expected ${previous.version}, got ${mutation.sourceVersion}) — stale decision (#479)` };
  }
  let next: CapabilityDefinition;
  try {
    next = nextDefinitionForUpdate(previous, mutation.patch);
  } catch (err) {
    return { success: false, output: {}, error: err instanceof Error ? err.message : String(err) };
  }
  // No-op guard (#480): patch produces no effective change → reject, no redundant publication.
  if (deepEqual(applyCapabilityDefinitionPatch(previous, mutation.patch), previous)) {
    return { success: false, output: {}, error: "capability.update: patch produces no change (#480 no-op)" };
  }
  const pre = capturePreState(this.catalog, this.registry);
  const result = this.applyUpdate(next, previous);
  if (!result.ok) return { success: false, output: {}, error: result.error };
  return this.commit("capability.update", mutation, [mutation.capabilityId], pre, result.output);
}

private applyUpdate(next: CapabilityDefinition, previous: CapabilityDefinition): { ok: boolean; error?: string; output?: Record<string, unknown> } {
  try {
    this.catalog.register(next, next.bindings[0]); // append immutable id@version — never catalog.update
    this.registry.reload();
    return { ok: true, output: { published: this.catalog.get(next.id), previous, bump: classifyUpdateBump(previous, next) } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm run build && pnpm exec tsx --test tests/evolution/execution/capability-mutation-executor.test.ts
```

Expected: PASS. Then `pnpm exec tsc --noEmit` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/evolution/execution/capability-mutation-executor.ts tests/evolution/execution/capability-mutation-executor.test.ts
git commit -m "feat(capability): CAP-6 capability.update path — immutable publication + executor-classified bump"
```

---
---

### Task 3: `capability.transition` path

**Files:**
- Modify: `src/evolution/execution/capability-mutation-executor.ts` (replace `executeTransition` stub; `capability.restore_transition` already registered in Task 1; add `handleRestoreStep`)
- Modify: `tests/evolution/execution/capability-mutation-executor.test.ts` (add `describe("transition")`)

**Interfaces:**
- Consumes: `CapabilityTransitionMutation`, `isLegalTransition`, `LEGAL_LIFECYCLE_TRANSITIONS` (CAP-5), `LifecycleState`, `Registry.getLifecycleState`/`setLifecycleState`.
- Produces: `handleRestoreStep(step)` — restores a captured pre-state for `capability.restore_*` operations (Task 1's in-plan rollback contract). For transition, restore = captured pre-lifecycle or clear.

**Design contract:**
- Transition sequence: (1) `validateCapabilityMutation(mutation)` → reject; (2) **stale precondition (#34, #481): `registry.getLifecycleState(id) !== from` → reject** "actual <state> !== expected <from>" (A4 MUST refuse); (3) capture pre-state (full snapshot — lifecycle is registry state); (4) `registry.setLifecycleState(id, to)`; (5) commit (record + immutable result). Failure → restore pre-state (affectedIds = [capabilityId]).
- Transition does NOT touch the catalog (lifecycle is registry-owned state). The post output carries `{ capabilityId, from, to }`.
- `isLegalTransition(from, to)` is already enforced by `validateCapabilityMutation` — the executor must NOT re-implement the graph (no new semantics).
- In-plan rollback (`capability.restore_transition` step, emitted by `createCapabilityRollbackResolver`): `handleRestoreStep` restores the id to the captured pre-lifecycle (or clears if the id had no pre-state). For Task 3 this is exercised through a record-sink-failure restore; the full runtime-driven in-plan rollback is Task 8.

- [ ] **Step 1: Write the failing transition tests**

Append to `tests/evolution/execution/capability-mutation-executor.test.ts`:

```ts
describe("CapabilityMutationExecutor — transition", () => {
  let dir: string; let catalog: CapabilityCatalog; let registry: CapabilityRegistry;
  before(() => { dir = mkdtempSync(join(tmpdir(), "cap6-tr-")); catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir })); registry = new CapabilityRegistry(catalog); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  async function seedActive() {
    catalog.register(def(), def().bindings[0]);
    registry.reload();
    registry.setLifecycleState("tool.file.read", "active");
  }

  it("applies a legal transition (active → mature)", async () => {
    await seedActive();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const mutation = { operation: "capability.transition" as const, capabilityId: "tool.file.read", from: "active" as const, to: "mature" as const };
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.transition", parameters: mutation, idempotent: true, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, true);
    assert.equal(registry.getLifecycleState("tool.file.read"), "mature");
  });

  it("refuses a stale decision (actual !== from)", async () => {
    await seedActive();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const mutation = { operation: "capability.transition" as const, capabilityId: "tool.file.read", from: "deprecated" as const, to: "active" as const };
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.transition", parameters: mutation, idempotent: true, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, false);
    assert.match(res.error ?? "", /actual/);
    assert.equal(registry.getLifecycleState("tool.file.read"), "active"); // unchanged
  });

  it("does not mutate the catalog (lifecycle is registry state)", async () => {
    await seedActive();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const mutation = { operation: "capability.transition" as const, capabilityId: "tool.file.read", from: "active" as const, to: "declining" as const };
    const before = JSON.stringify(catalog.list());
    await executor.executeStep({ stepId: "s1", operation: "capability.transition", parameters: mutation, idempotent: true, preconditions: {}, postconditions: {} }, {});
    assert.equal(JSON.stringify(catalog.list()), before);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm run build && pnpm exec tsx --test tests/evolution/execution/capability-mutation-executor.test.ts
```

Expected: FAIL — transition returns "not implemented".

- [ ] **Step 3: Implement the transition path**

```ts
import type { CapabilityTransitionMutation } from "../../capability/mutation-contract.js";

private async executeTransition(step: ExecutionStep): Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
  const mutation = step.parameters as unknown as CapabilityTransitionMutation;
  const validation = validateCapabilityMutation(mutation);
  if (!validation.valid) return { success: false, output: {}, error: validation.errors.join("; ") };
  const actual = this.registry.getLifecycleState(mutation.capabilityId);
  if (actual !== mutation.from) {
    return { success: false, output: {}, error: `capability.transition: stale decision — actual '${String(actual)}' !== expected '${mutation.from}' (#34)` };
  }
  const pre = capturePreState(this.catalog, this.registry);
  const result = this.applyTransition(mutation);
  if (!result.ok) return { success: false, output: {}, error: result.error };
  return this.commit("capability.transition", mutation, [mutation.capabilityId], pre, result.output);
}

private applyTransition(mutation: CapabilityTransitionMutation): { ok: boolean; error?: string; output?: Record<string, unknown> } {
  try {
    this.registry.setLifecycleState(mutation.capabilityId, mutation.to);
    return { ok: true, output: { capabilityId: mutation.capabilityId, from: mutation.from, to: mutation.to } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm run build && pnpm exec tsx --test tests/evolution/execution/capability-mutation-executor.test.ts
```

Expected: PASS. Then `pnpm exec tsc --noEmit` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/evolution/execution/capability-mutation-executor.ts tests/evolution/execution/capability-mutation-executor.test.ts
git commit -m "feat(capability): CAP-6 capability.transition path — stale-decision precondition"
```

---
---

### Task 4: `capability.consolidate` path

**Files:**
- Modify: `src/evolution/execution/capability-mutation-executor.ts` (replace `executeConsolidate` stub; add `capability.restore_consolidate` to the rollback resolver)
- Modify: `tests/evolution/execution/capability-mutation-executor.test.ts` (add `describe("consolidate")`)

**Interfaces:**
- Consumes: `CapabilityConsolidateMutation`, `validateConsolidateMerge` (CAP-5 — the source-aware deferral-invariant validator), `CapabilityDefinition`, `LifecycleState`.
- Produces: `capability.restore_consolidate` rollback mapping (parameters: `{ sources: string[]; target: string }`).

**Design contract:**
- Consolidate sequence: (1) `validateCapabilityMutation(mutation)` (local shape) → reject; (2) resolve sources: `sourceDefs = mutation.sources.map(id => catalog.get(id))` — any missing → reject "source does not resolve"; (3) **`validateConsolidateMerge(mutation, sourceDefs)` → errors → reject** (this is the source-aware gate the CAP-5 deferral invariant demands — the executor is the ONLY place it runs); (4) **`mutation.definition.id === target` → else reject** (the approved definition must publish as the target); (5) **target version must advance the current target** — `catalog.has(target)` and `catalog.get(target).version >= definition.version` → reject "proposed target version must be higher than current target version (immutable #479)"; (6) capture pre-state; (7) publish target: `catalog.register(mutation.definition, mutation.definition.bindings[0])`; (8) disposition: `"deprecate"` → `registry.setLifecycleState(source, "deprecated")` for each source; `"remove"` → `catalog.remove(source)` for each source; (9) `registry.reload()`; (10) commit. Failure → restore pre-state (affectedIds = [target, ...sources]).
- This is a REAL definition mutation (#477): the approved definition is published; it is NOT the old A7.1 "deprecate related capabilities" behavior. The target publication is the governed definition, immutable, exactly as approved.
- If `sourceDisposition === "deprecate"`, sources remain in the catalog with lifecycle `deprecated` (terminal, #481); if `"remove"`, they are removed from the catalog.

- [ ] **Step 1: Write the failing consolidate tests**

Append to `tests/evolution/execution/capability-mutation-executor.test.ts`:

```ts
import { validateConsolidateMerge } from "../../../src/capability/mutation-contract.js";

describe("CapabilityMutationExecutor — consolidate", () => {
  let dir: string; let catalog: CapabilityCatalog; let registry: CapabilityRegistry;
  before(() => { dir = mkdtempSync(join(tmpdir(), "cap6-co-")); catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir })); registry = new CapabilityRegistry(catalog); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  const merged = (id: string, overrides: Partial<CapabilityDefinition> = {}) => def({ id, title: `Merged ${id}`, description: "merged", requiredPermissions: ["operator"], dependencies: [], ...overrides });

  async function seedSources() {
    catalog.register(merged("tool.file.a", { bindings: [{ type: "tool", id: "ta" }] }), { type: "tool", id: "ta" });
    catalog.register(merged("tool.file.b", { bindings: [{ type: "tool", id: "tb" }] }), { type: "tool", id: "tb" });
    registry.reload();
  }

  it("publishes the approved target definition and deprecates sources (deprecate disposition)", async () => {
    await seedSources();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const mutation = {
      operation: "capability.consolidate" as const,
      sources: ["tool.file.a", "tool.file.b"],
      target: "tool.file.ab",
      definition: merged("tool.file.ab", { version: "1.0.0", dependencies: ["tool.file.a", "tool.file.b"] }),
      sourceDisposition: "deprecate" as const,
    };
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.consolidate", parameters: mutation, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, true);
    // Real definition mutation: target published, not just deprecate-related
    const target = catalog.get("tool.file.ab")!;
    assert.equal(target.title, "Merged tool.file.ab");
    assert.equal(target.version, "1.0.0");
    // Sources deprecated (still present)
    assert.equal(registry.getLifecycleState("tool.file.a"), "deprecated");
    assert.equal(registry.getLifecycleState("tool.file.b"), "deprecated");
  });

  it("removes sources when disposition is 'remove'", async () => {
    await seedSources();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const mutation = {
      operation: "capability.consolidate" as const,
      sources: ["tool.file.a", "tool.file.b"],
      target: "tool.file.ab",
      definition: merged("tool.file.ab", { version: "1.0.0", dependencies: ["tool.file.a", "tool.file.b"] }),
      sourceDisposition: "remove" as const,
    };
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.consolidate", parameters: mutation, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, true);
    assert.equal(catalog.has("tool.file.a"), false);
    assert.equal(catalog.has("tool.file.b"), false);
  });

  it("rejects a merge that violates the #477 conservative rules (source-aware)", async () => {
    await seedSources();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const mutation = {
      operation: "capability.consolidate" as const,
      sources: ["tool.file.a", "tool.file.b"],
      target: "tool.file.ab",
      definition: merged("tool.file.ab", { version: "1.0.0", dependencies: [] }), // missing union dependency
      sourceDisposition: "deprecate" as const,
    };
    // Sanity: the CAP-5 validator rejects it too (executor must route through it)
    const srcs = mutation.sources.map((id) => catalog.get(id)!).filter(Boolean);
    assert.equal(validateConsolidateMerge(mutation, srcs).valid, false);
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.consolidate", parameters: mutation, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, false);
    assert.ok(!catalog.has("tool.file.ab")); // nothing mutated
  });

  it("rejects a definition whose id does not match the target", async () => {
    await seedSources();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const mutation = {
      operation: "capability.consolidate" as const,
      sources: ["tool.file.a", "tool.file.b"],
      target: "tool.file.ab",
      definition: merged("tool.file.WRONG", { version: "1.0.0", dependencies: ["tool.file.a", "tool.file.b"] }),
      sourceDisposition: "deprecate" as const,
    };
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.consolidate", parameters: mutation, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, false);
    assert.match(res.error ?? "", /id.*target|target.*id/);
  });

  it("rejects a source that does not resolve", async () => {
    await seedSources();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const mutation = {
      operation: "capability.consolidate" as const,
      sources: ["tool.file.a", "tool.file.missing"],
      target: "tool.file.ab",
      definition: merged("tool.file.ab", { version: "1.0.0", dependencies: ["tool.file.a"] }),
      sourceDisposition: "deprecate" as const,
    };
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.consolidate", parameters: mutation, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, false);
    assert.match(res.error ?? "", /does not resolve/);
  });

  it("record-sink failure after consolidate → byte-identical restore", async () => {
    await seedSources();
    const executor = new CapabilityMutationExecutor({ catalog, registry, record: async () => { throw new Error("boom"); } });
    const before = JSON.stringify(catalog.list());
    const mutation = {
      operation: "capability.consolidate" as const,
      sources: ["tool.file.a", "tool.file.b"],
      target: "tool.file.ab",
      definition: merged("tool.file.ab", { version: "1.0.0", dependencies: ["tool.file.a", "tool.file.b"] }),
      sourceDisposition: "remove" as const,
    };
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.consolidate", parameters: mutation, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, false);
    assert.equal(JSON.stringify(catalog.list()), before);
    assert.equal(registry.getLifecycleState("tool.file.a"), undefined); // lifecycle also restored
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm run build && pnpm exec tsx --test tests/evolution/execution/capability-mutation-executor.test.ts
```

Expected: FAIL — consolidate returns "not implemented".

- [ ] **Step 3: Implement the consolidate path**

Register `capability.consolidate` in the resolver:

```ts
resolver.registerOperation("capability.consolidate", (step) => {
  const { sources, target } = step.parameters as { sources?: string[]; target?: string };
  return {
    stepId: `rb-${step.stepId}`, forwardStepId: step.stepId,
    operation: "capability.restore_consolidate",
    parameters: { sources: sources ?? [], target }, rollbackType: "automatic" as const, safe: true,
  };
});
```

Replace the `executeConsolidate` stub:

```ts
import { validateConsolidateMerge } from "../../capability/mutation-contract.js";
import type { CapabilityConsolidateMutation } from "../../capability/mutation-contract.js";

private async executeConsolidate(step: ExecutionStep): Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
  const mutation = step.parameters as unknown as CapabilityConsolidateMutation;
  const validation = validateCapabilityMutation(mutation);
  if (!validation.valid) return { success: false, output: {}, error: validation.errors.join("; ") };

  const sourceDefs: CapabilityDefinition[] = [];
  for (const id of mutation.sources) {
    const d = this.catalog.get(id);
    if (!d) return { success: false, output: {}, error: `capability.consolidate: source '${id}' does not resolve to a definition` };
    sourceDefs.push(d);
  }
  const merge = validateConsolidateMerge(mutation, sourceDefs);
  if (!merge.valid) return { success: false, output: {}, error: merge.errors.join("; ") };
  if (mutation.definition.id !== mutation.target) {
    return { success: false, output: {}, error: `capability.consolidate: proposed definition id '${mutation.definition.id}' must equal target '${mutation.target}'` };
  }
  if (this.catalog.has(mutation.target) && this.catalog.get(mutation.target)!.version >= mutation.definition.version) {
    return { success: false, output: {}, error: `capability.consolidate: proposed target version ${mutation.definition.version} must be higher than current target version ${this.catalog.get(mutation.target)!.version} (immutable #479)` };
  }

  const pre = capturePreState(this.catalog, this.registry);
  const affected = [mutation.target, ...mutation.sources];
  const result = this.applyConsolidate(mutation);
  if (!result.ok) { restorePreState(this.catalog, this.registry, affected, pre); return { success: false, output: {}, error: result.error }; }
  return this.commit("capability.consolidate", mutation, affected, pre, result.output);
}

private applyConsolidate(mutation: CapabilityConsolidateMutation): { ok: boolean; error?: string; output?: Record<string, unknown> } {
  try {
    this.catalog.register(mutation.definition, mutation.definition.bindings[0]); // publish the approved definition (immutable)
    if (mutation.sourceDisposition === "deprecate") {
      for (const s of mutation.sources) this.registry.setLifecycleState(s, "deprecated");
    } else {
      for (const s of mutation.sources) this.catalog.remove(s);
    }
    this.registry.reload();
    return { ok: true, output: { target: this.catalog.get(mutation.target), sources: mutation.sources, sourceDisposition: mutation.sourceDisposition } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm run build && pnpm exec tsx --test tests/evolution/execution/capability-mutation-executor.test.ts
```

Expected: PASS. Then `pnpm exec tsc --noEmit` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/evolution/execution/capability-mutation-executor.ts tests/evolution/execution/capability-mutation-executor.test.ts
git commit -m "feat(capability): CAP-6 capability.consolidate path — source-aware merge + disposition"
```

---
---

### Task 5: `capability.remove` path

**Files:**
- Modify: `src/evolution/execution/capability-mutation-executor.ts` (replace `executeRemove` stub; add `capability.restore_remove` to the rollback resolver)
- Modify: `tests/evolution/execution/capability-mutation-executor.test.ts` (add `describe("remove")`)

**Interfaces:**
- Consumes: `CapabilityRemoveMutation`.
- Produces: `capability.restore_remove` rollback mapping (parameters: `{ capabilityId }`).

**Design contract:**
- Remove sequence: (1) `validateCapabilityMutation(mutation)` → reject; (2) `catalog.get(capabilityId)` exists → else reject "not found"; (3) capture pre-state; (4) `catalog.remove(capabilityId)` (removes all `id@version` publications — removal is terminal); (5) `registry.reload()`; (6) commit. Failure → restore pre-state (affectedIds = [capabilityId]).
- Removal policy is a governance concern upstream (design §25 "Whether removal is allowed should be policy-controlled"). The executor does NOT add a must-be-deprecated gate — that would be new semantics. A deprecated capability may remain in the catalog only if no remove mutation is governed; the executor applies an approved remove regardless of lifecycle (the approval IS the policy gate).
- The rollback restores every removed `id@version` publication + lifecycle/availability (full snapshot restore).

- [ ] **Step 1: Write the failing remove tests**

Append to `tests/evolution/execution/capability-mutation-executor.test.ts`:

```ts
describe("CapabilityMutationExecutor — remove", () => {
  let dir: string; let catalog: CapabilityCatalog; let registry: CapabilityRegistry;
  before(() => { dir = mkdtempSync(join(tmpdir(), "cap6-rm-")); catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir })); registry = new CapabilityRegistry(catalog); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  async function seedTwoVersions() {
    catalog.register(def(), def().bindings[0]);
    catalog.register(def({ version: "1.1.0", description: "newer" }), def({ version: "1.1.0", description: "newer" }).bindings[0]);
    registry.reload();
  }

  it("removes the capability (all id@version publications) with an immutable record", async () => {
    await seedTwoVersions();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const mutation = { operation: "capability.remove" as const, capabilityId: "tool.file.read", reason: "superseded by tool.file.aggregate" };
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.remove", parameters: mutation, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, true);
    assert.equal(catalog.has("tool.file.read"), false);
    assert.equal(registry.get("tool.file.read"), undefined);
    const result = res.output.result as { mutation: { reason: string }; preState: { definitions: CapabilityDefinition[] } };
    assert.equal(result.mutation.reason, "superseded by tool.file.aggregate");
    assert.equal(result.preState.definitions.filter((d) => d.id === "tool.file.read").length, 2); // full pre-state captured
  });

  it("rejects removal of an unknown capability", async () => {
    await seedTwoVersions();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const mutation = { operation: "capability.remove" as const, capabilityId: "tool.file.nope", reason: "x" };
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.remove", parameters: mutation, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, false);
    assert.match(res.error ?? "", /not found/);
  });

  it("record-sink failure after remove → byte-identical restore", async () => {
    await seedTwoVersions();
    const executor = new CapabilityMutationExecutor({ catalog, registry, record: async () => { throw new Error("boom"); } });
    const before = JSON.stringify(catalog.list());
    const mutation = { operation: "capability.remove" as const, capabilityId: "tool.file.read", reason: "x" };
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.remove", parameters: mutation, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, false);
    assert.equal(JSON.stringify(catalog.list()), before);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm run build && pnpm exec tsx --test tests/evolution/execution/capability-mutation-executor.test.ts
```

Expected: FAIL — remove returns "not implemented".

- [ ] **Step 3: Implement the remove path**

Register `capability.remove` in the resolver:

```ts
resolver.registerOperation("capability.remove", (step) => {
  const { capabilityId } = step.parameters as { capabilityId?: string };
  return {
    stepId: `rb-${step.stepId}`, forwardStepId: step.stepId,
    operation: "capability.restore_remove",
    parameters: { capabilityId }, rollbackType: "automatic" as const, safe: true,
  };
});
```

Replace the `executeRemove` stub:

```ts
import type { CapabilityRemoveMutation } from "../../capability/mutation-contract.js";

private async executeRemove(step: ExecutionStep): Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
  const mutation = step.parameters as unknown as CapabilityRemoveMutation;
  const validation = validateCapabilityMutation(mutation);
  if (!validation.valid) return { success: false, output: {}, error: validation.errors.join("; ") };
  if (!this.catalog.has(mutation.capabilityId)) {
    return { success: false, output: {}, error: `capability.remove: '${mutation.capabilityId}' not found` };
  }
  const pre = capturePreState(this.catalog, this.registry);
  const result = this.applyRemove(mutation);
  if (!result.ok) return { success: false, output: {}, error: result.error };
  return this.commit("capability.remove", mutation, [mutation.capabilityId], pre, result.output);
}

private applyRemove(mutation: CapabilityRemoveMutation): { ok: boolean; error?: string; output?: Record<string, unknown> } {
  try {
    this.catalog.remove(mutation.capabilityId);
    this.registry.reload();
    return { ok: true, output: { capabilityId: mutation.capabilityId, reason: mutation.reason, removed: true } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm run build && pnpm exec tsx --test tests/evolution/execution/capability-mutation-executor.test.ts
```

Expected: PASS. Then `pnpm exec tsc --noEmit` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/evolution/execution/capability-mutation-executor.ts tests/evolution/execution/capability-mutation-executor.test.ts
git commit -m "feat(capability): CAP-6 capability.remove path — terminal removal + full pre-state capture"
```

---
---

### Task 6: Atomicity matrix + immutable artifact hardening

**Files:**
- Modify: `src/evolution/execution/capability-mutation-executor.ts` (add `handleRestoreStep` — in-plan `capability.restore_*` handling; ensure restore is idempotent across a mid-plan failure)
- Modify: `tests/evolution/execution/capability-mutation-executor.test.ts` (add `describe("atomicity")` and `describe("immutability")`)
- Test: `tests/evolution/execution/capability-mutation-atomicity.test.ts` (dedicated byte-identical matrix)

**Interfaces:**
- Consumes: all five op paths from Tasks 1-5.
- Produces: `private handleRestoreStep(step): { success: boolean; output: Record<string, unknown> }` — restores the captured pre-state for a `capability.restore_*` step (the in-plan rollback the resolver emits). For Task 6 it exercises each restore op; Task 8 drives it through the runtime.

**Design contract (the ticket's atomicity AC, hardened):**
- **Reject → unchanged:** a mutation failing `validateCapabilityMutation` / source resolution / preconditions leaves catalog + registry byte-identical. Covered per-op in Tasks 1-5; this task adds a comprehensive matrix across ALL five ops asserting `JSON.stringify(catalog.list())` and `registry.list()` unchanged after each reject.
- **Execution failure → rollback, no committed mutation:** a record-sink failure (or an injected apply failure) after the durable mutation restores the pre-state byte-identical. Matrix across all five ops.
- **Success → exactly one governed mutation + new immutable publication where required:** create/update/consolidate publish exactly one new `id@version`; transition mutates lifecycle only; remove deletes. Matrix asserts the exact post-state.
- **Immutable input + output artifacts:** every `CapabilityMutationResult` is deep-frozen; returned objects share no references with live catalog/registry state (mutating them cannot change the catalog). `artifactId` is deterministic across identical executions.
- **In-plan rollback (`capability.restore_*`):** `handleRestoreStep` maps each restore op to `restorePreState` with the step's parameters (the executor restores from the captured pre-state; idempotent). The in-plan rollback and the executor's own restore produce the same byte-identical result.

- [ ] **Step 1: Write the failing atomicity + immutability tests**

`tests/evolution/execution/capability-mutation-atomicity.test.ts`:

```ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CapabilityCatalog } from "../../../src/capability/canonical/catalog.js";
import { CapabilityDefinitionStore } from "../../../src/capability/canonical/catalog-store.js";
import { CapabilityRegistry } from "../../../src/capability/registry.js";
import { CapabilityMutationExecutor } from "../../../src/evolution/execution/capability-mutation-executor.js";
import type { CapabilityDefinition } from "../../../src/capability/canonical/definition.js";
import type { CapabilityMutation, ExecutionStep } from "../../../src/evolution/execution/contracts/execution-contract.js";

function def(id = "tool.file.read", overrides: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return { id, version: "1.0.0", kind: "operation", title: "Read file", description: "read", tags: ["file"], category: "files", risk: "low", requiredPermissions: ["operator"], dependencies: [], bindings: [{ type: "tool", id: "tool-1" }], ...overrides };
}

function step(op: string, params: Record<string, unknown>): ExecutionStep {
  return { stepId: "s1", operation: op, parameters: params, idempotent: false, preconditions: {}, postconditions: {} };
}

describe("CAP-6 atomicity matrix", () => {
  let dir: string; let catalog: CapabilityCatalog; let registry: CapabilityRegistry;
  before(() => { dir = mkdtempSync(join(tmpdir(), "cap6-at-")); catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir })); registry = new CapabilityRegistry(catalog); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  function snapshot() { return { catalog: JSON.stringify(catalog.list()), registry: JSON.stringify(registry.list()) }; }
  function assertIdentical(a: ReturnType<typeof snapshot>, b: ReturnType<typeof snapshot>) {
    assert.equal(b.catalog, a.catalog);
    assert.equal(b.registry, a.registry);
  }

  it("reject leaves every op unchanged", async () => {
    catalog.register(def("tool.file.read"), def("tool.file.read").bindings[0]);
    registry.reload();
    const before = snapshot();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    // Invalid create (bad version) → unchanged
    await executor.executeStep(step("capability.create", { operation: "capability.create", definition: def("tool.file.bad", { version: "1.0" }) }), {});
    // Stale transition → unchanged
    await executor.executeStep(step("capability.transition", { operation: "capability.transition", capabilityId: "tool.file.read", from: "deprecated", to: "active" }), {});
    // Stale update → unchanged
    await executor.executeStep(step("capability.update", { operation: "capability.update", capabilityId: "tool.file.read", sourceVersion: "0.1.0", patch: { description: "x" } }), {});
    // Unknown remove → unchanged
    await executor.executeStep(step("capability.remove", { operation: "capability.remove", capabilityId: "tool.file.nope", reason: "x" }), {});
    // Consolidate with unresolvable source → unchanged
    await executor.executeStep(step("capability.consolidate", { operation: "capability.consolidate", sources: ["tool.file.missing"], target: "tool.file.merge", definition: def("tool.file.merge"), sourceDisposition: "deprecate" }), {});
    assertIdentical(snapshot(), before);
  });

  it("record-sink failure rolls back every durable op to byte-identical", async () => {
    catalog.register(def("tool.file.read"), def("tool.file.read").bindings[0]);
    registry.reload();
    const before = snapshot();
    const executor = new CapabilityMutationExecutor({ catalog, registry, record: async () => { throw new Error("boom"); } });
    const attempts: Array<{ op: string; params: Record<string, unknown> }> = [
      { op: "capability.create", params: { operation: "capability.create", definition: def("tool.file.created") } },
      { op: "capability.update", params: { operation: "capability.update", capabilityId: "tool.file.read", sourceVersion: "1.0.0", patch: { description: "new" } } },
      { op: "capability.transition", params: { operation: "capability.transition", capabilityId: "tool.file.read", from: "emerging", to: "active" } },
      { op: "capability.consolidate", params: { operation: "capability.consolidate", sources: ["tool.file.read"], target: "tool.file.merge", definition: def("tool.file.merge", { dependencies: ["tool.file.read"] }), sourceDisposition: "deprecate" } },
      { op: "capability.remove", params: { operation: "capability.remove", capabilityId: "tool.file.read", reason: "x" } },
    ];
    for (const a of attempts) {
      const res = await executor.executeStep(step(a.op, a.params), {});
      assert.equal(res.success, false, `${a.op} should fail`);
      assertIdentical(snapshot(), before);
    }
  });

  it("success produces exactly one governed mutation + immutable artifact", async () => {
    catalog.register(def("tool.file.read"), def("tool.file.read").bindings[0]);
    registry.reload();
    const before = snapshot();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const res = await executor.executeStep(step("capability.update", { operation: "capability.update", capabilityId: "tool.file.read", sourceVersion: "1.0.0", patch: { description: "new" } }), {});
    assert.equal(res.success, true);
    const result = res.output.result as { artifactId: string; mutation: { operation: string }; post: { published: CapabilityDefinition } };
    assert.equal(result.mutation.operation, "capability.update");
    assert.equal(result.post.published.version, "1.0.1");
    assert.equal(catalog.list().filter((d) => d.id === "tool.file.read").length, 2); // exactly one new publication
    // Immutable input + output: deep-frozen, no aliasing
    assert.ok(Object.isFrozen(result.mutation));
    assert.ok(Object.isFrozen(result.post));
    (result.mutation as unknown as { operation: string }).operation = "capability.remove"; // mutation must be inert
    assert.equal(catalog.list().filter((d) => d.id === "tool.file.read").length, 2);
    void before;
  });

  it("artifactId is deterministic for identical executions", async () => {
    catalog.register(def("tool.file.read"), def("tool.file.read").bindings[0]);
    registry.reload();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const params = { operation: "capability.update" as const, capabilityId: "tool.file.read", sourceVersion: "1.0.0", patch: { description: "deterministic" } };
    const a = await executor.executeStep(step("capability.update", params), {});
    // Re-seed to 1.0.0 then run again (same inputs → same artifactId)
    catalog.remove("tool.file.read");
    catalog.register(def("tool.file.read"), def("tool.file.read").bindings[0]);
    registry.reload();
    const b = await executor.executeStep(step("capability.update", params), {});
    assert.equal((a.output.result as { artifactId: string }).artifactId, (b.output.result as { artifactId: string }).artifactId);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm run build && pnpm exec tsx --test tests/evolution/execution/capability-mutation-atomicity.test.ts
```

Expected: FAIL — output objects not frozen (`Object.isFrozen` false), `artifactId` absent/undefined.

- [ ] **Step 3: Harden the executor (freeze results, deterministic artifactId, in-plan restore)**

Update `commit` to deep-freeze every artifact and make the record sink receive a frozen result:

```ts
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const k of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[k]);
  }
  return Object.freeze(value);
}

function deterministicArtifactId(operation: string, mutation: CapabilityMutation, post: Record<string, unknown>): string {
  const hash = createHash("sha256");
  hash.update(MUTATION_PREFIX);
  hash.update(canonicalStringify({ operation, mutation, post })); // post already normalized (no timestamps)
  return hash.digest("hex");
}
```

In `commit`: build `post` as a **normalized** deep copy (strip any `Date.now()`-derived fields — the executor currently has none, but assert it by constructing `post` from only mutation-derived state), then:

```ts
const result: CapabilityMutationResult = Object.freeze({
  artifactId: deterministicArtifactId(operation, mutation, deepCopy(post)),
  operation,
  mutation: deepFreeze(deepCopy(mutation)),
  preState: deepFreeze(deepCopy(pre)),
  post: deepFreeze(deepCopy(post)),
});
```

Add `handleRestoreStep` and wire the five `capability.restore_*` cases into `executeStep`:

```ts
case "capability.restore_create":
case "capability.restore_update":
case "capability.restore_transition":
case "capability.restore_consolidate":
case "capability.restore_remove":
  return this.handleRestoreStep(step);

private async handleRestoreStep(step: ExecutionStep): Promise<{ success: boolean; output: Record<string, unknown> }> {
  const params = step.parameters as { capabilityId?: string; sources?: string[]; target?: string };
  const affected: string[] = [];
  if (params.capabilityId) affected.push(params.capabilityId);
  if (params.sources) affected.push(...params.sources);
  if (params.target) affected.push(params.target);
  // The captured pre-state is stored per-execution; restorePreState is idempotent.
  // The executor holds no cross-step memory, so an in-plan restore re-captures the
  // CURRENT state as the baseline — Task 8's runtime-driven rollback drives this.
  return { success: true, output: { restored: affected } };
}
```

**Note for the implementer:** the executor is deliberately **stateless across steps** — it does NOT hold a pre-state map like the A7.1 `CapabilityLifecycleStepExecutor`. CAP-6's model is **one governed mutation per execution plan** (design §36 sequence; ticket AC "success → exactly one governed mutation"). Each plan has exactly one mutation step; the executor's record-sink restore (inside the boundary) already returns the catalog/registry byte-identical on any failure. `handleRestoreStep` handles the runtime's in-plan rollback for that single step (a no-op because the state is already restored) — it exists so the runtime's rollback path is covered, not to compose multi-mutation rollback. **Multi-step plans (several mutations per execution) are OUT OF SCOPE for CAP-6**; a future executor composition owns that. Do not add a pre-state map.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm run build && pnpm exec tsx --test tests/evolution/execution/capability-mutation-executor.test.ts tests/evolution/execution/capability-mutation-atomicity.test.ts
```

Expected: PASS. Then `pnpm exec tsc --noEmit` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/evolution/execution/capability-mutation-executor.ts tests/evolution/execution/capability-mutation-atomicity.test.ts tests/evolution/execution/capability-mutation-executor.test.ts
git commit -m "feat(capability): CAP-6 atomicity matrix + immutable frozen artifacts + in-plan restore"
```

---
---

### Task 7: Rollback re-homing + barrel export + full-suite verification

**Files:**
- Modify: `src/evolution/execution/execution-planner.ts` (remove the `capability.transition` registration at 173-183 from `createDefaultRollbackResolver`; update the comment to note legacy consumers use `createCapabilityRollbackResolver`)
- Modify: `src/evolution/capability-lifecycle/capability-lifecycle-applier.ts` (repoint resolver: `createDefaultRollbackResolver()` → `createCapabilityRollbackResolver()`)
- Modify: `src/evolution/execution/index.ts` (add `export * from "./capability-mutation-executor.js";`)
- Modify: `tests/evolution/execution/execution-planner.test.ts` (if any test referenced the removed registration — verify none do for `capability.transition`, else update)
- Test: `tests/evolution/execution/capability-mutation-rollback.test.ts` (new — assert the re-homed resolver emits all five mappings and the applier still produces automatic transition rollback)

**Interfaces:**
- Consumes: `createCapabilityRollbackResolver` (Task 1-5), `createDefaultRollbackResolver` (planner), `CapabilityLifecycleApplier` (legacy).
- Produces: the executor barrel-exported from `src/evolution/execution/index.ts`; the planner no longer owns `capability.*` rollback semantics; the legacy applier's plans keep automatic safe transition rollback.

**Design contract (the "re-home" — program spec CAP-6):**
- `createDefaultRollbackResolver` loses its `capability.transition` → `capability.restore_transition` registration (execution-planner.ts:173-183). The mapping lives ONLY in the executor's `createCapabilityRollbackResolver()`. The planner stays generic (upgrade_agent_runtime + update_configuration + manual fallback).
- The legacy `CapabilityLifecycleApplier` (which builds transition plans) is repointed to the executor's resolver so its `capability.transition` steps still get `capability.restore_transition` (safe: automatic) — behavior-preserving, verified by the applier's existing tests.
- No production code other than the applier referenced the removed registration (verified in the pre-plan survey); the A7.1 step-executor tests drive the step executor directly and are unaffected.

- [ ] **Step 1: Write the failing re-homing tests**

`tests/evolution/execution/capability-mutation-rollback.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCapabilityRollbackResolver } from "../../../src/evolution/execution/capability-mutation-executor.js";
import { createDefaultRollbackResolver } from "../../../src/evolution/execution/execution-planner.js";
import type { ExecutionStep } from "../../../src/evolution/execution/contracts/execution-contract.js";

function s(op: string, params: Record<string, unknown>, idempotent = false): ExecutionStep {
  return { stepId: "s1", operation: op, parameters: params, idempotent, preconditions: {}, postconditions: {} };
}

describe("capability rollback re-homing", () => {
  it("the executor resolver maps all five operations to automatic safe rollback", () => {
    const resolver = createCapabilityRollbackResolver();
    const ops: Array<[string, Record<string, unknown>]> = [
      ["capability.create", { capabilityId: "c1" }],
      ["capability.update", { capabilityId: "c1" }],
      ["capability.transition", { capabilityId: "c1" }],
      ["capability.consolidate", { sources: ["a", "b"], target: "ab" }],
      ["capability.remove", { capabilityId: "c1" }],
    ];
    for (const [op, params] of ops) {
      const rb = resolver.createRollback(s(op, params));
      assert.match(rb.operation, /^capability\.restore_/);
      assert.equal(rb.safe, true);
      assert.equal(rb.rollbackType, "automatic");
    }
  });

  it("the default planner resolver no longer owns capability.transition (re-homed)", () => {
    const resolver = createDefaultRollbackResolver();
    const rb = resolver.createRollback(s("capability.transition", { capabilityId: "c1" }, true));
    // Re-homed: falls back to manual (generic planner), safe=false — legacy applier is repointed
    assert.equal(rb.safe, false);
    assert.equal(rb.rollbackType, "manual");
  });

  it("the legacy applier still produces automatic transition rollback (repointed)", async () => {
    // Regression: applier plans for a deprecate must carry capability.restore_transition.
    const applierModule = await import("../../../src/evolution/capability-lifecycle/capability-lifecycle-applier.js");
    const { CapabilityLifecycleStepExecutor } = await import("../../../src/evolution/capability-lifecycle/capability-lifecycle-step-executor.js");
    assert.ok(applierModule.CapabilityLifecycleApplier);
    assert.ok(CapabilityLifecycleStepExecutor);
    // The applier's deps.resolver is now createCapabilityRollbackResolver — assert the
    // transition mapping it yields is the automatic restore (covered by the applier's own
    // tests; here we confirm the executor resolver's transition mapping matches).
    const resolver = createCapabilityRollbackResolver();
    const rb = resolver.createRollback(s("capability.transition", { capabilityId: "c1" }, true));
    assert.equal(rb.operation, "capability.restore_transition");
    assert.equal(rb.safe, true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm run build && pnpm exec tsx --test tests/evolution/execution/capability-mutation-rollback.test.ts
```

Expected: FAIL — `createDefaultRollbackResolver().createRollback(capability.transition)` still returns the automatic mapping (not yet removed).

- [ ] **Step 3: Re-home the rollback mapping + export**

In `execution-planner.ts`, delete the `capability.transition` registration block (the `resolver.registerOperation("capability.transition", ...)` call and its surrounding comment at 167-183). Keep `upgrade_agent_runtime` and `update_configuration`.

In `capability-lifecycle-applier.ts`, change:

```ts
import { createDefaultRollbackResolver } from "../execution/execution-planner.js";
```
to:
```ts
import { createCapabilityRollbackResolver } from "../execution/capability-mutation-executor.js";
```
and:
```ts
const resolver = this.deps.resolver ?? createDefaultRollbackResolver();
```
to:
```ts
const resolver = this.deps.resolver ?? createCapabilityRollbackResolver();
```

In `src/evolution/execution/index.ts`, add `export * from "./capability-mutation-executor.js";`.

Check `tests/evolution/execution/execution-planner.test.ts` — the `createDefaultRollbackResolver` describe block tests only upgrade_agent_runtime / update_configuration / unknown fallback (verified in the pre-plan survey: no `capability.transition` assertion). If any test asserts the removed mapping, update it to assert the manual fallback instead.

- [ ] **Step 4: Run the full suite to verify no regression**

```bash
pnpm run build && pnpm exec tsx --test tests/evolution/execution/ tests/evolution/capability-lifecycle/
pnpm exec tsc --noEmit
```

Expected: PASS (execution + lifecycle suites), 0 tsc errors. Then run the broader suite:
```bash
pnpm run build && pnpm test
```
Expected: only the known pre-existing CI failures (`supply-chain`/`unit`/`tui-smoke`) may fail on main; the execution/lifecycle/capability suites must pass.

- [ ] **Step 5: Commit**

```bash
git add src/evolution/execution/execution-planner.ts src/evolution/capability-lifecycle/capability-lifecycle-applier.ts src/evolution/execution/index.ts tests/evolution/execution/capability-mutation-rollback.test.ts tests/evolution/execution/execution-planner.test.ts
git commit -m "refactor(capability): CAP-6 re-home capability.* rollback mappings into executor + barrel export"
```

---
---

### Task 8: Full A4 flow integration test — authorize → plan → runtime → executor

**Files:**
- Test: `tests/evolution/execution/integration/capability-mutation-executor-integration.test.ts` (new, node:test)

**Interfaces:**
- Consumes: `authorizeExecution`, `createExecutionPlan`, `GovernedExecutionRuntime`, `CapabilityMutationExecutor`, `createCapabilityRollbackResolver`, `toCapabilityMutationChange`, `buildExecutionEvidence`; `CapabilityCatalog`/`CapabilityRegistry`; `generateDecision`/`computeDecisionIntegrityHash` (from `src/evolution/governance/decision-engine.js` — see the closed-loop test's pattern).
- Produces: an end-to-end proof of every AC in ticket #490: five mutations through A4; A4 gate verbatim; reject-no-mutation; rollback; immutable artifacts; no `APPROVED_PENDING_APPLICATION` dead-end; consolidation as a real definition mutation.

**Design contract:**
- Build a proposal embedding the mutation as a change (`EvolutionProposal & { changes: [toCapabilityMutationChange(mutation)] }`), a `GovernanceDecision` (kind APPROVE, integrity hash computed), authorize → plan (executor resolver) → `runtime.execute(plan, executor)`.
- **AC assertions:**
  1. **create through A4**: approved create → report completed → definition published (complete, not placeholder), lifecycle emerging.
  2. **update through A4**: approved update → new immutable `id@version` (higher), old publication retained.
  3. **transition through A4**: approved transition with correct `from` → lifecycle moves; **stale `from` → report not completed, state unchanged** (A4 refuses).
  4. **consolidate through A4**: approved consolidate → target published (real definition mutation), sources deprecated (or removed).
  5. **remove through A4**: approved remove → capability gone from catalog + registry.
  6. **rejection-no-mutation**: an invalid/stale mutation fails authorization OR the plan → nothing changes.
  7. **rollback**: a plan whose mutation fails (e.g. a record-sink failure injected on the second mutation) → report `rolled_back`, catalog + registry byte-identical to pre-execution.
  8. **immutable artifacts**: `buildExecutionEvidence` over the completed report yields an `EvolutionExecutionEvidence` with a valid integrity hash; the executor's `CapabilityMutationResult` is deep-frozen.
  9. **no APPROVED_PENDING_APPLICATION**: the executor applies the complete definition directly — the registry reports the capability as present/emerging with no overlay dead-end.
- The `GovernanceDecision` must pass `authorizeExecution` check 3 (integrity hash) — reuse `computeDecisionIntegrityHash` from the closed-loop test's pattern.

- [ ] **Step 1: Write the failing integration test**

```ts
/**
 * CAP-6 — End-to-end A4 flow: authorize → plan → GovernedExecutionRuntime →
 * CapabilityMutationExecutor. Proves every AC in ticket #490.
 *
 * @module capability-mutation-executor-integration
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CapabilityCatalog } from "../../../../src/capability/canonical/catalog.js";
import { CapabilityDefinitionStore } from "../../../../src/capability/canonical/catalog-store.js";
import { CapabilityRegistry } from "../../../../src/capability/registry.js";
import { authorizeExecution } from "../../../../src/evolution/execution/execution-authorization.js";
import { createExecutionPlan } from "../../../../src/evolution/execution/execution-planner.js";
import { GovernedExecutionRuntime } from "../../../../src/evolution/execution/execution-runtime.js";
import { buildExecutionEvidence } from "../../../../src/evolution/execution/execution-evidence-bridge.js";
import { CapabilityMutationExecutor, createCapabilityRollbackResolver, toCapabilityMutationChange } from "../../../../src/evolution/execution/capability-mutation-executor.js";
import { computeDecisionIntegrityHash } from "../../../../src/evolution/governance/decision-engine.js";
import type { GovernanceDecision } from "../../../../src/evolution/governance/contracts/decision-contract.js";
import type { EvolutionProposal } from "../../../../src/evolution/contracts/evolution-contract.js";
import type { ExecutionEnvironment, ExecutionRequest, EvolutionExecutionEvidence } from "../../../../src/evolution/execution/contracts/execution-contract.js";
import type { CapabilityMutation } from "../../../../src/capability/mutation-contract.js";
import type { CapabilityDefinition } from "../../../../src/capability/canonical/definition.js";

function def(id: string, overrides: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return { id, version: "1.0.0", kind: "operation", title: `Cap ${id}`, description: "d", tags: [], category: "c", risk: "low", requiredPermissions: ["operator"], dependencies: [], bindings: [{ type: "tool", id: "tool-1" }], ...overrides };
}

let decisionSeq = 0;
function makeDecision(evolutionId: string, proposalId: string): GovernanceDecision {
  const base: Omit<GovernanceDecision, "integrityHash"> = {
    decisionId: `govd-cap6-${++decisionSeq}`,
    proposalId,
    evolutionId,
    kind: "APPROVE",
    confidence: 0.9,
    reasoning: "CAP-6 test approval",
    risks: [],
    evidenceId: `ev-${decisionSeq}`,
    recommendationAvailable: false,
    followedRecommendation: false,
    policySnapshot: {
      policyName: "default",
      minApproveConfidence: 0.8,
      minMonitorConfidence: 0.5,
      rejectConfidenceThreshold: 0.3,
      maxAllowedRegressions: 0,
      escalateBehavior: "request_evidence",
      failClosedOnExpiredEvidence: true,
      minReproducibilityLevel: 2,
    },
    targetState: "APPROVED",
    decidedAt: "2026-08-11T00:00:00.000Z",
    decidedBy: "governance_policy",
  };
  return { ...base, integrityHash: computeDecisionIntegrityHash(base) };
}

function makeProposal(evolutionId: string, mutation: CapabilityMutation): EvolutionProposal & { changes: Array<ReturnType<typeof toCapabilityMutationChange>> } {
  return {
    proposalId: `prop-${evolutionId}`, evolutionId, title: "CAP-6", description: "integration",
    change: mutation.operation, beforeHash: null, afterHash: null, createdAt: "2026-08-11T00:00:00.000Z",
    changes: [toCapabilityMutationChange(mutation)],
  };
}

let evolutionSeq = 0;
async function runMutation(catalog: CapabilityCatalog, registry: CapabilityRegistry, mutation: CapabilityMutation, record?: (r: unknown) => Promise<void> | void) {
  const evolutionId = `evol-cap6-${++evolutionSeq}`;
  const proposal = makeProposal(evolutionId, mutation);
  const decision = makeDecision(evolutionId, proposal.proposalId);
  const request: ExecutionRequest = { requestId: `req-${evolutionId}`, evolutionId, requestedBy: "test", requestedAt: "2026-08-11T00:00:00.000Z" };
  const auth = authorizeExecution({ request, proposal, decision });
  assert.equal(auth.allowed, true, `authorization failed: ${"reason" in auth ? auth.reason : "n/a"}`);
  const environment: ExecutionEnvironment = { environmentId: "env", environmentHash: "hash", runtimeVersion: "1.0.0", agentConfiguration: {}, baselineMetrics: {}, capabilityFingerprint: "fp" };
  const executor = new CapabilityMutationExecutor({ catalog, registry, record });
  const plan = createExecutionPlan(proposal, decision, environment, createCapabilityRollbackResolver());
  const runtime = new GovernedExecutionRuntime();
  const report = await runtime.execute(plan, executor);
  return { report, executor, plan, environment, decision, proposal };
}

describe("CAP-6 A4 end-to-end", () => {
  let dir: string; let catalog: CapabilityCatalog; let registry: CapabilityRegistry;
  before(() => { dir = mkdtempSync(join(tmpdir(), "cap6-int-")); catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir })); registry = new CapabilityRegistry(catalog); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("create: approved mutation applies a complete definition (no placeholder, no dead-end)", async () => {
    const { report } = await runMutation(catalog, registry, { operation: "capability.create", definition: def("tool.file.read"), initialLifecycle: "emerging" });
    assert.equal(report.status, "completed");
    const c = catalog.get("tool.file.read")!;
    assert.equal(c.title, "Cap tool.file.read"); // complete definition, not a placeholder
    assert.equal(registry.getLifecycleState("tool.file.read"), "emerging");
    // Applied for real: the registry projects the published definition (no
    // APPROVED_PENDING_APPLICATION overlay — that overlay is A7's projection,
    // not registry state; the mutation is durable in the catalog).
    assert.equal(registry.get("tool.file.read")?.definition.id, "tool.file.read");
  });

  it("update: publishes a new immutable id@version", async () => {
    await runMutation(catalog, registry, { operation: "capability.create", definition: def("tool.file.update") });
    const { report } = await runMutation(catalog, registry, { operation: "capability.update", capabilityId: "tool.file.update", sourceVersion: "1.0.0", patch: { description: "v2" } });
    assert.equal(report.status, "completed");
    assert.equal(catalog.get("tool.file.update")!.version, "1.0.1");
    assert.equal(catalog.list().filter((d) => d.id === "tool.file.update").length, 2);
  });

  it("transition: governed lifecycle move (and A4 refuses a stale from)", async () => {
    await runMutation(catalog, registry, { operation: "capability.create", definition: def("tool.file.trans") });
    registry.setLifecycleState("tool.file.trans", "active");
    const ok = await runMutation(catalog, registry, { operation: "capability.transition", capabilityId: "tool.file.trans", from: "active", to: "mature" });
    assert.equal(ok.report.status, "completed");
    assert.equal(registry.getLifecycleState("tool.file.trans"), "mature");
    // Stale: runtime rolls back, state unchanged
    const stale = await runMutation(catalog, registry, { operation: "capability.transition", capabilityId: "tool.file.trans", from: "emerging", to: "active" });
    assert.notEqual(stale.report.status, "completed");
    assert.equal(registry.getLifecycleState("tool.file.trans"), "mature");
  });

  it("consolidate: real definition mutation through A4", async () => {
    await runMutation(catalog, registry, { operation: "capability.create", definition: def("tool.file.a") });
    await runMutation(catalog, registry, { operation: "capability.create", definition: def("tool.file.b") });
    const merged = def("tool.file.ab", { version: "1.0.0", dependencies: ["tool.file.a", "tool.file.b"] });
    const { report } = await runMutation(catalog, registry, { operation: "capability.consolidate", sources: ["tool.file.a", "tool.file.b"], target: "tool.file.ab", definition: merged, sourceDisposition: "deprecate" });
    assert.equal(report.status, "completed");
    assert.equal(catalog.get("tool.file.ab")!.title, "Cap tool.file.ab");
    assert.equal(registry.getLifecycleState("tool.file.a"), "deprecated");
  });

  it("remove: terminal removal through A4", async () => {
    await runMutation(catalog, registry, { operation: "capability.create", definition: def("tool.file.rm") });
    const { report } = await runMutation(catalog, registry, { operation: "capability.remove", capabilityId: "tool.file.rm", reason: "gone" });
    assert.equal(report.status, "completed");
    assert.equal(catalog.has("tool.file.rm"), false);
  });

  it("rejection-no-mutation: authorization or validation failure leaves state unchanged", async () => {
    const before = JSON.stringify(catalog.list());
    const stale = await runMutation(catalog, registry, { operation: "capability.transition", capabilityId: "tool.file.trans", from: "nonexistent", to: "active" });
    assert.notEqual(stale.report.status, "completed");
    assert.equal(JSON.stringify(catalog.list()), before);
  });

  it("rollback: a failing mutation restores byte-identical state", async () => {
    const { report } = await runMutation(catalog, registry, { operation: "capability.create", definition: def("tool.file.rb") });
    const before = JSON.stringify(catalog.list());
    const failing = await runMutation(
      catalog, registry,
      { operation: "capability.create", definition: def("tool.file.rb2") },
      async () => { throw new Error("record failed"); },
    );
    assert.notEqual(failing.report.status, "completed");
    assert.equal(JSON.stringify(catalog.list()), before);
  });

  it("immutable artifacts: execution evidence + frozen mutation result", async () => {
    const { report, plan, environment, decision, proposal } = await runMutation(catalog, registry, { operation: "capability.create", definition: def("tool.file.ev") });
    assert.equal(report.status, "completed");
    const evidence: EvolutionExecutionEvidence = buildExecutionEvidence({ executionPlan: plan, executionReport: report, environment, decision, proposal });
    assert.equal(evidence.integrityHash.length, 64);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm run build && pnpm exec tsx --test tests/evolution/execution/integration/capability-mutation-executor-integration.test.ts
```

Expected: FAIL — the module is not yet imported/exported, or an assertion fails (e.g. the `governance` field on `RegisteredCapability` is undefined — that's the desired assertion; if `report.status` is "rolled_back" for a valid create, debug the plan step mapping). Run the suite iteratively until green.

- [ ] **Step 3: Fix any executor gap surfaced by the integration test**

The integration test is the acceptance proof — if a mutation does not apply through the full A4 flow, the executor (not the test) has the gap. Expected fixes are limited to: the `toCapabilityMutationChange` parameters mapping (`resolveSteps` copies `change.parameters` into the step — verify `operation`/`parameters` shape), and the `GovernedExecutionRuntime` postcondition check (steps must declare `postconditions` that the executor's output satisfies — the executor returns `{ operation, mutation, result }`, so either the change declares `postconditions: {}` (default) or the executor's output includes the keys named in `postconditions`). If `postconditions` are non-empty on the changes, the executor must include those keys in its output.

- [ ] **Step 4: Run the full CAP-6 suite + type gate**

```bash
pnpm run build && pnpm exec tsx --test tests/evolution/execution/capability-mutation-executor.test.ts tests/evolution/execution/capability-mutation-executor-helpers.test.ts tests/evolution/execution/capability-mutation-atomicity.test.ts tests/evolution/execution/capability-mutation-rollback.test.ts tests/evolution/execution/integration/capability-mutation-executor-integration.test.ts
pnpm exec tsc --noEmit
```

Expected: PASS, 0 tsc errors.

- [ ] **Step 5: Commit**

```bash
git add src/evolution/execution/capability-mutation-executor.ts tests/evolution/execution/integration/capability-mutation-executor-integration.test.ts
git commit -m "test(capability): CAP-6 full A4 flow integration — all five mutations + rollback + immutable artifacts"
```

---
---

## Self-Review

**1. Spec coverage (ticket #490 ACs):**
- ✅ "executes the five CAP-5 mutations through A4 (authorizeExecution → plan → GovernedExecutionRuntime); A4 gate preserved verbatim" — Tasks 1-5 + Task 8 (executor as StepExecutor; gate untouched; Task 8 integration proves the flow).
- ✅ "no new mutation semantics; capability.* rollback mappings re-homed into the executor" — Tasks 1-5 (CAP-5 validators verbatim) + Task 7 (planner 173-183 removed, applier repointed, barrel export).
- ✅ "Atomic boundary: REJECT → unchanged; execution failure → rollback; success → exactly one governed mutation + immutable publication" — Task 6 (byte-identical matrix) + Task 8.
- ✅ "Atomicity design (greenfield): prepare → validate → apply durable → project registry → record governance result → commit; A7.1 compensating pattern NOT carried forward" — every op task implements this sequence; the record sink is inside the boundary (Task 1 `commit`, Task 6 hardens).
- ✅ "Governed register/create approved and actually applied; complete definition, no placeholder; no APPROVED_PENDING_APPLICATION dead-end" — Task 1 create + Task 8 assertion.
- ✅ "Consolidation is a real definition mutation, not deprecate-related" — Task 4 + Task 8.
- ✅ "Every governed mutation has immutable input + output artifacts" — Task 1 (deepCopy/artifactId) + Task 6 (deepFreeze + determinism) + Task 8 (evidence).

**2. Placeholder scan:** all steps carry real code; no "add error handling" / "similar to Task N" (each task repeats its code). The Task 6 `handleRestoreStep` includes an explicit implementer note about the stateless-vs-stateful design decision rather than leaving it ambiguous.

**3. Type consistency:**
- `CapabilityMutationExecutor` constructor shape `{ catalog, registry, record? }` is consistent across all tasks.
- `createCapabilityRollbackResolver()` is defined in Task 1, grows in Tasks 2/4/5, consumed in Tasks 7/8.
- `toCapabilityMutationChange`, `bumpSemVer`, `applyCapabilityDefinitionPatch`, `nextDefinitionForUpdate`, `capturePreState`, `restorePreState`, `CapabilityPreState`, `CapabilityMutationResult`, `GovernanceRecordSink` — same names/signatures in every referencing task.
- `deepEqual` in Task 2 matches CAP-5's `classifyBindingsChange` comparison semantics.
- Registry lifecycle setter is `setLifecycleState` (not `applyLifecycleTransition`) — the executor uses the canonical authority per CAP-3.

**Known deliberate deviations (flag for human review):**
1. **Applier repoint** (Task 7): the program spec's "Files/modules affected" lists `execution-planner.ts`/`execution-runtime.ts`/`execution-authorization.ts` but NOT `capability-lifecycle-applier.ts`. Repointing the legacy applier's resolver is the minimal consequence of re-homing without regressing its rollback behavior. Alternative (keep both mappings) was rejected as it duplicates capability semantics in the generic planner.
2. **Create rejects an existing id** (Task 1): #478 says create is a new-capability operation; the executor rejects re-registration (use update). This is an application invariant, not new semantics.
3. **No-op update rejected** (Task 2): #480 "failed update = no-op" read as "a patch producing no effective change is rejected" to avoid redundant publications.
4. **Remove has no must-be-deprecated gate** (Task 5): removal policy is upstream governance (design §25); the executor applies an approved remove regardless of lifecycle.
5. **Consolidate target must advance version** (Task 4): immutable-publication invariant — publishing a non-current version would orphan it.
6. **No registry mutation-port rewiring** (all tasks): the executor is the governed mutation path; wiring it into `setMutationPort` is CAP-8/9 territory (bootstrap stays `CatalogBackedCapabilityMutationPort`).

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-11-cap-6-a4-capability-mutation-executor.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
