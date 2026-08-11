// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityRegistry } from "../../../src/capability/registry.js";
import { NativeExecutor } from "../../../src/capability/executors.js";
import { registerInitialCapabilities } from "../../../src/capability/initial-capabilities.js";
import type { Capability } from "../../../src/capability/types.js";
// Task 5 wires the CAP-2 barrel — the whole slice is consumed through it so a
// missing/invalid export fails this test, not the individual unit tests.
import {
  CapabilityDefinitionStore,
  CapabilityCatalog,
  loadCatalogWithPrecedence,
  BOOTSTRAP_SOURCE_ORDER,
  evaluateDefinitionAuthoring,
  migrateKind,
  validateCapabilityDefinition,
  isValidVersion,
  bumpVersion,
  PROVIDER_TYPES,
} from "../../../src/capability/canonical/index.js";
import type {
  CapabilityBootstrapEntry,
  CapabilityBootstrapProvider,
  CapabilityDefinition,
  CapabilityProviderBinding,
  ProviderType,
} from "../../../src/capability/canonical/index.js";

/** Map an execution strategy to a ProviderType. Fails loudly on an unknown
 *  strategy so a genuinely unmappable current capability surfaces as a real
 *  migration blocker instead of being papered over. */
function providerTypeOf(strategy: string): ProviderType {
  const type = PROVIDER_TYPES.find((p) => p === strategy);
  if (!type) {
    throw new Error(`capability: execution strategy '${strategy}' has no canonical ProviderType (${PROVIDER_TYPES.join("|")})`);
  }
  return type;
}

/** Lossless projection of a current Capability onto the canonical CapabilityDefinition.
 *  Version fix (Task 5): legacy "1.0" must normalize to full "1.0.0" — CAP-1
 *  isValidVersion requires MAJOR.MINOR.PATCH, so catalog.register() would throw
 *  on a 2-part version. The naive endsWith(".0") map keeps "1.0" and fails. */
function toDefinition(cap: Capability): CapabilityDefinition {
  const binding: CapabilityProviderBinding = {
    id: cap.id,
    type: providerTypeOf(cap.execution.strategy),
  };
  return {
    id: cap.id,
    version: cap.version.split(".").length === 2 ? `${cap.version}.0` : cap.version,
    kind: migrateKind(cap.kind),
    title: cap.title,
    description: cap.description,
    ...(cap.aliases !== undefined ? { aliases: cap.aliases } : {}),
    tags: cap.tags,
    category: cap.category,
    risk: cap.risk,
    requiredPermissions: cap.requiredPermissions,
    ...(cap.argsSchema !== undefined ? { argsSchema: cap.argsSchema } : {}),
    ...(cap.resultSchema !== undefined ? { resultSchema: cap.resultSchema } : {}),
    ...(cap.examples !== undefined ? { examples: cap.examples } : {}),
    dependencies: cap.dependencies ?? [],
    bindings: [binding],
    ...(cap.extensions !== undefined ? { extensions: cap.extensions } : {}),
  };
}

