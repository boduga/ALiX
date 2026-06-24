/**
 * P9.4a — GovernanceChangeApplier tests.
 *
 * Tests cover the full apply pipeline: validation, file resolution, schema
 * checks, drift detection, snapshot, mutation, and evidence recording.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SnapshotStore } from "../../../src/adaptation/snapshot-store.js";
import { GovernanceChangeApplier } from "../../../src/adaptation/appliers/governance-change-applier.js";
import type { AdaptationProposal, ProposalTarget } from "../../../src/adaptation/adaptation-types.js";
import type { GovernanceChangePayload } from "../../../src/governance/governance-types.js";
import type { EvidenceEventWriter } from "../../../src/workflow/evidence-writer.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCalibrationFile(dir: string, entries: Array<{target: string; value: number}>): string {
  const calibrationsDir = join(dir, ".alix", "governance");
  mkdirSync(calibrationsDir, { recursive: true });
  const path = join(calibrationsDir, "calibration.json");
  writeFileSync(path, JSON.stringify({ calibrations: entries }, null, 2), "utf-8");
  return path;
}

function makeLensRegistry(dir: string, lenses: Array<{lens: string; status: string; enabled: boolean; pv?: number}>): string {
  const lensesDir = join(dir, ".alix", "governance");
  mkdirSync(lensesDir, { recursive: true });
  const path = join(lensesDir, "lens-registry.json");
  writeFileSync(path, JSON.stringify({ lenses }, null, 2), "utf-8");
  return path;
}

function makeGovernanceProposal(
  overrides: Partial<AdaptationProposal> & { payload?: Partial<GovernanceChangePayload> | Record<string, unknown> } = {},
): AdaptationProposal {
  return {
    id: "prop-gov-001",
    createdAt: "2026-06-23T00:00:00.000Z",
    status: "approved",
    action: "governance_change",
    target: { kind: "governance", recommendationId: "rec-001" } as ProposalTarget,
    payload: { kind: "confidence_calibration", target: "red_team", currentCalibration: 0.7, suggestedCalibration: 0.75 },
    sourceRecommendationType: "governance",
    sourceConfidence: 0.85,
    evidenceFingerprints: [],
    reason: "Test governance proposal",
    approvedBy: "test-operator",
    approvedAt: "2026-06-23T12:00:00.000Z",
    ...overrides,
  } as AdaptationProposal;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GovernanceChangeApplier", () => {
  let tempRoot: string;
  let snapDir: string;
  let snapshotStore: SnapshotStore;
  let writer: EvidenceEventWriter;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "gov-applier-"));
    snapDir = mkdtempSync(join(tmpdir(), "snap-"));
    snapshotStore = new SnapshotStore(snapDir);
    writer = {
      recordSnapshotTaken: vi.fn().mockResolvedValue(null),
      recordGovernanceMutationApplied: vi.fn().mockResolvedValue(null),
    } as any;
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
    if (existsSync(snapDir)) rmSync(snapDir, { recursive: true, force: true });
  });

  // 1. rejects non-approved proposal
  it("rejects non-approved proposal", async () => {
    const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, writer);
    const proposal = makeGovernanceProposal({ status: "pending" });
    await expect(applier.apply(proposal)).rejects.toThrow(/status.*approved/i);
  });

  // 2. rejects non-governance_change proposal
  it("rejects non-governance_change proposal", async () => {
    const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, writer);
    const proposal = makeGovernanceProposal({ action: "update_agent_card" } as any);
    await expect(applier.apply(proposal)).rejects.toThrow(/governance_change/i);
  });

  // 3. rejects unsupported payload kind
  it("rejects unsupported payload kind", async () => {
    const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, writer);
    const proposal = makeGovernanceProposal({
      payload: { kind: "chain_restoration" } as any,
    });
    await expect(applier.apply(proposal)).rejects.toThrow(/does not support/i);
  });

  // 4. rejects missing target file
  it("rejects missing target file", async () => {
    const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, writer);
    const proposal = makeGovernanceProposal();
    await expect(applier.apply(proposal)).rejects.toThrow(/not found|missing/i);
  });

  // 5. rejects invalid schema — empty object with no calibrations array
  it("rejects invalid schema", async () => {
    const govDir = join(tempRoot, ".alix", "governance");
    mkdirSync(govDir, { recursive: true });
    writeFileSync(join(govDir, "calibration.json"), JSON.stringify({ notCalibrations: [] }), "utf-8");
    const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, writer);
    const proposal = makeGovernanceProposal();
    await expect(applier.apply(proposal)).rejects.toThrow(/schema|calibrations/i);
  });

  // 6. rejects stale proposal (current value drift)
  it("rejects stale proposal (current value drift)", async () => {
    makeCalibrationFile(tempRoot, [{ target: "red_team", value: 0.65 }]); // expected 0.7
    const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, writer);
    const proposal = makeGovernanceProposal();
    await expect(applier.apply(proposal)).rejects.toThrow(/drift|current/i);
  });

  // 7. rejects pre-write hash mismatch
  it("rejects pre-write hash mismatch", async () => {
    makeCalibrationFile(tempRoot, [{ target: "red_team", value: 0.7 }]);
    let intercepted = false;
    const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, writer, {
      onBeforeMutation: () => {
        if (!intercepted) {
          intercepted = true;
          // Change the file between validation and mutation
          const calibrationPath = join(tempRoot, ".alix", "governance", "calibration.json");
          const data = JSON.parse(readFileSync(calibrationPath, "utf-8"));
          data.calibrations[0].value = 0.99;
          writeFileSync(calibrationPath, JSON.stringify(data), "utf-8");
        }
      },
    });
    const proposal = makeGovernanceProposal();
    await expect(applier.apply(proposal)).rejects.toThrow(/hash|changed|mismatch/i);
  });

  // 8. applies confidence_calibration successfully
  it("applies confidence_calibration successfully", async () => {
    makeCalibrationFile(tempRoot, [{ target: "red_team", value: 0.7 }]);
    const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, writer);
    const proposal = makeGovernanceProposal();
    await applier.apply(proposal);

    // Verify the file was updated
    const calibrationPath = join(tempRoot, ".alix", "governance", "calibration.json");
    const content = JSON.parse(readFileSync(calibrationPath, "utf-8"));
    expect(content.calibrations[0].value).toBe(0.75);
  });

  // 9. applies lens_adjustment promote successfully
  it("applies lens_adjustment promote successfully", async () => {
    makeLensRegistry(tempRoot, [{ lens: "my_lens", status: "trial", enabled: true }]);
    const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, writer);
    const proposal = makeGovernanceProposal({
      payload: { kind: "lens_adjustment", operation: "promote", lens: "my_lens", currentPV: 0, reviewsAnalyzed: 10 },
    });
    await applier.apply(proposal);

    const lensPath = join(tempRoot, ".alix", "governance", "lens-registry.json");
    const content = JSON.parse(readFileSync(lensPath, "utf-8"));
    expect(content.lenses[0].status).toBe("active");
  });

  // 10. applies lens_adjustment demote successfully
  it("applies lens_adjustment demote successfully", async () => {
    makeLensRegistry(tempRoot, [{ lens: "my_lens", status: "active", enabled: true }]);
    const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, writer);
    const proposal = makeGovernanceProposal({
      payload: { kind: "lens_adjustment", operation: "demote", lens: "my_lens", currentPV: 0, reviewsAnalyzed: 10 },
    });
    await applier.apply(proposal);

    const lensPath = join(tempRoot, ".alix", "governance", "lens-registry.json");
    const content = JSON.parse(readFileSync(lensPath, "utf-8"));
    expect(content.lenses[0].status).toBe("demoted");
  });

  // 11. applies lens_adjustment retire successfully
  it("applies lens_adjustment retire successfully", async () => {
    makeLensRegistry(tempRoot, [{ lens: "my_lens", status: "active", enabled: true }]);
    const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, writer);
    const proposal = makeGovernanceProposal({
      payload: { kind: "lens_adjustment", operation: "retire", lens: "my_lens", currentPV: 0, reviewsAnalyzed: 10 },
    });
    await applier.apply(proposal);

    const lensPath = join(tempRoot, ".alix", "governance", "lens-registry.json");
    const content = JSON.parse(readFileSync(lensPath, "utf-8"));
    expect(content.lenses[0].status).toBe("retired");
    expect(content.lenses[0].enabled).toBe(false);
  });

  // 12. records governance mutation evidence with full metadata
  it("records governance mutation evidence with all metadata", async () => {
    makeCalibrationFile(tempRoot, [{ target: "red_team", value: 0.7 }]);
    const recordSnapshotTaken = vi.fn().mockResolvedValue(null);
    const recordGovernanceMutationApplied = vi.fn().mockResolvedValue(null);
    const localWriter = { recordSnapshotTaken, recordGovernanceMutationApplied } as any;
    const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, localWriter);
    const proposal = makeGovernanceProposal();
    await applier.apply(proposal);

    expect(recordSnapshotTaken).toHaveBeenCalledWith(
      proposal.id,
      expect.objectContaining({
        snapshotFingerprint: expect.any(String),
        contentHash: expect.any(String),
        filePath: expect.stringContaining("calibration.json"),
      }),
    );

    // P9.4a: governance mutation applied evidence MUST include full metadata
    expect(recordGovernanceMutationApplied).toHaveBeenCalledWith(
      proposal.id,
      expect.objectContaining({
        payloadKind: "confidence_calibration",
        targetFile: expect.stringContaining("calibration.json"),
        snapshotId: expect.any(String),
        beforeHash: expect.any(String),
        afterHash: expect.any(String),
      }),
    );
  });

  // 13. full end-to-end apply with snapshot and verify
  it("full end-to-end apply with snapshot and verify", async () => {
    const localSnapDir = mkdtempSync(join(tmpdir(), "snap-"));
    const snapStore = new SnapshotStore(localSnapDir);
    const snapWriter = { recordSnapshotTaken: vi.fn().mockResolvedValue(null), recordGovernanceMutationApplied: vi.fn().mockResolvedValue(null) } as any;
    makeCalibrationFile(tempRoot, [{ target: "red_team", value: 0.7 }]);

    const applier = new GovernanceChangeApplier(tempRoot, snapStore, snapWriter);
    const proposal = makeGovernanceProposal();
    await applier.apply(proposal);

    // File changed
    const calibrationPath = join(tempRoot, ".alix", "governance", "calibration.json");
    const content = JSON.parse(readFileSync(calibrationPath, "utf-8"));
    expect(content.calibrations[0].value).toBe(0.75);

    // Snapshot exists
    const snapshot = await snapStore.load(proposal.id);
    expect(snapshot).not.toBeNull();

    // Snapshot content matches original state
    const decoded = Buffer.from(snapshot!.content, "base64").toString("utf-8");
    const originalState = JSON.parse(decoded);
    expect(originalState.calibrations[0].value).toBe(0.7);

    rmSync(localSnapDir, { recursive: true, force: true });
  });

  // 14. revert governance mutation restores original content (acceptance test — full lifecycle)
  it("revert governance mutation restores original content", async () => {
    const localSnapDir = mkdtempSync(join(tmpdir(), "snap-"));
    const snapStore = new SnapshotStore(localSnapDir);
    const snapWriter = { recordSnapshotTaken: vi.fn().mockResolvedValue(null), recordGovernanceMutationApplied: vi.fn().mockResolvedValue(null) } as any;

    // Set up original file
    const originalCalibrations = [{ target: "red_team", value: 0.7 }];
    const calibrationPath = makeCalibrationFile(tempRoot, originalCalibrations);

    // Apply governance change
    const applier = new GovernanceChangeApplier(tempRoot, snapStore, snapWriter);
    const proposal = makeGovernanceProposal();
    await applier.apply(proposal);

    // Verify file changed
    let content = JSON.parse(readFileSync(calibrationPath, "utf-8"));
    expect(content.calibrations[0].value).toBe(0.75);

    // Revert through SnapshotStore → RevertApplier
    const { RevertApplier } = await import("../../../src/adaptation/revert-applier.js");
    const revertWriter = { recordRevertFailed: vi.fn(), recordRevertApplied: vi.fn() } as any;
    const revertApplier = new RevertApplier(localSnapDir, revertWriter);

    const revertProposal: AdaptationProposal = {
      ...proposal,
      id: "prop-rev-001",
      action: "revert_proposal" as any,
      target: { kind: "revert", sourceProposalId: proposal.id } as any,
    };

    await revertApplier.apply(revertProposal);

    // Verify file restored to original
    content = JSON.parse(readFileSync(calibrationPath, "utf-8"));
    expect(content.calibrations[0].value).toBe(0.7);

    // Snapshot contentHash integrity verified
    const snapshot = await snapStore.loadVerified(proposal.id);
    expect(snapshot).not.toBeNull();

    rmSync(localSnapDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // P9.4b — policy_coverage mutation tests
  // -------------------------------------------------------------------------

  function makePolicyCoverageFile(dir: string, currentCoverage: number, targetCoverage: number): string {
    const govDir = join(dir, ".alix", "governance");
    mkdirSync(govDir, { recursive: true });
    const path = join(govDir, "policy-coverage.json");
    writeFileSync(
      path,
      JSON.stringify({ currentCoverage, targetCoverage, updatedByProposalId: "", updatedAt: "" }, null, 2),
      "utf-8",
    );
    return path;
  }

  it("applies policy_coverage successfully", async () => {
    makePolicyCoverageFile(tempRoot, 0.62, 0.80);
    const proposal = makeGovernanceProposal({
      payload: { kind: "policy_coverage", currentCoverage: 0.62, targetCoverage: 0.85 },
    });
    const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, writer);
    await applier.apply(proposal);

    const path = join(tempRoot, ".alix", "governance", "policy-coverage.json");
    const content = JSON.parse(readFileSync(path, "utf-8"));
    expect(content.targetCoverage).toBe(0.85);
    expect(content.currentCoverage).toBe(0.62);
    expect(content.updatedByProposalId).toBe("prop-gov-001");
    expect(content.updatedAt).toBeTruthy();
  });

  it("rejects policy_coverage with current coverage drift", async () => {
    makePolicyCoverageFile(tempRoot, 0.62, 0.80);
    const proposal = makeGovernanceProposal({
      payload: { kind: "policy_coverage", currentCoverage: 0.70, targetCoverage: 0.85 },
    });
    const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, writer);
    await expect(applier.apply(proposal)).rejects.toThrow(/drift|currentCoverage/i);
  });

  it("rejects policy_coverage when file does not exist", async () => {
    const proposal = makeGovernanceProposal({
      payload: { kind: "policy_coverage", currentCoverage: 0.62, targetCoverage: 0.85 },
    });
    const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, writer);
    await expect(applier.apply(proposal)).rejects.toThrow(/not found/i);
  });

  it("rejects policy_coverage with invalid schema (missing numeric fields)", async () => {
    const govDir = join(tempRoot, ".alix", "governance");
    mkdirSync(govDir, { recursive: true });
    writeFileSync(
      join(govDir, "policy-coverage.json"),
      JSON.stringify({ currentCoverage: "not-a-number", targetCoverage: 0.80, updatedByProposalId: "", updatedAt: "" }),
      "utf-8",
    );
    const proposal = makeGovernanceProposal({
      payload: { kind: "policy_coverage", currentCoverage: 0.62, targetCoverage: 0.85 },
    });
    const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, writer);
    await expect(applier.apply(proposal)).rejects.toThrow(/schema|numeric|currentCoverage/i);
  });

  it("records governance_mutation_applied for policy_coverage", async () => {
    makePolicyCoverageFile(tempRoot, 0.62, 0.80);
    const recordGovernanceMutationApplied = vi.fn().mockResolvedValue(null);
    const localWriter = { recordSnapshotTaken: vi.fn().mockResolvedValue(null), recordGovernanceMutationApplied } as any;
    const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, localWriter);
    const proposal = makeGovernanceProposal({
      payload: { kind: "policy_coverage", currentCoverage: 0.62, targetCoverage: 0.85 },
    });
    await applier.apply(proposal);

    expect(recordGovernanceMutationApplied).toHaveBeenCalledWith(
      proposal.id,
      expect.objectContaining({
        payloadKind: "policy_coverage",
        targetFile: expect.stringContaining("policy-coverage.json"),
        snapshotId: expect.any(String),
        beforeHash: expect.any(String),
        afterHash: expect.any(String),
      }),
    );
  });
});
