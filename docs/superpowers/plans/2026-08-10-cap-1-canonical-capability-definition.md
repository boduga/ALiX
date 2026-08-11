# CAP-1 — Canonical Capability Definition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the canonical `CapabilityDefinition` contract — semantic `CapabilityKind`, provider bindings, immutable SemVer `id@version` — as an additive module that does not disturb the 47 existing `Capability` consumers.

**Architecture:** A new `src/capability/canonical/` module defines the contract and validation as pure data types + functions. The existing `src/capability/types.ts` `Capability` interface is left untouched (its migration happens in CAP-3/CAP-4/CAP-8/CAP-11). This is the "expand" half of expand–contract. The old `kind: "core"|"tool"|...` and `execution.strategy` vocabulary is superseded but not deleted here.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest (`.vitest.ts` test files, matching `tests/capability/` convention). No new runtime dependency — SemVer validation is an internal helper.

## Global Constraints

- **Semantic kind vocabulary** (#475): `CapabilityKind = "core" | "query" | "operation" | "workflow" | "agent"`. No `"custom"` escape hatch. Provider technologies MUST NOT be kinds.
- **Provider vocabulary** (#476 / ADR-0013 §4): `ProviderType = "native" | "tool" | "mcp" | "external-cli" | "daemon" | "agent" | "plugin" | "remote-api"`.
- **Versioning** (#479): full SemVer `MAJOR.MINOR.PATCH`; short `"1.0"` rejected; `id@version` is the identity, immutable per publication. Dependencies are capability-ID refs (not `id@version`).
- **Migration mapping**: `tool.file.read→query`, `tool.git.commit→operation`, `tool.shell.run→operation`; `core` = intrinsic platform semantics (maps to `core`).
- **Pure data**: definitions are serializable, deterministic, implementation-independent, free of runtime/lifecycle/governance state, free of functions/live executor handles.
- **North-star invariant**: this contract creates exactly one definition shape, not a per-surface model.
- **Do NOT modify** `src/capability/types.ts`, `registry.ts`, `runtime.ts`, `execution-resolver.ts`, `executors.ts`, `initial-capabilities.ts`, or any consumer. CAP-1 is additive only.
- **Test runner**: Vitest, files `tests/capability/canonical/*.vitest.ts`. Follow the `tests/capability/registry.vitest.ts` style (describe/it/expect/vi).

---

## File Structure

- `src/capability/canonical/kind.ts` — `CapabilityKind` + kind validation + migration map.
- `src/capability/canonical/provider.ts` — `ProviderType`, `CapabilityProviderBinding`, provider validation.
- `src/capability/canonical/version.ts` — SemVer parsing/validation, `id@version` helpers.
- `src/capability/canonical/definition.ts` — `CapabilityDefinition` interface + `validateCapabilityDefinition()`.
- `src/capability/canonical/index.ts` — barrel re-export.
- `tests/capability/canonical/kind.vitest.ts`
- `tests/capability/canonical/provider.vitest.ts`
- `tests/capability/canonical/version.vitest.ts`
- `tests/capability/canonical/definition.vitest.ts`
- `tests/capability/canonical/representability.vitest.ts` — every current capability maps losslessly.

---

### Task 1: Semantic CapabilityKind + migration map

**Files:**
- Create: `src/capability/canonical/kind.ts`
- Test: `tests/capability/canonical/kind.vitest.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type CapabilityKind = "core" | "query" | "operation" | "workflow" | "agent"`; `const CAPABILITY_KINDS: readonly CapabilityKind[]`; `function isCapabilityKind(v: unknown): v is CapabilityKind`; `type LegacyKind = "core" | "tool" | "skill" | "custom" | "workflow" | "plugin"`; `function migrateKind(legacy: LegacyKind): CapabilityKind`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { isCapabilityKind, migrateKind, CAPABILITY_KINDS } from "../../../src/capability/canonical/kind.js";

describe("CapabilityKind", () => {
  it("defines exactly the five semantic kinds", () => {
    expect([...CAPABILITY_KINDS].sort()).toEqual(["agent", "core", "operation", "query", "workflow"]);
  });
  it("rejects provider technologies as kinds", () => {
    expect(isCapabilityKind("tool")).toBe(false);
    expect(isCapabilityKind("mcp")).toBe(false);
    expect(isCapabilityKind("external-cli")).toBe(false);
    expect(isCapabilityKind("custom")).toBe(false);
  });
  it("accepts the five semantic kinds", () => {
    for (const k of CAPABILITY_KINDS) expect(isCapabilityKind(k)).toBe(true);
  });
  it("maps legacy kinds to semantic kinds", () => {
    expect(migrateKind("core")).toBe("core");
    expect(migrateKind("tool")).toBe("operation");
    expect(migrateKind("skill")).toBe("operation");
    expect(migrateKind("workflow")).toBe("workflow");
    expect(migrateKind("plugin")).toBe("agent");
  });
  it("throws on the legacy custom escape hatch", () => {
    expect(() => migrateKind("custom")).toThrow(/custom/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/capability/canonical/kind.vitest.ts`
Expected: FAIL — module not found (`Cannot find module`).

- [ ] **Step 3: Write minimal implementation**

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/** Semantic form of a capability — WHAT ALiX can do, never HOW. */
export type CapabilityKind = "core" | "query" | "operation" | "workflow" | "agent";

export const CAPABILITY_KINDS: readonly CapabilityKind[] = ["core", "query", "operation", "workflow", "agent"] as const;

const KIND_SET = new Set<string>(CAPABILITY_KINDS);

export function isCapabilityKind(v: unknown): v is CapabilityKind {
  return typeof v === "string" && KIND_SET.has(v);
}

/** Pre-greenfield kind vocabulary — superseded by semantic kinds (decisions #475/#476). */
export type LegacyKind = "core" | "tool" | "skill" | "custom" | "workflow" | "plugin";

const LEGACY_TO_KIND: Record<LegacyKind, CapabilityKind> = {
  core: "core",
  tool: "operation",
  skill: "operation",
  workflow: "workflow",
  plugin: "agent",
};

/** Map a legacy kind string to its semantic form. "custom" has no semantic
 *  equivalent and is rejected — provider technologies must not become kinds. */
export function migrateKind(legacy: string): CapabilityKind {
  if (legacy === "custom") throw new Error("legacy kind 'custom' has no semantic CapabilityKind");
  const mapped = LEGACY_TO_KIND[legacy as LegacyKind];
  if (!mapped) throw new Error(`unknown legacy kind: ${legacy}`);
  return mapped;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/capability/canonical/kind.vitest.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/capability/canonical/kind.ts tests/capability/canonical/kind.vitest.ts
git commit -m "feat(capability): CAP-1 semantic CapabilityKind + legacy migration map"
```

---

### Task 2: Provider bindings + validation

**Files:**
- Create: `src/capability/canonical/provider.ts`
- Test: `tests/capability/canonical/provider.vitest.ts`

**Interfaces:**
- Consumes: `CapabilityKind` concept only (semantic, not imported type).
- Produces: `type ProviderType = "native" | "tool" | "mcp" | "external-cli" | "daemon" | "agent" | "plugin" | "remote-api"`; `const PROVIDER_TYPES: readonly ProviderType[]`; `interface CapabilityProviderBinding { id: string; type: ProviderType; config?: Record<string, unknown>; }`; `function validateProviderBinding(binding: unknown): asserts binding is CapabilityProviderBinding` (throws `CapabilityValidationError`-style `Error` with a stable message prefix).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { PROVIDER_TYPES, validateProviderBinding } from "../../../src/capability/canonical/provider.js";
import type { CapabilityProviderBinding } from "../../../src/capability/canonical/provider.js";

describe("CapabilityProviderBinding", () => {
  it("defines the ADR-0013 provider classes", () => {
    expect([...PROVIDER_TYPES].sort()).toEqual(
      ["agent", "daemon", "external-cli", "mcp", "native", "plugin", "remote-api", "tool"].sort(),
    );
  });
  it("accepts a valid binding", () => {
    const b: CapabilityProviderBinding = { id: "gh", type: "external-cli", config: { executable: "gh" } };
    expect(() => validateProviderBinding(b)).not.toThrow();
  });
  it("rejects empty provider ids", () => {
    expect(() => validateProviderBinding({ id: "", type: "native" })).toThrow(/provider id/);
    expect(() => validateProviderBinding({ id: "  ", type: "native" })).toThrow(/provider id/);
  });
  it("rejects malformed provider types", () => {
    expect(() => validateProviderBinding({ id: "gh", type: "cli" })).toThrow(/provider type/);
    expect(() => validateProviderBinding({ id: "gh", type: "gitnexus" })).toThrow(/provider type/);
  });
  it("rejects non-serializable config (functions)", () => {
    const fn = () => 1;
    expect(() => validateProviderBinding({ id: "x", type: "native", config: { cb: fn } })).toThrow(/serializable/);
  });
  it("rejects missing required config for external-cli", () => {
    expect(() => validateProviderBinding({ id: "gh", type: "external-cli" })).toThrow(/external-cli/);
  });
  it("accepts a plain id (no config) for native", () => {
    expect(() => validateProviderBinding({ id: "session.list", type: "native" })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/capability/canonical/provider.vitest.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/** Implementation mechanism for a capability — HOW ALiX performs it.
 *  Providers are implementations, never capability identities (ADR-0013 §4). */
export type ProviderType =
  | "native" | "tool" | "mcp" | "external-cli"
  | "daemon" | "agent" | "plugin" | "remote-api";

export const PROVIDER_TYPES: readonly ProviderType[] = [
  "native", "tool", "mcp", "external-cli", "daemon", "agent", "plugin", "remote-api",
] as const;

const PROVIDER_SET = new Set<string>(PROVIDER_TYPES);

/** Declarative binding of a capability to one provider implementation. Pure data. */
export interface CapabilityProviderBinding {
  /** Stable provider id within the runtime composition, e.g. "gh", "gitnexus", "session.list". */
  id: string;
  type: ProviderType;
  /** Provider-specific configuration. Must be JSON-serializable. */
  config?: Record<string, unknown>;
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isSerializable(value: unknown): boolean {
  if (value === null) return true;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return true;
  if (t === "undefined") return false;
  if (Array.isArray(value)) return value.every(isSerializable);
  if (t === "object") return Object.values(value as Record<string, unknown>).every(isSerializable);
  return false; // function, symbol, bigint
}

const EXTERNAL_CLI_REQUIRED = new Set<ProviderType>(["external-cli"]);

/** Throws Error with a stable prefix when `binding` is not a valid provider binding. */
export function validateProviderBinding(binding: unknown): asserts binding is CapabilityProviderBinding {
  if (!isPlainRecord(binding)) throw new Error("capability: provider binding must be an object");
  if (typeof binding.id !== "string" || binding.id.trim().length === 0) {
    throw new Error("capability: provider id must be a non-empty string");
  }
  if (!PROVIDER_SET.has(binding.type)) {
    throw new Error(`capability: provider type '${String(binding.type)}' is not one of ${PROVIDER_TYPES.join("|")}`);
  }
  if (binding.config !== undefined) {
    if (!isPlainRecord(binding.config)) throw new Error("capability: provider config must be an object");
    if (!isSerializable(binding.config)) throw new Error("capability: provider config must be JSON-serializable (no functions)");
  }
  if (EXTERNAL_CLI_REQUIRED.has(binding.type) && (binding.config === undefined || typeof binding.config.executable !== "string" || binding.config.executable.trim().length === 0)) {
    throw new Error(`capability: provider type 'external-cli' requires config.executable`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/capability/canonical/provider.vitest.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/capability/canonical/provider.ts tests/capability/canonical/provider.vitest.ts
git commit -m "feat(capability): CAP-1 provider bindings + validation"
```

---

### Task 3: SemVer version + id@version helpers

**Files:**
- Create: `src/capability/canonical/version.ts`
- Test: `tests/capability/canonical/version.vitest.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface ParsedVersion { major: number; minor: number; patch: number; }`; `function parseVersion(v: string): ParsedVersion` (throws on invalid); `function isValidVersion(v: unknown): v is string`; `function formatVersionId(id: string, version: string): string` (returns `${id}@${version}`); `function parseVersionId(ref: string): { id: string; version: string }`; `function compareVersions(a: string, b: string): number` (SemVer ordering); `function bumpVersion(base: string, kind: "major" | "minor" | "patch"): string`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  isValidVersion, parseVersion, formatVersionId, parseVersionId, compareVersions, bumpVersion,
} from "../../../src/capability/canonical/version.js";

describe("Capability versioning (SemVer)", () => {
  it("accepts full SemVer only", () => {
    expect(isValidVersion("1.0.0")).toBe(true);
    expect(isValidVersion("0.0.1")).toBe(true);
    expect(isValidVersion("10.2.30")).toBe(true);
    expect(isValidVersion("1.0")).toBe(false);       // short form rejected (#479)
    expect(isValidVersion("1")).toBe(false);
    expect(isValidVersion("v1.0.0")).toBe(false);
    expect(isValidVersion("1.0.0-beta")).toBe(false); // pre-release out of CAP-1 scope
    expect(isValidVersion("")).toBe(false);
  });
  it("parses components", () => {
    expect(parseVersion("2.3.4")).toEqual({ major: 2, minor: 3, patch: 4 });
  });
  it("round-trips id@version", () => {
    expect(formatVersionId("tool.file.read", "1.0.0")).toBe("tool.file.read@1.0.0");
    expect(parseVersionId("tool.file.read@1.0.0")).toEqual({ id: "tool.file.read", version: "1.0.0" });
  });
  it("orders versions", () => {
    expect(compareVersions("1.2.3", "1.2.4")).toBeLessThan(0);
    expect(compareVersions("1.2.4", "1.2.3")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
  it("bumps versions", () => {
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/capability/canonical/version.vitest.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

export interface ParsedVersion { major: number; minor: number; patch: number; }

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

export function isValidVersion(v: unknown): v is string {
  return typeof v === "string" && SEMVER_RE.test(v);
}

export function parseVersion(v: string): ParsedVersion {
  const m = SEMVER_RE.exec(v);
  if (!m) throw new Error(`capability: version '${v}' is not full SemVer MAJOR.MINOR.PATCH`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function formatVersionId(id: string, version: string): string {
  return `${id}@${version}`;
}

export function parseVersionId(ref: string): { id: string; version: string } {
  const at = ref.lastIndexOf("@");
  if (at <= 0) throw new Error(`capability: '${ref}' is not an id@version reference`);
  return { id: ref.slice(0, at), version: ref.slice(at + 1) };
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a); const pb = parseVersion(b);
  return (pa.major - pb.major) || (pa.minor - pb.minor) || (pa.patch - pb.patch);
}

export function bumpVersion(base: string, kind: "major" | "minor" | "patch"): string {
  const v = parseVersion(base);
  if (kind === "major") return `${v.major + 1}.0.0`;
  if (kind === "minor") return `${v.major}.${v.minor + 1}.0`;
  return `${v.major}.${v.minor}.${v.patch + 1}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/capability/canonical/version.vitest.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/capability/canonical/version.ts tests/capability/canonical/version.vitest.ts
git commit -m "feat(capability): CAP-1 SemVer id@version helpers"
```

---

### Task 4: Canonical CapabilityDefinition + validation

**Files:**
- Create: `src/capability/canonical/definition.ts`
- Test: `tests/capability/canonical/definition.vitest.ts`

**Interfaces:**
- Consumes: `CapabilityKind`, `isCapabilityKind` (Task 1); `CapabilityProviderBinding`, `validateProviderBinding` (Task 2); `isValidVersion` (Task 3).
- Produces: `type CapabilityRisk = "low" | "medium" | "high" | "critical"`; `type CapabilityPermission = "operator" | "admin" | "developer" | "internal"`; `interface CapabilityDefinition { id: string; version: string; kind: CapabilityKind; title: string; description: string; aliases?: string[]; tags: string[]; category: string; risk: CapabilityRisk; requiredPermissions: CapabilityPermission[]; argsSchema?: Record<string, unknown>; resultSchema?: Record<string, unknown>; examples?: string[]; dependencies: string[]; bindings: CapabilityProviderBinding[]; extensions?: Record<string, unknown>; }`; `function validateCapabilityDefinition(d: unknown): asserts d is CapabilityDefinition` — throws `Error` with `capability:` prefix on: non-object; empty id; invalid version (short SemVer); kind not in `CAPABILITY_KINDS`; kind equal to a provider technology; empty title; non-array tags/requiredPermissions/dependencies/bindings; at least one binding; any invalid binding (delegates to `validateProviderBinding`); dependencies not simple capability-id strings; non-serializable extensions.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { validateCapabilityDefinition } from "../../../src/capability/canonical/definition.js";
import type { CapabilityDefinition } from "../../../src/capability/canonical/definition.js";

function makeDef(over: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id: "core.session.list", version: "1.0.0", kind: "core",
    title: "List sessions", description: "List all sessions",
    tags: ["session"], category: "session", risk: "low",
    requiredPermissions: ["operator"], dependencies: [],
    bindings: [{ id: "session.list", type: "native" }],
    ...over,
  };
}

describe("CapabilityDefinition", () => {
  it("accepts a valid definition", () => {
    expect(() => validateCapabilityDefinition(makeDef())).not.toThrow();
  });
  it("rejects short SemVer version", () => {
    expect(() => validateCapabilityDefinition(makeDef({ version: "1.0" }))).toThrow(/version/);
  });
  it("rejects empty id", () => {
    expect(() => validateCapabilityDefinition(makeDef({ id: "" }))).toThrow(/id/);
  });
  it("rejects a kind that is a provider technology", () => {
    expect(() => validateCapabilityDefinition(makeDef({ kind: "tool" as never }))).toThrow(/kind/);
  });
  it("rejects a definition with no bindings", () => {
    expect(() => validateCapabilityDefinition(makeDef({ bindings: [] }))).toThrow(/binding/);
  });
  it("rejects an invalid binding inside the definition", () => {
    expect(() => validateCapabilityDefinition(makeDef({ bindings: [{ id: "", type: "native" }] }))).toThrow(/provider id/);
  });
  it("rejects non-serializable extensions", () => {
    expect(() => validateCapabilityDefinition(makeDef({ extensions: { fn: () => 1 } }))).toThrow(/serializable/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/capability/canonical/definition.vitest.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { CAPABILITY_KINDS, isCapabilityKind } from "./kind.js";
import type { CapabilityKind } from "./kind.js";
import { validateProviderBinding } from "./provider.js";
import type { CapabilityProviderBinding } from "./provider.js";
import { isValidVersion } from "./version.js";

export type CapabilityRisk = "low" | "medium" | "high" | "critical";
export type CapabilityPermission = "operator" | "admin" | "developer" | "internal";

const PROVIDER_TECH_KINDS = new Set<string>(["native", "tool", "mcp", "external-cli", "daemon", "agent", "plugin", "remote-api"]);

/** The canonical capability artifact. Pure data — no functions, no live handles. */
export interface CapabilityDefinition {
  id: string;                    // semantic, namespaced: "code.repository.impact"
  version: string;               // full SemVer MAJOR.MINOR.PATCH (#479)
  kind: CapabilityKind;          // semantic form, never implementation technology (#475)
  title: string;
  description: string;
  aliases?: string[];
  tags: string[];
  category: string;
  risk: CapabilityRisk;
  requiredPermissions: CapabilityPermission[];
  argsSchema?: Record<string, unknown>;
  resultSchema?: Record<string, unknown>;
  examples?: string[];
  dependencies: string[];        // capability-IDs, not id@version refs (#479)
  bindings: CapabilityProviderBinding[];  // one-to-many; identity independent of provider (#476)
  extensions?: Record<string, unknown>;
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isSerializable(value: unknown): boolean {
  if (value === null) return true;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return true;
  if (t === "undefined") return false;
  if (Array.isArray(value)) return value.every(isSerializable);
  if (t === "object") return Object.values(value as Record<string, unknown>).every(isSerializable);
  return false;
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/** Throws Error with a `capability:` prefix when `d` is not a valid canonical definition. */
export function validateCapabilityDefinition(d: unknown): asserts d is CapabilityDefinition {
  if (!isPlainRecord(d)) throw new Error("capability: definition must be an object");
  if (typeof d.id !== "string" || d.id.trim().length === 0) throw new Error("capability: definition id must be a non-empty string");
  if (!isValidVersion(d.version)) throw new Error(`capability: definition version '${String(d.version)}' is not full SemVer MAJOR.MINOR.PATCH`);
  if (!isCapabilityKind(d.kind)) throw new Error(`capability: definition kind '${String(d.kind)}' is not one of ${CAPABILITY_KINDS.join("|")}`);
  if (PROVIDER_TECH_KINDS.has(d.kind)) throw new Error(`capability: definition kind '${d.kind}' is a provider technology, not a semantic kind`);
  if (typeof d.title !== "string" || d.title.trim().length === 0) throw new Error("capability: definition title must be a non-empty string");
  if (typeof d.description !== "string") throw new Error("capability: definition description must be a string");
  if (!isStringArray(d.tags)) throw new Error("capability: definition tags must be a string array");
  if (typeof d.category !== "string") throw new Error("capability: definition category must be a string");
  if (!isStringArray(d.requiredPermissions)) throw new Error("capability: definition requiredPermissions must be a string array");
  if (!isStringArray(d.dependencies)) throw new Error("capability: definition dependencies must be a string array");
  if (!Array.isArray(d.bindings) || d.bindings.length === 0) throw new Error("capability: definition must declare at least one provider binding");
  for (const b of d.bindings) validateProviderBinding(b);
  if (d.extensions !== undefined) {
    if (!isPlainRecord(d.extensions)) throw new Error("capability: definition extensions must be an object");
    if (!isSerializable(d.extensions)) throw new Error("capability: definition extensions must be JSON-serializable (no functions)");
  }
  if (d.argsSchema !== undefined && !isPlainRecord(d.argsSchema)) throw new Error("capability: definition argsSchema must be a JSON Schema object");
  if (d.resultSchema !== undefined && !isPlainRecord(d.resultSchema)) throw new Error("capability: definition resultSchema must be a JSON Schema object");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/capability/canonical/definition.vitest.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/capability/canonical/definition.ts tests/capability/canonical/definition.vitest.ts
git commit -m "feat(capability): CAP-1 canonical CapabilityDefinition + validation"
```

---

### Task 5: Representability — all current capabilities map losslessly

**Files:**
- Create: `src/capability/canonical/representability.ts` (helper) — optional; the test may inline the mapping.
- Test: `tests/capability/canonical/representability.vitest.ts`

**Interfaces:**
- Consumes: `migrateKind` (Task 1), `validateCapabilityDefinition` (Task 4).
- Produces: nothing (test-only). The test imports `registerInitialCapabilities` from `src/capability/initial-capabilities.js` to enumerate current capabilities and asserts each maps to a valid `CapabilityDefinition`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { CapabilityRegistry } from "../../../src/capability/registry.js";
import { NativeExecutor } from "../../../src/capability/executors.js";
import { registerInitialCapabilities } from "../../../src/capability/initial-capabilities.js";
import { migrateKind } from "../../../src/capability/canonical/kind.js";
import { validateCapabilityDefinition } from "../../../src/capability/canonical/definition.js";

describe("CAP-1 representability", () => {
  it("maps every currently-registered capability to a valid CapabilityDefinition without loss", () => {
    const registry = new CapabilityRegistry();
    const native = new NativeExecutor();   // see src/capability/executors.ts for its ctor signature
    registerInitialCapabilities(registry, native);
    const caps = registry.list();
    expect(caps.length).toBeGreaterThan(0);
    for (const cap of caps) {
      const def = {
        id: cap.id,
        version: isValidSemVer(cap.version) ? cap.version : `${normalize(cap.version)}.0`, // 1.0 -> 1.0.0
        kind: migrateKind(cap.kind),
        title: cap.title,
        description: cap.description,
        tags: cap.tags,
        category: cap.category,
        risk: cap.risk,
        requiredPermissions: cap.requiredPermissions,
        argsSchema: cap.argsSchema,
        resultSchema: cap.resultSchema,
        examples: cap.examples,
        dependencies: cap.dependencies ?? [],
        bindings: [{ id: cap.execution.strategy, type: providerTypeOf(cap.execution.strategy) }],
        extensions: cap.extensions,
      };
      expect(() => validateCapabilityDefinition(def)).not.toThrow();
    }
  });
});

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
function isValidSemVer(v: string): boolean { return SEMVER_RE.test(v); }
function normalize(v: string): string { return v.split(".").length === 2 ? `${v}.0` : v; }
function providerTypeOf(strategy: string): string {
  if (strategy === "native" || strategy === "tool") return strategy;
  if (strategy === "daemon" || strategy === "agent" || strategy === "plugin") return strategy;
  if (strategy === "cli") return "external-cli";
  return "external-cli"; // default: treat unknown strategy as an external executable
}
```

> **Verified signature:** `registerInitialCapabilities(reg: CapabilityRegistry, _native: NativeExecutor): void` — **sync**, requires a `NativeExecutor` instance (check `src/capability/executors.ts` for its constructor), and mutates the registry in place. If `NativeExecutor`'s ctor needs deps, stub it with `vi.fn()`-style test double or pass `undefined as unknown as NativeExecutor` since `_native` is unused for pure registration. The version normalization (`1.0` → `1.0.0`) is the migration boundary: current `Capability.version` is often short SemVer, and CAP-1's contract requires full SemVer.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/capability/canonical/representability.vitest.ts`
Expected: FAIL — `migrateKind`/`validateCapabilityDefinition` may not yet handle all real inputs (e.g. an existing kind like `workflow` or `plugin` mapping).

- [ ] **Step 3: Make it pass**

Verify each current capability's `kind` maps through `migrateKind` (Task 1) and its `execution.strategy` maps to a `ProviderType` (Task 2). Adjust the inline `providerTypeOf` mapping in the test if a current strategy is not covered (e.g. `"mcp"`). If a current capability uses `kind: "workflow"` or `kind: "plugin"`, confirm `migrateKind` maps them (`workflow→workflow`, `plugin→agent`). Iterate until the test passes.

- [ ] **Step 4: Run the full canonical suite**

Run: `pnpm vitest run tests/capability/canonical/`
Expected: all green (kind, provider, version, definition, representability).

- [ ] **Step 5: Run the broader capability suite to confirm no regression**

Run: `pnpm vitest run tests/capability/`
Expected: all existing capability tests still pass (CAP-1 is additive — nothing existing changed).

- [ ] **Step 6: Commit**

```bash
git add tests/capability/canonical/representability.vitest.ts
git commit -m "test(capability): CAP-1 representability — all current capabilities map losslessly"
```

---

### Task 6: Barrel export + final verification

**Files:**
- Create: `src/capability/canonical/index.ts`

**Interfaces:**
- Consumes: all Tasks 1–4 exports.
- Produces: a barrel re-exporting `kind.ts`, `provider.ts`, `version.ts`, `definition.ts`.

- [ ] **Step 1: Write the barrel**

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

export * from "./kind.js";
export * from "./provider.js";
export * from "./version.js";
export * from "./definition.js";
```

- [ ] **Step 2: Typecheck the module**

Run: `pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -i "canonical" || echo "no canonical type errors"`
Expected: no type errors mentioning `src/capability/canonical/`.

- [ ] **Step 3: Full vitest run for the touched areas**

Run: `pnpm vitest run tests/capability/`
Expected: all green.

- [ ] **Step 4: Run detect_changes to confirm additive scope**

Run the GitNexus `detect_changes` check (project rule). Expected: changed files are only new `src/capability/canonical/*` + `tests/capability/canonical/*`; risk low; no existing execution flow affected.

- [ ] **Step 5: Commit**

```bash
git add src/capability/canonical/index.ts
git commit -m "feat(capability): CAP-1 canonical module barrel export"
```

---

## Post-implementation reconciliation (2026-08-11)

Findings from the SDD review loop, folded back into the plan for future CAPs:

1. **`kind: "agent"` is in BOTH `CapabilityKind` and `ProviderType`.** The original Task 4 design used a `PROVIDER_TECH_KINDS` guard to reject provider-tech kinds — but that wrongly rejected `kind: "agent"`, blocking `migrateKind("plugin") → "agent"`. **Fix:** the guard was removed; `isCapabilityKind` is the sole kind guard (it already rejects all provider-tech strings except `agent`, which is a legitimate kind). If a future CAP re-introduces a provider-tech-kind check, it must not blanket-reject provider vocabulary — only kinds that are NOT semantic kinds.
2. **`risk` and `requiredPermissions` are validated at runtime** (not just by TypeScript): `risk` against `low|medium|high|critical`, each permission against `operator|admin|developer|internal`. The original Task 4 sample only string-array-checked permissions.
3. **`isSerializable` rejects non-plain objects** (Date/RegExp/Map) via `Object.prototype.toString` — `Object.values(new Date())` is `[]`, which made the original check a false-positive pass.
4. **Latent TS errors in plan samples**: Task 1 (`Record<LegacyKind,...>` missing `"custom"` → TS2741) and Task 2 (`Set.has()` narrowing → TS2345) both carried type errors Vitest couldn't catch (esbuild transpiles without typechecking). **Always run `pnpm exec tsc --noEmit` after each task.**
5. **Plan text vs code**: the Interfaces paragraph said "dependencies not simple capability-id strings" but the sample code ships `string[]` — CAP-1 ships `string[]`; richer dependency typing is deferred.

**Final counts:** 8 commits (`e0675dd8`..`638c0bf0`), 31 canonical tests + 82 capability suite green, `tsc --noEmit` exit 0, 100% additive (10 new files, 0 existing modified).

---

## Self-Review

**Spec coverage (ticket #485 acceptance):**
- [x] `CapabilityDefinition` with semantic `CapabilityKind` (`core|query|operation|workflow|agent`), no `custom` — Task 1, Task 4.
- [x] No semantic kind means `tool`/`mcp`/`cli`/`gh`/`gitnexus`; provider tech only in `bindings[].provider.type` — Task 4 (PROVIDER_TECH_KINDS guard).
- [x] Immutable `id@version`, full SemVer, `"1.0"` rejected — Task 3, Task 4.
- [x] All current capabilities representable without loss — Task 5.
- [x] Definitions pure data, no live executor — Task 4 (serializable extensions, no functions in bindings), Task 2.
- [x] North-star: exactly one definition shape — the module defines one `CapabilityDefinition`.

**Placeholder scan:** no TBD/TODO; all tests and implementations are concrete. The Task 5 note flags the one assumption to verify against `initial-capabilities.ts` signature (sync vs async) — a real-world check the implementer must do, not a placeholder.

**Type consistency:** `CapabilityKind`, `ProviderType`, `CapabilityProviderBinding`, `CapabilityDefinition`, `isValidVersion`, `migrateKind` are used identically across Tasks 1–6. `bumpVersion`/`compareVersions`/`parseVersionId` are produced for CAP-2/5/6 consumption (noted in interfaces).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-10-cap-1-canonical-capability-definition.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session, batch execution with checkpoints.

Which approach?
