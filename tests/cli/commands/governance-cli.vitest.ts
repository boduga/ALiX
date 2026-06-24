/**
 * P9.3 — CLI tests for `alix governance` subcommands.
 *
 * Covers existing P9.0f health/drift subcommands AND the 5 new P9.3
 * subcommands: approve, reject, list, cleanup, explain.
 *
 * All tests use temp directories. Proposals are seeded directly via
 * ProposalStore or as raw JSON files on disk.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleGovernanceCommand } from "../../../src/cli/commands/governance.js";

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "gov-cli-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function mockExit(): { spy: ReturnType<typeof vi.spyOn>; restore: () => void } {
  const spy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
    throw new Error(`process.exit(${code})`);
  });
  return { spy, restore: () => spy.mockRestore() };
}

/** Persist a proposal directly via ProposalStore (bypasses CLI). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seedProposal(overrides: Record<string, any> = {}): Promise<{ id: string; action: string; status: string }> {
  const { ProposalStore } = await import("../../../src/adaptation/proposal-store.js");
  const proposalsDir = join(tempRoot, ".alix", "adaptation", "proposals");
  const store = new ProposalStore(proposalsDir);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proposal: any = {
    id: "prop-test-001",
    createdAt: "2026-06-19T00:00:00.000Z",
    status: "pending",
    action: "create_agent_card",
    target: { kind: "agent_card", id: "test.agent" },
    payload: {},
    sourceRecommendationType: "capability_gap",
    sourceConfidence: 0.85,
    evidenceFingerprints: [],
    reason: "Test proposal",
    ...overrides,
  };
  await store.save(proposal);
  return proposal;
}

/** Write a raw JSON proposal file directly (bypasses ProposalStore validation).
 *  Useful for orphaned/cleaned proposals that don't conform to the strict type. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeRawProposal(id: string, data: Record<string, any>): void {
  const proposalsDir = join(tempRoot, ".alix", "adaptation", "proposals");
  mkdirSync(proposalsDir, { recursive: true });
  writeFileSync(join(proposalsDir, `${id}.json`), JSON.stringify(data, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Existing P9.0f tests
// ---------------------------------------------------------------------------

describe("governance CLI", () => {
  it("health subcommand renders output containing 'Governance Health'", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleGovernanceCommand(["health"]);
    const output = log.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(output).toContain("Governance Health");
    log.mockRestore();
  });

  it("drift subcommand renders output containing 'Drift'", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleGovernanceCommand(["drift"]);
    const output = log.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(output).toContain("Drift");
    log.mockRestore();
  });

  it("errors on unknown subcommand", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as unknown as () => never);
    await handleGovernanceCommand(["bogus"]);
    expect(err).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
    err.mockRestore();
    exit.mockRestore();
  });

  // -------------------------------------------------------------------------
  // approve
  // -------------------------------------------------------------------------

  describe("approve", () => {
    it("rejects without proposal-id", async () => {
      const exit = mockExit();
      const c = captureConsole();

      await expect(handleGovernanceCommand(["approve"]))
        .rejects.toThrow("process.exit(2)");

      exit.restore();
      c.restore();
    });

    it("delegates to ApprovalGate and renders success", async () => {
      // Use non-governance_change action so governance criteria is skipped
      const proposal = await seedProposal({ id: "prop-approve-1", status: "pending", action: "create_agent_card" });

      const c = captureConsole();
      await handleGovernanceCommand(["approve", proposal.id]);
      c.restore();

      const joined = c.out().join("\n");
      expect(joined).toContain("Governance proposal approved.");
      expect(joined).toContain("prop-approve-1");

      // Verify the proposal was actually approved (status transitioned)
      const { ProposalStore } = await import("../../../src/adaptation/proposal-store.js");
      const store = new ProposalStore(join(tempRoot, ".alix", "adaptation", "proposals"));
      const reloaded = await store.load(proposal.id);
      expect(reloaded!.status).toBe("approved");
    });
  });

  // -------------------------------------------------------------------------
  // reject
  // -------------------------------------------------------------------------

  describe("reject", () => {
    it("renders rejection output", async () => {
      const proposal = await seedProposal({ id: "prop-reject-1", status: "pending" });

      const c = captureConsole();
      await handleGovernanceCommand(["reject", proposal.id, "Not needed anymore"]);
      c.restore();

      const joined = c.out().join("\n");
      expect(joined).toContain("Governance proposal rejected.");
      expect(joined).toContain("prop-reject-1");
      expect(joined).toContain("rejected");

      const { ProposalStore } = await import("../../../src/adaptation/proposal-store.js");
      const store = new ProposalStore(join(tempRoot, ".alix", "adaptation", "proposals"));
      const reloaded = await store.load(proposal.id);
      expect(reloaded!.status).toBe("rejected");
    });
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  describe("list", () => {
    it("shows pending governance proposals", async () => {
      await seedProposal({ id: "prop-gov-1", action: "governance_change", status: "pending", target: { kind: "governance", recommendationId: "rec-1" } });
      await seedProposal({ id: "prop-reg-1", action: "create_agent_card", status: "pending" });
      await seedProposal({ id: "prop-gov-2", action: "governance_change", status: "approved" }); // not pending

      const c = captureConsole();
      await handleGovernanceCommand(["list"]);
      c.restore();

      const joined = c.out().join("\n");
      expect(joined).toContain("Pending Governance Proposals");
      expect(joined).toContain("prop-gov-1");
      expect(joined).not.toContain("prop-reg-1"); // not governance_change
      expect(joined).not.toContain("prop-gov-2"); // not pending
    });

    it("--orphaned shows orphaned proposals (but hides cleaned ones)", async () => {
      // Raw write to include systemState that ProposalStore validation would reject
      writeRawProposal("prop-orph-1", {
        id: "prop-orph-1",
        createdAt: "2026-06-19T00:00:00.000Z",
        status: "pending",
        action: "governance_change",
        target: { kind: "governance", recommendationId: "rec-1" },
        payload: {},
        sourceRecommendationType: "drift",
        sourceConfidence: 0.7,
        evidenceFingerprints: [],
        reason: "Orphaned by atomicity failure",
        systemState: { orphaned: true, reason: "EvidenceChain write failed" },
      });
      writeRawProposal("prop-orph-2", {
        id: "prop-orph-2",
        createdAt: "2026-06-19T00:00:00.000Z",
        status: "pending",
        action: "governance_change",
        target: { kind: "governance", recommendationId: "rec-2" },
        payload: {},
        sourceRecommendationType: "drift",
        sourceConfidence: 0.7,
        evidenceFingerprints: [],
        reason: "Already cleaned",
        systemState: { orphaned: true, reason: "stale", cleaned: true },
      });

      const c = captureConsole();
      await handleGovernanceCommand(["list", "--orphaned"]);
      c.restore();

      const joined = c.out().join("\n");
      expect(joined).toContain("Orphaned Governance Proposals");
      expect(joined).toContain("prop-orph-1"); // orphaned, NOT cleaned
      expect(joined).not.toContain("prop-orph-2"); // orphaned but cleaned
    });
  });

  // -------------------------------------------------------------------------
  // cleanup
  // -------------------------------------------------------------------------

  describe("cleanup", () => {
    it("tombstones orphaned proposal", async () => {
      writeRawProposal("prop-clean-1", {
        id: "prop-clean-1",
        createdAt: "2026-06-19T00:00:00.000Z",
        status: "pending",
        action: "governance_change",
        target: { kind: "governance", recommendationId: "rec-1" },
        payload: {},
        sourceRecommendationType: "drift",
        sourceConfidence: 0.7,
        evidenceFingerprints: [],
        reason: "Orphaned proposal",
        systemState: { orphaned: true, reason: "test orphan" },
      });

      const c = captureConsole();
      await handleGovernanceCommand(["cleanup", "prop-clean-1"]);
      c.restore();

      const joined = c.out().join("\n");
      expect(joined).toContain("Orphaned governance proposal cleaned up.");
      expect(joined).toContain("prop-clean-1");
      expect(joined).toContain("File retained for audit.");

      // Verify the proposal now has cleaned: true
      const { ProposalStore } = await import("../../../src/adaptation/proposal-store.js");
      const store = new ProposalStore(join(tempRoot, ".alix", "adaptation", "proposals"));
      const reloaded = await store.load("prop-clean-1");
      expect(reloaded!.systemState?.cleaned).toBe(true);
    });

    it("rejects non-orphaned proposal", async () => {
      await seedProposal({ id: "prop-clean-2", action: "governance_change", status: "pending" });

      const exit = mockExit();
      const c = captureConsole();

      await expect(handleGovernanceCommand(["cleanup", "prop-clean-2"]))
        .rejects.toThrow("process.exit(1)");
      expect(c.err().join("\n")).toContain("not orphaned");

      exit.restore();
      c.restore();
    });

    it("rejects already-cleaned proposal", async () => {
      writeRawProposal("prop-clean-3", {
        id: "prop-clean-3",
        createdAt: "2026-06-19T00:00:00.000Z",
        status: "pending",
        action: "governance_change",
        target: { kind: "governance", recommendationId: "rec-1" },
        payload: {},
        sourceRecommendationType: "drift",
        sourceConfidence: 0.7,
        evidenceFingerprints: [],
        reason: "Already cleaned proposal",
        systemState: { orphaned: true, reason: "test orphan", cleaned: true },
      });

      const exit = mockExit();
      const c = captureConsole();

      await expect(handleGovernanceCommand(["cleanup", "prop-clean-3"]))
        .rejects.toThrow("process.exit(1)");
      expect(c.err().join("\n")).toContain("already cleaned");

      exit.restore();
      c.restore();
    });
  });

  // -------------------------------------------------------------------------
  // explain
  // -------------------------------------------------------------------------

  describe("explain", () => {
    it("renders governance proposal explanation", async () => {
      // With empty stores, the assembler returns a skeletal explanation
      const c = captureConsole();
      await handleGovernanceCommand(["explain", "prop-explain-1"]);
      c.restore();

      const joined = c.out().join("\n");
      expect(joined).toContain("Governance Proposal Explanation");
      expect(joined).toContain("prop-explain-1");
      expect(joined).toContain("Layers Available");
    });

    it("shows approval attempt history when evidence exists", async () => {
      // Pre-seed evidence events for denial history
      const evidenceDir = join(tempRoot, ".alix", "evidence");
      mkdirSync(evidenceDir, { recursive: true });
      const evidenceJsonl = join(evidenceDir, "evidence.jsonl");
      const record = {
        version: 1,
        id: "ev-deny-1",
        type: "governance_approval_denied",
        timestamp: "2026-06-20T00:00:00.000Z",
        fingerprint: "fp-deny-1",
        payload: { proposalId: "prop-explain-2", criterion: "low-integrity", integrityScore: 45 },
      };
      writeFileSync(evidenceJsonl, JSON.stringify(record) + "\n", "utf-8");

      const c = captureConsole();
      await handleGovernanceCommand(["explain", "prop-explain-2"]);
      c.restore();

      const joined = c.out().join("\n");
      expect(joined).toContain("Governance Proposal Explanation");
      expect(joined).toContain("Approval Attempt History");
      expect(joined).toContain("Denials: 1");
      expect(joined).toContain("low-integrity");
    });
  });
});
