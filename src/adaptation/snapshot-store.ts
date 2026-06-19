import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

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
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    writeFileSync(
      join(this.dir, `${snapshot.proposalId}.json`),
      JSON.stringify(snapshot, null, 2),
      "utf-8",
    );
  }

  async load(proposalId: string): Promise<AdaptationSnapshot | null> {
    const path = join(this.dir, `${proposalId}.json`);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as AdaptationSnapshot;
  }

  async verify(snapshot: AdaptationSnapshot): Promise<boolean> {
    const decoded = Buffer.from(snapshot.content, "base64").toString("utf-8");
    const computedHash = createHash("sha256").update(decoded).digest("hex");
    return computedHash === snapshot.contentHash;
  }
}
