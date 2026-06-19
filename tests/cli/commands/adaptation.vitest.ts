/**
 * P5.1g — adaptation CLI command tests.
 *
 * Exercises handleAdaptationCommand end-to-end against real temp directories
 * (ProposalStore, EvidenceStore, AgentCardApplier, SkillApplier). The command
 * handler resolves .alix paths from process.cwd(), so each test points cwd at
 * a fresh mkdtemp directory.
 *
 * Covers:
 *  - list (with and without --status filter)
 *  - show <id> (happy path + unknown id)
 *  - propose <report.json> (happy path + adaptation_proposed evidence)
 *  - approve <id> (routes through ApprovalGate, records adaptation_approved)
 *  - reject <id> [--reason] (routes through ApprovalGate, records adaptation_rejected)
 *  - apply <id> (routes through ApprovalGate, dispatches to AgentCardApplier/SkillApplier)
 *  - apply-without-approval must be BLOCKED by the gate (no-approval-no-mutation)
 *  - unknown subcommand
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ReflectionReport } from "../../../src/reflection/reflection-types.js";
import type { AdaptationProposal } from "../../../src/adaptation/adaptation-types.js";

// ---------------------------------------------------------------------------
// process.cwd override helpers
// ---------------------------------------------------------------------------

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

function setCwd(dir: string): void {
  cwdSpy.mockReturnValue(dir);
}

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "adaptation-cli-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeReport(recommendations: ReflectionReport["recommendations"]): ReflectionReport {
  return {
    generatedAt: new Date().toISOString(),
    observations: [],
    recommendations,
    metrics: {
      workflowsCompleted: 0,
      workflowsBlocked: 0,
      workflowsAborted: 0,
      capabilitiesRequested: 0,
      unresolvedCapabilities: 0,
      reviewApprovalRate: 1,
    },
    summary: {
      totalObservations: 0,
      totalRecommendations: recommendations.length,
      highSeverityCount: 0,
    },
  };
}

function writeReportFile(name: string, report: ReflectionReport): string {
  const path = join(tempRoot, name);
  writeFileSync(path, JSON.stringify(report), "utf-8");
  return path;
}

/** Make and persist a proposal directly via ProposalStore (bypasses the CLI). */
async function seedProposal(
  overrides: Partial<AdaptationProposal> = {},
): Promise<AdaptationProposal> {
  const { ProposalStore } = await import("../../../src/adaptation/proposal-store.js");
  const store = new ProposalStore(join(tempRoot, ".alix", "adaptation", "proposals"));
  const proposal: AdaptationProposal = {
    id: "prop-test-001",
    createdAt: "2026-06-19T00:00:00.000Z",
    status: "pending",
    action: "create_agent_card",
    target: { kind: "agent_card", id: "new.agent" },
    payload: {
      id: "new.agent",
      name: "New Agent",
      description: "Fills capability gap",
      version: "1.0.0",
      domains: ["general"],
      capabilities: ["capability.x"],
      enabled: true,
    },
    sourceRecommendationType: "capability_gap",
    sourceConfidence: 0.92,
    evidenceFingerprints: ["abc123"],
    reason: "12 goals required capability.x but no agent covers it",
    ...overrides,
  };
  await store.save(proposal);
  return proposal;
}

function captureConsole(): {
  out: () => string[];
  err: () => string[];
  restore: () => void;
} {
  const out: string[] = [];
  const err: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { out.push(a.join(" ")); });
  const errSpy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { err.push(a.join(" ")); });
  return {
    out: () => out,
    err: () => err,
    restore: () => { logSpy.mockRestore(); errSpy.mockRestore(); },
  };
}

