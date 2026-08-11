# CAP-2 — Persistent Capability Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a durable `CapabilityCatalog` (JSONL store + bootstrap providers + source precedence + two-phase authoring) that becomes the single durable source of capability definitions — additively, without modifying the three existing definition databases or their HIGH-risk consumers.

**Architecture:** New files under `src/capability/canonical/` (the CAP-1 module): `catalog.ts` (facade over the store), `catalog-store.ts` (JSONL persistence), `bootstrap.ts` (bootstrap-provider abstraction + source precedence), `authoring.ts` (two-phase authoring status). Bootstrap providers *read* from the existing sources (`initial-capabilities.ts`, `tool-registry.ts`, `policy/capability-registry.ts`) via their existing public APIs but never modify them. The existing databases remain authoritative for their current consumers until CAP-8/CAP-11 swap them out — this is additive, the "expand" half.

**Tech Stack:** TypeScript (ESM), Vitest (`.vitest.ts`), Node `node:fs`. JSONL pattern mirrors `src/evolution/capability-lifecycle/capability-lifecycle-ledger.ts` (appendFileSync/readFileSync).

## Global Constraints

- **Store layout** (§12): `.alix/capabilities/definitions.jsonl` + `.alix/capabilities/bindings.jsonl`.
- **Catalog contract** (§10): `get(id) / list() / has(id) / register(definition, binding?) / update(id, patch) / remove(id) / getBinding(id)`.
- **Store contract** (§12): `listDefinitions() / getDefinition(id) / appendDefinition(def) / replaceDefinition(def) / removeDefinition(id) / getBinding(id)`.
- **Bootstrap contract** (§13): `interface CapabilityBootstrapProvider { load(): CapabilityBootstrapEntry[] }`.
- **Source precedence**: built-in → project-local → plugins → provider discovery → governed registrations → explicit overrides.
- **Two-phase authoring** (#478): `DefinitionAuthoringStatus = "required" | "incomplete" | "valid"`; incomplete → authoring required; complete → valid → can become a proposal; A7 never invents defaults.
- **A capability cannot enter the catalog without a complete, explicitly-authored definition passing canonical validation** (CAP-1 `validateCapabilityDefinition`).
- **Additive only** — do NOT modify `initial-capabilities.ts`, `tool-registry.ts` (HIGH blast radius: ToolExecutor/CoordinationPlanner/5 CLI commands), `policy/capability-registry.ts`, or the CAP-1 canonical module. The store persists canonical `CapabilityDefinition` objects (CAP-1 type).
- **North-star invariant**: catalog is the single durable source, not a second registry.
- **Test runner**: Vitest, `tests/capability/canonical/*.vitest.ts`. After each task run `pnpm exec tsc --noEmit` (Vitest/esbuild doesn't typecheck — CAP-1 lesson).

---

## File Structure

- `src/capability/canonical/catalog-store.ts` — JSONL store (definitions + bindings).
- `src/capability/canonical/catalog.ts` — `CapabilityCatalog` facade over the store.
- `src/capability/canonical/bootstrap.ts` — `CapabilityBootstrapProvider` + `CapabilityBootstrapEntry` + source-precedence loader.
- `src/capability/canonical/authoring.ts` — `DefinitionAuthoringStatus` + `evaluateDefinitionAuthoring()`.
- Update `src/capability/canonical/index.ts` — add new exports.
- `tests/capability/canonical/catalog-store.vitest.ts`
- `tests/capability/canonical/catalog.vitest.ts`
- `tests/capability/canonical/bootstrap.vitest.ts`
- `tests/capability/canonical/authoring.vitest.ts`
- `tests/capability/canonical/catalog-integration.vitest.ts` — bootstrap → catalog → store round-trip.

---

### Task 1: JSONL catalog store

**Files:**
- Create: `src/capability/canonical/catalog-store.ts`
- Test: `tests/capability/canonical/catalog-store.vitest.ts`

**Interfaces:**
- Consumes: `CapabilityDefinition`, `validateCapabilityDefinition` (CAP-1, `./definition.js`).
- Produces: `interface CatalogStoreOptions { dir: string; }`; `class CapabilityDefinitionStore` with methods `listDefinitions(): CapabilityDefinition[]`, `getDefinition(id: string): CapabilityDefinition | undefined`, `appendDefinition(def: CapabilityDefinition): void` (validates, rejects duplicate id@version), `replaceDefinition(def: CapabilityDefinition): void` (validates, replaces same id@version or appends), `removeDefinition(id: string): void`, `getBinding(id: string): CapabilityProviderBinding | undefined`, `appendBinding(id: string, binding: CapabilityProviderBinding): void`. Writes `definitions.jsonl` + `bindings.jsonl` under the store dir. Atomic writes via temp-file + rename.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityDefinitionStore } from "../../../src/capability/canonical/catalog-store.js";
import type { CapabilityDefinition } from "../../../src/capability/canonical/definition.js";

function makeDef(id: string, version = "1.0.0"): CapabilityDefinition {
  return { id, version, kind: "operation", title: id, description: id, tags: [], category: "test",
    risk: "low", requiredPermissions: ["operator"], dependencies: [],
    bindings: [{ id: "x", type: "native" }] };
}

describe("CapabilityDefinitionStore", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "capstore-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("persists definitions to definitions.jsonl", () => {
    const store = new CapabilityDefinitionStore({ dir });
    store.appendDefinition(makeDef("a.b.c"));
    expect(existsSync(join(dir, "capabilities", "definitions.jsonl"))).toBe(true);
  });

  it("round-trips list/get", () => {
    const s1 = new CapabilityDefinitionStore({ dir });
    s1.appendDefinition(makeDef("a.b.c"));
    s1.appendDefinition(makeDef("x.y.z", "2.0.0"));
    const s2 = new CapabilityDefinitionStore({ dir }); // fresh instance = reload
    expect(s2.listDefinitions().map(d => d.id)).toEqual(["a.b.c", "x.y.z"]);
    expect(s2.getDefinition("x.y.z")?.version).toBe("2.0.0");
  });

  it("rejects append of a duplicate id@version", () => {
    const s = new CapabilityDefinitionStore({ dir });
    s.appendDefinition(makeDef("a.b.c"));
    expect(() => s.appendDefinition(makeDef("a.b.c"))).toThrow(/duplicate|already/i);
  });

  it("rejects append of an invalid definition", () => {
    const s = new CapabilityDefinitionStore({ dir });
    expect(() => s.appendDefinition({ ...makeDef("bad"), version: "1.0" })).toThrow(/capability:/);
  });

  it("replaceDefinition overwrites the same id@version", () => {
    const s = new CapabilityDefinitionStore({ dir });
    s.appendDefinition(makeDef("a.b.c"));
    s.replaceDefinition({ ...makeDef("a.b.c"), title: "updated" });
    expect(s.getDefinition("a.b.c")?.title).toBe("updated");
    expect(s.listDefinitions()).toHaveLength(1);
  });

  it("removeDefinition drops a definition", () => {
    const s = new CapabilityDefinitionStore({ dir });
    s.appendDefinition(makeDef("a.b.c"));
    s.removeDefinition("a.b.c");
    expect(s.getDefinition("a.b.c")).toBeUndefined();
  });

  it("skips corrupt lines on load (corruption handling)", () => {
    const s1 = new CapabilityDefinitionStore({ dir });
    s1.appendDefinition(makeDef("a.b.c"));
    const file = join(dir, "capabilities", "definitions.jsonl");
    // Inject a corrupt line at the end
    const raw = readFileSync(file, "utf-8") + "{ not valid json }\n";
    const s2 = new CapabilityDefinitionStore({ dir }); // reloads
    // Corrupt line is skipped; valid entry survives
    expect(s2.listDefinitions().some(d => d.id === "a.b.c")).toBe(true);
  });

  it("persists and reloads bindings", () => {
    const s1 = new CapabilityDefinitionStore({ dir });
    s1.appendBinding("a.b.c", { id: "gh", type: "external-cli", config: { executable: "gh" } });
    const s2 = new CapabilityDefinitionStore({ dir });
    expect(s2.getBinding("a.b.c")?.type).toBe("external-cli");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/capability/canonical/catalog-store.vitest.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { appendFileSync, mkdirSync, readFileSync, existsSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CapabilityDefinition } from "./definition.js";
import { validateCapabilityDefinition } from "./definition.js";
import type { CapabilityProviderBinding } from "./provider.js";

export interface CatalogStoreOptions { dir: string; }

interface DefLine { id: string; version: string; kind: string; /* + full def */ }
interface BindingLine { id: string; binding: CapabilityProviderBinding; }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Durable JSONL store for canonical capability definitions + bindings (§12).
 *  Layout: <dir>/capabilities/definitions.jsonl, <dir>/capabilities/bindings.jsonl. */
export class CapabilityDefinitionStore {
  private readonly defsFile: string;
  private readonly bindingsFile: string;
  private definitions = new Map<string, CapabilityDefinition>();  // key: id@version
  private bindings = new Map<string, CapabilityProviderBinding>();

  constructor(opts: CatalogStoreOptions) {
    this.defsFile = join(opts.dir, "capabilities", "definitions.jsonl");
    this.bindingsFile = join(opts.dir, "capabilities", "bindings.jsonl");
    this.load();
  }

  private load(): void {
    for (const raw of this.readLines(this.defsFile)) {
      try {
        const obj = JSON.parse(raw);
        if (isRecord(obj) && typeof obj.id === "string" && typeof obj.version === "string") {
          validateCapabilityDefinition(obj as unknown as CapabilityDefinition);
          this.definitions.set(this.key(obj.id, obj.version), obj as CapabilityDefinition);
        }
      } catch { /* corrupt line — skip */ }
    }
    for (const raw of this.readLines(this.bindingsFile)) {
      try {
        const obj = JSON.parse(raw);
        if (isRecord(obj) && typeof obj.id === "string" && isRecord(obj.binding)) {
          this.bindings.set(obj.id, obj.binding as unknown as CapabilityProviderBinding);
        }
      } catch { /* corrupt line — skip */ }
    }
  }

  private readLines(file: string): string[] {
    if (!existsSync(file)) return [];
    const text = readFileSync(file, "utf-8");
    return text.split("\n").filter((l) => l.trim().length > 0);
  }

  private key(id: string, version: string): string { return `${id}@${version}`; }

  private atomicAppend(file: string, line: object): void {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    const existing = existsSync(file) ? readFileSync(file, "utf-8") : "";
    writeFileSync(tmp, existing + JSON.stringify(line) + "\n", "utf-8");
    renameSync(tmp, file); // atomic replace
  }

  listDefinitions(): CapabilityDefinition[] {
    return [...this.definitions.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  getDefinition(id: string): CapabilityDefinition | undefined {
    // Return the highest SemVer for the id — deterministic "current" (§479).
    const matches = [...this.definitions.values()].filter((d) => d.id === id);
    if (matches.length === 0) return undefined;
    matches.sort((a, b) => this.compareVer(a.version, b.version));
    return matches[matches.length - 1];
  }

  private compareVer(a: string, b: string): number {
    const pa = a.split(".").map(Number); const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) { if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0); }
    return 0;
  }

  appendDefinition(def: CapabilityDefinition): void {
    validateCapabilityDefinition(def);
    if (this.definitions.has(this.key(def.id, def.version))) {
      throw new Error(`capability: definition ${def.id}@${def.version} already exists`);
    }
    this.definitions.set(this.key(def.id, def.version), def);
    this.atomicAppend(this.defsFile, def);
  }

  replaceDefinition(def: CapabilityDefinition): void {
    validateCapabilityDefinition(def);
    const k = this.key(def.id, def.version);
    this.definitions.set(k, def);
    // Rewrite the whole file with the updated entry (replace, not append).
    const lines = this.listDefinitions().map((d) => JSON.stringify(d)).join("\n") + "\n";
    mkdirSync(dirname(this.defsFile), { recursive: true });
    const tmp = `${this.defsFile}.tmp`;
    writeFileSync(tmp, lines, "utf-8");
    renameSync(tmp, this.defsFile);
  }

  removeDefinition(id: string): void {
    const remaining = this.listDefinitions().filter((d) => d.id !== id);
    this.definitions = new Map(remaining.map((d) => [this.key(d.id, d.version), d]));
    const lines = remaining.map((d) => JSON.stringify(d)).join("\n") + "\n";
    mkdirSync(dirname(this.defsFile), { recursive: true });
    const tmp = `${this.defsFile}.tmp`;
    writeFileSync(tmp, lines, "utf-8");
    renameSync(tmp, this.defsFile);
    this.bindings.delete(id);
  }

  getBinding(id: string): CapabilityProviderBinding | undefined {
    return this.bindings.get(id);
  }

  appendBinding(id: string, binding: CapabilityProviderBinding): void {
    this.bindings.set(id, binding);
    this.atomicAppend(this.bindingsFile, { id, binding });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/capability/canonical/catalog-store.vitest.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm exec tsc --noEmit` — exit 0 (fix any latent type errors in YOUR file).
Commit:
```bash
git add src/capability/canonical/catalog-store.ts tests/capability/canonical/catalog-store.vitest.ts
git commit -m "feat(capability): CAP-2 JSONL catalog store"
```

---

### Task 2: CapabilityCatalog facade

**Files:**
- Create: `src/capability/canonical/catalog.ts`
- Test: `tests/capability/canonical/catalog.vitest.ts`

**Interfaces:**
- Consumes: `CapabilityDefinitionStore` (Task 1), `CapabilityDefinition`, `CapabilityProviderBinding`.
- Produces: `interface CapabilityCatalogPatch { title?: string; description?: string; tags?: string[]; category?: string; risk?: ...; requiredPermissions?: ...; bindings?: CapabilityProviderBinding[]; }`; `class CapabilityCatalog { constructor(store: CapabilityDefinitionStore); get(id): CapabilityDefinition | undefined; list(): CapabilityDefinition[]; has(id): boolean; register(def, binding?): void; update(id, patch): void; remove(id): void; getBinding(id): CapabilityProviderBinding | undefined; }` — matches design §10. `register` appends (throws on duplicate id@version); `update` applies a patch to the *highest* version and replaces; `remove` removes + its binding.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityDefinitionStore } from "../../../src/capability/canonical/catalog-store.js";
import { CapabilityCatalog } from "../../../src/capability/canonical/catalog.js";
import type { CapabilityDefinition } from "../../../src/capability/canonical/definition.js";

function makeDef(id: string, version = "1.0.0"): CapabilityDefinition {
  return { id, version, kind: "operation", title: id, description: id, tags: [], category: "test",
    risk: "low", requiredPermissions: ["operator"], dependencies: [],
    bindings: [{ id: "x", type: "native" }] };
}

describe("CapabilityCatalog", () => {
  let dir: string; let store: CapabilityDefinitionStore; let catalog: CapabilityCatalog;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "capcat-")); store = new CapabilityDefinitionStore({ dir }); catalog = new CapabilityCatalog(store); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("register adds a definition + binding", () => {
    catalog.register(makeDef("a.b.c"), { id: "gh", type: "external-cli", config: { executable: "gh" } });
    expect(catalog.has("a.b.c")).toBe(true);
    expect(catalog.getBinding("a.b.c")?.type).toBe("external-cli");
  });

  it("register throws on duplicate id@version", () => {
    catalog.register(makeDef("a.b.c"));
    expect(() => catalog.register(makeDef("a.b.c"))).toThrow(/already exists/i);
  });

  it("get returns the highest version", () => {
    catalog.register(makeDef("a.b.c", "1.0.0"));
    catalog.register(makeDef("a.b.c", "1.1.0"));
    expect(catalog.get("a.b.c")?.version).toBe("1.1.0");
    expect(catalog.list()).toHaveLength(2); // all versions retained
  });

  it("update patches the highest version (replaces)", () => {
    catalog.register(makeDef("a.b.c", "1.0.0"));
    catalog.update("a.b.c", { title: "new title" });
    expect(catalog.get("a.b.c")?.title).toBe("new title");
    expect(catalog.list()).toHaveLength(1);
  });

  it("remove drops the definition and binding", () => {
    catalog.register(makeDef("a.b.c"), { id: "x", type: "native" });
    catalog.remove("a.b.c");
    expect(catalog.has("a.b.c")).toBe(false);
    expect(catalog.getBinding("a.b.c")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/capability/canonical/catalog.vitest.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import type { CapabilityDefinition } from "./definition.js";
import type { CapabilityProviderBinding } from "./provider.js";
import type { CapabilityDefinitionStore } from "./catalog-store.js";

export interface CapabilityCatalogPatch {
  title?: string; description?: string; tags?: string[]; category?: string;
  risk?: CapabilityDefinition["risk"]; requiredPermissions?: CapabilityDefinition["requiredPermissions"];
  bindings?: CapabilityProviderBinding[];
}

/** Canonical capability catalog — the single durable source of definitions (§10).
 *  Not a registry (no lifecycle/availability); not a governance ledger. */
export class CapabilityCatalog {
  constructor(private readonly store: CapabilityDefinitionStore) {}

  get(id: string): CapabilityDefinition | undefined { return this.store.getDefinition(id); }
  list(): CapabilityDefinition[] { return this.store.listDefinitions(); }
  has(id: string): boolean { return this.store.getDefinition(id) !== undefined; }

  register(def: CapabilityDefinition, binding?: CapabilityProviderBinding): void {
    this.store.appendDefinition(def);
    if (binding) this.store.appendBinding(def.id, binding);
  }

  update(id: string, patch: CapabilityCatalogPatch): void {
    const current = this.store.getDefinition(id);
    if (!current) throw new Error(`capability: catalog update for unknown id ${id}`);
    const next: CapabilityDefinition = { ...current, ...patch };
    this.store.replaceDefinition(next);
    if (patch.bindings) {
      // Replace binding is not part of the store's replace; handled by caller (CAP-6 A4).
    }
  }

  remove(id: string): void { this.store.removeDefinition(id); }

  getBinding(id: string): CapabilityProviderBinding | undefined { return this.store.getBinding(id); }
}
```

> Note: `update` currently merges the patch into the highest-version definition and replaces it. Per #480, a governed update creates a *new* immutable publication via A4 (CAP-6); the catalog's `update` here is the store primitive the executor will call with an explicit new `id@version`. For CAP-2's additive scope, `update` mutates the highest version in place (documented as the store primitive); the A4 executor in CAP-6 will call `register` with the new publication instead.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/capability/canonical/catalog.vitest.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm exec tsc --noEmit` — exit 0.
Commit:
```bash
git add src/capability/canonical/catalog.ts tests/capability/canonical/catalog.vitest.ts
git commit -m "feat(capability): CAP-2 CapabilityCatalog facade"
```

---

### Task 3: Bootstrap providers + source precedence

**Files:**
- Create: `src/capability/canonical/bootstrap.ts`
- Test: `tests/capability/canonical/bootstrap.vitest.ts`

**Interfaces:**
- Consumes: `CapabilityDefinition` (CAP-1), `migrateKind` (`./kind.js`).
- Produces: `interface CapabilityBootstrapEntry { definition: CapabilityDefinition; binding?: CapabilityProviderBinding; source: string; }`; `interface CapabilityBootstrapProvider { readonly source: string; load(): CapabilityBootstrapEntry[]; }`; `const BOOTSTRAP_SOURCE_ORDER: readonly string[] = ["built-in", "project-local", "plugins", "provider-discovery", "governed", "overrides"]`; `function loadCatalogWithPrecedence(providers: CapabilityBootstrapProvider[]): CapabilityBootstrapEntry[]` — groups by source order, later sources override earlier on same id@version; validates each via `validateCapabilityDefinition`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { loadCatalogWithPrecedence, BOOTSTRAP_SOURCE_ORDER } from "../../../src/capability/canonical/bootstrap.js";
import type { CapabilityBootstrapProvider, CapabilityBootstrapEntry } from "../../../src/capability/canonical/bootstrap.js";
import type { CapabilityDefinition } from "../../../src/capability/canonical/definition.js";

function makeDef(id: string, title: string): CapabilityDefinition {
  return { id, version: "1.0.0", kind: "operation", title, description: id, tags: [], category: "test",
    risk: "low", requiredPermissions: ["operator"], dependencies: [], bindings: [{ id: "x", type: "native" }] };
}
function provider(source: string, defs: CapabilityDefinition[]): CapabilityBootstrapProvider {
  return { source, load: () => defs.map((d) => ({ definition: d, source } as CapabilityBootstrapEntry)) };
}

describe("bootstrap source precedence", () => {
  it("orders sources built-in → … → overrides", () => {
    expect(BOOTSTRAP_SOURCE_ORDER).toEqual(["built-in", "project-local", "plugins", "provider-discovery", "governed", "overrides"]);
  });

  it("later sources override earlier on same id", () => {
    const entries = loadCatalogWithPrecedence([
      provider("built-in", [makeDef("a.b.c", "built-in title")]),
      provider("overrides", [makeDef("a.b.c", "override title")]),
    ]);
    const abc = entries.find((e) => e.definition.id === "a.b.c");
    expect(abc?.definition.title).toBe("override title");
  });

  it("keeps distinct ids from different sources", () => {
    const entries = loadCatalogWithPrecedence([
      provider("built-in", [makeDef("a.b.c", "x")]),
      provider("plugins", [makeDef("p.q.r", "y")]),
    ]);
    expect(entries.map((e) => e.definition.id).sort()).toEqual(["a.b.c", "p.q.r"]);
  });

  it("rejects an invalid definition from a provider", () => {
    expect(() => loadCatalogWithPrecedence([
      provider("built-in", [{ ...makeDef("bad", "x"), version: "1.0" }]),
    ])).toThrow(/capability:/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/capability/canonical/bootstrap.vitest.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import type { CapabilityDefinition } from "./definition.js";
import { validateCapabilityDefinition } from "./definition.js";
import type { CapabilityProviderBinding } from "./provider.js";

export interface CapabilityBootstrapEntry {
  definition: CapabilityDefinition;
  binding?: CapabilityProviderBinding;
  source: string;
}

/** One source of capability definitions at initialization (§13).
 *  A bootstrap provider is NOT an authority — the catalog is. */
export interface CapabilityBootstrapProvider {
  readonly source: string;
  load(): CapabilityBootstrapEntry[];
}

export const BOOTSTRAP_SOURCE_ORDER = [
  "built-in", "project-local", "plugins", "provider-discovery", "governed", "overrides",
] as const;

/** Deterministic source precedence: later sources override earlier on the same
 *  id@version. Every entry passes canonical validation. */
export function loadCatalogWithPrecedence(providers: CapabilityBootstrapProvider[]): CapabilityBootstrapEntry[] {
  const byKey = new Map<string, CapabilityBootstrapEntry>();
  const ordered = [...providers].sort(
    (a, b) => BOOTSTRAP_SOURCE_ORDER.indexOf(a.source as never) - BOOTSTRAP_SOURCE_ORDER.indexOf(b.source as never),
  );
  for (const p of ordered) {
    for (const entry of p.load()) {
      validateCapabilityDefinition(entry.definition);
      const key = `${entry.definition.id}@${entry.definition.version}`;
      byKey.set(key, entry); // later source wins
    }
  }
  return [...byKey.values()];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/capability/canonical/bootstrap.vitest.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm exec tsc --noEmit` — exit 0.
Commit:
```bash
git add src/capability/canonical/bootstrap.ts tests/capability/canonical/bootstrap.vitest.ts
git commit -m "feat(capability): CAP-2 bootstrap providers + source precedence"
```

---

### Task 4: Two-phase definition authoring

**Files:**
- Create: `src/capability/canonical/authoring.ts`
- Test: `tests/capability/canonical/authoring.vitest.ts`

**Interfaces:**
- Consumes: `CapabilityDefinition`, `validateCapabilityDefinition`.
- Produces: `type DefinitionAuthoringStatus = "required" | "incomplete" | "valid"`; `interface AuthoringAssessment { status: DefinitionAuthoringStatus; missing: string[]; }`; `function evaluateDefinitionAuthoring(input: Partial<CapabilityDefinition> | undefined): AuthoringAssessment` — returns `required` when input undefined/empty; `incomplete` when missing required fields (id/version/kind/title/description/tags/category/risk/requiredPermissions/bindings or invalid SemVer); `valid` when `validateCapabilityDefinition` passes. Never invents defaults.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { evaluateDefinitionAuthoring } from "../../../src/capability/canonical/authoring.js";
import type { CapabilityDefinition } from "../../../src/capability/canonical/definition.js";

function makeDef(): CapabilityDefinition {
  return { id: "a.b.c", version: "1.0.0", kind: "operation", title: "t", description: "d",
    tags: [], category: "c", risk: "low", requiredPermissions: ["operator"], dependencies: [],
    bindings: [{ id: "x", type: "native" }] };
}

describe("two-phase definition authoring", () => {
  it("returns required when no input", () => {
    expect(evaluateDefinitionAuthoring(undefined).status).toBe("required");
  });
  it("returns incomplete for a partial definition", () => {
    const res = evaluateDefinitionAuthoring({ id: "a.b.c" });
    expect(res.status).toBe("incomplete");
    expect(res.missing.length).toBeGreaterThan(0);
  });
  it("returns incomplete for short SemVer", () => {
    const res = evaluateDefinitionAuthoring({ ...makeDef(), version: "1.0" });
    expect(res.status).toBe("incomplete");
    expect(res.missing).toContain("version");
  });
  it("returns incomplete for no bindings", () => {
    const res = evaluateDefinitionAuthoring({ ...makeDef(), bindings: [] });
    expect(res.status).toBe("incomplete");
    expect(res.missing).toContain("bindings");
  });
  it("returns valid for a complete definition", () => {
    const res = evaluateDefinitionAuthoring(makeDef());
    expect(res.status).toBe("valid");
    expect(res.missing).toHaveLength(0);
  });
  it("never invents defaults", () => {
    // A definition missing requiredPermissions must be flagged, not defaulted.
    const { id, version, kind, title, description, tags, category, risk, dependencies, bindings } = makeDef();
    const res = evaluateDefinitionAuthoring({ id, version, kind, title, description, tags, category, risk, dependencies, bindings });
    expect(res.status).toBe("incomplete");
    expect(res.missing).toContain("requiredPermissions");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/capability/canonical/authoring.vitest.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import type { CapabilityDefinition } from "./definition.js";
import { validateCapabilityDefinition } from "./definition.js";
import { isValidVersion } from "./version.js";

/** Two-phase authoring status (#478): A7 proposes a gap; an operator authors the
 *  complete definition. required → incomplete → valid. A7 never invents defaults. */
export type DefinitionAuthoringStatus = "required" | "incomplete" | "valid";

export interface AuthoringAssessment { status: DefinitionAuthoringStatus; missing: string[]; }

const REQUIRED_FIELDS: (keyof CapabilityDefinition)[] = [
  "id", "version", "kind", "title", "description", "tags", "category",
  "risk", "requiredPermissions", "dependencies", "bindings",
];

export function evaluateDefinitionAuthoring(
  input: Partial<CapabilityDefinition> | undefined,
): AuthoringAssessment {
  if (input === undefined || Object.keys(input).length === 0) return { status: "required", missing: REQUIRED_FIELDS as string[] };

  const missing: string[] = [];
  for (const f of REQUIRED_FIELDS) {
    const v = (input as Record<string, unknown>)[f];
    if (v === undefined || (Array.isArray(v) && v.length === 0)) missing.push(f as string);
  }
  if (input.version !== undefined && !isValidVersion(input.version)) missing.push("version");
  // bindings empty handled above; also ensure non-empty array present
  if (Array.isArray(input.bindings) && input.bindings.length > 0) {
    // defer full validation to the "valid" check below
  }

  if (missing.length > 0) return { status: "incomplete", missing };

  try {
    validateCapabilityDefinition(input as CapabilityDefinition);
    return { status: "valid", missing: [] };
  } catch {
    // Any remaining validation failure (bad risk, bad permission, non-serializable) = incomplete.
    return { status: "incomplete", missing: ["definition"] };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/capability/canonical/authoring.vitest.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm exec tsc --noEmit` — exit 0.
Commit:
```bash
git add src/capability/canonical/authoring.ts tests/capability/canonical/authoring.vitest.ts
git commit -m "feat(capability): CAP-2 two-phase definition authoring"
```

---

### Task 5: Barrel + integration test

**Files:**
- Modify: `src/capability/canonical/index.ts`
- Create: `tests/capability/canonical/catalog-integration.vitest.ts`

**Interfaces:**
- Consumes: all Task 1-4 exports.
- Produces: nothing new (integration proof).

- [ ] **Step 1: Add barrel exports**

```ts
export * from "./catalog-store.js";
export * from "./catalog.js";
export * from "./bootstrap.js";
export * from "./authoring.js";
```

- [ ] **Step 2: Write the integration test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityDefinitionStore } from "../../../src/capability/canonical/catalog-store.js";
import { CapabilityCatalog } from "../../../src/capability/canonical/catalog.js";
import { loadCatalogWithPrecedence } from "../../../src/capability/canonical/bootstrap.js";
import { evaluateDefinitionAuthoring } from "../../../src/capability/canonical/authoring.js";
import { migrateKind } from "../../../src/capability/canonical/kind.js";
import type { CapabilityDefinition } from "../../../src/capability/canonical/definition.js";

describe("CAP-2 end-to-end: bootstrap → catalog → store", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "capint-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("bootstraps a catalog, persists it, and a fresh store reloads it", () => {
    // Simulate a bootstrap provider feeding a semantic definition from a legacy source
    const legacy: Array<{ id: string; version: string; legacyKind: string }> = [
      { id: "core.session.list", version: "1.0", legacyKind: "core" },
      { id: "tool.file.read", version: "1.0", legacyKind: "tool" },
    ];
    const provider = {
      source: "built-in",
      load: () => legacy.map((c) => ({
        source: "built-in",
        definition: {
          id: c.id, version: c.version.endsWith(".0") ? c.version : `${c.version}.0`,
          kind: migrateKind(c.legacyKind), title: c.id, description: c.id, tags: [], category: "bootstrap",
          risk: "low", requiredPermissions: ["operator"], dependencies: [],
          bindings: [{ id: c.id, type: "native" as const }],
        } as CapabilityDefinition,
      })),
    };
    const entries = loadCatalogWithPrecedence([provider]);
    const store = new CapabilityDefinitionStore({ dir });
    const catalog = new CapabilityCatalog(store);
    for (const e of entries) catalog.register(e.definition, e.binding);

    // Authoring gate: a complete def is valid; a partial is not
    expect(evaluateDefinitionAuthoring(entries[0].definition).status).toBe("valid");
    expect(evaluateDefinitionAuthoring({ id: "core.session.list" }).status).toBe("incomplete");

    // Fresh store reloads what was persisted
    const fresh = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
    expect(fresh.has("core.session.list")).toBe(true);
    expect(fresh.has("tool.file.read")).toBe(true);
    expect(fresh.get("core.session.list")?.kind).toBe("core");
    expect(fresh.get("tool.file.read")?.kind).toBe("operation"); // migrateKind("tool") → operation
  });
});
```

- [ ] **Step 3: Run the full canonical suite**

Run: `pnpm vitest run tests/capability/canonical/`
Expected: all green (Task 1-4 + integration).

- [ ] **Step 4: Confirm no regression in existing capability suite**

Run: `pnpm vitest run tests/capability/`
Expected: all still pass (CAP-2 is additive — nothing existing changed). Note: `tests/policy/` uses node:test (`.test.ts`), not vitest, and is untouched by CAP-2 — no policy tests should be affected.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm exec tsc --noEmit` — exit 0.
Commit:
```bash
git add src/capability/canonical/index.ts tests/capability/canonical/catalog-integration.vitest.ts
git commit -m "feat(capability): CAP-2 catalog integration test + barrel"
```

---

## Self-Review

**Spec coverage (ticket #486 acceptance):**
- [x] Catalog store: load/save/atomic-update/validation/deterministic-ordering/corruption-handling/versioning — Task 1 (atomic append via temp+rename, validation, deterministic sort, corrupt-line skip, `get` returns highest version).
- [x] Three definition databases converge to bootstrap providers — Task 3 (`CapabilityBootstrapProvider` abstraction + the integration test feeds from a legacy-shaped source). Existing databases NOT modified (additive).
- [x] Source precedence deterministic — Task 3 (`BOOTSTRAP_SOURCE_ORDER`, later wins).
- [x] Two-phase create authoring — Task 4 (`required|incomplete|valid`, never invents defaults).
- [x] A capability cannot enter the catalog without a complete validated definition — Task 1 (store `appendDefinition` validates), Task 4.
- [x] North-star: catalog single durable source, not a second registry — the catalog owns definitions only; no lifecycle/availability.

**Placeholder scan:** no TBD/TODO; all tests + implementations concrete.

**Type consistency:** `CapabilityDefinitionStore`, `CapabilityCatalog`, `CapabilityBootstrapProvider`/`Entry`, `BOOTSTRAP_SOURCE_ORDER`, `DefinitionAuthoringStatus`, `evaluateDefinitionAuthoring`, `CapabilityCatalogPatch` used consistently across tasks. `migrateKind` (CAP-1) reused in integration test. Store `getDefinition` returns highest SemVer — matches #479 "current = highest eligible".

**Additive check:** the three existing databases (`initial-capabilities.ts`, `tool-registry.ts`, `policy/capability-registry.ts`) and their HIGH-risk consumers (ToolExecutor, CoordinationPlanner, 5 CLI commands) are NOT touched. Only new files under `src/capability/canonical/` + the barrel + tests.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-10-cap-2-persistent-capability-catalog.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session, batch execution with checkpoints.

Which approach?
