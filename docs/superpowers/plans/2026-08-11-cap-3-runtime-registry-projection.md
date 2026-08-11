# CAP-3 — Runtime Registry Projection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `src/capability/registry.ts` into a canonical registry that is the runtime projection of the CAP-2 persistent catalog — one registry per runtime universe, lifecycle state owned by the registry (not an A7 overlay), legacy `Capability` served through a temporary read adapter, and the CLI's second registry eliminated.

**Architecture:** One canonical model. The registry stores `RegisteredCapability` (definition + lifecycle + availability + bindings) keyed by capability id, seeded by reading the catalog. Legacy `find/list/query/register` methods become a temporary adapter that DERIVES legacy `Capability` from the canonical state — never a second stored map. Mutations (`register`/`unregister`) route through a `CapabilityMutationPort`; CAP-3 ships the `CatalogBackedCapabilityMutationPort`, CAP-6 replaces its implementation with A4-governed execution without changing public call sites. `platform.ts` becomes the composition root: load catalog → build registry → resolve bindings.

**Tech Stack:** TypeScript (ESM, `node:` imports), Vitest (`tests/capability/*.vitest.ts`), node:test (`*.test.ts` — A7 lifecycle tests), CAP-1 canonical module (`src/capability/canonical/`), CAP-2 `CapabilityCatalog`.

## Global Constraints