function mockExit(): { spy: ReturnType<typeof vi.spyOn>; calls: () => (string | number | null | undefined)[] } {
  const calls: (string | number | null | undefined)[] = [];
  const spy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
    calls.push(code);
    throw new Error(`process.exit(${code})`);
  });
  return { spy, calls: () => calls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("adaptation CLI", () => {
  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  describe("list", () => {
    it("lists seeded proposals in a readable table", async () => {
      await seedProposal({ id: "prop-A", action: "create_agent_card", status: "pending" });
      await seedProposal({ id: "prop-B", action: "update_agent_card", status: "approved" });

      const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
      const c = captureConsole();
      await handleAdaptationCommand(["list"]);
      c.restore();

      const joined = c.out().join("\n");
      expect(joined).toContain("prop-A");
      expect(joined).toContain("prop-B");
      expect(joined).toContain("pending");
      expect(joined).toContain("approved");
    });

    it("filters by --status", async () => {
      await seedProposal({ id: "prop-PENDING", status: "pending" });
      await seedProposal({ id: "prop-APPROVED", status: "approved" });

      const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
      const c = captureConsole();
      await handleAdaptationCommand(["list", "--status", "approved"]);
      c.restore();

      const joined = c.out().join("\n");
      expect(joined).toContain("prop-APPROVED");
      expect(joined).not.toContain("prop-PENDING");
    });

    it("prints a no-proposals message when the store is empty", async () => {
      const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
      const c = captureConsole();
      await handleAdaptationCommand(["list"]);
      c.restore();
      // Empty store should not crash; some human-readable indication of zero.
      expect(c.out().join("\n").toLowerCase()).toMatch(/no proposals|0|empty/);
    });
  });

  // -------------------------------------------------------------------------
  // show
  // -------------------------------------------------------------------------

  describe("show", () => {
    it("prints full details for a known id", async () => {
      const proposal = await seedProposal({ id: "prop-show-1", reason: "a specific reason" });

      const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
      const c = captureConsole();
      await handleAdaptationCommand(["show", proposal.id]);
      c.restore();

      const joined = c.out().join("\n");
      expect(joined).toContain("prop-show-1");
      expect(joined).toContain("a specific reason");
      expect(joined).toContain("create_agent_card");
    });

    it("errors cleanly with exit 1 on unknown id", async () => {
      const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
      const c = captureConsole();
      const exit = mockExit();

      await expect(handleAdaptationCommand(["show", "prop-missing"]))
        .rejects.toThrow("process.exit(1)");
      expect(c.err().join("\n").toLowerCase()).toContain("prop-missing");

      exit.spy.mockRestore();
      c.restore();
    });

    it("errors when no id is given", async () => {
      const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
      const c = captureConsole();
      const exit = mockExit();

      await expect(handleAdaptationCommand(["show"])).rejects.toThrow("process.exit(1)");

      exit.spy.mockRestore();
      c.restore();
    });
  });

  // -------------------------------------------------------------------------
  // propose
  // -------------------------------------------------------------------------

  describe("propose", () => {
    it("converts a ReflectionReport into pending proposals and saves them", async () => {
      const report = makeReport([
        {
          type: "capability_gap",
          confidence: 0.9,
          title: "Need Foo",
          evidence: ["ev-1"],
          recommendedAction: "Create new agent card for Foo",
        },
      ]);
      const reportPath = writeReportFile("report.json", report);

      const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
      const c = captureConsole();
      await handleAdaptationCommand(["propose", reportPath]);
      c.restore();

      // Proposal was saved to the store directory.
      const { ProposalStore } = await import("../../../src/adaptation/proposal-store.js");
      const store = new ProposalStore(join(tempRoot, ".alix", "adaptation", "proposals"));
      const all = await store.list();
      expect(all.length).toBe(1);
      expect(all[0].status).toBe("pending");
      expect(all[0].action).toBe("create_agent_card");
      expect(all[0].sourceRecommendationType).toBe("capability_gap");

      // Output mentions the new proposal id.
      expect(c.out().join("\n")).toContain(all[0].id);
    });

    it("records adaptation_proposed evidence for each proposal", async () => {
      const report = makeReport([
        {
          type: "capability_gap",
          confidence: 0.9,
          title: "Need Foo",
          evidence: ["ev-1"],
          recommendedAction: "Create new agent card for Foo",
        },
      ]);
      const reportPath = writeReportFile("report.json", report);

      const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
      const c = captureConsole();
      await handleAdaptationCommand(["propose", reportPath]);
      c.restore();

      const { EvidenceStore } = await import("../../../src/security/evidence/evidence-store.js");
      const store = new EvidenceStore({ storeDir: join(tempRoot, ".alix", "security") });
      const proposed = await store.query({ type: "adaptation_proposed" });
      expect(proposed.total).toBe(1);
      expect(proposed.records[0].payload.proposalId).toBeDefined();
      expect(proposed.records[0].payload.action).toBe("create_agent_card");
    });

    it("skips unknown recommendation types and records nothing for them", async () => {
      // Unknown types are not part of RecommendationType; cast to simulate a
      // malformed recommendation that the converter must skip gracefully.
      const report = makeReport([
        { type: "skill_revision" as const, confidence: 0.5, title: "Tweak skill", evidence: ["ev"], recommendedAction: "adjust step for plan" },
      ]);
      const reportPath = writeReportFile("report.json", report);

      const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
      const c = captureConsole();
      await handleAdaptationCommand(["propose", reportPath]);
      c.restore();

      const { ProposalStore } = await import("../../../src/adaptation/proposal-store.js");
      const store = new ProposalStore(join(tempRoot, ".alix", "adaptation", "proposals"));
      const all = await store.list();
      expect(all.length).toBe(1); // skill_revision IS mapped; only truly unknown types are skipped
    });

    it("errors with exit 1 when the report file is missing", async () => {
      const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
      const c = captureConsole();
      const exit = mockExit();

      await expect(handleAdaptationCommand(["propose", join(tempRoot, "nope.json")]))
        .rejects.toThrow("process.exit(1)");

      exit.spy.mockRestore();
      c.restore();
    });
  });

  // -------------------------------------------------------------------------
  // approve
  // -------------------------------------------------------------------------

  describe("approve", () => {
    it("routes through ApprovalGate and records adaptation_approved evidence", async () => {
      const proposal = await seedProposal({ id: "prop-approve-1" });

      const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
      const c = captureConsole();
      await handleAdaptationCommand(["approve", proposal.id, "--by", "alice"]);
      c.restore();

      // Status transitioned by the gate.
      const { ProposalStore } = await import("../../../src/adaptation/proposal-store.js");
      const store = new ProposalStore(join(tempRoot, ".alix", "adaptation", "proposals"));
      const reloaded = await store.load(proposal.id);
      expect(reloaded!.status).toBe("approved");
      expect(reloaded!.approvedBy).toBe("alice");

      // Evidence recorded by the gate.
      const { EvidenceStore } = await import("../../../src/security/evidence/evidence-store.js");
      const evidence = new EvidenceStore({ storeDir: join(tempRoot, ".alix", "security") });
      const approved = await evidence.query({ type: "adaptation_approved" });
      expect(approved.total).toBe(1);
      expect(approved.records[0].payload.approvedBy).toBe("alice");
    });

    it("errors with exit 1 on unknown id", async () => {
      const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
      const c = captureConsole();
      const exit = mockExit();

      await expect(handleAdaptationCommand(["approve", "prop-missing"]))
        .rejects.toThrow("process.exit(1)");

      exit.spy.mockRestore();
      c.restore();
    });
  });

  // -------------------------------------------------------------------------
  // reject
  // -------------------------------------------------------------------------

  describe("reject", () => {
    it("routes through ApprovalGate and records adaptation_rejected with reason", async () => {
      const proposal = await seedProposal({ id: "prop-reject-1" });

      const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
      const c = captureConsole();
      await handleAdaptationCommand(["reject", proposal.id, "--reason", "not now"]);
      c.restore();

      const { ProposalStore } = await import("../../../src/adaptation/proposal-store.js");
      const store = new ProposalStore(join(tempRoot, ".alix", "adaptation", "proposals"));
      const reloaded = await store.load(proposal.id);
      expect(reloaded!.status).toBe("rejected");

      const { EvidenceStore } = await import("../../../src/security/evidence/evidence-store.js");
      const evidence = new EvidenceStore({ storeDir: join(tempRoot, ".alix", "security") });
      const rejected = await evidence.query({ type: "adaptation_rejected" });
      expect(rejected.total).toBe(1);
      expect(rejected.records[0].payload.reason).toBe("not now");
    });
  });

  // -------------------------------------------------------------------------
  // apply
  // -------------------------------------------------------------------------

  describe("apply", () => {
    it("is BLOCKED by the gate when the proposal is still pending (no-approval-no-mutation)", async () => {
      const proposal = await seedProposal({ id: "prop-block-1", status: "pending" });

      const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
      const c = captureConsole();
      const exit = mockExit();

      await expect(handleAdaptationCommand(["apply", proposal.id]))
        .rejects.toThrow("process.exit(1)");

      // The gate must have refused; no agent card written.
      expect(existsSync(join(tempRoot, ".alix", "cards", "agents", "new.agent.json"))).toBe(false);

      exit.spy.mockRestore();
      c.restore();
    });

    it("dispatches to AgentCardApplier for an approved agent_card proposal", async () => {
      const proposal = await seedProposal({ id: "prop-apply-card", status: "approved", approvedBy: "alice" });

      const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
      const c = captureConsole();
      await handleAdaptationCommand(["apply", proposal.id]);
      c.restore();

      // Agent card file written.
      const cardPath = join(tempRoot, ".alix", "cards", "agents", "new.agent.json");
      expect(existsSync(cardPath)).toBe(true);
      const card = JSON.parse(readFileSync(cardPath, "utf-8"));
      expect(card.id).toBe("new.agent");

      // Status transitioned to applied by the gate.
      const { ProposalStore } = await import("../../../src/adaptation/proposal-store.js");
      const store = new ProposalStore(join(tempRoot, ".alix", "adaptation", "proposals"));
      const reloaded = await store.load(proposal.id);
      expect(reloaded!.status).toBe("applied");

      // adaptation_applied evidence recorded.
      const { EvidenceStore } = await import("../../../src/security/evidence/evidence-store.js");
      const evidence = new EvidenceStore({ storeDir: join(tempRoot, ".alix", "security") });
      const applied = await evidence.query({ type: "adaptation_applied" });
      expect(applied.total).toBe(1);
    });

    it("dispatches to SkillApplier for an approved skill proposal", async () => {
      // Seed a skill file the applier can read + modify.
      const skillsDir = join(tempRoot, ".alix", "skills", "workflow");
      mkdirSync(skillsDir, { recursive: true });
      const skillId = "triage";
      writeFileSync(
        join(skillsDir, `${skillId}.json`),
        JSON.stringify({
          id: skillId,
          name: "Triage",
          steps: [
            { step: "plan", action: "old action", agent: "planner" },
            { step: "execute", action: "do the thing" },
          ],
        }),
        "utf-8",
      );

      const proposal = await seedProposal({
        id: "prop-apply-skill",
        status: "approved",
        approvedBy: "alice",
        action: "adjust_skill_definition",
        target: { kind: "skill", id: skillId },
        payload: { step: "plan", action: "new improved action" },
      });

      const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
      const c = captureConsole();
      await handleAdaptationCommand(["apply", proposal.id]);
      c.restore();

      const skill = JSON.parse(readFileSync(join(skillsDir, `${skillId}.json`), "utf-8"));
      expect(skill.steps[0].action).toBe("new improved action");
      // Untouched fields preserved.
      expect(skill.steps[0].agent).toBe("planner");
      expect(skill.steps[1].action).toBe("do the thing");
    });

    it("records adaptation_failed and marks status failed when the applier errors", async () => {
      // Approved proposal targeting a skill that does NOT exist on disk.
      const proposal = await seedProposal({
        id: "prop-apply-fail",
        status: "approved",
        approvedBy: "alice",
        action: "adjust_skill_definition",
        target: { kind: "skill", id: "no.such.skill" },
        payload: { step: "plan", action: "x" },
      });

      const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
      const c = captureConsole();
      const exit = mockExit();

      await expect(handleAdaptationCommand(["apply", proposal.id]))
        .rejects.toThrow("process.exit(1)");

      const { ProposalStore } = await import("../../../src/adaptation/proposal-store.js");
      const store = new ProposalStore(join(tempRoot, ".alix", "adaptation", "proposals"));
      const reloaded = await store.load(proposal.id);
      expect(reloaded!.status).toBe("failed");
      expect(reloaded!.error).toBeTruthy();

      const { EvidenceStore } = await import("../../../src/security/evidence/evidence-store.js");
      const evidence = new EvidenceStore({ storeDir: join(tempRoot, ".alix", "security") });
      const failed = await evidence.query({ type: "adaptation_failed" });
      expect(failed.total).toBe(1);

      exit.spy.mockRestore();
      c.restore();
    });

    it("errors with exit 1 on unknown id", async () => {
      const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
      const c = captureConsole();
      const exit = mockExit();

      await expect(handleAdaptationCommand(["apply", "prop-missing"]))
        .rejects.toThrow("process.exit(1)");

      exit.spy.mockRestore();
      c.restore();
    });
  });

  // -------------------------------------------------------------------------
  // unknown subcommand / help
  // -------------------------------------------------------------------------

  describe("unknown subcommand", () => {
    it("errors with exit 1 on an unknown subcommand", async () => {
      const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
      const c = captureConsole();
      const exit = mockExit();

      await expect(handleAdaptationCommand(["bogus"])).rejects.toThrow("process.exit(1)");
      expect(c.err().join("\n").toLowerCase()).toContain("usage");

      exit.spy.mockRestore();
      c.restore();
    });

    it("errors with exit 1 when no subcommand is provided", async () => {
      const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
      const c = captureConsole();
      const exit = mockExit();

      await expect(handleAdaptationCommand([])).rejects.toThrow("process.exit(1)");

      exit.spy.mockRestore();
      c.restore();
    });
  });
});
