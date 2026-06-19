import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { SnapshotStore } from "../../src/adaptation/snapshot-store.js";
import type { AdaptationSnapshot } from "../../src/adaptation/snapshot-store.js";
import type { AdaptationProposal } from "../../src/adaptation/adaptation-types.js";
import type { EvidenceRecord } from "../../src/security/evidence/evidence-types.js";
import { EvidenceEventWriter } from "../../src/workflow/evidence-writer.js";
import { RevertApplier } from "../../src/adaptation/revert-applier.js";

function makeSnapshot(overrides?: Partial<AdaptationSnapshot>): AdaptationSnapshot {
  const content = "original file content for revert test";
  const contentBase64 = Buffer.from(content, "utf-8").toString("base64");
  const contentHash = createHash("sha256").update(content).digest("hex");
  const fingerprint = `snapshot-${Math.random().toString(36).slice(2, 10)}`;
  return {
    proposalId: "prop-test-revert",
    snapshotAt: "2026-06-19T12:00:00.000Z",
    action: "update_agent_card",
    target: { kind: "agent_card", id: "card-1" },
    filePath: "/tmp/test-revert-output.json",
    content: contentBase64,
    contentHash,
    fingerprint,
    ...overrides,
  };
}

function makeRevertProposal(overrides?: Partial<AdaptationProposal>): AdaptationProposal {
  return {
    id: "prop-revert-001",
    createdAt: "2026-06-19T13:00:00.000Z",
    status: "approved",
    action: "revert_proposal",
    target: { kind: "revert", sourceProposalId: "prop-test-revert" },
    payload: { reason: "test revert" },
    sourceRecommendationType: "manual",
    sourceConfidence: 1.0,
    evidenceFingerprints: [],
    reason: "Test revert reason",
    provenance: "manual",
    ...overrides,
  } as AdaptationProposal;
}

function makeMockEvidenceRecord(): EvidenceRecord {
  return {
    version: 1,
    id: `ev-${Math.random().toString(36).slice(2, 10)}`,
    type: "adaptation_revert_failed",
    timestamp: new Date().toISOString(),
    fingerprint: `fp-${Math.random().toString(36).slice(2, 10)}`,
    payload: {},
  };
}

