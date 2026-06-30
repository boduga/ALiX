/**
 * P10.9.2a-T2 — CLI readiness integration tests.
 *
 * Tests that runList, runShow, and runApply correctly consume
 * computeProposalReadiness for the new Readiness/Applyable columns,
 * the show readiness block, and the apply readiness gate.
 *
 * Follows the same patterns as adaptation.vitest.ts (seedProposal,
 * captureConsole, mockExit, handleAdaptationCommand).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AdaptationProposal } from "../../../src/adaptation/adaptation-types.js";

// ---------------------------------------------------------------------------
// process.cwd override helpers
// ---------------------------------------------------------------------------

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "adaptation-readiness-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function seedProposal(
  overrides: Partial<AdaptationProposal> = {},
): Promise<AdaptationProposal> {
  const { ProposalStore } = await import(
    "../../../src/adaptation/proposal-store.js"
  );
  const store = new ProposalStore(
    join(tempRoot, ".alix", "adaptation", "proposals"),
  );
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
  const logSpy = vi
    .spyOn(console, "log")
    .mockImplementation((...a: unknown[]) => {
      out.push(a.join(" "));
    });
  const errSpy = vi
    .spyOn(console, "error")
    .mockImplementation((...a: unknown[]) => {
      err.push(a.join(" "));
    });
  return {
    out: () => out,
    err: () => err,
    restore: () => {
      logSpy.mockRestore();
      errSpy.mockRestore();
    },
  };
}

function mockExit(): {
  spy: ReturnType<typeof vi.spyOn>;
  calls: () => (string | number | null | undefined)[];
} {
  const calls: (string | number | null | undefined)[] = [];
  const spy = vi
    .spyOn(process, "exit")
    .mockImplementation((code?: string | number | null) => {
      calls.push(code);
      throw new Error(`process.exit(${code})`);
    });
  return { spy, calls: () => calls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("adaptation CLI — readiness integration", () => {
  // -------------------------------------------------------------------------
  // list — Readiness and Applyable columns
  // -------------------------------------------------------------------------

  describe("list", () => {
    it("list output includes Readiness column", async () => {
      await seedProposal({ id: "prop-rdy-1", status: "pending" });
      await seedProposal({
        id: "prop-rdy-2",
        status: "approved",
        approvedBy: "alice",
      });

      const { handleAdaptationCommand } = await import(
        "../../../src/cli/commands/adaptation.js"
      );
      const c = captureConsole();
      await handleAdaptationCommand(["list"]);
      c.restore();

      const joined = c.out().join("\n");
      expect(joined).toContain("Readiness");
      expect(joined).toContain("needs_approval");
      expect(joined).toContain("ready_to_apply");
    });

    it("list output includes Applyable column", async () => {
      await seedProposal({ id: "prop-app-1", status: "pending" });
      await seedProposal({
        id: "prop-app-2",
        status: "approved",
        approvedBy: "alice",
      });

      const { handleAdaptationCommand } = await import(
        "../../../src/cli/commands/adaptation.js"
      );
      const c = captureConsole();
      await handleAdaptationCommand(["list"]);
      c.restore();

      const joined = c.out().join("\n");
      expect(joined).toContain("Applyable");
      expect(joined).toContain("yes");
      expect(joined).toContain("no");
    });
  });

  // -------------------------------------------------------------------------
  // show — readiness block
  // -------------------------------------------------------------------------

  describe("show", () => {
    it("show output includes readiness block", async () => {
      await seedProposal({
        id: "prop-show-rdy",
        status: "approved",
        approvedBy: "alice",
      });

      const { handleAdaptationCommand } = await import(
        "../../../src/cli/commands/adaptation.js"
      );
      const c = captureConsole();
      await handleAdaptationCommand(["show", "prop-show-rdy"]);
      c.restore();

      const joined = c.out().join("\n");
      expect(joined).toContain("Readiness:");
      expect(joined).toContain("Applyable:");
      expect(joined).toContain("Next action:");
    });
  });

  // -------------------------------------------------------------------------
  // apply — readiness gate
  // -------------------------------------------------------------------------

  describe("apply", () => {
    it("ready_to_apply succeeds", async () => {
      await seedProposal({
        id: "prop-apply-rdy",
        status: "approved",
        approvedBy: "alice",
      });

      const { handleAdaptationCommand } = await import(
        "../../../src/cli/commands/adaptation.js"
      );
      const c = captureConsole();
      await handleAdaptationCommand(["apply", "prop-apply-rdy"]);
      c.restore();

      const joined = c.out().join("\n");
      expect(joined).toContain("Applied:");

      const { ProposalStore } = await import(
        "../../../src/adaptation/proposal-store.js"
      );
      const store = new ProposalStore(
        join(tempRoot, ".alix", "adaptation", "proposals"),
      );
      const reloaded = await store.load("prop-apply-rdy");
      expect(reloaded!.status).toBe("applied");
    });

    it("needs_approval refused", async () => {
      await seedProposal({ id: "prop-need-appr", status: "pending" });

      const { handleAdaptationCommand } = await import(
        "../../../src/cli/commands/adaptation.js"
      );
      const c = captureConsole();
      const exit = mockExit();

      await expect(
        handleAdaptationCommand(["apply", "prop-need-appr"]),
      ).rejects.toThrow("process.exit(1)");

      const joined = c.err().join("\n");
      expect(joined).toContain("not yet approved");
      expect(joined).toContain("approve");

      exit.spy.mockRestore();
      c.restore();
    });

    it("needs_specification refused", async () => {
      await seedProposal({
        id: "prop-need-spec",
        status: "approved",
        approvedBy: "alice",
        action: "executive_remediation_request",
        target: {
          kind: "executive_remediation",
          planId: "plan-1",
          stepId: "step-1",
          objectiveId: "obj-1",
          subsystem: "governance",
        },
        payload: {
          requiresHumanSpecification: true,
          recommendedAction: "Fix governance configuration manually",
        },
        reason: "Needs human specification",
      });

      const { handleAdaptationCommand } = await import(
        "../../../src/cli/commands/adaptation.js"
      );
      const c = captureConsole();
      const exit = mockExit();

      await expect(
        handleAdaptationCommand(["apply", "prop-need-spec"]),
      ).rejects.toThrow("process.exit(1)");

      const joined = c.err().join("\n");
      expect(joined).toContain("requires human specification");
      expect(joined).toContain("executive remediate");

      exit.spy.mockRestore();
      c.restore();
    });

    it("manual_action routed to printManualAction", async () => {
      await seedProposal({
        id: "prop-manual-act",
        status: "approved",
        approvedBy: "alice",
        action: "suggest_routing_weight",
        target: { kind: "routing_weight", capability: "code-review" },
        payload: {
          title: "Tune code-review routing",
          recommendedAction: "Increase routing weight for code-review to 0.6",
          evidence: ["ev-1"],
        },
        reason: "Under-routed capability",
      });

      const { handleAdaptationCommand } = await import(
        "../../../src/cli/commands/adaptation.js"
      );
      const c = captureConsole();
      const exit = mockExit();

      await handleAdaptationCommand(["apply", "prop-manual-act"]);
      exit.spy.mockRestore();
      c.restore();

      expect(exit.calls()).toHaveLength(0);
      expect(c.out().join("\n")).toContain("Manual action required");
    });

    it("completed refused", async () => {
      await seedProposal({
        id: "prop-completed",
        status: "applied",
        appliedAt: "2026-06-20T00:00:00.000Z",
      });

      const { handleAdaptationCommand } = await import(
        "../../../src/cli/commands/adaptation.js"
      );
      const c = captureConsole();
      const exit = mockExit();

      await expect(
        handleAdaptationCommand(["apply", "prop-completed"]),
      ).rejects.toThrow("process.exit(1)");

      const joined = c.err().join("\n");
      expect(joined).toContain("already been");
      expect(joined).toContain("applied");

      exit.spy.mockRestore();
      c.restore();
    });

    it("blocked refused", async () => {
      // Use an unknown target kind that has no registered applier and is
      // not a manual kind — this triggers the "blocked" readiness.
      await seedProposal({
        id: "prop-blocked",
        status: "approved",
        approvedBy: "alice",
        target: { kind: "unknown_kind" } as any,
        payload: {},
        reason: "Unrecognized target kind",
      });

      const { handleAdaptationCommand } = await import(
        "../../../src/cli/commands/adaptation.js"
      );
      const c = captureConsole();
      const exit = mockExit();

      await expect(
        handleAdaptationCommand(["apply", "prop-blocked"]),
      ).rejects.toThrow("process.exit(1)");

      const joined = c.err().join("\n");
      expect(joined).toContain("is blocked");
      expect(joined).toContain("unknown_kind");

      exit.spy.mockRestore();
      c.restore();
    });
  });
});
