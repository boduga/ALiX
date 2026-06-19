/**
 * P5.2e — Revert evidence tests (recordSnapshotTaken + recordRevertFailed).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EvidenceStore } from "../../../src/security/evidence/evidence-store.js";
import { EvidenceEventWriter } from "../../../src/workflow/evidence-writer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  const dir = join("/tmp", "ev-revert-test-" + randomUUID().slice(0, 8));
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  return dir;
}

function makeFixture(): { writer: EvidenceEventWriter; store: EvidenceStore; dir: string } {
  const dir = tmpDir();
  const store = new EvidenceStore({ storeDir: dir });
  const writer = new EvidenceEventWriter(
    (type, payload) => store.append(type, payload),
  );
  return { writer, store, dir };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EvidenceEventWriter revert events", () => {
  let dir: string;
  let store: EvidenceStore;
  let writer: EvidenceEventWriter;

  beforeEach(() => {
    const f = makeFixture();
    dir = f.dir;
    store = f.store;
    writer = f.writer;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("recordSnapshotTaken", () => {
    it("appends one adaptation_snapshot_taken record with full payload", async () => {
      const r = await writer.recordSnapshotTaken("prop-1", {
        snapshotFingerprint: "abc123snap",
        contentHash: "sha256def456",
        filePath: "src/config/card.json",
      });

      expect(r).not.toBeNull();
      expect(r!.type).toBe("adaptation_snapshot_taken");
      expect(r!.payload.proposalId).toBe("prop-1");
      expect(r!.payload.snapshotFingerprint).toBe("abc123snap");
      expect(r!.payload.contentHash).toBe("sha256def456");
      expect(r!.payload.filePath).toBe("src/config/card.json");
    });

    it("returns a valid EvidenceRecord shape", async () => {
      const r = await writer.recordSnapshotTaken("prop-2", {
        snapshotFingerprint: "fprint-1",
        contentHash: "chash-1",
        filePath: "/tmp/foo.json",
      });

      expect(r).not.toBeNull();
      expect(r!.id).toBeTruthy();
      expect(r!.fingerprint).toBeTruthy();
      expect(r!.timestamp).toBeTruthy();
      expect(r!.version).toBe(1);
    });
  });

  describe("recordRevertFailed", () => {
    it("appends one adaptation_revert_failed record with error and snapshotFingerprint", async () => {
      const r = await writer.recordRevertFailed("prop-3", {
        error: "Snapshot not found",
        snapshotFingerprint: "fprint-missing",
      });

      expect(r).not.toBeNull();
      expect(r!.type).toBe("adaptation_revert_failed");
      expect(r!.payload.proposalId).toBe("prop-3");
      expect(r!.payload.error).toBe("Snapshot not found");
      expect(r!.payload.snapshotFingerprint).toBe("fprint-missing");
    });

    it("allows snapshotFingerprint to be omitted", async () => {
      const r = await writer.recordRevertFailed("prop-4", {
        error: "Hash mismatch",
      });

      expect(r).not.toBeNull();
      expect(r!.type).toBe("adaptation_revert_failed");
      expect(r!.payload.proposalId).toBe("prop-4");
      expect(r!.payload.error).toBe("Hash mismatch");
      expect(r!.payload.snapshotFingerprint).toBeUndefined();
    });

    it("returns a valid EvidenceRecord shape", async () => {
      const r = await writer.recordRevertFailed("prop-5", {
        error: "Write error",
        snapshotFingerprint: "snap-5",
      });

      expect(r).not.toBeNull();
      expect(r!.id).toBeTruthy();
      expect(r!.fingerprint).toBeTruthy();
      expect(r!.timestamp).toBeTruthy();
      expect(r!.version).toBe(1);
    });
  });

  describe("query by type", () => {
    it("returns correct totals when both types are interleaved", async () => {
      await writer.recordSnapshotTaken("p1", {
        snapshotFingerprint: "f1", contentHash: "h1", filePath: "a.json",
      });
      await writer.recordRevertFailed("p2", {
        error: "e1", snapshotFingerprint: "f2",
      });
      await writer.recordSnapshotTaken("p3", {
        snapshotFingerprint: "f3", contentHash: "h3", filePath: "b.json",
      });

      const snapshots = await store.query({ type: "adaptation_snapshot_taken" });
      expect(snapshots.records.length).toBe(2);
      expect(snapshots.total).toBe(2);

      const failures = await store.query({ type: "adaptation_revert_failed" });
      expect(failures.records.length).toBe(1);
      expect(failures.total).toBe(1);
    });

    it("fingerprints are unique per event", async () => {
      const r1 = await writer.recordSnapshotTaken("pa", {
        snapshotFingerprint: "fa", contentHash: "ha", filePath: "a.json",
      });
      const r2 = await writer.recordSnapshotTaken("pb", {
        snapshotFingerprint: "fb", contentHash: "hb", filePath: "b.json",
      });

      expect(r1).not.toBeNull();
      expect(r2).not.toBeNull();
      expect(r1!.fingerprint).not.toBe(r2!.fingerprint);
    });
  });

  describe("error handling", () => {
    it("returns null when append fails for recordSnapshotTaken", async () => {
      const brokenWriter = new EvidenceEventWriter(async () => {
        throw new Error("Store unavailable");
      });
      const r = await brokenWriter.recordSnapshotTaken("px", {
        snapshotFingerprint: "fx", contentHash: "hx", filePath: "x.json",
      });
      expect(r).toBeNull();
    });

    it("returns null when append fails for recordRevertFailed", async () => {
      const brokenWriter = new EvidenceEventWriter(async () => {
        throw new Error("Store unavailable");
      });
      const r = await brokenWriter.recordRevertFailed("py", {
        error: "fail",
      });
      expect(r).toBeNull();
    });
  });
});