describe("RevertApplier", () => {
  let snapshotsDir: string;
  let outputDir: string;
  let snapshotStore: SnapshotStore;

  beforeEach(() => {
    snapshotsDir = mkdtempSync(join(tmpdir(), "revert-snap-"));
    outputDir = mkdtempSync(join(tmpdir(), "revert-out-"));
    snapshotStore = new SnapshotStore(snapshotsDir);
  });

  afterEach(() => {
    rmSync(snapshotsDir, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  });

  function makeWriter() {
    const calls: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const append = async (type: string, payload: Record<string, unknown>): Promise<EvidenceRecord> => {
      calls.push({ type, payload });
      return makeMockEvidenceRecord();
    };
    return { writer: new EvidenceEventWriter(append), calls };
  }

  // ---------------------------------------------------------------------------
  // Test (a): happy path — snapshot exists + hash matches + file write succeeds
  // ---------------------------------------------------------------------------
  it("(a) restores file from snapshot when snapshot exists and hash matches", async () => {
    const outputPath = join(outputDir, "restored.json");
    const originalContent = "original content for happy path test";

    const snapshot: AdaptationSnapshot = {
      proposalId: "prop-src-001",
      snapshotAt: "2026-06-19T12:00:00.000Z",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "card-1" },
      filePath: outputPath,
      content: Buffer.from(originalContent, "utf-8").toString("base64"),
      contentHash: createHash("sha256").update(originalContent).digest("hex"),
      fingerprint: "snap-fp-001",
    };

    await snapshotStore.save(snapshot);

    const proposal = makeRevertProposal({
      target: { kind: "revert", sourceProposalId: "prop-src-001" },
    });

    const { writer } = makeWriter();
    const applier = new RevertApplier(snapshotsDir, writer);

    // Should not throw
    await applier.apply(proposal);

    // Verify file was restored
    const restoredContent = readFileSync(outputPath, "utf-8");
    expect(restoredContent).toBe(originalContent);
  });

  // ---------------------------------------------------------------------------
  // Test (b): snapshot not found
  // ---------------------------------------------------------------------------
  it("(b) throws when snapshot is not found for the source proposal", async () => {
    const proposal = makeRevertProposal({
      target: { kind: "revert", sourceProposalId: "nonexistent-id" },
    });

    const { writer, calls } = makeWriter();
    const applier = new RevertApplier(snapshotsDir, writer);

    await expect(applier.apply(proposal)).rejects.toThrow(/snapshot not found/i);

    // Verify recordRevertFailed was called
    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe("adaptation_revert_failed");
    const payload = calls[0].payload;
    expect(payload.proposalId).toBe("prop-revert-001");
    expect(payload.error).toMatch(/snapshot not found/i);
  });

  // ---------------------------------------------------------------------------
  // Test (c): hash mismatch (snapshot content corrupted)
  // ---------------------------------------------------------------------------
  it("(c) throws with hash mismatch when snapshot content is corrupted", async () => {
    const outputPath = join(outputDir, "corrupted-test.json");
    const originalContent = "original content for hash test";

    const snapshot: AdaptationSnapshot = {
      proposalId: "prop-src-002",
      snapshotAt: "2026-06-19T12:00:00.000Z",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "card-1" },
      filePath: outputPath,
      content: Buffer.from(originalContent, "utf-8").toString("base64"),
      contentHash: createHash("sha256").update(originalContent).digest("hex"),
      fingerprint: "snap-fp-002",
    };

    await snapshotStore.save(snapshot);

    // Tamper with the saved file: change the content field but keep same contentHash
    const filePath = join(snapshotsDir, "prop-src-002.json");
    const tampered = {
      ...snapshot,
      content: Buffer.from("CORRUPTED CONTENT!", "utf-8").toString("base64"),
    };
    writeFileSync(filePath, JSON.stringify(tampered, null, 2), "utf-8");

    const proposal = makeRevertProposal({
      target: { kind: "revert", sourceProposalId: "prop-src-002" },
    });

    const { writer, calls } = makeWriter();
    const applier = new RevertApplier(snapshotsDir, writer);

    await expect(applier.apply(proposal)).rejects.toThrow(/hash mismatch/i);

    // Verify recordRevertFailed was called
    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe("adaptation_revert_failed");
    const payload = calls[0].payload;
    expect(payload.proposalId).toBe("prop-revert-001");
    expect(payload.error).toMatch(/hash mismatch/i);
  });

  // ---------------------------------------------------------------------------
  // Test (d): non-revert action
  // ---------------------------------------------------------------------------
  it("(d) throws when proposal action is not 'revert_proposal'", async () => {
    const proposal = makeRevertProposal({
      action: "update_agent_card" as "revert_proposal",
    });

    const { writer } = makeWriter();
    const applier = new RevertApplier(snapshotsDir, writer);

    await expect(applier.apply(proposal)).rejects.toThrow(/revert_proposal/i);
  });

  // ---------------------------------------------------------------------------
  // Test (e): recordRevertFailed is called on failure (dedicated test)
  // ---------------------------------------------------------------------------
  it("(e) calls recordRevertFailed on snapshot-not-found and includes snapshotFingerprint in error payload", async () => {
    const proposal = makeRevertProposal({
      id: "prop-dedicated-fail",
      target: { kind: "revert", sourceProposalId: "ghost-id" },
    });

    const { writer, calls } = makeWriter();
    const applier = new RevertApplier(snapshotsDir, writer);

    await expect(applier.apply(proposal)).rejects.toThrow();
    expect(calls).toHaveLength(1);

    const payload = calls[0].payload;
    expect(payload.proposalId).toBe("prop-dedicated-fail");
    expect(payload).toHaveProperty("error");
    expect(payload).toHaveProperty("snapshotFingerprint");
  });

  // ---------------------------------------------------------------------------
  // Test (f): throws without calling recordRevertFailed on non-revert action
  // ---------------------------------------------------------------------------
  it("(f) does NOT call recordRevertFailed when the failure is a non-revert action (wrong action)", async () => {
    const proposal = makeRevertProposal({
      action: "create_agent_card" as "revert_proposal",
    });

    const { writer, calls } = makeWriter();
    const applier = new RevertApplier(snapshotsDir, writer);

    await expect(applier.apply(proposal)).rejects.toThrow();
    // recordRevertFailed should NOT be called for wrong-action errors
    expect(calls).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Test (g): write error (target directory does not exist) is handled
  // ---------------------------------------------------------------------------
  it("(g) succeeds even when target directory does not exist (creates it)", async () => {
    const nestedDir = join(outputDir, "deep", "nested");
    const outputPath = join(nestedDir, "restored-deep.json");
    const originalContent = "content for nested dir test";

    const snapshot: AdaptationSnapshot = {
      proposalId: "prop-src-nested",
      snapshotAt: "2026-06-19T12:00:00.000Z",
      action: "update_agent_card",
      target: { kind: "agent_card", id: "card-1" },
      filePath: outputPath,
      content: Buffer.from(originalContent, "utf-8").toString("base64"),
      contentHash: createHash("sha256").update(originalContent).digest("hex"),
      fingerprint: "snap-fp-nested",
    };

    await snapshotStore.save(snapshot);

    const proposal = makeRevertProposal({
      target: { kind: "revert", sourceProposalId: "prop-src-nested" },
    });

    const { writer } = makeWriter();
    const applier = new RevertApplier(snapshotsDir, writer);

    await applier.apply(proposal);

    const restoredContent = readFileSync(outputPath, "utf-8");
    expect(restoredContent).toBe(originalContent);
  });
});
