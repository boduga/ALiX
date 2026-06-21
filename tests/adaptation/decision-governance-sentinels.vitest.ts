import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/** Read a file's source text for structural/grep-based checks. */
function sourceOf(relativePath: string): string {
  const resolved = path.resolve(__dirname, relativePath);
  return fs.readFileSync(resolved, "utf-8");
}

describe("P6 Governance Invariants — Recommend ≠ Decide", () => {
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

  it("DecisionContextBuilder must not import governance/mutation modules", () => {
    const source = sourceOf(
      "../../src/adaptation/decision-context-builder.ts",
    );
    for (const mod of FORBIDDEN_IMPORTS) {
      expect(source).not.toContain(mod);
    }
  });

  it("DecisionContextBuilder must not reference governance types", () => {
    const source = sourceOf(
      "../../src/adaptation/decision-context-builder.ts",
    );
    for (const type of FORBIDDEN_TYPES) {
      expect(source).not.toContain(type);
    }
  });

  it("DecisionContextBuilder must not contain save/update/approve/apply or proposal-generation calls", () => {
    const source = sourceOf(
      "../../src/adaptation/decision-context-builder.ts",
    );
    const forbiddenMethods = [
      ".save(",
      ".update(",
      ".approve(",
      ".apply(",
      ".reject(",
      ".generateProposal(",
      "createProposal(",
      "generateFromReflection(",
      "generateFromEffectiveness(",
      "generateFromCapabilityEvolution(",
    ];
    for (const method of forbiddenMethods) {
      expect(source).not.toContain(method);
    }
  });
});
