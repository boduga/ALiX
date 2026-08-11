// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const SRC = resolve(import.meta.dirname, "../../src/capability/mutation-contract.ts");
const source = readFileSync(SRC, "utf8");

/** Pure import-scan + allowlist filter. Shared by the layer-1 allowlist test and
 *  the negative regression test so the scan/filter logic is pinned in one place. */
function bannedImports(sourceText: string, allowlist: string[]): string[] {
  const imports = [...sourceText.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  return imports.filter((p) => !allowlist.some((a) => p.startsWith(a)));
}

/** CAP-5 purity invariant: mutation-contract.ts must stay a pure contract —
 *  no registry/persistence/executor/runtime/governance wiring. */
describe("mutation-contract.ts purity (user ruling)", () => {
  it("imports only the allowed contract modules", () => {
    // user ruling pins adaptation imports to ONLY LifecycleState from
    // ../adaptation/capability-evolution-types.js — no prefix-wildcard for
    // the rest of src/adaptation (stores, analyzers, appliers, etc.)
    const allowed = [
      "./canonical/",
      "../adaptation/capability-evolution-types.js",
      "../evolution/contracts/evolution-contract.js",
    ];
    expect(bannedImports(source, allowed)).toEqual([]);
  });

  it("catches a forbidden persistence/runtime import from src/adaptation (user ruling)", () => {
    const synthetic = 'import type { EffectivenessStore } from "../adaptation/effectiveness-store.js";\n';
    const banned = bannedImports(synthetic, [
      "./canonical/",
      "../adaptation/capability-evolution-types.js",
      "../evolution/contracts/evolution-contract.js",
    ]);
    expect(banned).toContain("../adaptation/effectiveness-store.js");
  });

  it("does not reference registry, runtime, executor, or platform symbols", () => {
    for (const symbol of ["CapabilityRegistry", "CapabilityRuntime", "ProviderExecutor", "CapabilityPlatform", "CapabilityMutationPort"]) {
      expect(source).not.toMatch(new RegExp(`\\b${symbol}\\b`));
    }
  });

  it("has no side-effect statements (no new/assignments outside functions)", () => {
    // heuristic: no `new ` allocations — Set/Map are pure data structures and
    // are allowed inside validator functions; no top-level `console.`/`process.` calls
    expect(source).not.toMatch(/\bnew\s+(?!Set\b|Map\b)[A-Z]/);
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
