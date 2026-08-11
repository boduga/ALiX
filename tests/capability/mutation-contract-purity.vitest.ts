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
