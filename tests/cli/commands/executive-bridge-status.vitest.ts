/**
 * P10.9.2a-T3 — Integration tests for `alix executive bridge status`.
 *
 * Tests handleBridgeStatus() through ProposalStore-backed fixture proposals
 * in a temporary directory. Verifies summary counts, plan filtering, JSON
 * output, non-bridge exclusion, and detail section format.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { ProposalStore } from "../../../src/adaptation/proposal-store.js";
import { handleBridgeStatus } from "../../../src/cli/commands/executive-bridge-handler.js";
import type { AdaptationProposal } from "../../../src/adaptation/adaptation-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProposal(
  overrides: Partial<AdaptationProposal> & { id: string },
): AdaptationProposal {
  const base: AdaptationProposal = {
    id: "",
    createdAt: "2026-06-29T00:00:00.000Z",
    status: "approved",
    action: "create_improvement_issue",
    target: { kind: "agent_card", id: "test" },
    payload: {},
    sourceRecommendationType: "executive_remediation",
    sourceConfidence: 0.8,
    evidenceFingerprints: ["fp-test"],
    reason: "test proposal",
  };
  return { ...base, ...overrides };
}

function createTempDir(): string {
  const dir = join(tmpdir(), `bridge-status-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeProposal(dir: string, proposal: AdaptationProposal): void {
  writeFileSync(
    join(dir, `${proposal.id}.json`),
    JSON.stringify(proposal, null, 2),
    "utf-8",
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleBridgeStatus", () => {
  let tempDir: string;
  let store: ProposalStore;

  beforeEach(() => {
    tempDir = createTempDir();
    store = new ProposalStore(tempDir);
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Test 1: empty store
  // -----------------------------------------------------------------------
  it("shows 'No bridge proposals found' when store is empty", async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });

    await handleBridgeStatus([], store);

    expect(logs).toContain("No bridge proposals found.");
    spy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // Test 2: one needs_specification + one ready_to_apply → correct counts
  // -----------------------------------------------------------------------
  it("shows correct counts for one needs_specification and one ready_to_apply", async () => {
    // needs_specification: executive_remediation target requires human spec
    writeProposal(
      tempDir,
      makeProposal({
        id: "prop-needs-spec",
        target: {
          kind: "executive_remediation",
          planId: "plan-1",
          stepId: "step-1",
          objectiveId: "obj-1",
          subsystem: "governance",
        },
        payload: { requiresHumanSpecification: true },
      }),
    );

    // ready_to_apply: agent_card target (registered_applier)
    writeProposal(
      tempDir,
      makeProposal({
        id: "prop-ready",
        target: { kind: "agent_card", id: "test-agent" },
      }),
    );

    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });

    await handleBridgeStatus([], store);

    expect(logs).toEqual(
      expect.arrayContaining([
        "Bridge Summary",
        expect.stringContaining("Needs specification: 1"),
        expect.stringContaining("Ready to apply: 1"),
        expect.stringContaining("Manual action: 0"),
        expect.stringContaining("Blocked: 0"),
      ]),
    );
    spy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // Test 3: filters by planId via payload.planId (--plan flag)
  // -----------------------------------------------------------------------
  it("filters by planId when --plan is passed", async () => {
    writeProposal(
      tempDir,
      makeProposal({
        id: "prop-plan-a",
        target: {
          kind: "executive_remediation",
          planId: "plan-a",
          stepId: "step-1",
          objectiveId: "obj-1",
          subsystem: "governance",
        },
        payload: {
          requiresHumanSpecification: true,
          planId: "plan-a",
        },
      }),
    );

    writeProposal(
      tempDir,
      makeProposal({
        id: "prop-plan-b",
        target: {
          kind: "executive_remediation",
          planId: "plan-b",
          stepId: "step-2",
          objectiveId: "obj-2",
          subsystem: "learning",
        },
        payload: {
          requiresHumanSpecification: true,
          planId: "plan-b",
        },
      }),
    );

    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });

    await handleBridgeStatus(["--plan", "plan-a"], store);

    // Should only show plan-a proposal
    expect(logs).toEqual(
      expect.arrayContaining([
        "Bridge Summary",
        expect.stringContaining("Needs specification: 1"),
        expect.stringContaining("Ready to apply: 0"),
      ]),
    );
    expect(logs).toEqual(
      expect.arrayContaining([expect.stringContaining("prop-plan-a")]),
    );
    expect(logs).not.toEqual(
      expect.arrayContaining([expect.stringContaining("prop-plan-b")]),
    );
    spy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // Test 4: --json output valid JSON correct structure
  // -----------------------------------------------------------------------
  it("outputs valid JSON with correct structure when --json is passed", async () => {
    writeProposal(
      tempDir,
      makeProposal({
        id: "prop-json-ready",
        target: { kind: "agent_card", id: "test-agent" },
      }),
    );

    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });

    await handleBridgeStatus(["--json"], store);

    expect(logs.length).toBeGreaterThanOrEqual(1);
    const raw = logs.join("\n");
    let parsed: any;
    expect(() => {
      parsed = JSON.parse(raw);
    }).not.toThrow();

    expect(parsed).toHaveProperty("needsSpecification");
    expect(parsed).toHaveProperty("readyToApply");
    expect(parsed).toHaveProperty("manualAction");
    expect(parsed).toHaveProperty("blocked");
    expect(parsed).toHaveProperty("details");
    expect(Array.isArray(parsed.details)).toBe(true);
    expect(parsed.readyToApply).toBe(1);
    if (parsed.details.length > 0) {
      expect(parsed.details[0]).toHaveProperty("id");
      expect(parsed.details[0]).toHaveProperty("readiness");
      expect(parsed.details[0]).toHaveProperty("subsystem");
      expect(parsed.details[0]).toHaveProperty("nextCommand");
    }
    spy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // Test 5: non-bridge proposals excluded from summary
  // -----------------------------------------------------------------------
  it("excludes non-bridge proposals from counts", async () => {
    // Bridge proposal
    writeProposal(
      tempDir,
      makeProposal({
        id: "prop-bridge",
        target: { kind: "agent_card", id: "test-agent" },
      }),
    );

    // Non-bridge proposal (sourceRecommendationType is not executive_remediation
    // and payload.source is not executive_bridge)
    writeProposal(
      tempDir,
      makeProposal({
        id: "prop-non-bridge",
        sourceRecommendationType: "manual_recommendation",
        payload: { source: "something_else" },
      }),
    );

    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });

    await handleBridgeStatus([], store);

    // Only 1 bridge proposal should be counted
    expect(logs).toEqual(
      expect.arrayContaining([
        "Bridge Summary",
        expect.stringContaining("Ready to apply: 1"),
      ]),
    );
    // Non-bridge proposal should not appear in detail section
    expect(logs).not.toEqual(
      expect.arrayContaining([expect.stringContaining("prop-non-bridge")]),
    );
    spy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // Test 6: detail section lists proposal id + readiness + subsystem
  // -----------------------------------------------------------------------
  it("detail section lists id, readiness, subsystem, and nextCommand hint", async () => {
    writeProposal(
      tempDir,
      makeProposal({
        id: "prop-detail-a",
        target: {
          kind: "executive_remediation",
          planId: "plan-1",
          stepId: "step-1",
          objectiveId: "obj-1",
          subsystem: "governance",
        },
        payload: { requiresHumanSpecification: true },
      }),
    );

    writeProposal(
      tempDir,
      makeProposal({
        id: "prop-detail-b",
        target: { kind: "agent_card", id: "test-agent" },
      }),
    );

    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });

    await handleBridgeStatus([], store);

    // Find the section after "Detail" header
    const detailIdx = logs.findIndex((l) => l.startsWith("Detail"));
    expect(detailIdx).toBeGreaterThanOrEqual(0);
    const detailLines = logs.slice(detailIdx);

    // prop-detail-a: needs_specification, governance, nextCommand
    const lineA = detailLines.find((l) => l.includes("prop-detail-a"));
    expect(lineA).toBeDefined();
    expect(lineA).toContain("needs_specification");
    expect(lineA).toContain("governance");
    expect(lineA).toContain("alix executive remediate");

    // prop-detail-b: ready_to_apply, unknown (agent_card has no subsystem)
    // support.nextCommand is undefined for registered_applier → empty trailing
    const lineB = detailLines.find((l) => l.includes("prop-detail-b"));
    expect(lineB).toBeDefined();
    expect(lineB).toContain("ready_to_apply");
    expect(lineB).toContain("unknown");
    // ready_to_apply registered_applier has no support.nextCommand; the
    // nextAction hint lives in readiness.nextAction, not support.nextCommand.
    spy.mockRestore();
  });
});
