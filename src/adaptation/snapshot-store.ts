import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { assertSafePathComponent } from "../security/path-assert.js";

export interface AdaptationSnapshot {
  proposalId: string;
  snapshotAt: string;       // ISO 8601
  action: string;           // the ProposalAction being applied
  target: { kind: string } & Record<string, unknown>;  // the proposal target
  filePath: string;         // absolute path of the snapshotted file
  content: string;          // base64-encoded file content
  contentHash: string;      // SHA-256 hex of decoded content
  fingerprint: string;      // the snapshot's own identity fingerprint
}

export class SnapshotStore {
  constructor(private readonly dir: string) {}

  async save(snapshot: AdaptationSnapshot): Promise<void> {
    assertSafePathComponent(snapshot.proposalId);
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });

    const targetPath = join(this.dir, `${snapshot.proposalId}.json`);
    const tmpPath = targetPath + ".tmp";

    // Atomic write: write to .tmp, then rename (atomic on same filesystem per POSIX)
    writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), "utf-8");
    renameSync(tmpPath, targetPath);
  }

  async load(proposalId: string): Promise<AdaptationSnapshot | null> {
    assertSafePathComponent(proposalId);
    const path = join(this.dir, `${proposalId}.json`);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as AdaptationSnapshot;
  }

  async verify(snapshot: AdaptationSnapshot): Promise<boolean> {
    const decoded = Buffer.from(snapshot.content, "base64").toString("utf-8");
    const computedHash = createHash("sha256").update(decoded).digest("hex");
    return computedHash === snapshot.contentHash;
  }

  /**
   * Load a snapshot by proposalId and verify its integrity before returning.
   *
   * This is the trust-path variant of `load()`. Callers that need integrity
   * guarantees (e.g. RevertApplier) should use this instead of raw `load()`.
   * Returns null if the snapshot file doesn't exist, and throws if the content
   * hash verification fails.
   */
  async loadVerified(proposalId: string): Promise<AdaptationSnapshot | null> {
    assertSafePathComponent(proposalId);
    const snapshot = await this.load(proposalId);
    if (!snapshot) return null;

    const valid = await this.verify(snapshot);
    if (!valid) {
      throw new Error(
        `Snapshot integrity check failed for proposal ${proposalId}: ` +
        `content hash mismatch. The snapshot may be corrupted or tampered with.`,
      );
    }
    return snapshot;
  }
}
