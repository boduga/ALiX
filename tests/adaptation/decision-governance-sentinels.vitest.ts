import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { importedSpecifiers, importedBindings, codeOnly } from "../helpers/import-graph.js";

const TARGET = resolve(__dirname, "../../src/adaptation/decision-context-builder.ts");

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
    const specifiers = [...importedSpecifiers(TARGET)];
    for (const mod of FORBIDDEN_IMPORTS) {
      expect(specifiers.some((s) => s.includes(mod)), `imports ${mod}`).toBe(false);
    }
  });

  it("DecisionContextBuilder must not import governance types", () => {
    const bindings = importedBindings(TARGET);
    for (const type of FORBIDDEN_TYPES) {
      expect(bindings.has(type), `imports ${type}`).toBe(false);
    }
  });

  it("DecisionContextBuilder must not call save/update/approve/apply or proposal-generation methods", () => {
    const code = codeOnly(readFileSync(TARGET, "utf-8"));
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
      expect(code.includes(method), `calls ${method}`).toBe(false);
    }
  });
});
