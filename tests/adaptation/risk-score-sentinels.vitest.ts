import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { importedSpecifiers, importedBindings, codeOnly } from "../helpers/import-graph.js";

const TARGET = resolve(__dirname, "../../src/adaptation/risk-score-builder.ts");

describe("P6 Governance Invariants — RiskScore must not recommend", () => {
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

  const STORE_TYPES = ["ProposalStore", "EvidenceStore", "LineageBuilder", "IntelligenceStore", "EffectivenessStore"];

  const RECOMMENDATION_PATTERNS: RegExp[] = [
    /\bapprove\b/,  // avoids matching "approved" (legitimate status value)
    /\breject\b/,   // avoids matching "rejected" (legitimate status value)
    /\bdefer\b/,
    // "investigate" is excluded — it appears legitimately as a
    // DecisionContext outcome value the scoring functions must read.
  ];

  it("must not import governance/mutation modules", () => {
    const specifiers = [...importedSpecifiers(TARGET)];
    for (const mod of FORBIDDEN_IMPORTS) {
      expect(specifiers.some((s) => s.includes(mod)), `imports ${mod}`).toBe(false);
    }
  });

  it("must not import governance types", () => {
    const bindings = importedBindings(TARGET);
    for (const type of FORBIDDEN_TYPES) {
      expect(bindings.has(type), `imports ${type}`).toBe(false);
    }
  });

  it("must not contain recommendation language", () => {
    const code = codeOnly(readFileSync(TARGET, "utf-8"));
    for (const pattern of RECOMMENDATION_PATTERNS) {
      expect(code).not.toMatch(pattern);
    }
  });

  it("must not call write/approve/apply methods", () => {
    const code = codeOnly(readFileSync(TARGET, "utf-8"));
    const forbidden = [".save(", ".update(", ".approve(", ".apply(", ".reject("];
    for (const method of forbidden) {
      expect(code.includes(method), `calls ${method}`).toBe(false);
    }
  });

  it("constructor must not accept stores", () => {
    const bindings = importedBindings(TARGET);
    for (const store of STORE_TYPES) {
      expect(bindings.has(store), `imports store ${store}`).toBe(false);
    }
  });
});
