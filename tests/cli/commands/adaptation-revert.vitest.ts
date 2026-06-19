/**
 * P5.2e.6 — adaptation revert subcommand + selectApplier routing tests.
 *
 * Exercises the `alix adaptation revert <id>` creation subcommand and validates
 * that `selectApplier` routes `revert_proposal` proposals to `RevertApplier`.
 *
 * Covers:
 *  - (a) revert on a non-existent proposal → error
 *  - (b) revert on a non-snapshotted proposal → error
 *  - (c) revert on a snapshotted proposal → creates pending revert_proposal + evidence
 *  - (d) revert without <id> → usage error
 *  - (e) selectApplier routes target.kind "revert" to RevertApplier (integration)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// process.cwd override helpers
// ---------------------------------------------------------------------------

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

function setCwd(dir: string): void {
  cwdSpy.mockReturnValue(dir);
}

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "adaptation-revert-cli-"));
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

function mockExit(): { spy: ReturnType<typeof vi.spyOn>; calls: () => (string | number | null | undefined)[] } {
  const calls: (string | number | null | undefined)[] = [];
  const spy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
    calls.push(code);
    throw new Error(`process.exit(${code})`);
  });
  return { spy, calls: () => calls };
}

/** Seed a proposal directly via ProposalStore. */
async function seedProposal(overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const { ProposalStore } = await import("../../../src/adaptation/proposal-store.js");
  const store = new ProposalStore(join(tempRoot, ".alix", "adaptation", "proposals"));

  const id = (overrides.id as string) || "prop-test-001";
  const action = (overrides.action as string) || "update_agent_card";
  const status = (overrides.status as string) || "pending";

  const proposal = {
    id,
    createdAt: "2026-06-19T00:00:00.000Z",
    status,
    action,
    target: (overrides.target as Record<string, unknown>) || { kind: "agent_card", id: "test.agent" },
    payload: (overrides.payload as Record<string, unknown>) || { name: "Test", description: "For testing" },
    sourceRecommendationType: "test",
    sourceConfidence: 1,
    evidenceFingerprints: [] as string[],
    reason: (overrides.reason as string) || "test proposal",
    ...overrides,
  };

  await store.save(proposal as unknown as import("../../../src/adaptation/adaptation-types.js").AdaptationProposal);
  return proposal;
}