- **North-star invariant**: exactly one `CapabilityRegistry` per runtime universe; the catalog is the single durable source, not a second registry. Registry `list()` == catalog current state.
- **Canonical registry with a temporary legacy read adapter** (user-approved). One canonical model: `Map<CapabilityId, RegisteredCapability>` with `definition | lifecycle | availability | bindings`. Legacy `Capability` is DERIVED from canonical state on demand — NEVER stored in a parallel map. Legacy reads cannot mutate canonical state.
- **register() is bootstrap-only.** CAP-3 registration is a bootstrap/compatibility operation — no A4 authorization, no governance approval, no lifecycle proposal, no mutation-ledger semantics. It routes through the catalog-backed port: `legacy register(cap) → convert → catalog → refresh projection`. CAP-6 replaces the port implementation with A4; **no consumer-facing registry mutation API may bypass the port after CAP-6**.
- **CAP-3 provider reads are declarative/structural only.** `getProviders()` = distinct `binding.provider.type` across registered definitions. `getAvailableProviders(id)` = that capability's bindings whose provider type has a bound executor in the runtime `ExecutorRegistry`. MUST NOT claim CAP-4 health/fallback/availability semantics.
- **Lifecycle state is current registry state** (#481): `setLifecycleState`/`getLifecycleState` are the authority; the A7 ledger (`capability-lifecycle-ledger.ts`) is HISTORY only. The six-state `LifecycleState` from `../adaptation/capability-evolution-types.js` is used verbatim (it already matches design §16).
- **Files CAP-3 may modify**: `src/capability/registry.ts`, `src/capability/platform.ts`, `src/capability/runtime.ts` (read-path verification only), `src/cli.ts` (CLI second-registry removal), `src/capability/index.ts` (barrel), plus NEW files `src/capability/legacy-adapter.ts`, `src/capability/mutation-port.ts`, and their tests.
- **Files CAP-3 MUST NOT modify**: `src/capability/initial-capabilities.ts`, `src/tools/tool-registry.ts`, `src/policy/capability-registry.ts`, and everything under `src/capability/canonical/` (CAP-1/2 module stays pure — the legacy adapter lives OUTSIDE it). Existing registry consumers outside the listed files must keep working unmodified.
- **A7 lifecycle modules keep working**: `setLifecycleState` is the new current-state authority; **`applyLifecycleTransition` is retained as a deprecated delegating alias** — 3 production files call it (`capability-lifecycle-rehydration.ts:32`, `capability-lifecycle-step-executor.ts:34,53`) and are OUTSIDE the CAP-3 file allowlist, so they must keep working unmodified. `getLifecycleState`/`clearLifecycleState`/`listLifecycleStates` retain their signatures. The A7 ledger rehydration (`rehydrateLifecycleOverlay`) still reads the ledger into the registry at init, but the registry OWNS current state thereafter.
- **Test runner**: Vitest for new tests (`tests/capability/*.vitest.ts`). After EACH task run `pnpm exec tsc --noEmit` — MUST exit 0 (Vitest/esbuild doesn't typecheck — CAP-1 lesson).

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/capability/legacy-adapter.ts` (NEW) | `legacyToCanonicalDefinition`, `canonicalToLegacyCapability`, `buildLegacyBindings` — lossless legacy↔canonical conversion; `toolName` rides `binding.config` |
| `src/capability/mutation-port.ts` (NEW) | `CapabilityMutationPort` interface + `CatalogBackedCapabilityMutationPort` (idempotent bootstrap register) |
| `src/capability/registry.ts` (MODIFY) | Canonical projection storage + legacy adapter + canonical API + lifecycle-state authority |
| `src/capability/platform.ts` (MODIFY) | Composition root: catalog → registry → runtime; wiring |
| `src/capability/runtime.ts` (VERIFY) | Read paths keep working through the adapter (behavior unchanged) |
| `src/cli.ts` (MODIFY) | `alix capabilities` uses the composition root; second `new CapabilityRegistry()` removed |
| `src/capability/index.ts` (MODIFY) | Barrel: export new types/adapters |

### Task 1: Legacy↔canonical conversion adapter

**Files:**
- Create: `src/capability/legacy-adapter.ts`
- Test: `tests/capability/legacy-adapter.vitest.ts`

**Interfaces:**
- Consumes: `Capability` (`./types.js`), `CapabilityDefinition` + `validateCapabilityDefinition` + `CapabilityKind` (`./canonical/definition.js`, `./canonical/kind.js`), `CapabilityProviderBinding` + `ProviderType` (`./canonical/provider.js`), `formatVersionId`/`isValidVersion` (`./canonical/version.js`), `migrateKind` (`./canonical/kind.js`).
- Produces: `legacyToCanonicalDefinition(cap: Capability): CapabilityDefinition`; `canonicalToLegacyCapability(def: CapabilityDefinition, prev?: Partial<Capability>): Capability`; `buildLegacyBindings(cap: Capability): CapabilityProviderBinding[]`. Later tasks rely on these exact names.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import type { Capability } from "../../src/capability/types.js";
import { legacyToCanonicalDefinition, canonicalToLegacyCapability, buildLegacyBindings } from "../../src/capability/legacy-adapter.js";
import { migrateKind } from "../../src/capability/canonical/kind.js";

function makeLegacyCap(overrides: Partial<Capability> = {}): Capability {
  return {
    id: "tool.file.read", version: "1.0", kind: "tool",
    title: "Read file", description: "Read file contents",
    tags: ["file"], category: "file", risk: "low",
    requiredPermissions: ["developer"],
    argsSchema: { type: "object" }, resultSchema: { type: "object" },
    execution: { strategy: "tool", timeout: 10_000, cancellable: false },
    extensions: { toolName: "file.read" },
    ...overrides,
  };
}

describe("legacy↔canonical conversion adapter", () => {
  it("converts a legacy capability to a canonical definition losslessly", () => {
    const def = legacyToCanonicalDefinition(makeLegacyCap());
    expect(def.id).toBe("tool.file.read");
    expect(def.version).toBe("1.0.0");                       // short semver normalized (#479)
    expect(def.kind).toBe("operation");                       // migrateKind("tool") → operation
    expect(def.bindings).toHaveLength(1);
    expect(def.bindings[0]!.type).toBe("tool");               // execution.strategy → provider type
    expect(def.bindings[0]!.config).toEqual({ toolName: "file.read" }); // extensions.toolName rides binding.config
  });

  it("round-trips back to a legacy capability, preserving toolName", () => {
    const def = legacyToCanonicalDefinition(makeLegacyCap());
    const back = canonicalToLegacyCapability(def);
    expect(back.id).toBe("tool.file.read");
    expect(back.kind).toBe("tool");                           // operation → tool (best-effort reverse)
    expect(back.execution.strategy).toBe("tool");
    expect(back.extensions?.toolName).toBe("file.read");      // recovered from binding.config
    expect(back.title).toBe("Read file");
    expect(back.requiredPermissions).toEqual(["developer"]);
  });

  it("maps every real initial capability losslessly (representability)", () => {
    // core.session.list (kind core, strategy native) + tool.shell.run (kind tool)
    const core = legacyToCanonicalDefinition(makeLegacyCap({ id: "core.session.list", kind: "core", execution: { strategy: "native" }, extensions: undefined }));
    expect(core.kind).toBe("core");
    expect(core.bindings[0]!.type).toBe("native");
    const shell = legacyToCanonicalDefinition(makeLegacyCap({ id: "tool.shell.run", risk: "high", requiredPermissions: ["admin"], execution: { strategy: "tool" }, extensions: { toolName: "shell.run" } }));
    expect(shell.bindings[0]!.config).toEqual({ toolName: "shell.run" });
  });

  it("round-trips execution timeout/cancellable through binding.config (lossless)", () => {
    const def = legacyToCanonicalDefinition(makeLegacyCap({ execution: { strategy: "tool", timeout: 10_000, cancellable: true } }));
    expect(def.bindings[0]!.config).toMatchObject({ timeout: 10_000, cancellable: true });
    const back = canonicalToLegacyCapability(def);
    expect(back.execution.timeout).toBe(10_000);
    expect(back.execution.cancellable).toBe(true);
  });

  it("throws on a legacy custom kind (no canonical equivalent)", () => {
    expect(() => legacyToCanonicalDefinition(makeLegacyCap({ kind: "custom" }))).toThrow(/migrate|kind/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/capability/legacy-adapter.vitest.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import type { Capability } from "./types.js";
import { migrateKind } from "./canonical/kind.js";
import type { CapabilityDefinition, CapabilityKind } from "./canonical/definition.js";
import type { CapabilityProviderBinding, ProviderType } from "./canonical/provider.js";

/** Map a legacy execution.strategy to a canonical provider type (ADR-0013).
 *  "cli" legacy strategies map to external-cli; everything else maps 1:1. */
const LEGACY_STRATEGY_TO_PROVIDER: Record<string, ProviderType> = {
  native: "native", tool: "tool", mcp: "mcp", cli: "external-cli",
  daemon: "daemon", agent: "agent", plugin: "plugin", "remote-api": "remote-api",
};

/** Best-effort reverse of migrateKind for the TEMPORARY legacy adapter.
 *  Lossy by design: tool+skill both → operation, so both read back as "tool".
 *  query (no legacy equivalent) reads back as "custom". */
const CANONICAL_KIND_TO_LEGACY: Record<CapabilityKind, Capability["kind"]> = {
  core: "core", operation: "tool", workflow: "workflow", agent: "plugin", query: "custom",
};

/** Build canonical provider bindings from a legacy capability.
 *  extensions (incl. toolName) AND execution metadata (timeout/cancellable)
 *  ride binding.config so the canonical round-trip is lossless; executors and
 *  the legacy adapter recover them on the way back. */
export function buildLegacyBindings(cap: Capability): CapabilityProviderBinding[] {
  const provider = LEGACY_STRATEGY_TO_PROVIDER[cap.execution.strategy] ?? "tool";
  const config: Record<string, unknown> = {
    ...cap.extensions,
    ...(cap.execution.timeout != null ? { timeout: cap.execution.timeout } : {}),
    ...(cap.execution.cancellable != null ? { cancellable: cap.execution.cancellable } : {}),
  };
  return [{ id: cap.id, type: provider, ...(Object.keys(config).length > 0 ? { config } : {}) }];
}

/** Convert a legacy Capability to a canonical CapabilityDefinition.
 *  Normalizes version to full SemVer (#479), migrates kind via migrateKind
 *  (throws on "custom"), carries execution/extensions through bindings. */
export function legacyToCanonicalDefinition(cap: Capability): CapabilityDefinition {
  const kind = migrateKind(cap.kind); // throws on "custom" — no canonical equivalent
  return {
    id: cap.id,
    version: cap.version.split(".").length === 2 ? `${cap.version}.0` : cap.version,
    kind,
    title: cap.title,
    description: cap.description,
    tags: cap.tags,
    category: cap.category,
    risk: cap.risk,
    requiredPermissions: cap.requiredPermissions,
    dependencies: cap.dependencies ?? [],
    bindings: buildLegacyBindings(cap),
    ...(cap.argsSchema ? { argsSchema: cap.argsSchema } : {}),
    ...(cap.resultSchema ? { resultSchema: cap.resultSchema } : {}),
  };
}

/** Derive a legacy Capability from canonical state — the TEMPORARY adapter.
 *  Never stored; produced on demand for find()/list()/query() consumers.
 *  toolName, timeout, cancellable are recovered from binding.config (lossless);
 *  aliases/examples genuinely have no canonical home and are omitted. */
export function canonicalToLegacyCapability(def: CapabilityDefinition): Capability {
  const binding = def.bindings[0];
  const providerType = binding?.type ?? "tool";
  const legacyKind = CANONICAL_KIND_TO_LEGACY[def.kind] ?? "custom";
  const config = (binding?.config ?? {}) as Record<string, unknown>;
  const strategy = Object.entries(LEGACY_STRATEGY_TO_PROVIDER).find(([, p]) => p === providerType)?.[0] ?? "tool";
  return {
    id: def.id,
    version: def.version,
    kind: legacyKind,
    title: def.title,
    description: def.description,
    tags: def.tags,
    category: def.category,
    risk: def.risk,
    requiredPermissions: def.requiredPermissions,
    execution: {
      strategy,
      ...(typeof config.timeout === "number" ? { timeout: config.timeout } : {}),
      ...(typeof config.cancellable === "boolean" ? { cancellable: config.cancellable } : {}),
    },
    dependencies: def.dependencies,
    ...(Object.keys(config).length > 0 ? { extensions: config as Capability["extensions"] } : {}),
    ...(def.argsSchema ? { argsSchema: def.argsSchema } : {}),
    ...(def.resultSchema ? { resultSchema: def.resultSchema } : {}),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/capability/legacy-adapter.vitest.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm exec tsc --noEmit` — exit 0.
Commit:
```bash
git add src/capability/legacy-adapter.ts tests/capability/legacy-adapter.vitest.ts
git commit -m "feat(capability): CAP-3 legacy↔canonical conversion adapter"
```

---

### Task 2: Mutation port — catalog-backed bootstrap seam

**Files:**
- Create: `src/capability/mutation-port.ts`
- Test: `tests/capability/mutation-port.vitest.ts`

**Interfaces:**
- Consumes: `CapabilityCatalog` (`./canonical/catalog.js`), `CapabilityDefinition` (`./canonical/definition.js`), `Capability` (`./types.js`), `legacyToCanonicalDefinition` (Task 1).
- Produces: `interface CapabilityMutationPort { register(def: CapabilityDefinition): void; unregister(id: string): void; }`; `class CatalogBackedCapabilityMutationPort implements CapabilityMutationPort`. Registry (Task 3) consumes this. CAP-6 swaps the implementation to A4-governed — the public call sites do not change.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityCatalog } from "../../src/capability/canonical/catalog.js";
import { CapabilityDefinitionStore } from "../../src/capability/canonical/catalog-store.js";
import { CatalogBackedCapabilityMutationPort } from "../../src/capability/mutation-port.js";
import { legacyToCanonicalDefinition } from "../../src/capability/legacy-adapter.js";
import type { Capability } from "../../src/capability/types.js";

function makeLegacyCap(): Capability {
  return { id: "tool.file.read", version: "1.0", kind: "tool", title: "Read file", description: "d",
    tags: [], category: "file", risk: "low", requiredPermissions: ["developer"], execution: { strategy: "tool" } };
}

describe("CatalogBackedCapabilityMutationPort", () => {
  let dir: string;
  let catalog: CapabilityCatalog;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cap3-mut-"));
    catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("registers through the catalog (idempotent on duplicate id@version)", () => {
    const port = new CatalogBackedCapabilityMutationPort(catalog);
    const def = legacyToCanonicalDefinition(makeLegacyCap());
    port.register(def);
    expect(catalog.has("tool.file.read")).toBe(true);
    expect(() => port.register(def)).not.toThrow(); // duplicate bootstrap re-run is a no-op
    expect(catalog.list()).toHaveLength(1);          // still exactly one entry
  });

  it("unregisters through the catalog", () => {
    const port = new CatalogBackedCapabilityMutationPort(catalog);
    port.register(legacyToCanonicalDefinition(makeLegacyCap()));
    port.unregister("tool.file.read");
    expect(catalog.has("tool.file.read")).toBe(false);
  });

  it("unregister of an unknown id is a silent no-op", () => {
    const port = new CatalogBackedCapabilityMutationPort(catalog);
    expect(() => port.unregister("nope.missing")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/capability/mutation-port.vitest.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import type { CapabilityCatalog } from "./canonical/catalog.js";
import type { CapabilityDefinition } from "./canonical/definition.js";

/** Mutation boundary seam (CAP-3): register/unregister route here, NOT into
 *  the registry's own state. CAP-3 ships the catalog-backed implementation.
 *  CAP-6 replaces this port's implementation with the A4-governed mutation
 *  boundary (CapabilityMutationExecutor); no consumer-facing registry mutation
 *  API may bypass the port after CAP-6. Bootstrap/compatibility ONLY — no A4
 *  authorization, governance, or mutation-ledger semantics in this CAP. */
export interface CapabilityMutationPort {
  register(def: CapabilityDefinition): void;
  unregister(id: string): void;
}

/** CAP-3 implementation: the catalog is already the mutation authority. The
 *  registry never writes the catalog itself; it forwards through this port.
 *  register is IDEMPOTENT — a duplicate id@version is a no-op (bootstrap
 *  seeding may re-run; the store rejects duplicate id@version). */
export class CatalogBackedCapabilityMutationPort implements CapabilityMutationPort {
  constructor(private readonly catalog: CapabilityCatalog) {}

  register(def: CapabilityDefinition): void {
    if (this.catalog.has(def.id)) return; // idempotent bootstrap seeding
    this.catalog.register(def, def.bindings[0]);
  }

  unregister(id: string): void {
    if (!this.catalog.has(id)) return; // silent no-op on unknown id
    this.catalog.remove(id);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/capability/mutation-port.vitest.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm exec tsc --noEmit` — exit 0.
Commit:
```bash
git add src/capability/mutation-port.ts tests/capability/mutation-port.vitest.ts
git commit -m "feat(capability): CAP-3 catalog-backed bootstrap mutation port"
```

---

### Task 3: Registry refactor — canonical projection + legacy adapter

**Files:**
- Modify: `src/capability/registry.ts` (entire file)
- Test: `tests/capability/registry.vitest.ts` (update existing), `tests/capability/registry-projection.vitest.ts` (NEW)

**Interfaces:**
- Consumes: `CapabilityCatalog` (`./canonical/catalog.js`), `CapabilityDefinition` (`./canonical/definition.js`), `LifecycleState` (`../adaptation/capability-evolution-types.js`), `canonicalToLegacyCapability` + `legacyToCanonicalDefinition` (Task 1), `CapabilityMutationPort` (Task 2), `Capability` + `CapabilityStatus` + `Permission` (`./types.js`).
- Produces: canonical `get(id) / listRegistered() / queryRegistered() / getLifecycleState(id) / setLifecycleState(id, state) / clearLifecycleState(id) / listLifecycleStates() / getAvailability(id) / getProviders() / getAvailableProviders(id) / export() / import(entries)`; legacy `find(id) / list() / describe(id) / query(q) / register(cap) / unregister(id) / setStatus(id, s) / getStatus(id) / watch(cb) / attach(bus) / reload()`. runtime.ts + execution-resolver.ts use `find()` unchanged.

**Design (user-approved):**
```text
Registry
  └── Map<CapabilityId, RegisteredCapability>   // single canonical model
            │  definition  (from catalog)
            │  lifecycle   (registry current state — NOT A7 overlay)
            │  availability
            └── bindings
  legacy methods → canonicalToLegacyCapability() derived on demand
  register/unregister → CapabilityMutationPort (bootstrap only)
```

- [ ] **Step 1: Write the failing test** (`tests/capability/registry-projection.vitest.ts`)

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityCatalog } from "../../src/capability/canonical/catalog.js";
import { CapabilityDefinitionStore } from "../../src/capability/canonical/catalog-store.js";
import { CapabilityRegistry } from "../../src/capability/registry.js";
import { CatalogBackedCapabilityMutationPort } from "../../src/capability/mutation-port.js";
import { legacyToCanonicalDefinition } from "../../src/capability/legacy-adapter.js";
import type { Capability } from "../../src/capability/types.js";

function makeLegacyCap(): Capability {
  return { id: "tool.file.read", version: "1.0", kind: "tool", title: "Read file", description: "d",
    tags: [], category: "file", risk: "low", requiredPermissions: ["developer"],
    execution: { strategy: "tool" }, extensions: { toolName: "file.read" } };
}

function makeRegistry(dir: string): { catalog: CapabilityCatalog; registry: CapabilityRegistry } {
  const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  const registry = new CapabilityRegistry(catalog);
  registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
  return { catalog, registry };
}

describe("CAP-3 registry projection", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "cap3-reg-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("list() == catalog current state (registry owns no independent definitions)", () => {
    const { catalog, registry } = makeRegistry(dir);
    registry.register(makeLegacyCap());
    expect(registry.list()).toHaveLength(1);
    expect(catalog.list()).toHaveLength(1);            // register went through the port → catalog
    expect(registry.list()[0]!.id).toBe("tool.file.read");
    // Remove from the catalog directly → registry reflects it (projection)
    catalog.remove("tool.file.read");
    expect(registry.list()).toHaveLength(0);
  });

  it("canonical get() returns RegisteredCapability with lifecycle + availability + bindings", () => {
    const { registry } = makeRegistry(dir);
    registry.register(makeLegacyCap());
    const rc = registry.get("tool.file.read");
    expect(rc?.definition.id).toBe("tool.file.read");
    expect(rc?.lifecycle).toBe("emerging");            // default current state
    expect(rc?.availability.enabled).toBe(true);
    expect(rc?.bindings[0]?.type).toBe("tool");
  });

  it("lifecycle state is registry current state (set/get authority, not A7 overlay)", () => {
    const { registry } = makeRegistry(dir);
    registry.register(makeLegacyCap());
    expect(registry.getLifecycleState("tool.file.read")).toBe("emerging");
    registry.setLifecycleState("tool.file.read", "active");
    expect(registry.getLifecycleState("tool.file.read")).toBe("active");
    expect(registry.listLifecycleStates()).toEqual([{ capabilityId: "tool.file.read", state: "active" }]);
  });

  it("setLifecycleState on an unknown id throws", () => {
    const { registry } = makeRegistry(dir);
    expect(() => registry.setLifecycleState("nope", "active")).toThrow(/unknown/i);
  });

  it("legacy adapter derives Capability and never mutates canonical state", () => {
    const { registry } = makeRegistry(dir);
    registry.register(makeLegacyCap());
    const legacy = registry.find("tool.file.read");
    expect(legacy?.extensions?.toolName).toBe("file.read"); // recovered from binding.config
    legacy!.kind = "core";                                  // mutating the derived object...
    expect(registry.get("tool.file.read")?.definition.kind).toBe("operation"); // ...does NOT touch canonical
  });

  it("query() still filters over legacy-derived capabilities", () => {
    const { registry } = makeRegistry(dir);
    registry.register(makeLegacyCap());
    expect(registry.query({ category: "file" })).toHaveLength(1);
    expect(registry.query({ category: "session" })).toHaveLength(0);
  });

  it("getProviders() = distinct binding provider types; getAvailableProviders() filters by bound executor", () => {
    const { registry } = makeRegistry(dir);
    registry.register(makeLegacyCap()); // binding type "tool"
    registry.register({ ...makeLegacyCap(), id: "core.session.list", kind: "core", execution: { strategy: "native" }, extensions: undefined });
    expect(registry.getProviders().sort()).toEqual(["native", "tool"]); // declarative — no CAP-4 semantics
    const exec = new Set(["native"]); // only native is bound in this fake executor registry
    expect(registry.getAvailableProviders("core.session.list", (t) => exec.has(t))).toEqual(["native"]);
    expect(registry.getAvailableProviders("tool.file.read", (t) => exec.has(t))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/capability/registry-projection.vitest.ts`
Expected: FAIL — `new CapabilityRegistry(catalog)` / `setMutationPort` / `get` / `setLifecycleState` not found.

- [ ] **Step 3: Write the refactored registry** (`src/capability/registry.ts` — full replacement)

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { CapabilityValidationError } from "./errors.js";
import type { EventBus } from "./event-bus.js";
import type { Capability, CapabilityStatus, Permission } from "./types.js";
import type { LifecycleState } from "../adaptation/capability-evolution-types.js";
import type { CapabilityDefinition } from "./canonical/definition.js";
import type { CapabilityCatalog } from "./canonical/catalog.js";
import type { CapabilityProviderBinding, ProviderType } from "./canonical/provider.js";
import { canonicalToLegacyCapability, legacyToCanonicalDefinition } from "./legacy-adapter.js";
import type { CapabilityMutationPort } from "./mutation-port.js";

/** CAP-3 canonical availability (design §15). Declarative only — CAP-4 owns
 *  the full R1 availability concept (health, fallback, ordered providers). */
export interface CapabilityAvailability {
  enabled: boolean;
  reason?:
    | "missing_binding"
    | "binding_unavailable"
    | "deprecated"
    | "disabled"
    | "dependency_unavailable"
    | "authorization"
    | "runtime_error";
}

/** Single canonical registry model (user-approved): one map, definition from
 *  the catalog + lifecycle + availability + bindings. Legacy Capability is
 *  DERIVED on demand — never stored in a parallel map. */
export interface RegisteredCapability {
  definition: CapabilityDefinition;
  lifecycle: LifecycleState;
  availability: CapabilityAvailability;
  bindings: CapabilityProviderBinding[];
}

export interface CapabilityQuery {
  text?: string;
  tags?: string[];
  category?: string;
  risk?: string;
  permissions?: Permission;
  kinds?: string[];
  namespaces?: string[];
}

export interface CapabilityManifest {
  version: 1;
  generatedAt: string;
  functions: Capability[];
}

const DEFAULT_LIFECYCLE: LifecycleState = "emerging";

/** Rejects invalid IDs. Allowed: core.session.list, tool.file.read,
 *  mcp.github.issue.create. Rejected: SessionList, foo, ../../bad. */
const CAPABILITY_ID = /^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/;

/** Canonical registry — runtime projection of the CAP-2 catalog.
 *  Exactly one instance per runtime universe (composition root = platform.ts).
 *  The registry stores NO definitions independently; `list()` == catalog state.
 *  Legacy find/list/query/register are a TEMPORARY adapter over canonical state. */
export class CapabilityRegistry {
  private entries = new Map<string, RegisteredCapability>();
  private readonly status = new Map<string, CapabilityStatus>();
  private watchers = new Set<(evt: { type: "registered" | "removed"; capabilityId: string }) => void>();
  private bus?: EventBus;
  private mutationPort?: CapabilityMutationPort;
  private providerBound?: (type: string) => boolean;

  constructor(private readonly catalog: CapabilityCatalog) {}

  /** Composition-root wiring (CAP-3). CAP-6 replaces the port implementation
   *  with A4-governed execution; no mutation API bypasses this port. */
  setMutationPort(port: CapabilityMutationPort): void {
    this.mutationPort = port;
  }

  /** Optional executor-availability probe (wired by platform from ExecutorRegistry).
   *  Used ONLY by getAvailableProviders — declarative, no CAP-4 fallback/health. */
  setProviderBound(fn: (type: string) => boolean): void {
    this.providerBound = fn;
  }

  private refresh(): void {
    const next = new Map<string, RegisteredCapability>();
    for (const def of this.catalog.list()) {
      const prev = this.entries.get(def.id);
      next.set(def.id, {
        definition: def,
        lifecycle: prev?.lifecycle ?? DEFAULT_LIFECYCLE,
        availability: prev?.availability ?? { enabled: true },
        bindings: def.bindings,
      });
    }
    this.entries = next;
  }

  private ensureEntry(id: string): RegisteredCapability {
    this.refresh();
    const entry = this.entries.get(id);
    if (!entry) throw new CapabilityValidationError(`Unknown capability id: ${id}`);
    return entry;
  }

  // ── Canonical API ────────────────────────────────────────────────

  get(id: string): RegisteredCapability | undefined {
    this.refresh();
    return this.entries.get(id);
  }

  listRegistered(): RegisteredCapability[] {
    this.refresh();
    return [...this.entries.values()];
  }

  queryRegistered(q: CapabilityQuery = {}): RegisteredCapability[] {
    return this.query(q).map((c) => this.get(c.id)!).filter(Boolean);
  }

  getLifecycleState(id: string): LifecycleState | undefined {
    return this.get(id)?.lifecycle;
  }

  /** Lifecycle current-state authority (#481). This IS the registry's own
   *  state — not an A7 overlay. The A7 ledger remains history only. */
  setLifecycleState(id: string, to: LifecycleState): void {
    const entry = this.ensureEntry(id);
    entry.lifecycle = to;
  }

  /** A7 compatibility alias (deprecated). 3 production files call
   *  applyLifecycleTransition (rehydration, step-executor) and are outside
   *  CAP-3's file allowlist — this alias keeps them working unmodified while
   *  lifecycle state lives in ONE authority (setLifecycleState). */
  applyLifecycleTransition(id: string, to: LifecycleState): void {
    this.setLifecycleState(id, to);
  }

  clearLifecycleState(id: string): void {
    const entry = this.entries.get(id);
    if (entry) entry.lifecycle = DEFAULT_LIFECYCLE;
  }

  listLifecycleStates(): { capabilityId: string; state: LifecycleState }[] {
    this.refresh();
    return [...this.entries.entries()]
      .map(([capabilityId, e]) => ({ capabilityId, state: e.lifecycle }))
      .sort((a, b) => (a.capabilityId < b.capabilityId ? -1 : a.capabilityId > b.capabilityId ? 1 : 0));
  }

  getAvailability(id: string): CapabilityAvailability | undefined {
    return this.get(id)?.availability;
  }

  /** Declarative provider read (CAP-3, no CAP-4 semantics): the distinct
   *  binding provider types referenced by currently registered definitions. */
  getProviders(): ProviderType[] {
    const types = new Set<ProviderType>();
    for (const rc of this.listRegistered()) for (const b of rc.bindings) types.add(b.type);
    return [...types];
  }

  /** Declarative: this capability's bindings whose provider type has a bound
   *  executor (via the injected providerBound probe). NOT health/fallback. */
  getAvailableProviders(id: string, bound?: (type: string) => boolean): ProviderType[] {
    const rc = this.get(id);
    if (!rc) return [];
    const probe = bound ?? this.providerBound ?? (() => false);
    return rc.bindings.map((b) => b.type).filter((t) => probe(t));
  }

  export(): CapabilityManifest {
    return { version: 1, generatedAt: new Date().toISOString(), functions: this.list() };
  }

  /** Idempotent bulk import (bootstrap). Routes through the mutation port. */
  import(entries: Array<Capability | CapabilityDefinition>): void {
    for (const e of entries) {
      const isLegacy = "execution" in e;
      const def = isLegacy ? legacyToCanonicalDefinition(e as Capability) : (e as CapabilityDefinition);
      this.mutationPort?.register(def);
    }
    this.refresh();
  }

  // ── Temporary legacy adapter (derived, never stored) ─────────────

  attach(bus: EventBus): void { this.bus = bus; }

  register(capability: Capability): void {
    if (!CAPABILITY_ID.test(capability.id)) {
      throw new CapabilityValidationError(`Invalid capability id: ${capability.id} (must match ${CAPABILITY_ID.source})`);
    }
    if (!this.mutationPort) throw new CapabilityValidationError(`No mutation port wired — register() is bootstrap-only (CAP-3)`);
    this.mutationPort.register(legacyToCanonicalDefinition(capability));
    this.refresh();
    for (const w of this.watchers) w({ type: "registered", capabilityId: capability.id });
    this.bus?.emit({ type: "CapabilityRegistered", capabilityId: capability.id, at: Date.now() });
  }

  unregister(id: string): void {
    this.mutationPort?.unregister(id);
    this.refresh();
    this.status.delete(id);
    this.entries.delete(id);
    for (const w of this.watchers) w({ type: "removed", capabilityId: id });
    this.bus?.emit({ type: "CapabilityRemoved", capabilityId: id, at: Date.now() });
  }

  find(id: string): Capability | undefined {
    const rc = this.get(id);
    if (!rc) return undefined;
    return canonicalToLegacyCapability(rc.definition);
  }

  list(): Capability[] { return this.listRegistered().map((rc) => this.find(rc.definition.id)!).filter(Boolean); }

  describe(id: string): Capability | undefined { return this.find(id); }

  query(q: CapabilityQuery = {}): Capability[] {
    let results = this.list();
    if (q.text) {
      const t = q.text.toLowerCase();
      results = results.filter(c =>
        c.id.toLowerCase().includes(t) ||
        c.title.toLowerCase().includes(t) ||
        c.description.toLowerCase().includes(t) ||
        (c.aliases ?? []).some(a => a.toLowerCase().includes(t)));
    }
    if (q.tags?.length) results = results.filter(c => q.tags!.some(t => c.tags.includes(t)));
    if (q.category) results = results.filter(c => c.category === q.category);
    if (q.risk) results = results.filter(c => c.risk === q.risk);
    const perm = q.permissions;
    if (perm) results = results.filter(c => c.requiredPermissions.includes(perm));
    if (q.kinds?.length) results = results.filter(c => q.kinds!.includes(c.kind));
    if (q.namespaces?.length) results = results.filter(c => q.namespaces!.some(ns => c.id.startsWith(`${ns}.`)));
    return results;
  }

  setStatus(id: string, s: { availability?: CapabilityStatus["availability"]; health?: CapabilityStatus["health"] }): void {
    const prev = this.status.get(id);
    const next: CapabilityStatus = {
      capabilityId: id,
      availability: s.availability ?? prev?.availability ?? "available",
      health: s.health ?? prev?.health ?? "healthy",
      lastChecked: Date.now(),
    };
    this.status.set(id, next);
  }

  getStatus(id: string): CapabilityStatus | undefined { return this.status.get(id); }

  reload(): void { this.refresh(); }

  watch(cb: (evt: { type: "registered" | "removed"; capabilityId: string }) => void): () => void {
    this.watchers.add(cb);
    return () => this.watchers.delete(cb);
  }
}
```

- [ ] **Step 4: Fix existing `tests/capability/registry.vitest.ts`**

The old test constructs `new CapabilityRegistry()` with no args. Update its setup to use a temp-dir catalog + mutation port (same pattern as `makeRegistry` above). Preserve every existing assertion (`register`/`unregister`/`find`/`query`/`watch`/`export`/invalid-id). If a test asserted `applyLifecycleTransition`, rename to `setLifecycleState` (same semantics).

- [ ] **Step 5: Run both registry suites + typecheck**

Run: `pnpm vitest run tests/capability/registry.vitest.ts tests/capability/registry-projection.vitest.ts`
Expected: all PASS.
Run: `pnpm exec tsc --noEmit` — exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/capability/registry.ts tests/capability/registry.vitest.ts tests/capability/registry-projection.vitest.ts
git commit -m "feat(capability): CAP-3 registry as canonical catalog projection + legacy adapter"
```

---

### Task 4: platform.ts composition root + runtime read-path verification

**Files:**
- Modify: `src/capability/platform.ts`
- Verify (no behavior change): `src/capability/runtime.ts`, `src/capability/execution-resolver.ts` — both use `registry.find()` which still works through the adapter.
- Test: `tests/capability/platform-projection.vitest.ts` (NEW)

**Interfaces:**
- Consumes: `CapabilityCatalog` + `CapabilityDefinitionStore` (canonical), `CapabilityRegistry`, `CatalogBackedCapabilityMutationPort`, existing HookRegistry/ExecutorRegistry/NativeExecutor/ExecutionResolver/CapabilityRuntime.
- Produces: `new CapabilityPlatform(opts?: { catalogDir?: string; catalog?: CapabilityCatalog })` — platform becomes the composition root: `load catalog → build registry → wire port → resolve bindings`.

- [ ] **Step 1: Write the failing test** (`tests/capability/platform-projection.vitest.ts`)

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityPlatform } from "../../src/capability/platform.js";

describe("CAP-3 platform composition root", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "cap3-plat-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("boots catalog → registry → runtime; register is bootstrap-only through the port", async () => {
    const platform = new CapabilityPlatform({ catalogDir: dir });
    platform.register({ id: "core.session.list", version: "1.0", kind: "core", title: "List sessions",
      description: "d", tags: [], category: "session", risk: "low", requiredPermissions: ["operator"],
      execution: { strategy: "native" } });
    expect(platform.registry.list()).toHaveLength(1);
    expect(platform.find("core.session.list")?.id).toBe("core.session.list");
    // Second identical registration (bootstrap re-run) is a silent no-op
    platform.register({ id: "core.session.list", version: "1.0", kind: "core", title: "List sessions",
      description: "d", tags: [], category: "session", risk: "low", requiredPermissions: ["operator"],
      execution: { strategy: "native" } });
    expect(platform.registry.list()).toHaveLength(1);
  });

  it("registry persists through the catalog (fresh platform reloads it)", () => {
    const p1 = new CapabilityPlatform({ catalogDir: dir });
    p1.register({ id: "tool.file.read", version: "1.0", kind: "tool", title: "Read file", description: "d",
      tags: [], category: "file", risk: "low", requiredPermissions: ["developer"], execution: { strategy: "tool" } });
    const p2 = new CapabilityPlatform({ catalogDir: dir });
    expect(p2.registry.list()).toHaveLength(1);
    expect(p2.find("tool.file.read")?.kind).toBe("tool");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/capability/platform-projection.vitest.ts`
Expected: FAIL — `new CapabilityPlatform({ catalogDir })` rejects the arg (current ctor takes none).

- [ ] **Step 3: Rewrite platform.ts as composition root**

```ts
// src/capability/platform.ts
import { CapabilityRegistry } from "./registry.js";
import { HookRegistry } from "./hook-registry.js";
import { ExecutionResolver } from "./execution-resolver.js";
import { CapabilityRuntime } from "./runtime.js";
import { ExecutorRegistry, NativeExecutor, type CapabilityExecutor } from "./executors.js";
import { EventBus } from "./event-bus.js";
import type { CapabilityQuery } from "./registry.js";
import type { Capability, CapabilityContext, Invocation } from "./types.js";
import { CapabilityCatalog } from "./canonical/catalog.js";
import { CapabilityDefinitionStore } from "./canonical/catalog-store.js";
import { CatalogBackedCapabilityMutationPort } from "./mutation-port.js";
import { join } from "node:path";

/** Composition root (CAP-3, Stage 3): load catalog → build registry → wire
 *  mutation port → resolve bindings. Exactly ONE CapabilityRegistry per runtime
 *  universe lives here. Consumers construct a platform, never a registry. */
export class CapabilityPlatform {
  readonly registry: CapabilityRegistry;
  readonly hooks = new HookRegistry();
  readonly executors = new ExecutorRegistry();
  readonly events = new EventBus();
  readonly native = new NativeExecutor();
  readonly catalog: CapabilityCatalog;

  private readonly resolver: ExecutionResolver;
  private readonly runtime: CapabilityRuntime;

  constructor(opts: { catalogDir?: string; catalog?: CapabilityCatalog } = {}) {
    this.catalog = opts.catalog ?? new CapabilityCatalog(new CapabilityDefinitionStore({ dir: opts.catalogDir ?? join(process.cwd(), ".alix", "capabilities") }));
    this.registry = new CapabilityRegistry(this.catalog);
    this.registry.setMutationPort(new CatalogBackedCapabilityMutationPort(this.catalog));
    this.registry.setProviderBound((type) => this.executors.get(type) !== undefined);
    this.registry.attach(this.events);
    this.executors.register("native", this.native);
    this.resolver = new ExecutionResolver(this.registry);
    this.runtime = new CapabilityRuntime(this.registry, this.hooks, this.resolver, this.executors, this.events);
  }

  register(capability: Capability): void { this.registry.register(capability); }
  find(id: string): Capability | undefined { return this.registry.find(id); }
  query(q: CapabilityQuery = {}): Capability[] { return this.registry.query(q); }

  invoke(
    capabilityId: string,
    args: Record<string, unknown>,
    overrides: Partial<Pick<CapabilityContext, "actor" | "cwd" | "workspace" | "sessionId" | "permissions">>,
  ): Invocation {
    return this.runtime.invoke(capabilityId, args, overrides);
  }

  registerExecutor(strategy: string, executor: CapabilityExecutor): void {
    this.executors.register(strategy, executor);
  }
}
```

- [ ] **Step 4: Verify runtime.ts + execution-resolver.ts read paths**

Both use `registry.find(capabilityId)` / `registry.find(depId)` — still served by the legacy adapter with identical shapes. Run their suites unchanged; NO source edits expected. If any type-level coupling appears (`CapabilityRegistry` type import is fine), fix the minimal surface.

Run: `pnpm vitest run tests/capability/runtime.vitest.ts tests/capability/execution-resolver.vitest.ts tests/capability/initial-capabilities.vitest.ts`
Expected: all PASS (behavior unchanged).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm exec tsc --noEmit` — exit 0.
Commit:
```bash
git add src/capability/platform.ts tests/capability/platform-projection.vitest.ts
git commit -m "feat(capability): CAP-3 platform composition root (catalog→registry→runtime)"
```

---

### Task 5: CLI second-registry removal + single-instance structural test

**Files:**
- Modify: `src/cli.ts` (the `alix capabilities` block), `src/capability/index.ts` (barrel)
- Test: `tests/capability/single-registry.vitest.ts` (NEW)

**Interfaces:**
- Consumes: composition root from Task 4. Produces: no second `new CapabilityRegistry()` anywhere outside `platform.ts`; barrel exports the new types.

- [ ] **Step 1: Write the structural test** (`tests/capability/single-registry.vitest.ts`)

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** AC#12 — structural composition check. The ONLY place a CapabilityRegistry
 *  is constructed is the platform composition root. This scans source (not
 *  tests) for `new CapabilityRegistry(` outside platform.ts. */
describe("exactly one canonical CapabilityRegistry per runtime universe", () => {
  const ROOT = join(process.cwd(), "src");
  const EXCLUDED = new Set(["capability/registry.ts", "capability/platform.ts"]);

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const ent of readdirSync(dir)) {
      const p = join(dir, ent);
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
    }
    return out;
  }

  it("no `new CapabilityRegistry(` outside the platform composition root", () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const rel = file.replace(process.cwd() + "/", "");
      if (EXCLUDED.has(rel)) continue;
      const src = readFileSync(file, "utf-8");
      // imports of the class are fine; construction is not
      const m = src.match(/new\s+CapabilityRegistry\s*\(/);
      if (m) offenders.push(`${rel}:${src.slice(0, m.index).split("\n").length}`);
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/capability/single-registry.vitest.ts`
Expected: FAIL — lists `src/cli.ts:<line>` (the second registry).

- [ ] **Step 3: Remove the CLI second registry** (`src/cli.ts`)

Replace the `alix capabilities` block (currently `const registry = new CapabilityRegistry(); const ledger = ...; const store = ...; await rehydrateLifecycleOverlay(registry, ledger);`) so it builds the composition root ONCE from the project dir:

```ts
if (command === "capabilities") {
  const { handleCapabilitiesCommand } = await import("./cli/commands/capabilities.js");
  const { CapabilityPlatform } = await import("./capability/platform.js");
  const { JsonlCapabilityLifecycleLedger, DEFAULT_CAPABILITY_LIFECYCLE_FILE } =
    await import("./evolution/capability-lifecycle/capability-lifecycle-ledger.js");
  const { CapabilityEvolutionStore } = await import("./adaptation/capability-evolution-store.js");
  const { rehydrateLifecycleOverlay } =
    await import("./evolution/capability-lifecycle/capability-lifecycle-rehydration.js");
  const cwd = process.cwd();
  const platform = new CapabilityPlatform({ catalogDir: join(cwd, ".alix", "capabilities") });
  const ledger = new JsonlCapabilityLifecycleLedger(DEFAULT_CAPABILITY_LIFECYCLE_FILE);
  const store = new CapabilityEvolutionStore(join(cwd, ".alix", "capability-evolution"));
  await rehydrateLifecycleOverlay(platform.registry, ledger);
  await handleCapabilitiesCommand(args, { cwd, ledger, registry: platform.registry, store });
  process.exit(0);
}
```

Confirm `join` is already imported in `cli.ts` (it is — used elsewhere). Remove the now-unused `CapabilityRegistry` import from `src/capability/registry.js` in this block if it became orphaned.

- [ ] **Step 4: Barrel exports** (`src/capability/index.ts`)

`registry.ts` is already re-exported via `export * from "./registry.js"` — so `RegisteredCapability`/`CapabilityAvailability` flow through automatically once Task 3 defines them (do NOT add a second explicit export — duplicate-export error). Just add the two new modules:
`export * from "./legacy-adapter.js"; export * from "./mutation-port.js";`

- [ ] **Step 5: Run structural test + full capability suite + typecheck**

Run: `pnpm vitest run tests/capability/single-registry.vitest.ts` — PASS.
Run: `pnpm vitest run tests/capability/ tests/capability/canonical/` — all green.
Run: `pnpm exec tsc --noEmit` — exit 0.
Also run the A7 lifecycle suites that consume the registry: `pnpm vitest run tests/evolution/capability-lifecycle/` — must stay green (they use `applyLifecycleTransition`→`setLifecycleState`; if a test still calls the old name, update it in this task).

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts src/capability/index.ts tests/capability/single-registry.vitest.ts
git commit -m "feat(capability): CAP-3 CLI shares composition root; single-registry structural test"
```

---

## Self-Review

**Spec coverage (ticket #487 + user rulings):**
- [x] Registry is runtime projection: `register/unregister/get/list/query/getLifecycleState/setLifecycleState/getProviders/getAvailableProviders/export/import` — Task 3 (all 11 on the surface; `getProviders`/`getAvailableProviders` declarative per user ruling).
- [x] `list()` == catalog current state; registry owns definitions only via catalog — Task 3 (projection test: catalog.remove → registry reflects).
- [x] Lifecycle state is current registry state, not A7 overlay — Task 3 (`setLifecycleState` authority; `listLifecycleStates` reads registry state; ledger stays history).
- [x] Exactly one registry instance; CLI second registry removed — Task 5 (structural test + cli.ts rewire).
- [x] Mutations flow through CAP-6 boundary → CAP-3 establishes the catalog-backed bootstrap port (user ruling: CAP-6 replaces the port impl; no mutation API bypasses it after CAP-6) — Task 2 + Task 3.
- [x] Legacy adapter is derived, never stored — Task 1 + Task 3 (mutation-of-derived-object test proves isolation).
- [x] register() bootstrap-only (no A4/governance) — Task 2 port contract + Task 3 `setMutationPort` guard.
- [x] Existing runtime bootstrap capabilities remain available — Task 4 (platform boots + idempotent seeding).
- [x] No requirement to migrate all 19 consumers — Task 4 verification (runtime/resolver/initial-caps suites unchanged).
- [x] CAP-4/6/8 own subsequent consumer migrations — noted in plan.

**Placeholder scan:** All steps have exact code; no TBD/TODO.

**Type consistency:** `applyLifecycleTransition` is RETAINED as a delegating alias (3 production callers outside the allowlist). `setLifecycleState`/`getLifecycleState`/`clearLifecycleState`/`listLifecycleStates` signatures match what `src/evolution/capability-lifecycle/*` calls. `find`/`list`/`query`/`register`/`unregister`/`export` keep legacy shapes. `get(id)` returns `RegisteredCapability | undefined` (design §14). `CapabilityQuery` stays exported from registry.ts (consumers import it from there).

**Known seam (documented, not a defect):** `canonicalToLegacyCapability` cannot recover `aliases`/`examples` (no canonical home) — acceptable for a temporary adapter; CAP-8's full consumer migration removes the adapter entirely. `execution.timeout`/`cancellable` ARE recovered via `binding.config` (lossless). The `extensions` object now also includes `timeout`/`cancellable` keys — verify no executor misreads `extensions.timeout` as a domain extension (none do today; NativeExecutor reads id+handler, ToolExecutor reads extensions.toolName).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-11-cap-3-runtime-registry-projection.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task + review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session with batch checkpoints.
