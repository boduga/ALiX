/**
 * replay-diff-store.ts — Capture before/after file snapshots, compute diffs,
 * and persist ReplayDiffRecord sets for replay mutations.
 */

import { existsSync, copyFileSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execSync } from "node:child_process";
import type { ReplayStatusIndex } from "./replay-status-index.js";

// ─── Types ───────────────────────────────────────────────────────────

export type ReplayDiffRecord = {
  filePath: string;
  changeType: "created" | "modified" | "deleted";
  beforeSnapshotPath?: string;
  afterSnapshotPath?: string;
  diffPreview: string;
  diffSize: number;
  rollbackable: boolean;
  timestamp: string;
};

export type ReplayDiffSet = {
  replayId: string;
  records: ReplayDiffRecord[];
  totalFilesChanged: number;
  totalRollbackable: number;
  storePath: string;
  createdAt: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────

/** Determine if a record is rollbackable based on changeType and beforeState. */
export function isRollbackable(changeType: string, hasBeforeState: boolean): boolean {
  if (changeType === "created") return false;
  return hasBeforeState;
}

// ─── ReplayDiffStore ─────────────────────────────────────────────────

export class ReplayDiffStore {
  constructor(
    private cwd: string,
    private statusIndex?: ReplayStatusIndex,
  ) {}

  private replayDir(replayId: string): string {
    return join(this.cwd, ".alix", "replays", replayId);
  }

  private snapshotDir(replayId: string, when: "before" | "after"): string {
    return join(this.replayDir(replayId), "snapshots", when);
  }

  private diffsDir(replayId: string): string {
    return join(this.replayDir(replayId), "diffs");
  }

  async captureBefore(replayId: string, filePath: string): Promise<string | null> {
    const resolvedPath = resolve(this.cwd, filePath);
    if (!existsSync(resolvedPath)) return null;
    const dest = join(this.snapshotDir(replayId, "before"), filePath);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(resolvedPath, dest);
    return dest;
  }

  async captureAfter(replayId: string, filePath: string): Promise<string | null> {
    const resolvedPath = resolve(this.cwd, filePath);
    if (!existsSync(resolvedPath)) return null;
    const dest = join(this.snapshotDir(replayId, "after"), filePath);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(resolvedPath, dest);
    return dest;
  }

  async computeDiff(replayId: string, filePath: string): Promise<string> {
    const before = join(this.snapshotDir(replayId, "before"), filePath);
    const after = join(this.snapshotDir(replayId, "after"), filePath);
    const diffDir = this.diffsDir(replayId);
    mkdirSync(diffDir, { recursive: true });
    const diffFileName = filePath.replace(/\//g, "__").replace(/\\/g, "__") + ".diff";
    const diffPath = join(diffDir, diffFileName);

    const beforeExists = existsSync(before);
    const afterExists = existsSync(after);

    // Handle missing snapshots
    if (!beforeExists && !afterExists) return "(no snapshots to diff)";
    if (!beforeExists && afterExists) {
      const content = readFileSync(after, "utf-8");
      const lines = content.split("\n");
      const diffText = `--- /dev/null\n+++ ${filePath}\n@@ -0,0 +1,${lines.length} @@\n` +
        lines.map(l => `+${l}`).join("\n");
      writeFileSync(diffPath, diffText, "utf-8");
      return diffText;
    }
    if (beforeExists && !afterExists) {
      const content = readFileSync(before, "utf-8");
      const lines = content.split("\n");
      const diffText = `--- ${filePath}\n+++ /dev/null\n@@ -1,${lines.length} +0,0 @@\n` +
        lines.map(l => `-${l}`).join("\n");
      writeFileSync(diffPath, diffText, "utf-8");
      return diffText;
    }

    try {
      const diff = execSync(
        `git diff --no-index -- "${before}" "${after}"`,
        { encoding: "utf-8", timeout: 10000 },
      );
      writeFileSync(diffPath, diff, "utf-8");
      return diff;
    } catch (err: any) {
      if (err.stdout) {
        writeFileSync(diffPath, err.stdout, "utf-8");
        return err.stdout;
      }
      return `(diff failed: ${err.message})`;
    }
  }

  async appendRecord(replayId: string, record: ReplayDiffRecord): Promise<void> {
    const index = await this.loadIndex(replayId) ?? {
      replayId,
      records: [],
      totalFilesChanged: 0,
      totalRollbackable: 0,
      storePath: this.replayDir(replayId),
      createdAt: new Date().toISOString(),
    };

    // First record being captured — set status if index is available
    if (index.records.length === 0 && this.statusIndex) {
      await this.statusIndex.ensureReplay(replayId);
    }

    index.records.push(record);
    index.totalFilesChanged = index.records.length;
    index.totalRollbackable = index.records.filter(r => r.rollbackable).length;
    await this.saveIndex(replayId, index);
  }

  async saveIndex(replayId: string, set: ReplayDiffSet): Promise<void> {
    const dir = this.replayDir(replayId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.json"), JSON.stringify(set, null, 2), "utf-8");
  }

  async loadIndex(replayId: string): Promise<ReplayDiffSet | null> {
    const indexPath = join(this.replayDir(replayId), "index.json");
    if (!existsSync(indexPath)) return null;
    try {
      return JSON.parse(readFileSync(indexPath, "utf-8")) as ReplayDiffSet;
    } catch {
      return null;
    }
  }

  isRollbackable(changeType: string, hasBeforeState: boolean): boolean {
    return isRollbackable(changeType, hasBeforeState);
  }
}
