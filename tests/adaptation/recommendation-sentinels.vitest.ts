/**
 * P6.1 — Governance sentinels for RecommendationEngine.
 *
 * Enforces the Recommend ≠ Decide invariant at the source-code level.
 * RecommendationEngine must not import governance/mutation modules,
 * reference governance types, contain recommendation-as-action language,
 * or call write/approve/apply methods.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

function sourceOf(relativePath: string): string {
  const resolved = path.resolve(__dirname, relativePath);
  return fs.readFileSync(resolved, "utf-8");
}

const FORBIDDEN_IMPORTS = [
  "approval-gate",
  "agent-card-applier",
  "skill-applier",
  "revert-applier",
  "auto-proposal-generator",
  "capability-evolution-proposal-generator",
];

const FORBIDDEN_TYPES = [
  "ApprovalGate",
  "Applier",
  "AgentCardApplier",
  "SkillApplier",
  "RevertApplier",
  "AutomaticProposalGenerator",
  "CapabilityEvolutionProposalGenerator",
];

const FORBIDDEN_STORES = [
  "ProposalStore",
  "EvidenceStore",
  "LineageBuilder",
  "IntelligenceStore",
  "EffectivenessStore",
];

it("must not import governance/mutation modules", () => {
  const source = sourceOf("../../src/adaptation/recommendation-engine.ts");
  for (const mod of FORBIDDEN_IMPORTS) {
    expect(source).not.toContain(mod);
  }
});

it("must not reference governance types", () => {
  const source = sourceOf("../../src/adaptation/recommendation-engine.ts");
  for (const type of FORBIDDEN_TYPES) {
    expect(source).not.toContain(type);
  }
});

it("must not reference store types in source", () => {
  const source = sourceOf("../../src/adaptation/recommendation-engine.ts");
  for (const store of FORBIDDEN_STORES) {
    expect(source).not.toContain(store);
  }
});

it("must not contain write/approve/apply/reject calls", () => {
  const source = sourceOf("../../src/adaptation/recommendation-engine.ts");
  const forbidden = [".save(", ".update(", ".approve(", ".apply(", ".reject(", ".queue("];
  for (const method of forbidden) {
    expect(source).not.toContain(method);
  }
});

// No vocabulary grep needed — recommendation/approve/reject/defer/investigate are
// legitimate domain model values in the recommendation engine. Only imperative
// calls (.apply(), .save(), etc.) and governance imports are forbidden.

it("constructor must not accept stores", () => {
  const source = sourceOf("../../src/adaptation/recommendation-engine.ts");
  // The constructor should only accept no arguments
  const constructorMatch = source.match(/constructor\([^)]*\)/);
  if (constructorMatch) {
    const params = constructorMatch[0];
    expect(params).toBe("constructor()");
  }
});
