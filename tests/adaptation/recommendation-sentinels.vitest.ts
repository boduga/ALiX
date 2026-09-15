/**
 * P6.1 — Governance sentinels for RecommendationEngine.
 *
 * Enforces the Recommend ≠ Decide invariant structurally: RecommendationEngine
 * must not import governance/mutation modules, import governance/store types,
 * or call write/approve/apply/reject methods. Dependency claims are checked
 * against the real import graph (#697), not a whole-file substring scan, so a
 * comment or unrelated mention no longer satisfies them.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { importedSpecifiers, importedBindings, codeOnly } from "../helpers/import-graph.js";

const ENGINE = path.resolve(__dirname, "../../src/adaptation/recommendation-engine.ts");

const FORBIDDEN_MODULE_FRAGMENTS = [
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

describe("RecommendationEngine governance sentinels", () => {
  it("does not import governance/mutation modules", () => {
    const specifiers = [...importedSpecifiers(ENGINE)];
    for (const frag of FORBIDDEN_MODULE_FRAGMENTS) {
      expect(specifiers.some((s) => s.includes(frag)), `imports ${frag}`).toBe(false);
    }
  });

  it("does not import governance types", () => {
    const bindings = importedBindings(ENGINE);
    for (const type of FORBIDDEN_TYPES) {
      expect(bindings.has(type), `imports type ${type}`).toBe(false);
    }
  });

  it("does not import store types", () => {
    const bindings = importedBindings(ENGINE);
    for (const store of FORBIDDEN_STORES) {
      expect(bindings.has(store), `imports store ${store}`).toBe(false);
    }
  });

  it("does not call write/approve/apply/reject methods", () => {
    const code = codeOnly(fs.readFileSync(ENGINE, "utf-8"));
    const forbidden = [".save(", ".update(", ".approve(", ".apply(", ".reject(", ".queue("];
    for (const method of forbidden) {
      expect(code.includes(method), `calls ${method}`).toBe(false);
    }
  });

  it("constructor accepts no arguments (no store injection)", () => {
    const code = codeOnly(fs.readFileSync(ENGINE, "utf-8"));
    const match = code.match(/constructor\([^)]*\)/);
    if (match) expect(match[0]).toBe("constructor()");
  });
});
