# CAP-5 — Capability Mutation Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze every capability mutation rule and the lifecycle policy as a pure, executable-agnostic contract: five governed mutations (`create`/`update`/`transition`/`consolidate`/`remove`) with exact payloads and pre/post conditions, a fixed six-state lifecycle graph, immutable-publication semantics, and the three-axis separation — so CAP-6's executor implements exactly this contract and cannot redefine it.

**Architecture:** A single pure module `src/capability/mutation-contract.ts` is the authoritative CAP-5 contract — five payload interfaces + the `CapabilityMutation` discriminated union + the data-driven lifecycle transition table + `isLegalTransition` + the SemVer bump classifier + the conservative consolidation merge validator + the master `validateCapabilityMutation` (pre/post conditions). Two in-place reconciles make the existing evolution contracts consistent: `lifecycle-contract.ts` declares `CapabilityRuntimeState` (three axes) + `CapabilityGovernanceStatus` (fourth, independent axis) and marks `APPROVED_PENDING_APPLICATION` out-of-contract (deletion = CAP-11); `evolution-contract.ts` gives `EvolutionTarget` an optional `version` so capability targets pin the exact immutable publication (#479). Contracts-first: NO executor (CAP-6), NO runtime/registry wiring, NO mutation-port change (CAP-6), A7 lifecycle overlay NOT extended.

**Tech Stack:** TypeScript (ESM). CAP-5's own module + its vitest tests (`tests/capability/*.vitest.ts`); reconcile tests are node:test (`tests/evolution/*`). Vitest does NOT typecheck — run `pnpm exec tsc --noEmit` after every task. Full verification: `pnpm test:vitest`, `pnpm run build`, then node:test on `dist/tests/evolution`.

## Global Constraints

- **Single authoritative module** (user ruling): all CAP-5 mutation contract content lives in `src/capability/mutation-contract.ts`. It is PURE: types + constants + pure validators only. No registry imports, no persistence imports, no executor imports, no runtime imports, no governance-decision imports, no side effects. It imports ONLY type/value from `./canonical/*` (definition, provider, version), `LifecycleState` from `../adaptation/capability-evolution-types.js`, and `ValidationResult` (type-only) from `../evolution/contracts/evolution-contract.js`.
- **Mutation payload interface names follow design §20 vocabulary**: `CapabilityCreateMutation`, `CapabilityUpdateMutation`, `CapabilityTransitionMutation`, `CapabilityConsolidateMutation`, `CapabilityRemoveMutation`, union `CapabilityMutation`. (The four user rulings referenced these informally as `CreateCapability`/etc.; the plan uses the design doc's published names.)
- **Operation vocabulary is fixed**: `"capability.create" | "capability.update" | "capability.transition" | "capability.consolidate" | "capability.remove"`.
- **Lifecycle graph is data-driven** (user ruling): `const LEGAL_LIFECYCLE_TRANSITIONS: Readonly<Record<LifecycleState, readonly LifecycleState[]>>` (the locked #481 table) + tiny pure `isLegalTransition(from, to)`. The graph is visibly auditable and tests read it as the single source of truth. `deprecated` is terminal (empty array). There is NO `dormant` state — lifecycle legality NEVER references availability, and availability never references lifecycle (#476, #481).
- **Locked lifecycle graph (#481)**, exactly: `emerging → [active, deprecated]`, `active → [mature, declining]`, `mature → [declining]`, `stagnant → [active, deprecated]`, `declining → [deprecated]`, `deprecated → []`. Note `active → deprecated` and `emerging → mature` are ILLEGAL.
- **Consolidation = true governed merge (#477, supersedes design §24)**: payload carries the explicit proposed target `definition` — the executor applies exactly the approved definition and NEVER invents a merge. `sourceDisposition: "deprecate" | "remove"`; `remove` only when safe (refs/deps — executor concern). `target` MUST NOT be one of `sources`. Sources-deprecated-with-no-canonical-target is deprecation, never consolidation.
- **Update = immutable publication (#480)**: `update(capabilityId, sourceVersion, patch)` — naming the exact source version is REQUIRED; `update(id)` meaning "modify current" is PROHIBITED. `sourceVersion` must be full SemVer `MAJOR.MINOR.PATCH` (via `isValidVersion` from `./canonical/version.js` — ranges/pre-releases rejected, never silently normalized). Patch surface = all mutable fields; `id`/`version`/`kind` are immutable and MUST NOT appear in a patch (enforced at runtime too).
- **Update bump classifier (user ruling — locked matrix)**: MAJOR = `argsSchema`, `resultSchema`, `requiredPermissions`, or binding change; MINOR = additive-only schema property, `aliases`/`tags`/`dependencies` change; PATCH = `title`, `description`, `examples`, `category`, `risk`, `extensions`, `allowFallbacks`. Classifier is SEMANTIC (compares definitions, not "which key changed"): an optional→required schema property is MAJOR. **Binding identity rule (user tightening, canonical CAP-4 definition)**: the effective serving provider is `(binding.type, binding.id, binding.config)` — `binding.id` is the canonical provider-instance identity (`providerId: string; // = binding.id`), `config` is part of the instance. Therefore ANY non-identical binding array (type change, id change, config change, or reorder) is **MAJOR** — the classifier never treats a binding change as MINOR. This includes `{type:"external-cli", config:{executable:"gh"}}` → `{type:"external-cli", config:{executable:"gitnexus"}}` (a provider swap with the type held constant). **Monotonic**: any MAJOR-class change ⇒ MAJOR regardless of simultaneous MINOR/PATCH. Signature: `classifyUpdateBump(previous: CapabilityDefinition, next: CapabilityDefinition): "major" | "minor" | "patch"`. It compares two canonical definitions/publications and returns the minimum required bump; it does NOT apply patches (CAP-6 owns application — it applies the patch to the previous definition, producing `next`, then calls the classifier).
- **Validator deferral invariant (user tightening)**: `validateCapabilityMutation()` validates all mutation-LOCAL preconditions. A consolidate mutation is NOT fully validated until `validateConsolidateMerge()` has also passed against resolved source publications (CAP-6 resolves them from the catalog). `validateCapabilityMutation` must not claim a Consolidate mutation is fully valid by itself, and must never reach into a catalog.
- **Immutable-publication invariant (#479/#480)**: every mutation that creates a publication MUST produce a new immutable `id@version`; no mutation may mutate an existing publication in place. CAP-5 enforces this via the patch surface (id/version/kind immutable) + the sourceVersion requirement; CAP-6 owns the mechanics of generating the new version.
- **Three-axis separation (user ruling)**: `lifecycle-contract.ts` gains `CapabilityRuntimeState { definition; lifecycle; availability }` + `CapabilityGovernanceStatus = "none"|"proposed"|"approved"|"rejected"|"applied"|"measured"`. Governance status is a FOURTH independent axis (not part of lifecycle). `lifecycle: "deprecated"` + `availability: available` and `lifecycle: "active"` + `availability: unavailable` and `governance: "approved"` on an `active` capability are all legal — none needs a synthetic lifecycle state. **`APPROVED_PENDING_APPLICATION` is NOT a CAP-5 state; its removal/cleanup is CAP-11** — documented in a comment. Types + tests only, no wiring.
- **`EvolutionTarget` reconcile (user ruling)**: add `version?: string` to `EvolutionTarget`. For `kind === "capability"`: version absent → unpinned; version present → must be full SemVer only (no `^`/`~`/`>=`/`*`, no silent normalization), and `(id, version)` is the complete immutable-publication identity. Other target kinds ignore `version`. `validateEvolutionTarget` is a new exported pure function; `validateEvolutionIntent` calls it (replacing the loose "target must be an object" check).
- **A7 overlay NOT extended**: `registry.ts` lifecycle helpers, `CapabilityLifecycleIntent`, `deriveCapabilityProjectionState` and `APPROVED_PENDING_APPLICATION` are all untouched by CAP-5 (their replacement is CAP-9/CAP-11). The old `INTENT_TO_STATE.consolidate` (deprecate-sources) stays AS-IS until CAP-6 — the new contract merely documents what consolidation MUST be.
- **`CapabilityMutationPort` untouched**: `src/capability/mutation-port.ts` stays exactly as CAP-3 shipped it. CAP-6 replaces the implementation. CAP-5 adds NO new port methods.
- **Forbidden files (never touch):** `src/capability/initial-capabilities.ts`, `src/tools/tool-registry.ts`, `src/policy/capability-registry.ts`, and production `src/capability/canonical/*` (import-only — `mutation-contract.ts` reads `canonical/definition.ts`, `canonical/provider.ts`, `canonical/version.ts` but never edits them).
- **Type-purity of `mutation-contract.ts`** is structurally proven: Task 8 adds a sentinel test asserting the module imports only the allowed set (canonical modules, `adaptation/capability-evolution-types`, type-only `evolution/contracts/evolution-contract`) — a `deprecated` import of registry/runtime/executor fails CI.
- **Vitest does not typecheck**: run `pnpm exec tsc --noEmit` after every task (CAP-1 lesson). Capability tests are `.vitest.ts`; evolution reconcile tests are node:test `.test.ts`.

---

### Task 1: Lifecycle Transition Table + `isLegalTransition`

Creates `src/capability/mutation-contract.ts` and its test file, containing the data-driven locked lifecycle graph and the transition-legality predicate. This is the foundational contract policy Tasks 3/5 consume.

**Files:**
- Create: `src/capability/mutation-contract.ts`
- Test: `tests/capability/mutation-contract.vitest.ts` (first `describe` block; later tasks append)

**Interfaces:**
- Consumes: `LifecycleState` from `../adaptation/capability-evolution-types.js` (type-only).
- Produces: `LEGAL_LIFECYCLE_TRANSITIONS` (the `Readonly<Record<LifecycleState, readonly LifecycleState[]>>` table) and `isLegalTransition(from: LifecycleState, to: LifecycleState): boolean`.

- [ ] **Step 1: Write the failing test**

`tests/capability/mutation-contract.vitest.ts`:

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import {
  LEGAL_LIFECYCLE_TRANSITIONS,
  isLegalTransition,
} from "../../src/capability/mutation-contract.js";
import type { LifecycleState } from "../../src/adaptation/capability-evolution-types.js";

const ALL_STATES: readonly LifecycleState[] = [
  "emerging", "active", "mature", "stagnant", "declining", "deprecated",
];

describe("LEGAL_LIFECYCLE_TRANSITIONS (#481 locked graph)", () => {
  it("covers exactly the six lifecycle states", () => {
    expect(Object.keys(LEGAL_LIFECYCLE_TRANSITIONS).sort()).toEqual([...ALL_STATES].sort());
  });

  it("encodes the exact locked edge set", () => {
    expect(LEGAL_LIFECYCLE_TRANSITIONS.emerging).toEqual(["active", "deprecated"]);
    expect(LEGAL_LIFECYCLE_TRANSITIONS.active).toEqual(["mature", "declining"]);
    expect(LEGAL_LIFECYCLE_TRANSITIONS.mature).toEqual(["declining"]);
    expect(LEGAL_LIFECYCLE_TRANSITIONS.stagnant).toEqual(["active", "deprecated"]);
    expect(LEGAL_LIFECYCLE_TRANSITIONS.declining).toEqual(["deprecated"]);
    expect(LEGAL_LIFECYCLE_TRANSITIONS.deprecated).toEqual([]);
  });

  it("has deprecated as a terminal state (no outgoing edges)", () => {
    expect(LEGAL_LIFECYCLE_TRANSITIONS.deprecated).toHaveLength(0);
  });

  it("is acyclic (no state can reach itself)", () => {
    for (const from of ALL_STATES) {
      const frontier = [...LEGAL_LIFECYCLE_TRANSITIONS[from]];
      const seen = new Set(frontier);
      while (frontier.length > 0) {
        const cur = frontier.pop()!;
        expect(cur).not.toBe(from);
        for (const next of LEGAL_LIFECYCLE_TRANSITIONS[cur]) {
          if (!seen.has(next)) { seen.add(next); frontier.push(next); }
        }
      }
    }
  });
});

describe("isLegalTransition", () => {
  it("accepts every legal edge from the locked graph", () => {
    expect(isLegalTransition("emerging", "active")).toBe(true);
    expect(isLegalTransition("emerging", "deprecated")).toBe(true);
    expect(isLegalTransition("active", "mature")).toBe(true);
    expect(isLegalTransition("active", "declining")).toBe(true);
    expect(isLegalTransition("mature", "declining")).toBe(true);
    expect(isLegalTransition("stagnant", "active")).toBe(true);
    expect(isLegalTransition("stagnant", "deprecated")).toBe(true);
    expect(isLegalTransition("declining", "deprecated")).toBe(true);
  });

  it("rejects edges not in the locked graph", () => {
    expect(isLegalTransition("active", "deprecated")).toBe(false); // #481: no active→deprecated
    expect(isLegalTransition("emerging", "mature")).toBe(false);
    expect(isLegalTransition("mature", "active")).toBe(false);
    expect(isLegalTransition("declining", "active")).toBe(false);
    expect(isLegalTransition("deprecated", "active")).toBe(false); // terminal
    expect(isLegalTransition("deprecated", "deprecated")).toBe(false);
  });

  it("rejects self-loops", () => {
    expect(isLegalTransition("active", "active")).toBe(false);
    expect(isLegalTransition("emerging", "emerging")).toBe(false);
  });

  it("is complete: every (from, to) not in the table is illegal", () => {
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        const expected = LEGAL_LIFECYCLE_TRANSITIONS[from].includes(to);
        expect(isLegalTransition(from, to)).toBe(expected);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/capability/mutation-contract.vitest.ts --config vitest.config.mts`
Expected: FAIL — module `../../src/capability/mutation-contract.js` not found.

- [ ] **Step 3: Write the implementation**

Create `src/capability/mutation-contract.ts`:

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-5 — Capability Mutation Contract.
 *
 * The single authoritative definition of what mutations are legal and what
 * state transitions they produce. Pure contract: types + constants + pure
 * validators. No registry/persistence/executor/runtime/governance imports and
 * no side effects. CAP-6 implements the executor that applies these mutations
 * through A4; CAP-9 targets A7 proposals at these intents; CAP-7 reads the
 * transition table for eligibility.
 *
 * Locked decisions: #475 (semantic kind), #477 (consolidation), #479
 * (versioning), #480 (executable update), #481 (lifecycle graph, no dormant).
 * This file grows cumulatively across plan Tasks 1-5.
 */

import type { LifecycleState } from "../adaptation/capability-evolution-types.js";

// ---------------------------------------------------------------------------
// Lifecycle transition policy (#481 — locked six-state graph)
// ---------------------------------------------------------------------------

/**
 * The fixed, acyclic six-state lifecycle graph (#481). Data-driven so the
 * locked graph is visibly auditable and tests have a single source of truth.
 * `deprecated` is terminal (empty legal target list). There is NO `dormant`
 * state — unbound capabilities are expressed on the availability axis, never
 * here. Lifecycle legality is part of the mutation contract: a transition is
 * a legal mutation ONLY if this table permits it.
 */
export const LEGAL_LIFECYCLE_TRANSITIONS: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = {
  emerging: ["active", "deprecated"],
  active: ["mature", "declining"],
  mature: ["declining"],
  stagnant: ["active", "deprecated"],
  declining: ["deprecated"],
  deprecated: [],
};

/** Is `from → to` a legal lifecycle transition under the locked #481 graph? */
export function isLegalTransition(from: LifecycleState, to: LifecycleState): boolean {
  return LEGAL_LIFECYCLE_TRANSITIONS[from].includes(to);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/capability/mutation-contract.vitest.ts --config vitest.config.mts`
Expected: PASS (all `isLegalTransition` + table tests).

- [ ] **Step 5: Type gate + commit**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0.

```bash
git add src/capability/mutation-contract.ts tests/capability/mutation-contract.vitest.ts
git commit -m "feat(capability): CAP-5 lifecycle transition table + isLegalTransition"
```

---

### Task 2: Mutation Payload Types + Discriminated Union

Appends the five payload interfaces, the `CapabilityMutation` union, and the `CAPABILITY_MUTATION_OPERATIONS` constant to `mutation-contract.ts`. Pure types — no behavior. Task 3/4/5 build on these.

**Files:**
- Modify: `src/capability/mutation-contract.ts` (append below the transition-policy section)
- Test: `tests/capability/mutation-contract.vitest.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: `CapabilityDefinition`, `CapabilityRisk`, `CapabilityPermission` (type-only) from `./canonical/definition.js`; `CapabilityProviderBinding` (type-only) from `./canonical/provider.js`; `LifecycleState` (already imported).
- Produces: `CapabilityDefinitionPatch`, `CapabilityCreateMutation`, `CapabilityUpdateMutation`, `CapabilityTransitionMutation`, `CapabilityConsolidateMutation`, `CapabilityRemoveMutation`, `CapabilityMutation`, `CAPABILITY_MUTATION_OPERATIONS`.

- [ ] **Step 1: Write the failing test**

Append to `tests/capability/mutation-contract.vitest.ts`:

```ts
import {
  CAPABILITY_MUTATION_OPERATIONS,
} from "../../src/capability/mutation-contract.js";
import type {
  CapabilityCreateMutation,
  CapabilityUpdateMutation,
  CapabilityTransitionMutation,
  CapabilityConsolidateMutation,
  CapabilityRemoveMutation,
  CapabilityMutation,
} from "../../src/capability/mutation-contract.js";

describe("CapabilityMutation payload types", () => {
  it("defines exactly the five governed mutation operations", () => {
    expect(CAPABILITY_MUTATION_OPERATIONS).toEqual([
      "capability.create",
      "capability.update",
      "capability.transition",
      "capability.consolidate",
      "capability.remove",
    ]);
  });

  it("discriminates each payload on its operation string", () => {
    const create: CapabilityMutation = {
      operation: "capability.create",
      definition: makeDefinition("tool.file.read", "1.0.0"),
    };
    const update: CapabilityMutation = {
      operation: "capability.update",
      capabilityId: "tool.file.read",
      sourceVersion: "1.0.0",
      patch: { title: "Read a file" },
    };
    const transition: CapabilityMutation = {
      operation: "capability.transition",
      capabilityId: "tool.file.read",
      from: "emerging",
      to: "active",
    };
    const consolidate: CapabilityMutation = {
      operation: "capability.consolidate",
      sources: ["tool.file.read", "tool.file.tail"],
      target: "tool.file.read",
      definition: makeDefinition("tool.file.read", "2.0.0"),
      sourceDisposition: "deprecate",
    };
    const remove: CapabilityMutation = {
      operation: "capability.remove",
      capabilityId: "tool.file.tail",
      reason: "superseded by tool.file.read",
    };
    expect(create.operation).toBe("capability.create");
    expect(update.operation).toBe("capability.update");
    expect(transition.operation).toBe("capability.transition");
    expect(consolidate.operation).toBe("capability.consolidate");
    expect(remove.operation).toBe("capability.remove");
  });

  it("update carries sourceVersion + patch (no 'modify current' shape)", () => {
    const u: CapabilityUpdateMutation = {
      operation: "capability.update",
      capabilityId: "tool.file.read",
      sourceVersion: "1.0.0",
      patch: { risk: "medium" },
    };
    expect(u.sourceVersion).toBe("1.0.0");
    // @ts-expect-error — patch must NOT accept the immutable kind field
    const bad: CapabilityUpdateMutation = { operation: "capability.update", capabilityId: "x", sourceVersion: "1.0.0", patch: { kind: "query" } };
    void bad;
  });

  it("consolidate requires an explicit proposed target definition + sourceDisposition", () => {
    const c: CapabilityConsolidateMutation = {
      operation: "capability.consolidate",
      sources: ["a.b", "a.c"],
      target: "a.b",
      definition: makeDefinition("a.b", "2.0.0"),
      sourceDisposition: "remove",
    };
    expect(c.sourceDisposition).toBe("remove");
  });

  it("transition carries explicit from + to (stale-decision precondition)", () => {
    const t: CapabilityTransitionMutation = {
      operation: "capability.transition",
      capabilityId: "tool.file.read",
      from: "active",
      to: "mature",
    };
    expect(t.from).toBe("active");
    expect(t.to).toBe("mature");
  });

  it("create carries a definition and no placeholder flag", () => {
    const c: CapabilityCreateMutation = {
      operation: "capability.create",
      definition: makeDefinition("tool.file.write", "1.0.0"),
    };
    expect(c.definition.id).toBe("tool.file.write");
  });

  it("remove carries a reason", () => {
    const r: CapabilityRemoveMutation = {
      operation: "capability.remove",
      capabilityId: "tool.file.tail",
      reason: "superseded",
    };
    expect(r.reason).toBe("superseded");
  });
});

// helper shared with later describe blocks in this file
function makeDefinition(id: string, version: string) {
  return {
    id, version, kind: "operation", title: id, description: id,
    tags: [], category: "tools", risk: "low",
    requiredPermissions: ["operator"], dependencies: [], bindings: [],
  } as CapabilityDefinition;
}
```

Add the needed import at the top of the test file: `import type { CapabilityDefinition } from "../../src/capability/canonical/definition.js";` (the helper cast requires it).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/capability/mutation-contract.vitest.ts --config vitest.config.mts`
Expected: FAIL — `CAPABILITY_MUTATION_OPERATIONS` not exported from mutation-contract.

- [ ] **Step 3: Append the implementation**

Append to `src/capability/mutation-contract.ts` (after the `isLegalTransition` function; extend the import block):

```ts
import type { CapabilityDefinition, CapabilityRisk, CapabilityPermission } from "./canonical/definition.js";
import type { CapabilityProviderBinding } from "./canonical/provider.js";

// ---------------------------------------------------------------------------
// Mutation payloads (design §20-25; #477/#479/#480/#481)
// ---------------------------------------------------------------------------

/** Mutable definition surface (#480 patch surface). `id`/`version`/`kind` are
 *  immutable and never patchable. Every field here is a governed mutation —
 *  none is a governance loophole. */
export interface CapabilityDefinitionPatch {
  title?: string;
  description?: string;
  aliases?: string[];
  tags?: string[];
  category?: string;
  risk?: CapabilityRisk;
  requiredPermissions?: CapabilityPermission[];
  argsSchema?: Record<string, unknown>;
  resultSchema?: Record<string, unknown>;
  examples?: string[];
  dependencies?: string[];
  bindings?: CapabilityProviderBinding[];
  allowFallbacks?: boolean;
  extensions?: Record<string, unknown>;
}

/** create (#478): an authored, approved definition — no placeholder. A new
 *  capability always enters the graph at `emerging` (#481); `initialLifecycle`
 *  may be omitted and defaults to "emerging". */
export interface CapabilityCreateMutation {
  operation: "capability.create";
  definition: CapabilityDefinition;
  initialLifecycle?: "emerging";
}

/** update (#480): governed source `id@version` → new immutable publication.
 *  `update(id)` meaning "modify current" is explicitly PROHIBITED — the caller
 *  must name the exact source version. Bump is executor-classified via
 *  `classifyUpdateBump` (Task 3). */
export interface CapabilityUpdateMutation {
  operation: "capability.update";
  capabilityId: string;
  sourceVersion: string;
  patch: CapabilityDefinitionPatch;
}

/** transition (#481): explicit `from` is the stale-decision precondition. A
 *  transition is legal ONLY if `from → to` is in `LEGAL_LIFECYCLE_TRANSITIONS`. */
export interface CapabilityTransitionMutation {
  operation: "capability.transition";
  capabilityId: string;
  from: LifecycleState;
  to: LifecycleState;
}

/** consolidate (#477): true governed merge. The proposal carries the explicit
 *  resulting target `definition`; the executor applies exactly the approved
 *  definition and NEVER invents a merge. `target` must not be one of
 *  `sources`; `remove` only when safe (refs/deps — executor concern). */
export interface CapabilityConsolidateMutation {
  operation: "capability.consolidate";
  sources: string[];
  target: string;
  definition: CapabilityDefinition;
  sourceDisposition: "deprecate" | "remove";
}

/** remove (#481, design §25): policy-controlled. A `deprecated` capability may
 *  remain in the catalog for historical/reference purposes. */
export interface CapabilityRemoveMutation {
  operation: "capability.remove";
  capabilityId: string;
  reason: string;
}

export type CapabilityMutation =
  | CapabilityCreateMutation
  | CapabilityUpdateMutation
  | CapabilityTransitionMutation
  | CapabilityConsolidateMutation
  | CapabilityRemoveMutation;

export const CAPABILITY_MUTATION_OPERATIONS: readonly CapabilityMutation["operation"][] = [
  "capability.create",
  "capability.update",
  "capability.transition",
  "capability.consolidate",
  "capability.remove",
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/capability/mutation-contract.vitest.ts --config vitest.config.mts`
Expected: PASS.

- [ ] **Step 5: Type gate + commit**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0.

```bash
git add src/capability/mutation-contract.ts tests/capability/mutation-contract.vitest.ts
git commit -m "feat(capability): CAP-5 mutation payload types + CapabilityMutation union"
```

---

### Task 3: Update Bump Classifier

Appends the SemVer bump classifier to `mutation-contract.ts`. This encodes the user-locked bump matrix and monotonic rule — the contract CAP-6's executor applies when publishing an update's new `id@version`.

**Files:**
- Modify: `src/capability/mutation-contract.ts` (append after the payload-types section)
- Test: `tests/capability/mutation-contract.vitest.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: `CapabilityDefinition`, `CapabilityProviderBinding` (already imported); the `CapabilityDefinitionPatch` type from Task 2 is NOT needed here (the classifier compares two full definitions).
- Produces: `classifyUpdateBump(previous: CapabilityDefinition, next: CapabilityDefinition): "major" | "minor" | "patch"` (compares two canonical definitions/publications; does NOT apply patches — CAP-6 applies the update's patch to `previous` to produce `next`). Private helpers `classifySchemaChange`, `classifyBindingsChange` (returns `"major" | "none"` — any binding difference is MAJOR), `listChanged`.

- [ ] **Step 1: Write the failing test**

Append to `tests/capability/mutation-contract.vitest.ts`:

```ts
import { classifyUpdateBump } from "../../src/capability/mutation-contract.js";
import type { CapabilityDefinition } from "../../src/capability/canonical/definition.js";

function baseDefinition(over: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id: "tool.file.read", version: "1.0.0", kind: "operation",
    title: "Read a file", description: "Reads a file",
    tags: [], category: "tools", risk: "low",
    requiredPermissions: ["operator"], dependencies: [], bindings: [],
    ...over,
  };
}

describe("classifyUpdateBump (#479/#480 locked matrix)", () => {
  it("classifies identical definitions as PATCH (no change)", () => {
    const a = baseDefinition();
    expect(classifyUpdateBump(a, baseDefinition())).toBe("patch");
  });

  it("classifies PATCH fields as PATCH", () => {
    const a = baseDefinition();
    expect(classifyUpdateBump(a, baseDefinition({ title: "Read a file (updated)" }))).toBe("patch");
    expect(classifyUpdateBump(a, baseDefinition({ description: "new description" }))).toBe("patch");
    expect(classifyUpdateBump(a, baseDefinition({ examples: ["cat x"] }))).toBe("patch");
    expect(classifyUpdateBump(a, baseDefinition({ category: "files" }))).toBe("patch");
    expect(classifyUpdateBump(a, baseDefinition({ risk: "medium" }))).toBe("patch");
    expect(classifyUpdateBump(a, baseDefinition({ extensions: { note: "x" } }))).toBe("patch");
    expect(classifyUpdateBump(a, baseDefinition({ allowFallbacks: false }))).toBe("patch");
  });

  it("classifies MINOR fields as MINOR", () => {
    const a = baseDefinition();
    expect(classifyUpdateBump(a, baseDefinition({ aliases: ["readfile"] }))).toBe("minor");
    expect(classifyUpdateBump(a, baseDefinition({ tags: ["io"] }))).toBe("minor");
    expect(classifyUpdateBump(a, baseDefinition({ dependencies: ["core.session.list"] }))).toBe("minor");
  });

  it("classifies an added optional schema property as MINOR", () => {
    const a = baseDefinition({ argsSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } });
    const b = baseDefinition({ argsSchema: { type: "object", properties: { path: { type: "string" }, encoding: { type: "string" } }, required: ["path"] } });
    expect(classifyUpdateBump(a, b)).toBe("minor");
  });

  it("classifies MAJOR fields as MAJOR", () => {
    const a = baseDefinition();
    expect(classifyUpdateBump(a, baseDefinition({ requiredPermissions: ["admin"] }))).toBe("major");
    expect(classifyUpdateBump(a, baseDefinition({ argsSchema: { type: "object", properties: {}, required: ["path"] } }))).toBe("major");
    expect(classifyUpdateBump(a, baseDefinition({ resultSchema: { type: "object", properties: {} } }))).toBe("major");
  });

  it("classifies a removed schema property as MAJOR", () => {
    const a = baseDefinition({ argsSchema: { type: "object", properties: { path: { type: "string" }, encoding: { type: "string" } }, required: ["path"] } });
    const b = baseDefinition({ argsSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } });
    expect(classifyUpdateBump(a, b)).toBe("major");
  });

  it("classifies an optional→required schema property as MAJOR (semantic, not key-set)", () => {
    const a = baseDefinition({ argsSchema: { type: "object", properties: { path: { type: "string" } }, required: [] } });
    const b = baseDefinition({ argsSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } });
    expect(classifyUpdateBump(a, b)).toBe("major");
  });

  it("classifies a shared-property type change as MAJOR", () => {
    const a = baseDefinition({ argsSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } });
    const b = baseDefinition({ argsSchema: { type: "object", properties: { path: { type: "number" } }, required: ["path"] } });
    expect(classifyUpdateBump(a, b)).toBe("major");
  });

  it("classifies a binding provider-technology change as MAJOR", () => {
    const a = baseDefinition({ bindings: [{ type: "mcp", id: "mcp-1" }] });
    const b = baseDefinition({ bindings: [{ type: "external-cli", id: "cli-1" }] });
    expect(classifyUpdateBump(a, b)).toBe("major");
  });

  it("classifies a same-technology id swap as MAJOR (binding.id = provider identity)", () => {
    // canonical CAP-4 provider identity is binding.id — mcp-1 → mcp-2 is a
    // different serving provider, hence MAJOR, not MINOR (user tightening).
    const a = baseDefinition({ bindings: [{ type: "mcp", id: "mcp-1" }] });
    const b = baseDefinition({ bindings: [{ type: "mcp", id: "mcp-2" }] });
    expect(classifyUpdateBump(a, b)).toBe("major");
  });

  it("classifies a config change as MAJOR even with type and id held constant", () => {
    // gh → gitnexus via config.executable is a provider swap despite the type
    // staying "external-cli" (user tightening — canonical identity = (type, id, config)).
    const a = baseDefinition({ bindings: [{ type: "external-cli", id: "gh", config: { executable: "gh" } }] });
    const b = baseDefinition({ bindings: [{ type: "external-cli", id: "gh", config: { executable: "gitnexus" } }] });
    expect(classifyUpdateBump(a, b)).toBe("major");
  });

  it("classifies a binding reorder as MAJOR (fallback priority is behavioral)", () => {
    const a = baseDefinition({ bindings: [{ type: "mcp", id: "mcp-1" }, { type: "external-cli", id: "gh" }] });
    const b = baseDefinition({ bindings: [{ type: "external-cli", id: "gh" }, { type: "mcp", id: "mcp-1" }] });
    expect(classifyUpdateBump(a, b)).toBe("major");
  });

  it("treats an identical binding array as no binding change", () => {
    const a = baseDefinition({ bindings: [{ type: "mcp", id: "mcp-1", config: { timeoutMs: 5000 } }] });
    const b = baseDefinition({ bindings: [{ type: "mcp", id: "mcp-1", config: { timeoutMs: 5000 } }] });
    expect(classifyUpdateBump(a, b)).toBe("patch"); // nothing else changed → PATCH
  });

  it("is monotonic: any MAJOR-class change ⇒ MAJOR despite MINOR/PATCH changes", () => {
    const a = baseDefinition();
    const b = baseDefinition({
      title: "renamed",
      argsSchema: { type: "object", properties: { extra: { type: "string" } } },
      bindings: [{ type: "daemon", id: "d" }],
    });
    expect(classifyUpdateBump(a, b)).toBe("major");
  });
});
```

Note the `bindings` fixtures match `CapabilityProviderBinding` (`{ id, type, config? }` from `src/capability/canonical/provider.ts`) — the provider technology is `binding.type`, NOT `binding.provider.type`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/capability/mutation-contract.vitest.ts --config vitest.config.mts`
Expected: FAIL — `classifyUpdateBump` not exported.

- [ ] **Step 3: Append the implementation**

Append to `src/capability/mutation-contract.ts`:

```ts
import { isEqual } from "./util.js"; // see Step 3 note — OR inline a small deepEqual (see below)
```

> **Implementer note — deep equality:** `mutation-contract.ts` must stay dependency-free (pure, no new runtime deps). If `src/capability/util.ts` does not already export an `isEqual`, inline a small local `deepEqual(a: unknown, b: unknown): boolean` (JSON-stable compare for plain data — the contract's payloads are serializable plain data) at the top of the classifier section instead. Do NOT add a package dependency.

```ts
// ---------------------------------------------------------------------------
// Update bump classification (#479/#480 — locked matrix, user ruling)
// ---------------------------------------------------------------------------

/**
 * Classify the SemVer bump an update publication earns by comparing the
 * governed SOURCE definition with the NEXT definition. Compares two canonical
 * definitions/publications and returns the minimum required bump; it does NOT
 * apply patches — the caller (CAP-6) applies the update's patch to `previous`
 * to produce `next`, then classifies.
 * MAJOR: argsSchema / resultSchema / requiredPermissions / any binding change
 * (type, id, or config — the effective serving provider is (type, id, config),
 * the canonical CAP-4 provider identity). MINOR: additive-only schema
 * property, aliases / tags / dependencies. PATCH: title, description,
 * examples, category, risk, extensions, allowFallbacks. id/version/kind are
 * immutable and never appear here. Semantic, not textual: an optional→required
 * property is MAJOR. Monotonic: any MAJOR-class change ⇒ MAJOR regardless of
 * simultaneous MINOR/PATCH changes. CAP-6's executor applies this; CAP-5 only
 * classifies.
 */
export function classifyUpdateBump(
  previous: CapabilityDefinition,
  next: CapabilityDefinition,
): "major" | "minor" | "patch" {
  let major = false;
  let minor = false;

  // MAJOR: requiredPermissions
  if (listChanged(previous.requiredPermissions, next.requiredPermissions)) major = true;

  // MAJOR/MINOR: argsSchema + resultSchema (semantic schema classifier)
  const args = classifySchemaChange(previous.argsSchema, next.argsSchema);
  const result = classifySchemaChange(previous.resultSchema, next.resultSchema);
  if (args === "major" || result === "major") major = true;
  if (args === "minor" || result === "minor") minor = true;

  // MAJOR: bindings (any difference changes the serving provider)
  const bindings = classifyBindingsChange(previous.bindings, next.bindings);
  if (bindings === "major") major = true;

  // MINOR: aliases / tags / dependencies
  if (listChanged(previous.aliases ?? [], next.aliases ?? [])) minor = true;
  if (listChanged(previous.tags, next.tags)) minor = true;
  if (listChanged(previous.dependencies, next.dependencies)) minor = true;

  // PATCH fields (title, description, examples, category, risk, extensions,
  // allowFallbacks) contribute nothing — any change here with no MAJOR/MINOR
  // change falls through to PATCH.

  if (major) return "major";
  if (minor) return "minor";
  return "patch";
}

/** Classify an argsSchema/resultSchema change. Semantic, conservative: name-set
 *  + `required`-array + shared-property declared `type`. Adding an optional
 *  property is MINOR; removing a property, making one required, or changing a
 *  shared property's declared type is MAJOR. Anything else that differs is
 *  MAJOR (fail-closed on ambiguity). */
export function classifySchemaChange(
  previous: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined,
): "major" | "minor" | "none" {
  const a = schemaShape(previous);
  const b = schemaShape(next);
  if (shapesEqual(a, b)) return "none";

  // removed property → MAJOR
  for (const key of a.props.keys()) {
    if (!b.props.has(key)) return "major";
  }
  // shared property type drift → MAJOR
  for (const [key, typeA] of a.props) {
    const typeB = b.props.get(key);
    if (typeB !== undefined && typeA !== typeB) return "major";
  }
  // property became required → MAJOR
  for (const key of b.props.keys()) {
    if (!a.required.has(key) && b.required.has(key)) return "major";
  }
  // added property that is required → MAJOR
  for (const key of b.props.keys()) {
    if (!a.props.has(key) && b.required.has(key)) return "major";
  }
  // only optional additions remain → MINOR
  return "minor";
}

/** MAJOR if the bindings differ in ANY way (ordered deep compare); NONE if the
 *  arrays are deeply identical. Per the canonical CAP-4 provider identity —
 *  (type, id, config) — any difference changes the serving provider, so there
 *  is NO MINOR binding case. Provider technology is `binding.type`. */
function classifyBindingsChange(
  previous: readonly { type: string; id: string; config?: Record<string, unknown> }[],
  next: readonly { type: string; id: string; config?: Record<string, unknown> }[],
): "major" | "none" {
  return deepEqual(previous, next) ? "none" : "major";
}

function listChanged(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return true;
  return false;
}

interface SchemaShape {
  props: Map<string, string>; // property name → declared type ("" when untyped)
  required: Set<string>;
}

function schemaShape(schema: Record<string, unknown> | undefined): SchemaShape {
  const props = new Map<string, string>();
  const properties = (schema?.properties ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(properties)) {
    const t = (v as Record<string, unknown>)?.type;
    props.set(k, typeof t === "string" ? t : "");
  }
  if (schema && Object.keys(properties).length === 0) {
    for (const k of Object.keys(schema)) {
      if (k !== "required" && k !== "type" && k !== "properties") props.set(k, "");
    }
  }
  const required = new Set<string>(Array.isArray(schema?.required) ? (schema.required as string[]) : []);
  return { props, required };
}

function shapesEqual(a: SchemaShape, b: SchemaShape): boolean {
  if (a.props.size !== b.props.size) return false;
  for (const [k, v] of a.props) if (b.props.get(k) !== v) return false;
  if (a.required.size !== b.required.size) return false;
  for (const r of a.required) if (!b.required.has(r)) return false;
  return true;
}

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/capability/mutation-contract.vitest.ts --config vitest.config.mts`
Expected: PASS (all classifier tests).

- [ ] **Step 5: Type gate + commit**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0.

```bash
git add src/capability/mutation-contract.ts tests/capability/mutation-contract.vitest.ts
git commit -m "feat(capability): CAP-5 update bump classifier (locked matrix, monotonic)"
```

---

### Task 4: Consolidate Conservative Merge Validator

Appends the consolidation merge-rule validator to `mutation-contract.ts`. Encodes the #477 conservative merge-rules table — validating that a PROPOSED target definition is conservatively sound RELATIVE TO the source definitions. It never synthesizes a definition (the proposal must carry it).

**Files:**
- Modify: `src/capability/mutation-contract.ts` (append after the classifier section)
- Test: `tests/capability/mutation-contract.vitest.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: `CapabilityConsolidateMutation` (Task 2), `CapabilityDefinition`/`CapabilityRisk` (already imported), `ValidationResult` (new type-only import), `validateCapabilityDefinition` from `./canonical/definition.js`.
- Produces: `validateConsolidateMerge(proposal: CapabilityConsolidateMutation, sources: readonly CapabilityDefinition[]): ValidationResult`. Private `RISK_RANK`.

- [ ] **Step 1: Write the failing test**

Append to `tests/capability/mutation-contract.vitest.ts`:

```ts
import { validateConsolidateMerge } from "../../src/capability/mutation-contract.js";
import type { CapabilityConsolidateMutation } from "../../src/capability/mutation-contract.js";

function sourceDef(id: string, over: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id, version: "1.0.0", kind: "operation", title: id, description: id,
    tags: [], category: "tools", risk: "low",
    requiredPermissions: ["operator"], dependencies: [], bindings: [{ type: "mcp", id: `${id}-mcp` }],
    ...over,
  };
}

// VALID fixture: target is a NEW id (not a source), risk is highest, permissions
// are the union, dependencies are the union, bindings explicit, no alias collision.
function proposal(over: Partial<CapabilityConsolidateMutation> = {}): CapabilityConsolidateMutation {
  return {
    operation: "capability.consolidate",
    sources: ["tool.file.read", "tool.file.tail"],
    target: "tool.file.combined",
    definition: sourceDef("tool.file.combined", {
      risk: "medium",
      requiredPermissions: ["operator", "admin"],
      dependencies: ["core.session.list"],
      aliases: ["readtail"],
    }),
    sourceDisposition: "deprecate",
    ...over,
  };
}

describe("validateConsolidateMerge (#477 conservative merge rules)", () => {
  // sources: tool.file.read has perms [operator], deps []; tool.file.tail has
  // perms [operator, admin], deps [core.session.list], aliases [tail].
  const sources = [
    sourceDef("tool.file.read"),
    sourceDef("tool.file.tail", { requiredPermissions: ["operator", "admin"], dependencies: ["core.session.list"], aliases: ["tail"] }),
  ];

  it("accepts a conservatively sound proposal", () => {
    const r = validateConsolidateMerge(proposal(), sources);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects when target is one of the sources", () => {
    const r = validateConsolidateMerge(proposal({ target: "tool.file.read" }), sources);
    expect(r.valid).toBe(false);
  });

  it("rejects empty or duplicate sources", () => {
    expect(validateConsolidateMerge(proposal({ sources: [] }), sources).valid).toBe(false);
    expect(validateConsolidateMerge(proposal({ sources: ["tool.file.read", "tool.file.read"] }), sources).valid).toBe(false);
  });

  it("rejects a kind mismatch between a source and the proposed target", () => {
    expect(validateConsolidateMerge(proposal({ definition: sourceDef("tool.file.combined", { kind: "query" }) }), sources).valid).toBe(false);
  });

  it("rejects proposed risk below the highest source risk", () => {
    expect(validateConsolidateMerge(proposal({ definition: sourceDef("tool.file.combined", { risk: "low" }) }), sources).valid).toBe(false);
  });

  it("rejects a missing source required permission (union)", () => {
    expect(validateConsolidateMerge(proposal({ definition: sourceDef("tool.file.combined", { requiredPermissions: ["operator"] }) }), sources).valid).toBe(false);
  });

  it("rejects a missing source dependency (union)", () => {
    expect(validateConsolidateMerge(proposal({ definition: sourceDef("tool.file.combined", { dependencies: [] }) }), sources).valid).toBe(false);
  });

  it("rejects empty proposed bindings (never blindly unioned)", () => {
    expect(validateConsolidateMerge(proposal({ definition: sourceDef("tool.file.combined", { bindings: [] }) }), sources).valid).toBe(false);
  });

  it("rejects duplicate aliases within the proposed definition", () => {
    expect(validateConsolidateMerge(proposal({ definition: sourceDef("tool.file.combined", { aliases: ["tail", "tail"] }) }), sources).valid).toBe(false);
  });

  it("rejects a source id that does not resolve to a definition", () => {
    expect(validateConsolidateMerge(proposal({ sources: ["tool.file.read", "ghost.capability"] }), sources).valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/capability/mutation-contract.vitest.ts --config vitest.config.mts`
Expected: FAIL — `validateConsolidateMerge` not exported.

- [ ] **Step 3: Append the implementation**

Append to `src/capability/mutation-contract.ts` (extend the import block first):

```ts
import type { ValidationResult } from "../evolution/contracts/evolution-contract.js";
import { validateCapabilityDefinition } from "./canonical/definition.js";

// ---------------------------------------------------------------------------
// Consolidation conservative merge rules (#477)
// ---------------------------------------------------------------------------

const RISK_RANK: Record<CapabilityRisk, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/**
 * Validate a consolidation PROPOSAL against the #477 conservative merge rules,
 * relative to the resolved SOURCE definitions. The proposal must carry the
 * explicit proposed target definition; this validator checks it is
 * conservatively sound — it NEVER synthesizes a merged definition.
 *
 * Rules (#477 table): target ∉ sources; sources non-empty + unique; each
 * source resolves; proposed kind compatible with every source (else
 * governance cannot auto-merge); proposed risk >= highest source risk
 * (highest wins); proposed requiredPermissions ⊇ union of sources;
 * proposed dependencies ⊇ union of sources; proposed bindings explicitly
 * proposed (non-empty, never blindly unioned); proposed aliases collision-free.
 */
export function validateConsolidateMerge(
  proposal: CapabilityConsolidateMutation,
  sources: readonly CapabilityDefinition[],
): ValidationResult {
  const errors: string[] = [];

  if (proposal.sources.length === 0) errors.push("consolidate: sources must be non-empty");
  if (new Set(proposal.sources).size !== proposal.sources.length) errors.push("consolidate: sources must be unique");
  if (proposal.sources.includes(proposal.target)) errors.push("consolidate: target must not be one of the sources");
  if (proposal.sourceDisposition !== "deprecate" && proposal.sourceDisposition !== "remove") {
    errors.push("consolidate: sourceDisposition must be 'deprecate' or 'remove'");
  }

  try {
    validateCapabilityDefinition(proposal.definition);
  } catch (err) {
    errors.push(`consolidate: proposed target definition invalid — ${err instanceof Error ? err.message : String(err)}`);
  }

  const sourceDefs = proposal.sources.map((id) => sources.find((s) => s.id === id));
  for (let i = 0; i < proposal.sources.length; i++) {
    if (!sourceDefs[i]) errors.push(`consolidate: source '${proposal.sources[i]}' does not resolve to a definition`);
  }
  const resolved = sourceDefs.filter((s): s is CapabilityDefinition => s !== undefined);
  if (resolved.length === 0) return { valid: errors.length === 0, errors };

  // kind compatibility (#477: "Must be compatible; otherwise governance cannot auto-merge")
  for (const s of resolved) {
    if (s.kind !== proposal.definition.kind) {
      errors.push(`consolidate: kind '${s.kind}' of source '${s.id}' incompatible with proposed kind '${proposal.definition.kind}' — governance cannot auto-merge`);
    }
  }

  // risk: highest wins
  const maxSourceRisk = Math.max(...resolved.map((s) => RISK_RANK[s.risk]));
  if (RISK_RANK[proposal.definition.risk] < maxSourceRisk) {
    errors.push("consolidate: proposed risk must be >= highest source risk (highest wins)");
  }

  // requiredPermissions: union
  for (const s of resolved) {
    for (const p of s.requiredPermissions) {
      if (!proposal.definition.requiredPermissions.includes(p)) {
        errors.push(`consolidate: proposed definition missing required permission '${p}' from source '${s.id}' (union required)`);
      }
    }
  }

  // dependencies: union
  for (const s of resolved) {
    for (const d of s.dependencies) {
      if (!proposal.definition.dependencies.includes(d)) {
        errors.push(`consolidate: proposed definition missing dependency '${d}' from source '${s.id}' (union required)`);
      }
    }
  }

  // bindings: explicitly proposed, never blindly unioned
  if (proposal.definition.bindings.length === 0) {
    errors.push("consolidate: proposed definition must carry explicit bindings (never blindly unioned)");
  }

  // aliases: no collision within the proposed definition
  const aliases = proposal.definition.aliases ?? [];
  if (new Set(aliases).size !== aliases.length) errors.push("consolidate: aliases must not collide within the proposed definition");

  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/capability/mutation-contract.vitest.ts --config vitest.config.mts`
Expected: PASS.

- [ ] **Step 5: Type gate + commit**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0.

```bash
git add src/capability/mutation-contract.ts tests/capability/mutation-contract.vitest.ts
git commit -m "feat(capability): CAP-5 consolidation conservative merge validator (#477)"
```

---

### Task 5: `validateCapabilityMutation` — Master Mutation Validator

Appends the master validator to `mutation-contract.ts`. This is the contract's acceptance proof: every mutation's pre/post conditions, enforced as a pure function, so CAP-6's executor cannot invent semantics.

**Responsibilities (the exact mutation-local pre/post-condition split):**

| Mutation | Validated here (mutation-local) |
|---|---|
| `create` | operation/payload shape; required definition fields (via `validateCapabilityDefinition`); `initialLifecycle` = "emerging" (#481 — a new capability always enters the graph at emerging) |
| `update` | `capabilityId` non-empty; `sourceVersion` REQUIRED and full SemVer MAJOR.MINOR.PATCH (no ranges, no normalization — the stale-decision/concurrent-update protection); patch non-empty; `id`/`version`/`kind` NOT patchable |
| `transition` | `capabilityId`; explicit `from` + `to` are valid lifecycle states; `isLegalTransition(from, to)` (#481 graph) |
| `consolidate` | operation/payload shape; `sources` non-empty + unique; `target` ∉ `sources`; `sourceDisposition` ∈ {deprecate, remove}; proposed definition valid. **NOT validated here**: the source-aware conservative merge rules — those require `validateConsolidateMerge(proposal, resolvedSources)` (CAP-6 resolves sources from the catalog) |
| `remove` | `capabilityId` non-empty; `reason` non-empty |

**Invariant (user tightening):** `validateCapabilityMutation()` validates ALL mutation-local preconditions. A consolidate mutation is NOT fully validated until `validateConsolidateMerge()` has also passed against resolved source publications. `validateCapabilityMutation()` must never claim a Consolidate mutation is fully valid by itself — its Consolidate path returns local-shape validity only, and its JSDoc documents the deferral. It must never reach into a catalog.

**Files:**
- Modify: `src/capability/mutation-contract.ts` (append after the merge-validator section)
- Test: `tests/capability/mutation-contract.vitest.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: `CapabilityMutation` + all payload types (Task 2), `isLegalTransition` (Task 1), `isValidVersion` from `./canonical/version.js`, `validateCapabilityDefinition` (already imported), `ValidationResult` (already imported).
- Produces: `validateCapabilityMutation(value: unknown): ValidationResult`.

- [ ] **Step 1: Write the failing test**

Append to `tests/capability/mutation-contract.vitest.ts`:

```ts
import { validateCapabilityMutation, validateConsolidateMerge } from "../../src/capability/mutation-contract.js";

// validateCapabilityDefinition requires >=1 binding, so the create/consolidate
// tests need a definition with a real binding (not the Task 3 factory default).
const okDef = baseDefinition({ bindings: [{ type: "mcp", id: "mcp-1" }] });

describe("validateCapabilityMutation (pre/post conditions)", () => {
  it("rejects non-objects", () => {
    expect(validateCapabilityMutation(null).valid).toBe(false);
    expect(validateCapabilityMutation(42).valid).toBe(false);
  });

  it("rejects unknown operations", () => {
    expect(validateCapabilityMutation({ operation: "capability.frobnicate" }).valid).toBe(false);
  });

  it("create: accepts a valid authored definition", () => {
    const r = validateCapabilityMutation({ operation: "capability.create", definition: okDef });
    expect(r.valid).toBe(true);
  });

  it("create: rejects an invalid definition and a non-emerging initialLifecycle", () => {
    expect(validateCapabilityMutation({ operation: "capability.create", definition: { ...okDef, version: "1.0" } }).valid).toBe(false);
    expect(validateCapabilityMutation({ operation: "capability.create", definition: okDef, initialLifecycle: "active" }).valid).toBe(false);
  });

  it("update: accepts sourceVersion + patch", () => {
    const r = validateCapabilityMutation({ operation: "capability.update", capabilityId: "tool.file.read", sourceVersion: "1.0.0", patch: { title: "x" } });
    expect(r.valid).toBe(true);
  });

  it("update: rejects malformed sourceVersion, empty patch, and immutable patch fields", () => {
    expect(validateCapabilityMutation({ operation: "capability.update", capabilityId: "tool.file.read", sourceVersion: "1.0", patch: { title: "x" } }).valid).toBe(false);
    expect(validateCapabilityMutation({ operation: "capability.update", capabilityId: "tool.file.read", sourceVersion: "^1.0.0", patch: { title: "x" } }).valid).toBe(false);
    expect(validateCapabilityMutation({ operation: "capability.update", capabilityId: "tool.file.read", sourceVersion: "1.0.0", patch: {} }).valid).toBe(false);
    expect(validateCapabilityMutation({ operation: "capability.update", capabilityId: "tool.file.read", sourceVersion: "1.0.0", patch: { kind: "query" } }).valid).toBe(false);
    expect(validateCapabilityMutation({ operation: "capability.update", capabilityId: "tool.file.read", sourceVersion: "1.0.0", patch: { version: "2.0.0" } }).valid).toBe(false);
    expect(validateCapabilityMutation({ operation: "capability.update", capabilityId: "tool.file.read", sourceVersion: "1.0.0", patch: { id: "other.capability" } }).valid).toBe(false);
  });

  it("transition: accepts a legal transition and rejects illegal/stale ones", () => {
    expect(validateCapabilityMutation({ operation: "capability.transition", capabilityId: "tool.file.read", from: "emerging", to: "active" }).valid).toBe(true);
    expect(validateCapabilityMutation({ operation: "capability.transition", capabilityId: "tool.file.read", from: "active", to: "deprecated" }).valid).toBe(false); // not in #481 graph
    expect(validateCapabilityMutation({ operation: "capability.transition", capabilityId: "tool.file.read", from: "active", to: "active" }).valid).toBe(false);
    expect(validateCapabilityMutation({ operation: "capability.transition", capabilityId: "tool.file.read", from: "active", to: "dormant" }).valid).toBe(false);
  });

  it("consolidate: enforces internal preconditions (target ∉ sources, non-empty, disposition)", () => {
    expect(validateCapabilityMutation({
      operation: "capability.consolidate", sources: ["a.b", "a.c"], target: "a.b",
      definition: okDef, sourceDisposition: "deprecate",
    }).valid).toBe(false); // target ∈ sources
    expect(validateCapabilityMutation({
      operation: "capability.consolidate", sources: [], target: "a.c",
      definition: okDef, sourceDisposition: "deprecate",
    }).valid).toBe(false); // empty sources
    expect(validateCapabilityMutation({
      operation: "capability.consolidate", sources: ["a.b", "a.c"], target: "a.d",
      definition: okDef, sourceDisposition: "retain",
    }).valid).toBe(false); // bad disposition
    expect(validateCapabilityMutation({
      operation: "capability.consolidate", sources: ["a.b", "a.c"], target: "a.d",
      definition: okDef, sourceDisposition: "remove",
    }).valid).toBe(true);
  });

  it("consolidate: local validation passes even when source-aware validation fails (deferral invariant)", () => {
    // A kind-mismatched merge is mutation-LOCALLY valid (target ∉ sources,
    // non-empty sources, valid proposed definition) — validateCapabilityMutation
    // MUST NOT claim it is fully valid by itself. validateConsolidateMerge
    // (Task 4) rejects it against resolved source publications. This is the
    // validateCapabilityMutation → validateConsolidateMerge deferral invariant.
    const mutation = {
      operation: "capability.consolidate" as const,
      sources: ["tool.file.read", "tool.file.tail"],
      target: "tool.file.combined",
      definition: okDef, // kind: "operation"
      sourceDisposition: "deprecate" as const,
    };
    expect(validateCapabilityMutation(mutation).valid).toBe(true); // mutation-local shape only
    const merge = validateConsolidateMerge(mutation, [
      { ...okDef, id: "tool.file.read", kind: "query" },
      { ...okDef, id: "tool.file.tail", kind: "query" },
    ]);
    expect(merge.valid).toBe(false); // source-aware conservative rules reject it
  });

  it("remove: requires capabilityId and reason", () => {
    expect(validateCapabilityMutation({ operation: "capability.remove", capabilityId: "tool.file.tail", reason: "superseded" }).valid).toBe(true);
    expect(validateCapabilityMutation({ operation: "capability.remove", capabilityId: "tool.file.tail", reason: "" }).valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/capability/mutation-contract.vitest.ts --config vitest.config.mts`
Expected: FAIL — `validateCapabilityMutation` not exported.

- [ ] **Step 3: Append the implementation**

Append to `src/capability/mutation-contract.ts` (extend the import block first):

```ts
import { isValidVersion } from "./canonical/version.js";

// ---------------------------------------------------------------------------
// Master mutation validator — pre/post conditions
// ---------------------------------------------------------------------------

const IMMUTABLE_DEFINITION_FIELDS = ["id", "version", "kind"] as const;

/**
 * Validate any CAP-5 mutation against its MUTATION-LOCAL pre/post conditions.
 * The contract's acceptance proof: a mutation a later executor cannot redefine.
 *
 * Invariant: a consolidate mutation is NOT fully validated by this function
 * alone — the source-aware conservative merge rules need resolved source
 * publications and are checked by `validateConsolidateMerge(proposal, sources)`
 * (CAP-6 resolves them from the catalog). This function validates only the
 * local shape and NEVER claims a Consolidate is fully valid by itself.
 */
export function validateCapabilityMutation(value: unknown): ValidationResult {
  const shape = validateMutationShape(value);
  if (!shape.valid) return shape;

  const m = value as CapabilityMutation;
  switch (m.operation) {
    case "capability.create": return validateCreate(m);
    case "capability.update": return validateUpdate(m);
    case "capability.transition": return validateTransition(m);
    case "capability.consolidate": return validateConsolidate(m);
    case "capability.remove": return validateRemove(m);
  }
}

/** Structural shape check — operation discriminator + required field presence. */
function validateMutationShape(value: unknown): ValidationResult {
  if (!value || typeof value !== "object") return { valid: false, errors: ["mutation must be an object"] };
  const v = value as Record<string, unknown>;
  if (typeof v.operation !== "string" || !(CAPABILITY_MUTATION_OPERATIONS as readonly string[]).includes(v.operation)) {
    return { valid: false, errors: [`operation must be one of: ${CAPABILITY_MUTATION_OPERATIONS.join(", ")}`] };
  }
  return { valid: true, errors: [] };
}

function validateCreate(m: CapabilityCreateMutation): ValidationResult {
  const errors: string[] = [];
  try {
    validateCapabilityDefinition(m.definition);
  } catch (err) {
    errors.push(`create: definition invalid — ${err instanceof Error ? err.message : String(err)}`);
  }
  if (m.initialLifecycle !== undefined && m.initialLifecycle !== "emerging") {
    errors.push("create: initialLifecycle must be 'emerging' (a new capability enters the graph at emerging, #481)");
  }
  return { valid: errors.length === 0, errors };
}

function validateUpdate(m: CapabilityUpdateMutation): ValidationResult {
  const errors: string[] = [];
  if (!isValidVersion(m.sourceVersion)) {
    errors.push(`update: sourceVersion must be full SemVer MAJOR.MINOR.PATCH (got '${String(m.sourceVersion)}'); no ranges, no normalization`);
  }
  if (m.capabilityId.trim().length === 0) errors.push("update: capabilityId required");
  const patchKeys = Object.keys(m.patch ?? {});
  if (patchKeys.length === 0) errors.push("update: patch must not be empty");
  for (const imm of IMMUTABLE_DEFINITION_FIELDS) {
    if ((m.patch as Record<string, unknown>)[imm] !== undefined) {
      errors.push(`update: '${imm}' is immutable and must not appear in a patch`);
    }
  }
  return { valid: errors.length === 0, errors };
}

function validateTransition(m: CapabilityTransitionMutation): ValidationResult {
  const errors: string[] = [];
  if (!isLifecycleState(m.from)) errors.push(`transition: 'from' must be a valid lifecycle state (got '${String(m.from)}')`);
  if (!isLifecycleState(m.to)) errors.push(`transition: 'to' must be a valid lifecycle state (got '${String(m.to)}')`);
  if (isLifecycleState(m.from) && isLifecycleState(m.to) && !isLegalTransition(m.from, m.to)) {
    errors.push(`transition: '${m.from}' → '${m.to}' is not a legal transition in the #481 graph`);
  }
  return { valid: errors.length === 0, errors };
}

function validateConsolidate(m: CapabilityConsolidateMutation): ValidationResult {
  const errors: string[] = [];
  if (m.sources.length === 0) errors.push("consolidate: sources must be non-empty");
  if (new Set(m.sources).size !== m.sources.length) errors.push("consolidate: sources must be unique");
  if (m.sources.includes(m.target)) errors.push("consolidate: target must not be one of the sources");
  if (m.sourceDisposition !== "deprecate" && m.sourceDisposition !== "remove") {
    errors.push("consolidate: sourceDisposition must be 'deprecate' or 'remove'");
  }
  try {
    validateCapabilityDefinition(m.definition);
  } catch (err) {
    errors.push(`consolidate: proposed target definition invalid — ${err instanceof Error ? err.message : String(err)}`);
  }
  return { valid: errors.length === 0, errors };
}

function validateRemove(m: CapabilityRemoveMutation): ValidationResult {
  const errors: string[] = [];
  if (m.capabilityId.trim().length === 0) errors.push("remove: capabilityId required");
  if (m.reason.trim().length === 0) errors.push("remove: reason required");
  return { valid: errors.length === 0, errors };
}

function isLifecycleState(v: unknown): v is LifecycleState {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(LEGAL_LIFECYCLE_TRANSITIONS, v);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/capability/mutation-contract.vitest.ts --config vitest.config.mts`
Expected: PASS.

- [ ] **Step 5: Type gate + commit**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0.

```bash
git add src/capability/mutation-contract.ts tests/capability/mutation-contract.vitest.ts
git commit -m "feat(capability): CAP-5 validateCapabilityMutation master validator (pre/post conditions)"
```

---

### Task 6: Three-Axis Separation in `lifecycle-contract.ts`

Reconciles the existing A7 lifecycle contract with the CAP-5 three-axis model. Declares `CapabilityRuntimeState` (three independent axes) + `CapabilityGovernanceStatus` (fourth, independent axis), and documents that `APPROVED_PENDING_APPLICATION` is out-of-contract (deletion = CAP-11). Types + tests only — NO wiring, NO change to `CapabilityLifecycleIntent`/`deriveCapabilityProjectionState`.

**Files:**
- Modify: `src/evolution/capability-lifecycle/contracts/lifecycle-contract.ts` (add imports + a new section; do NOT touch existing exports)
- Test: Create `tests/evolution/capability-lifecycle/capability-lifecycle-three-axis.test.ts` (node:test style)

**Interfaces:**
- Consumes: `LifecycleState` (already imported), `CapabilityAvailability` (type-only, new), `CapabilityDefinition` (type-only, new).
- Produces: `CapabilityRuntimeState`, `CapabilityGovernanceStatus`.

- [ ] **Step 1: Write the failing test**

Create `tests/evolution/capability-lifecycle/capability-lifecycle-three-axis.test.ts` (node:test, matching the sibling `capability-lifecycle-contract-a71.test.ts` import style — evolution node:test runs against `dist/`):

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CAPABILITY_GOVERNANCE_STATUSES,
} from "../../../dist/evolution/capability-lifecycle/contracts/lifecycle-contract.js";
import type {
  CapabilityRuntimeState,
  CapabilityGovernanceStatus,
} from "../../../dist/evolution/capability-lifecycle/contracts/lifecycle-contract.js";

const ALL_GOVERNANCE_STATUSES: readonly string[] = [
  "none", "proposed", "approved", "rejected", "applied", "measured",
];

describe("CapabilityGovernanceStatus (CAP-5 fourth axis)", () => {
  it("has exactly the six governance statuses", () => {
    assert.deepEqual([...CAPABILITY_GOVERNANCE_STATUSES].sort(), [...ALL_GOVERNANCE_STATUSES].sort());
  });

  it("does NOT include APPROVED_PENDING_APPLICATION (deletion = CAP-11)", () => {
    assert.equal(CAPABILITY_GOVERNANCE_STATUSES.includes("APPROVED_PENDING_APPLICATION" as CapabilityGovernanceStatus), false);
  });

  it("is typed as a union of the six literals", () => {
    const s: CapabilityGovernanceStatus = "approved";
    assert.equal(s, "approved");
  });
});

describe("CapabilityRuntimeState (three independent axes)", () => {
  // Minimal structural objects — the axes must be independently representable.
  it("allows deprecated + available (deprecated is terminal, not unavailable)", () => {
    const state: CapabilityRuntimeState = { definition: {} as never, lifecycle: "deprecated", availability: { available: true } } as unknown as CapabilityRuntimeState;
    assert.equal(state.lifecycle, "deprecated");
    assert.equal(state.availability.available, true);
  });

  it("allows active + unavailable (availability is never a lifecycle change)", () => {
    const state: CapabilityRuntimeState = { definition: {} as never, lifecycle: "active", availability: { available: false, reason: "provider_unavailable" } } as unknown as CapabilityRuntimeState;
    assert.equal(state.lifecycle, "active");
    assert.equal(state.availability.available, false);
  });

  it("allows emerging + available (unbound is availability, not dormant)", () => {
    const state: CapabilityRuntimeState = { definition: {} as never, lifecycle: "emerging", availability: { available: true } } as unknown as CapabilityRuntimeState;
    assert.equal(state.lifecycle, "emerging");
  });

  it("keeps definition / lifecycle / availability as distinct keys", () => {
    const state: CapabilityRuntimeState = { definition: {} as never, lifecycle: "active", availability: { available: true } } as unknown as CapabilityRuntimeState;
    assert.deepEqual(Object.keys(state).sort(), ["availability", "definition", "lifecycle"]);
  });
});
```

> **Implementer note — `CAPABILITY_GOVERNANCE_STATUSES`:** the reconcile (Step 3) adds this exported readonly array of the six statuses alongside the type, so the test can assert the exact vocabulary at runtime (mirrors the existing `P5_5_LIFECYCLE_STATES` pattern in this file).

- [ ] **Step 2: Confirm the module lacks the new symbols (test fails to compile/run)**

Run: `pnpm run build && node --test dist/tests/evolution/capability-lifecycle/capability-lifecycle-three-axis.test.js`
Expected: FAIL — `CAPABILITY_GOVERNANCE_STATUSES` undefined.

- [ ] **Step 3: Implement the reconcile**

In `src/evolution/capability-lifecycle/contracts/lifecycle-contract.ts`:

1. Extend the import block (add below the existing `import type { ... }` lines):

```ts
import type { CapabilityDefinition } from "../../../capability/canonical/definition.js";
import type { CapabilityAvailability } from "../../../capability/registry.js";
```

2. Append a new section (after the `CapabilityProjectionState`/`deriveCapabilityProjectionState` block):

```ts
// ---------------------------------------------------------------------------
// Three-axis separation + governance status (CAP-5; #481, #476, design §17)
// ---------------------------------------------------------------------------

/**
 * The three independent runtime axes. `lifecycle` ("where it is") and
 * `availability` ("can it run?") are independent — `active + unavailable` and
 * `deprecated + available` are both legal. There is NO `dormant` lifecycle
 * state; an unbound capability is `unavailable`, never a fourth state. The
 * definition axis is the immutable `id@version` publication (#479).
 *
 * CAP-5 contract only — NOT yet wired into the registry. CAP-7/8/9 adopt this
 * type as the canonical runtime-state shape.
 */
export interface CapabilityRuntimeState {
  definition: CapabilityDefinition;
  lifecycle: LifecycleState;
  availability: CapabilityAvailability;
}

/**
 * Fourth, independent axis: what GOVERNANCE says about the capability
 * (design §17). Orthogonal to lifecycle — a capability can be
 * `lifecycle: active` while `governance: approved` with a deprecation
 * requested-but-not-yet-applied; no artificial lifecycle value such as
 * APPROVED_PENDING_APPLICATION is required. CAP-5 declares the type only; it
 * is not wired into the governance engine.
 */
export type CapabilityGovernanceStatus =
  | "none"
  | "proposed"
  | "approved"
  | "rejected"
  | "applied"
  | "measured";

export const CAPABILITY_GOVERNANCE_STATUSES: readonly CapabilityGovernanceStatus[] = [
  "none", "proposed", "approved", "rejected", "applied", "measured",
];

// NOTE: `CapabilityProjectionState`'s `APPROVED_PENDING_APPLICATION` (A7
// overlay) is NOT a CAP-5 lifecycle or governance state. Its removal/cleanup
// is deferred to CAP-11. The CAP-5 model expresses the same truth as
// `lifecycle` + `governance: approved`.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm run build && node --test dist/tests/evolution/capability-lifecycle/capability-lifecycle-three-axis.test.js`
Expected: PASS.

- [ ] **Step 5: Type gate + commit**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0.

```bash
git add src/evolution/capability-lifecycle/contracts/lifecycle-contract.ts tests/evolution/capability-lifecycle/capability-lifecycle-three-axis.test.ts
git commit -m "feat(capability): CAP-5 three-axis separation + governance status in lifecycle contract"
```

---

### Task 7: `EvolutionTarget` Reconcile in `evolution-contract.ts`

Gives capability evolution targets a way to pin the exact immutable publication (#479): `EvolutionTarget` gains optional `version`, a new exported `validateEvolutionTarget` enforces it (full SemVer only, no ranges, no normalization), and `validateEvolutionIntent` wires it in.

**Files:**
- Modify: `src/evolution/contracts/evolution-contract.ts` (`EvolutionTarget` interface + add `validateEvolutionTarget` + call it from `validateEvolutionIntent`); add a SemVer check helper.
- Test: `tests/evolution/evolution-contract.test.ts` (append a `describe` block — node:test style, runs against `dist/`).

**Interfaces:**
- Consumes: `isValidVersion` from `../../capability/canonical/version.js` (runtime import — evolution already imports capability modules).
- Produces: `validateEvolutionTarget(value: unknown): ValidationResult`; `EvolutionTarget.version?: string`.

- [ ] **Step 1: Write the failing test**

Append to `tests/evolution/evolution-contract.test.ts` (match the file's existing import + style):

```ts
describe("validateEvolutionTarget (CAP-5 #479 pinning)", () => {
  it("accepts a capability target without a version (unpinned)", () => {
    const r = validateEvolutionTarget({ kind: "capability", id: "tool.file.read" });
    assert.equal(r.valid, true);
  });

  it("accepts a capability target pinned to an exact full-SemVer publication", () => {
    const r = validateEvolutionTarget({ kind: "capability", id: "tool.file.read", version: "1.1.0" });
    assert.equal(r.valid, true);
  });

  it("rejects a capability target with a non-full-SemVer version", () => {
    assert.equal(validateEvolutionTarget({ kind: "capability", id: "tool.file.read", version: "1.1" }).valid, false);
    assert.equal(validateEvolutionTarget({ kind: "capability", id: "tool.file.read", version: "1" }).valid, false);
  });

  it("rejects a capability target with a range or wildcard version", () => {
    assert.equal(validateEvolutionTarget({ kind: "capability", id: "tool.file.read", version: "^1.1.0" }).valid, false);
    assert.equal(validateEvolutionTarget({ kind: "capability", id: "tool.file.read", version: ">=1.0.0" }).valid, false);
    assert.equal(validateEvolutionTarget({ kind: "capability", id: "tool.file.read", version: "*" }).valid, false);
  });

  it("ignores version for non-capability target kinds", () => {
    assert.equal(validateEvolutionTarget({ kind: "policy", id: "policy-approval-threshold", version: "not-semver" }).valid, true);
  });

  it("rejects a missing kind or id", () => {
    assert.equal(validateEvolutionTarget({ id: "tool.file.read" }).valid, false);
    assert.equal(validateEvolutionTarget({ kind: "capability" }).valid, false);
  });

  it("validateEvolutionIntent still passes with a pinned capability target", () => {
    const intent = {
      evolutionId: "ev-1", origin: "operator",
      target: { kind: "capability", id: "tool.file.read", version: "1.1.0" },
      rationale: [{ type: "observation", reference: "obs-1" }],
      expectedEffect: "tighten", riskClass: "medium", constraints: [], createdAt: "2026-08-11T00:00:00Z",
    };
    const r = validateEvolutionIntent(intent);
    assert.equal(r.valid, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build && node --test dist/tests/evolution/evolution-contract.test.js`
Expected: FAIL — `validateEvolutionTarget` not exported.

- [ ] **Step 3: Implement the reconcile**

In `src/evolution/contracts/evolution-contract.ts`:

1. Add the SemVer import at the top (with the other imports):

```ts
import { isValidVersion } from "../../capability/canonical/version.js";
```

2. Add `version?: string` to the `EvolutionTarget` interface:

```ts
export interface EvolutionTarget {
  kind: EvolutionTargetKind;
  id: string;
  /** Exact immutable publication for `kind === "capability"` (#479, CAP-5).
   *  Absent = unpinned; present = must be full SemVer MAJOR.MINOR.PATCH. When
   *  present, `(id, version)` is the complete publication identity. Other
   *  target kinds ignore `version`. */
  version?: string;
  currentHash?: string;
}
```

3. Add the exported validator (place it after the `EvolutionTarget` interface, before `EvolutionRiskClass`):

```ts
/**
 * Validate an EvolutionTarget (CAP-5 #479 reconcile). For capability targets,
 * `version` (when present) must be full SemVer MAJOR.MINOR.PATCH only — no
 * ranges (`^`/`~`/`>=`/`*`), never silently normalized; a malformed pinned
 * target fails contract validation. Other kinds ignore `version`. Pure — no
 * side effects, no I/O, no store access.
 */
export function validateEvolutionTarget(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["EvolutionTarget must be an object"] };
  }
  const v = value as Record<string, unknown>;
  if (typeof v.kind !== "string" || !isValidTargetKind(v.kind)) {
    errors.push(`kind must be one of: ${VALID_EVOLUTION_TARGET_KINDS.join(", ")}`);
  }
  if (!isNonEmptyString(v.id)) errors.push("id required and must be non-empty");
  if (v.kind === "capability" && v.version !== undefined) {
    if (typeof v.version !== "string" || !isValidVersion(v.version)) {
      errors.push(`capability target version must be full SemVer MAJOR.MINOR.PATCH (got '${String(v.version)}'); no ranges, no normalization`);
    }
  }
  return { valid: errors.length === 0, errors };
}
```

4. Wire it into `validateEvolutionIntent` — replace the loose target check:

```ts
  if (!v.target || typeof v.target !== "object") {
    errors.push("target required and must be an EvolutionTarget object");
  } else {
    const targetErrors = validateEvolutionTarget(v.target).errors;
    errors.push(...targetErrors);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run build && node --test dist/tests/evolution/evolution-contract.test.js`
Expected: PASS (all new + existing tests).

- [ ] **Step 5: Type gate + commit**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0.

```bash
git add src/evolution/contracts/evolution-contract.ts tests/evolution/evolution-contract.test.ts
git commit -m "feat(capability): CAP-5 EvolutionTarget pins exact id@version (#479)"
```

---

### Task 8: Barrel Export, Purity Sentinel, Full-Suite Verification

Closes the CAP-5 loop: export the mutation contract from the capability barrel, add a structural sentinel proving `mutation-contract.ts` stays pure, and verify the full test surface is green. No runtime wiring — CAP-5 is contracts-first.

**Files:**
- Modify: `src/capability/index.ts` (add `export * from "./mutation-contract.js";`)
- Test: Create `tests/capability/mutation-contract-purity.vitest.ts` (structural sentinel)
- Verify: no changes to `src/capability/mutation-port.ts`, `src/capability/registry.ts`, `src/capability/runtime.ts`, `src/capability/platform.ts`.

**Interfaces:**
- Produces: `CapabilityMutation` family exported from `src/capability/index.js`.

- [ ] **Step 1: Write the failing purity test**

Create `tests/capability/mutation-contract-purity.vitest.ts`:

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const SRC = resolve(import.meta.dirname, "../../src/capability/mutation-contract.ts");
const source = readFileSync(SRC, "utf8");

/** CAP-5 purity invariant: mutation-contract.ts must stay a pure contract —
 *  no registry/persistence/executor/runtime/governance wiring. */
describe("mutation-contract.ts purity (user ruling)", () => {
  it("imports only the allowed contract modules", () => {
    const allowed = [
      "./canonical/",
      "../adaptation/",
      "../evolution/contracts/evolution-contract.js",
    ];
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    const banned = imports.filter((p) => !allowed.some((a) => p.startsWith(a)));
    expect(banned).toEqual([]);
  });

  it("does not reference registry, runtime, executor, or platform symbols", () => {
    for (const symbol of ["CapabilityRegistry", "CapabilityRuntime", "ProviderExecutor", "CapabilityPlatform", "CapabilityMutationPort"]) {
      expect(source).not.toMatch(new RegExp(`\\b${symbol}\\b`));
    }
  });

  it("has no side-effect statements (no new/assignments outside functions)", () => {
    // heuristic: no `new ` allocations and no top-level `console.`/`process.` calls
    expect(source).not.toMatch(/\bnew\s+[A-Z]/);
    expect(source).not.toMatch(/console\./);
    expect(source).not.toMatch(/\bprocess\./);
  });
});

/** Barrel integration: the mutation contract is exported from the capability index. */
describe("capability barrel exports", () => {
  it("re-exports the mutation contract", async () => {
    const mod = await import("../../src/capability/index.js");
    expect(typeof mod.isLegalTransition).toBe("function");
    expect(typeof mod.validateCapabilityMutation).toBe("function");
    expect(typeof mod.classifyUpdateBump).toBe("function");
    expect(mod.CAPABILITY_MUTATION_OPERATIONS).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/capability/mutation-contract-purity.vitest.ts --config vitest.config.mts`
Expected: FAIL — `isLegalTransition` not exported from `index.js` (barrel export missing).

- [ ] **Step 3: Implement the barrel export**

In `src/capability/index.ts`, add (alphabetical placement with the other `export *` lines):

```ts
export * from "./mutation-contract.js";
```

- [ ] **Step 4: Run tests to verify it passes**

Run: `pnpm exec vitest run tests/capability/mutation-contract-purity.vitest.ts tests/capability/mutation-contract.vitest.ts --config vitest.config.mts`
Expected: PASS.

- [ ] **Step 5: Full-suite verification**

Run:
```bash
pnpm exec tsc --noEmit
pnpm test:vitest
pnpm run build && node --test dist/tests/evolution/capability-lifecycle/capability-lifecycle-three-axis.test.js dist/tests/evolution/evolution-contract.test.js
```
Expected: `tsc` exit 0; vitest green (the pre-existing 170 capability tests + the new mutation-contract suites); the two node:test reconcile files green.

Confirm by `git diff --stat` that `mutation-port.ts`, `registry.ts`, `runtime.ts`, and `platform.ts` are NOT in the diff (CAP-6 owns those).

- [ ] **Step 6: Commit**

```bash
git add src/capability/index.ts tests/capability/mutation-contract-purity.vitest.ts
git commit -m "feat(capability): CAP-5 barrel export + mutation-contract purity sentinel"
```

---

## Self-Review

**Spec coverage (program §CAP-5 acceptance criteria):**
- "Five mutation contracts defined with exact payloads and pre/post conditions" → Task 2 (payloads) + Task 5 (pre/post conditions via `validateCapabilityMutation`). ✅
- "Lifecycle graph fixed acyclic; deprecated terminal; no dormant" → Task 1 (`LEGAL_LIFECYCLE_TRANSITIONS`, terminal `deprecated: []`, acyclicity test). ✅
- "update produces a new immutable publication; no in-place mutation" → Task 2 payload (`sourceVersion` required, no "modify current"), Task 3 classifier, Task 5 `validateUpdate` immutable-field enforcement + the immutable-publication invariant (Global Constraints) that every publication-creating mutation yields a new `id@version`. ✅
- "consolidate requires an explicit proposed target definition; sources-deprecated-no-canonical-target = deprecation never consolidation" → Task 2 payload carries `definition`; Task 4/5 enforce target ∉ sources + merge rules; Task 8's purity keeps `INTENT_TO_STATE.consolidate` untouched. ✅
- **User tightenings applied**: validateCapabilityMutation → validateConsolidateMerge deferral invariant (Task 5 responsibilities + JSDoc + test); classifier operates on definitions not patches (Task 3 JSDoc + Global Constraints); binding-identity rule — any binding change (type/id/config/reorder) is MAJOR, reversing my earlier "same-tech swap = MINOR" invention (Task 3 tests + Global Constraints). ✅
- "Lifecycle and availability are independent axes" → Task 6 (`CapabilityRuntimeState`), Task 1 (transition legality never reads availability). ✅
- "Mutation-contract tests; transition-table tests; consolidation merge-rule tests; update bump-classification tests" → Tasks 1/3/4/5 test blocks. ✅
- Files affected reconcile: `evolution-contract.ts` → Task 7; `lifecycle-contract.ts` → Task 6. ✅
- "The A7 APPROVED_PENDING_APPLICATION projection state is not part of the new contract — its deletion is CAP-11" → Task 6 comment + tests. ✅

**Placeholder scan:** Each task has full code blocks. The two "Implementer note" annotations (Task 3 deep-equality choice, Task 6 `CAPABILITY_GOVERNANCE_STATUSES`) are explicit resolutions with the reason, not placeholders.

**Type consistency:** `CapabilityMutation` union members share the `operation` discriminator used by `validateMutationShape`'s switch; `CapabilityDefinitionPatch` excludes id/version/kind and `validateUpdate` enforces it at runtime; `classifyUpdateBump` returns the three literal classes Tasks 5/CAP-6 expect; `validateConsolidateMerge` signature `(proposal, sources)` is what CAP-6 will call with catalog-resolved definitions.
