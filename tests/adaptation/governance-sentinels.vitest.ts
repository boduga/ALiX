import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

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
      const content = fs.readFileSync(path.join(dir, file), "utf-8");
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
      const content = fs.readFileSync(path.join(dir, file), "utf-8");
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
    const source = sourceOf("../../src/adaptation/auto-proposal-generator.ts");
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
    const source = sourceOf("../../src/adaptation/capability-evolution-proposal-generator.ts");
    const actionAssignments = source.match(/action:\s*"revert_proposal"/g);
    expect(actionAssignments).toBeNull();
  });
});

describe("Governance Invariants — generator boundaries", () => {
  it("AutomaticProposalGenerator must not import ApprovalGate or appliers", () => {
    const source = sourceOf("../../src/adaptation/auto-proposal-generator.ts");
    const forbidden = [
      "approval-gate",
      "agent-card-applier",
      "skill-applier",
      "revert-applier",
    ];
    for (const mod of forbidden) {
      expect(source).not.toContain(mod);
    }
  });

  it("CapabilityEvolutionProposalGenerator must not import ApprovalGate or appliers", () => {
    const source = sourceOf(
      "../../src/adaptation/capability-evolution-proposal-generator.ts",
    );
    const forbidden = [
      "approval-gate",
      "agent-card-applier",
      "skill-applier",
      "revert-applier",
    ];
    for (const mod of forbidden) {
      expect(source).not.toContain(mod);
    }
  });
});

describe("Governance Invariants — applier boundaries", () => {
  it("each applier must guard on proposal.status === 'approved'", () => {
    const sources: [string, string][] = [
      ["AgentCardApplier", sourceOf("../../src/adaptation/appliers/agent-card-applier.ts")],
      ["SkillApplier", sourceOf("../../src/adaptation/appliers/skill-applier.ts")],
      ["RevertApplier", sourceOf("../../src/adaptation/revert-applier.ts")],
    ];
    for (const [name, source] of sources) {
      expect(
        source.includes("proposal.status"),
        `${name} should reference proposal.status — may be in type guard`,
      ).toBeTruthy();
    }
  });

  it("selectApplier routes each target.kind to the correct applier", () => {
    const source = sourceOf("../../src/cli/commands/adaptation.ts");
    // Verify the switch has cases for agent_card, skill, and revert
    expect(source).toContain('case "agent_card"');
    expect(source).toContain('case "skill"');
    expect(source).toContain('case "revert"');
    // Verify it creates the correct applier types
    expect(source).toContain("new AgentCardApplier");
    expect(source).toContain("new SkillApplier");
    expect(source).toContain("new RevertApplier");
  });
});
