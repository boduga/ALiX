import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/** Read a file's source text for structural/grep-based checks. */
function sourceOf(relativePath: string): string {
  const resolved = path.resolve(__dirname, relativePath);
  return fs.readFileSync(resolved, "utf-8");
}

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

  const RECOMMENDATION_PATTERNS: RegExp[] = [
    /\bapprove\b/,  // avoids matching "approved" (legitimate status value)
    /\breject\b/,   // avoids matching "rejected" (legitimate status value)
    /\bdefer\b/,
    // "investigate" is excluded — it appears legitimately as a
    // DecisionContext outcome value the scoring functions must read.
  ];

  it("must not import governance/mutation modules", () => {
    const source = sourceOf("../../src/adaptation/risk-score-builder.ts");
    for (const mod of FORBIDDEN_IMPORTS) {
      expect(source).not.toContain(mod);
    }
  });

  it("must not reference governance types", () => {
    const source = sourceOf("../../src/adaptation/risk-score-builder.ts");
    for (const type of FORBIDDEN_TYPES) {
      expect(source).not.toContain(type);
    }
  });

  it("must not contain recommendation language", () => {
    const source = sourceOf("../../src/adaptation/risk-score-builder.ts");
    for (const pattern of RECOMMENDATION_PATTERNS) {
      expect(source).not.toMatch(pattern);
    }
  });

  it("must not contain write/approve/apply calls", () => {
    const source = sourceOf("../../src/adaptation/risk-score-builder.ts");
    const forbidden = [".save(", ".update(", ".approve(", ".apply(", ".reject("];
    for (const method of forbidden) {
      expect(source).not.toContain(method);
    }
  });

  it("constructor must not accept stores", () => {
    // Architectural sentinel: RiskScoreBuilder should only receive a DecisionContext,
    // not stores. If its constructor signature changes to accept stores, this fails.
    const source = sourceOf("../../src/adaptation/risk-score-builder.ts");
    // Check the class doesn't reference ProposalStore, EvidenceStore, etc. in constructor
    const storePatterns = ["ProposalStore", "EvidenceStore", "LineageBuilder", "IntelligenceStore", "EffectivenessStore"];
    for (const store of storePatterns) {
      expect(source).not.toContain(store);
    }
  });
});
