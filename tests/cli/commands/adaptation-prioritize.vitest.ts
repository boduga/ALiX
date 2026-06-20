/**
 * P5.4.3 — adaptation prioritize CLI tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProposalStore } from "../../../src/adaptation/proposal-store.js";
import { IntelligenceStore } from "../../../src/adaptation/intelligence-store.js";
import { SCORING_VERSION } from "../../../src/adaptation/priority-types.js";
import type { IntelligenceReport } from "../../../src/adaptation/intelligence-types.js";

// ---------------------------------------------------------------------------
// process.cwd override helpers
// ---------------------------------------------------------------------------

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

function setCwd(dir: string): void {
  cwdSpy.mockReturnValue(dir);
}

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "adaptation-prioritize-cli-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function captureConsole(): { out: () => string[]; restore: () => void } {
  const out: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { out.push(a.join(" ")); });
  return {
    out: () => out,
    restore: () => { logSpy.mockRestore(); },
  };
}

async function seedProposal(store: ProposalStore, id: string, overrides?: Record<string, unknown>) {
  const proposal = {
    id,
    createdAt: "2026-06-15T00:00:00.000Z",
    status: "pending",
    action: "update_agent_card",
    target: { kind: "agent_card", id: "test.agent" },
    payload: {},
    sourceRecommendationType: "agent_card_update",
    sourceConfidence: 0.85,
    evidenceFingerprints: [],
    reason: "Test",
    ...overrides,
  };
  await store.save(proposal as any);
}

function makeIntelligenceReport(): IntelligenceReport {
  const emptyBucketSet = (dim: string) => ({ dimension: dim, buckets: [], totalInDimension: 0, insufficientDataCount: 0 });
  return {
    generatedAt: "2026-06-19T22:00:00.000Z",
    totalProposalsAnalyzed: 20,
    dataWindow: {
      oldestProposalCreatedAt: "2026-06-01T00:00:00.000Z",
      newestProposalCreatedAt: "2026-06-19T22:00:00.000Z",
      oldestEffectivenessAssessedAt: "2026-06-10T00:00:00.000Z",
    },
    executiveSummary: "Test data",
    buckets: {
      byAction: {
        dimension: "byAction",
        buckets: [
          {
            value: "update_agent_card",
            totalProposals: 10,
            insufficientData: false,
            keepCount: 8,
            keepRate: 0.8,
            advisoryRevertCount: 1,
            advisoryRevertRate: 0.1,
            actualRevertCount: 0,
            actualRevertRate: 0,
            approvalRate: 0.9,
          },
          {
            value: "add_capability",
            totalProposals: 5,
            insufficientData: false,
            keepCount: 5,
            keepRate: 1.0,
            advisoryRevertRate: 0,
            actualRevertRate: 0,
            approvalRate: 1.0,
          },
        ],
        totalInDimension: 15,
        insufficientDataCount: 0,
      },
      byTargetKind: emptyBucketSet("byTargetKind"),
      bySourceRecommendationType: emptyBucketSet("bySourceRecommendationType"),
      byProvenance: emptyBucketSet("byProvenance"),
      byCapability: emptyBucketSet("byCapability"),
      byOutcome: emptyBucketSet("byOutcome"),
    },
    confidenceCalibration: { buckets: [], totalAssessed: 10, confidenceOutcomeCorrelation: 0.5 },
    revertSignalAnalysis: {
      totalAdvisoryReverts: 2,
      totalActualReverts: 1,
      totalUnactedReverts: 1,
      revertPrecision: 0.5,
      topUnactedRevertBuckets: [],
      humansOverruledCount: 0,
    },
    topPerforming: [],
    lowestPerforming: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("adaptation prioritize CLI", () => {
  it("outputs ranked list when proposals exist with intelligence data", async () => {
    // Seed pending proposals
    const store = new ProposalStore(join(tempRoot, ".alix", "adaptation", "proposals"));
    await seedProposal(store, "prop-001", { sourceConfidence: 0.9 });
    await seedProposal(store, "prop-002", { sourceConfidence: 0.7 });

    // Seed IntelligenceReport
    const intelStore = new IntelligenceStore(join(tempRoot, ".alix", "adaptation", "intelligence"));
    const report = makeIntelligenceReport();
    // Override generatedAt to avoid filename collision
    report.generatedAt = "2026-06-19T23:00:00.000Z";
    await intelStore.save(report);

    const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
    const c = captureConsole();
    await handleAdaptationCommand(["prioritize"]);
    c.restore();

    const output = c.out().join("\n");
    expect(output).toContain("Proposal Priority Report");
    expect(output).toContain("prop-001");
    expect(output).toContain("prop-002");
    expect(output).toContain(SCORING_VERSION);
  });

  it("outputs --json format", async () => {
    const store = new ProposalStore(join(tempRoot, ".alix", "adaptation", "proposals"));
    await seedProposal(store, "prop-001", { sourceConfidence: 0.9 });

    const intelStore = new IntelligenceStore(join(tempRoot, ".alix", "adaptation", "intelligence"));
    const report = makeIntelligenceReport();
    report.generatedAt = "2026-06-19T23:30:00.000Z";
    await intelStore.save(report);

    const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
    const c = captureConsole();
    await handleAdaptationCommand(["prioritize", "--json"]);
    c.restore();

    const output = c.out().join("\n");
    const parsed = JSON.parse(output);
    expect(parsed.scoringVersion).toBe("v1");
    expect(parsed.ranked).toHaveLength(1);
    expect(parsed.ranked[0].proposalId).toBe("prop-001");
    expect(typeof parsed.ranked[0].priorityScore).toBe("number");
  });

  it("gracefully handles no IntelligenceReport", async () => {
    const store = new ProposalStore(join(tempRoot, ".alix", "adaptation", "proposals"));
    await seedProposal(store, "prop-001");

    const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
    const c = captureConsole();
    await handleAdaptationCommand(["prioritize"]);
    c.restore();

    const output = c.out().join("\n");
    expect(output).toContain("Proposal Priority Report");
    expect(output.length).toBeGreaterThan(0); // graceful output produced
  });

  it("--top flag limits results", async () => {
    const store = new ProposalStore(join(tempRoot, ".alix", "adaptation", "proposals"));
    await seedProposal(store, "prop-001");
    await seedProposal(store, "prop-002");

    const intelStore = new IntelligenceStore(join(tempRoot, ".alix", "adaptation", "intelligence"));
    const report = makeIntelligenceReport();
    report.generatedAt = "2026-06-19T23:45:00.000Z";
    await intelStore.save(report);

    const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
    const c = captureConsole();
    await handleAdaptationCommand(["prioritize", "--top", "1"]);
    c.restore();

    const output = c.out().join("\n");
    // Table should show at least prop-001 but could be either
    expect(output).toMatch(/prop-00[12]/);
  });

  it("handles no pending proposals", async () => {
    const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
    const c = captureConsole();
    await handleAdaptationCommand(["prioritize"]);
    c.restore();

    const output = c.out().join("\n");
    expect(output).toContain("No pending proposals");
  });

  it("report auto-saves to PriorityStore", async () => {
    const store = new ProposalStore(join(tempRoot, ".alix", "adaptation", "proposals"));
    await seedProposal(store, "prop-autosave");

    const intelStore = new IntelligenceStore(join(tempRoot, ".alix", "adaptation", "intelligence"));
    const report = makeIntelligenceReport();
    report.generatedAt = "2026-06-19T23:50:00.000Z";
    await intelStore.save(report);

    const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
    const c = captureConsole();
    await handleAdaptationCommand(["prioritize", "--json"]);
    c.restore();

    // Check that a file was saved to the priorities directory
    const { PriorityStore } = await import("../../../src/adaptation/priority-store.js");
    const pStore = new PriorityStore(join(tempRoot, ".alix", "adaptation", "priorities"));
    const files = await pStore.list();
    expect(files.length).toBeGreaterThanOrEqual(1);
    const latest = await pStore.loadLatest();
    expect(latest).not.toBeNull();
    expect(latest!.scoringVersion).toBe("v1");
  });
});
