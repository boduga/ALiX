/**
 * P5.2e.5 — RevertApplier.
 *
 * Restores a file from a snapshot taken before a proposal was applied.
 * Verifies snapshot integrity (contentHash) before restoring, and records
 * `adaptation_revert_failed` evidence on failure so the audit trail captures
 * why the revert could not complete.
 *
 * The RevertApplier is invoked by the ApprovalGate (via selectApplier routing)
 * when a `revert_proposal` is applied. It does NOT call the gate itself — the
 * gate wraps RevertApplier.apply and catches thrown errors to record
 * `adaptation_failed` + set status to `failed`.
 *
 * Hard boundary: only `revert_proposal` actions are accepted. Any other
 * action type causes an immediate throw.
 *
 * @module
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SnapshotStore } from "./snapshot-store.js";
import type { EvidenceEventWriter } from "../workflow/evidence-writer.js";
import type { AdaptationProposal } from "./adaptation-types.js";

export class RevertApplier {
  private readonly store: SnapshotStore;

  constructor(
    private readonly snapshotsDir: string,
    private readonly writer: EvidenceEventWriter,
  ) {
    this.store = new SnapshotStore(snapshotsDir);
  }

  /**
   * Restore a file from a snapshot.
   *
   * Only `revert_proposal` actions are accepted. The source proposal ID
   * (the proposal whose effects are being reverted) is extracted from
   * `proposal.target.sourceProposalId`.
   *
   * Steps:
   *   1. Verify `proposal.action === "revert_proposal"` — throw if not.
   *   2. Extract `sourceProposalId` from `proposal.target`.
   *   3. Load snapshot — throw if not found.
   *   4. Verify snapshot contentHash — throw on mismatch.
   *   5. Decode base64 content, ensure target directory exists, write file.
   *
   * On failure, `recordRevertFailed` is called BEFORE the throw so both
   * `adaptation_revert_failed` (this method) and `adaptation_failed`
   * (the gate catching the throw) appear in the evidence chain.
   */
  async apply(proposal: AdaptationProposal): Promise<void> {
    if (proposal.status !== "approved") {
      throw new Error(
        `RevertApplier: proposal status is "${proposal.status}", expected "approved"`,
      );
    }

    // Guard: only revert_proposal actions
    if (proposal.action !== "revert_proposal") {
      throw new Error(
        `RevertApplier: expected proposal.action "revert_proposal", got "${proposal.action}"`,
      );
    }

    // Extract source proposal ID from target
    const target = proposal.target;
    if (target.kind !== "revert" || !target.sourceProposalId) {
      throw new Error(
        `RevertApplier: proposal.target must be { kind: "revert", sourceProposalId }`,
      );
    }
    const sourceProposalId = target.sourceProposalId;

    // Load snapshot
    const snapshot = await this.store.load(sourceProposalId);
    if (!snapshot) {
      await this.writer.recordRevertFailed(proposal.id, {
        error: `Snapshot not found for source proposal "${sourceProposalId}"`,
        snapshotFingerprint: undefined,
      });
      throw new Error(
        `RevertApplier: snapshot not found for source proposal "${sourceProposalId}"`,
      );
    }

    // Verify snapshot integrity
    const valid = await this.store.verify(snapshot);
    if (!valid) {
      await this.writer.recordRevertFailed(proposal.id, {
        error: `Snapshot content hash mismatch for source proposal "${sourceProposalId}"`,
        snapshotFingerprint: snapshot.fingerprint,
      });
      throw new Error(
        `RevertApplier: snapshot hash mismatch for source proposal "${sourceProposalId}" — content may be corrupted`,
      );
    }

    // Decode and restore
    const decoded = Buffer.from(snapshot.content, "base64").toString("utf-8");

    // Ensure target directory exists
    const targetDir = dirname(snapshot.filePath);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    try {
      writeFileSync(snapshot.filePath, decoded, "utf-8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.writer.recordRevertFailed(proposal.id, {
        error: `Write failed for ${snapshot.filePath}: ${message}`,
        snapshotFingerprint: snapshot.fingerprint,
      });
      throw err;
    }
  }
}