/** Seed a snapshot file for a proposal ID. */
async function seedSnapshot(proposalId: string, filePath: string, content: string): Promise<string> {
  const snapshotsDir = join(tempRoot, ".alix", "adaptation", "snapshots");
  mkdirSync(snapshotsDir, { recursive: true });

  const encoded = Buffer.from(content, "utf-8").toString("base64");
  const contentHash = createHash("sha256").update(content).digest("hex");
  const fingerprint = randomUUID();

  const snapshot = {
    proposalId,
    snapshotAt: new Date().toISOString(),
    action: "update_agent_card",
    target: { kind: "agent_card", id: "test.agent" },
    filePath,
    content: encoded,
    contentHash,
    fingerprint,
  };

  writeFileSync(join(snapshotsDir, `${proposalId}.json`), JSON.stringify(snapshot, null, 2), "utf-8");
  return fingerprint;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("adaptation revert CLI", () => {
  // ---------------------------------------------------------------------------
  // (a) revert on a non-existent proposal → error
  // ---------------------------------------------------------------------------

  it("errors with exit 1 when the source proposal does not exist", async () => {
    const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
    const c = captureConsole();
    const exit = mockExit();

    await expect(handleAdaptationCommand(["revert", "prop-nonexistent"]))
      .rejects.toThrow("process.exit(1)");
    expect(c.err().join("\n").toLowerCase()).toContain("not found");

    exit.spy.mockRestore();
    c.restore();
  });

  // ---------------------------------------------------------------------------
  // (b) revert on a non-snapshotted proposal → error
  // ---------------------------------------------------------------------------

  it("errors with exit 1 when no snapshot exists for the source proposal", async () => {
    // Seed a proposal but do NOT create a snapshot.
    await seedProposal({ id: "prop-no-snapshot", action: "create_agent_card" });

    const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
    const c = captureConsole();
    const exit = mockExit();

    await expect(handleAdaptationCommand(["revert", "prop-no-snapshot"]))
      .rejects.toThrow("process.exit(1)");
    expect(c.err().join("\n").toLowerCase()).toContain("no snapshot");

    exit.spy.mockRestore();
    c.restore();
  });

  // ---------------------------------------------------------------------------
  // (c) revert on a snapshotted proposal → creates pending revert_proposal
  // ---------------------------------------------------------------------------

  it("creates a pending revert_proposal and records adaptation_proposed evidence", async () => {
    // Seed a source proposal.
    const sourceProposal = await seedProposal({ id: "prop-snapshotted", action: "update_agent_card" });

    // Create the card file and snapshot it manually.
    const cardDir = join(tempRoot, ".alix", "cards", "agents");
    mkdirSync(cardDir, { recursive: true });
    const cardPath = join(cardDir, "test.agent.json");
    const originalCard = { id: "test.agent", name: "Original", description: "Before update" };
    writeFileSync(cardPath, JSON.stringify(originalCard, null, 2), "utf-8");

    await seedSnapshot(sourceProposal.id as string, cardPath, JSON.stringify(originalCard, null, 2));

    const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
    const c = captureConsole();
    await handleAdaptationCommand(["revert", sourceProposal.id as string, "--reason", "Undo test change"]);

    const outLines = c.out().join("\n");
    // Verify output mentions the new revert proposal id.
    expect(outLines).toContain("Revert proposed:");
    expect(outLines).toContain("approve then apply to execute");
    c.restore();

    // Load the store and verify the revert proposal was created.
    const { ProposalStore } = await import("../../../src/adaptation/proposal-store.js");
    const store = new ProposalStore(join(tempRoot, ".alix", "adaptation", "proposals"));
    const all = await store.list();
    // Should have source proposal + revert proposal.
    expect(all.length).toBeGreaterThanOrEqual(2);

    const revertProposal = all.find((p) => p.action === "revert_proposal");
    expect(revertProposal).toBeDefined();
    expect(revertProposal!.status).toBe("pending");
    expect(revertProposal!.action).toBe("revert_proposal");
    expect(revertProposal!.target.kind).toBe("revert");
    expect((revertProposal!.target as { kind: "revert"; sourceProposalId: string }).sourceProposalId).toBe(sourceProposal.id);
    expect(revertProposal!.provenance).toBe("auto");
    expect(revertProposal!.reason).toBe("Undo test change");

    // Evidence recorded.
    const { EvidenceStore } = await import("../../../src/security/evidence/evidence-store.js");
    const evidence = new EvidenceStore({ storeDir: join(tempRoot, ".alix", "security") });
    const proposed = await evidence.query({ type: "adaptation_proposed" });
    // Filter to find revert_proposal events.
    const revertEvents = proposed.records.filter((r) =>
      r.payload.action === "revert_proposal",
    );
    expect(revertEvents.length).toBeGreaterThanOrEqual(1);
    expect(revertEvents[0].payload.provenance).toBe("auto");
  });

  // ---------------------------------------------------------------------------
  // (d) revert without <id> → usage error
  // ---------------------------------------------------------------------------

  it("errors with usage message when no proposal id is given", async () => {
    const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
    const c = captureConsole();
    const exit = mockExit();

    await expect(handleAdaptationCommand(["revert"]))
      .rejects.toThrow("process.exit(1)");
    expect(c.err().join("\n").toLowerCase()).toContain("usage");

    exit.spy.mockRestore();
    c.restore();
  });

  // ---------------------------------------------------------------------------
  // (e) selectApplier routes target.kind "revert" to RevertApplier (integration)
  // ---------------------------------------------------------------------------

  it("routes a revert_proposal through selectApplier to RevertApplier and restores the file", async () => {
    // Set up: create a card file, snapshot it, create a revert_proposal, approve it, apply it.
    const cardDir = join(tempRoot, ".alix", "cards", "agents");
    mkdirSync(cardDir, { recursive: true });
    const cardPath = join(cardDir, "restore-me.agent.json");
    const originalContent = { id: "restore-me.agent", name: "Original Name", version: "1.0.0" };
    writeFileSync(cardPath, JSON.stringify(originalContent, null, 2), "utf-8");

    // Simulate: the file was modified by an update_agent_card proposal.
    const modifiedContent = { id: "restore-me.agent", name: "Modified Name", version: "2.0.0" };
    writeFileSync(cardPath, JSON.stringify(modifiedContent, null, 2), "utf-8");

    // Create a snapshot of the ORIGINAL content.
    const sourceProposalId = "prop-source-revert";
    const snapshotFingerprint = await seedSnapshot(
      sourceProposalId,
      cardPath,
      JSON.stringify(originalContent, null, 2),
    );

    // Create and approve a revert_proposal.
    const revertProposalId = "prop-revert-001";
    const { ProposalStore } = await import("../../../src/adaptation/proposal-store.js");
    const store = new ProposalStore(join(tempRoot, ".alix", "adaptation", "proposals"));
    const revertProposal = {
      id: revertProposalId,
      createdAt: new Date().toISOString(),
      status: "approved" as const,
      action: "revert_proposal" as const,
      target: { kind: "revert" as const, sourceProposalId },
      payload: { reason: "Integration test revert", snapshotFingerprint, sourceProposalId },
      sourceRecommendationType: "manual_revert",
      sourceConfidence: 1,
      evidenceFingerprints: [snapshotFingerprint],
      reason: "Integration test revert",
      approvedBy: "tester",
      approvedAt: new Date().toISOString(),
      provenance: "manual" as const,
    };
    await store.save(revertProposal);

    // Apply the revert.
    const { handleAdaptationCommand } = await import("../../../src/cli/commands/adaptation.js");
    const c = captureConsole();
    await handleAdaptationCommand(["apply", revertProposalId]);
    c.restore();

    // Verify the card file was restored to original content.
    const restoredRaw = JSON.parse(readFileSync(cardPath, "utf-8"));
    expect(restoredRaw.name).toBe("Original Name");
    expect(restoredRaw.version).toBe("1.0.0");

    // Verify the proposal status is now "applied".
    const reloaded = await store.load(revertProposalId);
    expect(reloaded!.status).toBe("applied");

    // Verify adaptation_applied evidence recorded.
    const { EvidenceStore } = await import("../../../src/security/evidence/evidence-store.js");
    const evidence = new EvidenceStore({ storeDir: join(tempRoot, ".alix", "security") });
    const applied = await evidence.query({ type: "adaptation_applied" });
    const revertApplied = applied.records.filter((r) => r.payload.proposalId === revertProposalId);
    expect(revertApplied.length).toBe(1);
  });
});