/** Snapshot the currently-registered legacy capabilities. */
function currentCapabilities(): Capability[] {
  const registry = new CapabilityRegistry();
  registerInitialCapabilities(registry, new NativeExecutor());
  return registry.list();
}

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("CAP-2 catalog integration (barrel-wired)", () => {
  it("barrel exports the whole CAP-2 slice (store, catalog, bootstrap, authoring)", () => {
    expect(typeof CapabilityDefinitionStore).toBe("function");
    expect(typeof CapabilityCatalog).toBe("function");
    expect(typeof loadCatalogWithPrecedence).toBe("function");
    expect(typeof evaluateDefinitionAuthoring).toBe("function");
    // CAP-1 exports must still flow through the barrel untouched (purely additive).
    expect(typeof migrateKind).toBe("function");
    expect(typeof validateCapabilityDefinition).toBe("function");
    expect(typeof isValidVersion).toBe("function");
    expect(typeof bumpVersion).toBe("function");
    expect(Array.isArray(PROVIDER_TYPES)).toBe(true);
    expect(BOOTSTRAP_SOURCE_ORDER[0]).toBe("built-in");
  });

  it("registers every currently-registered capability into a durable catalog without loss", () => {
    const dir = tempDir("cap2-int-");
    try {
      const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
      const caps = currentCapabilities();
      expect(caps.length).toBeGreaterThan(0);

      for (const cap of caps) {
        const def = toDefinition(cap);
        // register() validates via the CAP-1 contract and throws on a short
        // version — the version fix guarantees every legacy "1.0" → "1.0.0".
        expect(() => catalog.register(def)).not.toThrow();
      }

      // The migration is lossless — every current field survives.
      expect(catalog.list()).toHaveLength(caps.length);
      for (const cap of caps) {
        expect(isValidVersion(cap.version) || isValidVersion(`${cap.version}.0`)).toBe(true);
        const def = catalog.get(cap.id);
        expect(def).toBeDefined();
        expect(def!.version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(def!.id).toBe(cap.id);
        expect(def!.title).toBe(cap.title);
        expect(def!.description).toBe(cap.description);
        expect(def!.tags).toEqual(cap.tags);
        expect(def!.category).toBe(cap.category);
        expect(def!.risk).toBe(cap.risk);
        expect(def!.requiredPermissions).toEqual(cap.requiredPermissions);
        expect(def!.bindings[0].type).toBe(providerTypeOf(cap.execution.strategy));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists definitions to JSONL and resolves the highest version across a store reload", () => {
    const dir = tempDir("cap2-persist-");
    try {
      const store1 = new CapabilityDefinitionStore({ dir });
      const catalog1 = new CapabilityCatalog(store1);
      const defs = currentCapabilities().map(toDefinition);
      for (const def of defs) catalog1.register(def);

      // A second, newer version of the first capability.
      const base = defs[0];
      const newer = { ...base, version: bumpVersion(base.version, "minor") };
      catalog1.register(newer);
      expect(catalog1.get(base.id)?.version).toBe(newer.version);

      // Fresh store over the same dir reloads the durable JSONL (atomic append).
      const catalog2 = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
      expect(catalog2.list()).toHaveLength(defs.length + 1);
      expect(catalog2.get(base.id)?.version).toBe(newer.version);
      expect(catalog2.has("core.session.list")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("bootstrap source precedence feeds the catalog and rejects non-canonical entries", () => {
    const dir = tempDir("cap2-boot-");
    try {
      const defs = currentCapabilities().map(toDefinition);
      const builtIn: CapabilityBootstrapProvider = {
        source: "built-in",
        load: () => defs.map((definition) => ({ definition, source: "built-in" } as CapabilityBootstrapEntry)),
      };
      const overrides: CapabilityBootstrapProvider = {
        source: "overrides",
        load: () => [{ definition: { ...defs[0], title: "overridden title" }, source: "overrides" }],
      };
      // Providers are passed in reverse order — loadCatalogWithPrecedence
      // re-orders by BOOTSTRAP_SOURCE_ORDER so "overrides" wins the same id@version.
      const entries = loadCatalogWithPrecedence([overrides, builtIn]);
      expect(entries.find((e) => e.definition.id === defs[0].id)?.definition.title).toBe("overridden title");

      // Every bootstrap entry must pass canonical validation; a short "1.0"
      // version is rejected at the bootstrap boundary, not silently accepted.
      expect(() => loadCatalogWithPrecedence([
        { source: "built-in", load: () => [{ definition: { ...defs[0], version: "1.0" }, source: "built-in" }] },
      ])).toThrow(/capability:/);

      const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
      for (const entry of entries) catalog.register(entry.definition, entry.binding);
      expect(catalog.list()).toHaveLength(defs.length);
      expect(catalog.get(defs[0].id)?.title).toBe("overridden title");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("authoring gate: mapped definitions are valid; raw legacy capabilities are incomplete", () => {
    const caps = currentCapabilities();
    // A fully-migrated definition passes the two-phase authoring gate.
    for (const cap of caps) {
      expect(evaluateDefinitionAuthoring(toDefinition(cap)).status).toBe("valid");
    }
    // The raw legacy capability is NOT a canonical definition yet: short version
    // and legacy kind both fail the gate (A7 never invents defaults).
    const raw = evaluateDefinitionAuthoring({
      id: caps[0].id,
      version: caps[0].version,
      kind: caps[0].kind as CapabilityDefinition["kind"],
      title: caps[0].title,
    });
    expect(raw.status).toBe("incomplete");
    expect(raw.missing.length).toBeGreaterThan(0);
  });
});
