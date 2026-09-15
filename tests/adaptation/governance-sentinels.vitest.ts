import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { AgentCardApplier } from "../../src/adaptation/appliers/agent-card-applier.js";
import { SkillApplier } from "../../src/adaptation/appliers/skill-applier.js";
import { RevertApplier } from "../../src/adaptation/revert-applier.js";
import { selectApplier } from "../../src/cli/commands/adaptation.js";
import type { AdaptationProposal } from "../../src/adaptation/adaptation-types.js";
import { importedSpecifiers, codeOnly } from "../helpers/import-graph.js";

/** Read a file's source text for structural/grep-based checks. */
function sourceOf(relativePath: string): string {
  const resolved = path.resolve(__dirname, relativePath);
  return fs.readFileSync(resolved, "utf-8");
}

/**
 * Check for exact mutation patterns: `status: "approved"`, `status = "approved"`,
 * or `{...proposal, status: "approved"}`. Only flag files that use these patterns
 * outside the approved whitelist.
 */
function hasStatusAssignment(content: string, statusValue: string): boolean {
  // Exact mutation patterns — not comparisons like `status === "approved"`
  const patterns = [
    new RegExp(`status:\\s*"${statusValue}"`),         // { status: "approved" }
    new RegExp(`status\\s*=\\s*"${statusValue}"`),      // status = "approved"
  ];
  return patterns.some((p) => p.test(content));
}

/** File paths that are allowed to assign approval/apply status. */
const WHITELISTED_PATHS = [
  "approval-gate.ts",
  "adaptation-types.ts",
  ".vitest.ts",
  ".test.ts",
];

function isWhitelisted(filePath: string): boolean {
  return WHITELISTED_PATHS.some((w) => filePath.includes(w));
}

describe("Governance Invariants — no auto-approve", () => {
  it("must not assign status 'approved' outside approval-gate.ts or test/type files", () => {
    const dir = path.resolve(__dirname, "../../src/adaptation");
    const files = fs.readdirSync(dir, { recursive: true }) as string[];
    const tsFiles = files.filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".d.ts"),
    );

    for (const file of tsFiles) {
      if (isWhitelisted(file)) continue;
      const content = codeOnly(fs.readFileSync(path.join(dir, file), "utf-8"));
      if (hasStatusAssignment(content, "approved")) {
        expect.fail(
          `${file} assigns status "approved" outside allowed files (approval-gate.ts, tests, types only)`,
        );
      }
    }
  });
});

describe("Governance Invariants — no auto-apply", () => {
  it("must not assign status 'applied' outside approval-gate.ts or test/type files", () => {
    const dir = path.resolve(__dirname, "../../src/adaptation");
    const files = fs.readdirSync(dir, { recursive: true }) as string[];
    const tsFiles = files.filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".d.ts"),
    );

    for (const file of tsFiles) {
      if (isWhitelisted(file)) continue;
      const content = codeOnly(fs.readFileSync(path.join(dir, file), "utf-8"));
      if (hasStatusAssignment(content, "applied")) {
        expect.fail(
          `${file} assigns status "applied" outside allowed files (approval-gate.ts, tests, types only)`,
        );
      }
    }
  });
});

describe("Governance Invariants — no auto-revert", () => {
  it("AutomaticProposalGenerator must not produce revert_proposal actions", async () => {
    const source = codeOnly(sourceOf("../../src/adaptation/auto-proposal-generator.ts"));
    // The string "revert_proposal" should not appear in the generator source
    // (it's allowed in types/imports but not in any action-producing code path)
    const occurrences = source.match(/"revert_proposal"/g);
    if (occurrences && occurrences.length > 0) {
      // Check they're all in type annotations, not in action assignment
      const actionAssignments = source.match(/action:\s*"revert_proposal"/g);
      expect(actionAssignments).toBeNull();
    }
  });

  it("CapabilityEvolutionProposalGenerator must not produce revert_proposal actions", async () => {
    const source = codeOnly(sourceOf("../../src/adaptation/capability-evolution-proposal-generator.ts"));
    const actionAssignments = source.match(/action:\s*"revert_proposal"/g);
    expect(actionAssignments).toBeNull();
  });
});

describe("Governance Invariants — generator boundaries", () => {
  const FORBIDDEN_GENERATOR_IMPORTS = [
    "approval-gate",
    "agent-card-applier",
    "skill-applier",
    "revert-applier",
  ];

  for (const target of [
    "../../src/adaptation/auto-proposal-generator.ts",
    "../../src/adaptation/capability-evolution-proposal-generator.ts",
  ]) {
    it(`${target.split("/").pop()} must not import ApprovalGate or appliers`, () => {
      const specifiers = [...importedSpecifiers(path.resolve(__dirname, target))];
      for (const mod of FORBIDDEN_GENERATOR_IMPORTS) {
        expect(specifiers.some((s) => s.includes(mod)), `imports ${mod}`).toBe(false);
      }
    });
  }
});

describe("Governance Invariants — applier boundaries", () => {
  function draftProposal(kind: string): AdaptationProposal {
    return {
      id: "prop-test",
      createdAt: new Date().toISOString(),
      status: "draft",
      action: "create",
      target: { kind },
      payload: {},
      sourceRecommendationType: "test",
      confidence: 0.5,
    } as unknown as AdaptationProposal;
  }

  it.each([
    ["AgentCardApplier", (dir: string) => new AgentCardApplier(dir)],
    ["SkillApplier", (dir: string) => new SkillApplier(dir)],
    ["RevertApplier", (dir: string) => new RevertApplier(dir, {} as never)],
  ])("%s refuses non-approved proposals", async (_name, make) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "applier-guard-"));
    try {
      const applier = make(dir);
      await expect(applier.apply(draftProposal("agent_card"))).rejects.toThrow(/expected "approved"/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ["agent_card", "AgentCardApplier"],
    ["skill", "SkillApplier"],
    ["revert", "RevertApplier"],
  ])("selectApplier routes %s to %s", async (kind, name) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "applier-route-"));
    try {
      const apply = selectApplier(dir, draftProposal(kind), {} as never);
      // The routed applier identifies itself when refusing the draft.
      await expect(apply(draftProposal(kind))).rejects.toThrow(new RegExp(name));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
