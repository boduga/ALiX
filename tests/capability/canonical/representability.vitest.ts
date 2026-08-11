// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { CapabilityRegistry } from "../../../src/capability/registry.js";
import { NativeExecutor } from "../../../src/capability/executors.js";
import { registerInitialCapabilities } from "../../../src/capability/initial-capabilities.js";
import type { Capability } from "../../../src/capability/types.js";
import { migrateKind } from "../../../src/capability/canonical/kind.js";
import { validateCapabilityDefinition } from "../../../src/capability/canonical/definition.js";
import type { CapabilityDefinition } from "../../../src/capability/canonical/definition.js";
import { isValidVersion } from "../../../src/capability/canonical/version.js";
import { PROVIDER_TYPES } from "../../../src/capability/canonical/provider.js";
import type { ProviderType } from "../../../src/capability/canonical/provider.js";

/** Normalize short SemVer to full MAJOR.MINOR.PATCH ("1.0" -> "1.0.0").
 *  Already-full versions pass through unchanged. */
function normalizeVersion(v: string): string {
  const parts = v.split(".").map((p) => p.trim());
  while (parts.length < 3) parts.push("0");
  const normalized = parts.join(".");
  if (!isValidVersion(normalized)) {
    throw new Error(`capability: version '${v}' cannot be normalized to full SemVer MAJOR.MINOR.PATCH`);
  }
  return normalized;
}

/** Map an execution strategy to a ProviderType. Fails loudly on an unknown
 *  strategy so a genuinely unmappable current capability surfaces as a
 *  real migration blocker instead of being papered over. */
function providerTypeOf(strategy: string): ProviderType {
  const type = PROVIDER_TYPES.find((p) => p === strategy);
  if (!type) {
    throw new Error(`capability: execution strategy '${strategy}' has no canonical ProviderType (${PROVIDER_TYPES.join("|")})`);
  }
  return type;
}

/** Lossless projection of a current Capability onto the canonical CapabilityDefinition.
 *  Semantic kind via migrateKind, version normalized to full SemVer, bindings
 *  derived from execution.strategy. */
function toCapabilityDefinition(cap: Capability): CapabilityDefinition {
  return {
    id: cap.id,
    version: normalizeVersion(cap.version),
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
    bindings: [{ id: cap.id, type: providerTypeOf(cap.execution.strategy) }],
    ...(cap.extensions !== undefined ? { extensions: cap.extensions } : {}),
  };
}

describe("CAP-1 representability", () => {
  it("maps every currently-registered capability to a valid CapabilityDefinition without loss", () => {
    const registry = new CapabilityRegistry();
    const native = new NativeExecutor(); // NativeExecutor ctor is dependency-free
    registerInitialCapabilities(registry, native);
    const caps = registry.list();

    expect(caps.length).toBeGreaterThan(0);
    for (const cap of caps) {
      const def = toCapabilityDefinition(cap);
      // Mapping must be lossless — the canonical definition carries every
      // current field, and validates against the CAP-1 contract.
      expect(() => validateCapabilityDefinition(def)).not.toThrow();
      expect(def.id).toBe(cap.id);
      expect(def.title).toBe(cap.title);
      expect(def.description).toBe(cap.description);
      expect(def.tags).toEqual(cap.tags);
      expect(def.category).toBe(cap.category);
      expect(def.risk).toBe(cap.risk);
      expect(def.requiredPermissions).toEqual(cap.requiredPermissions);
      expect(def.bindings[0].type).toBe(providerTypeOf(cap.execution.strategy));
    }
  });

  it("normalizes current short SemVer versions to full MAJOR.MINOR.PATCH", () => {
    const registry = new CapabilityRegistry();
    registerInitialCapabilities(registry, new NativeExecutor());
    for (const cap of registry.list()) {
      expect(isValidVersion(cap.version) ? cap.version : normalizeVersion(cap.version)).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});
