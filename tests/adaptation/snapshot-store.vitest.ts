import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, chmodSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { SnapshotStore } from "../../src/adaptation/snapshot-store.js";
import type { AdaptationSnapshot } from "../../src/adaptation/snapshot-store.js";

function makeSnapshot(overrides?: Partial<AdaptationSnapshot>): AdaptationSnapshot {
  const content = "original file content for snapshot test";
  const contentBase64 = Buffer.from(content, "utf-8").toString("base64");
  const contentHash = createHash("sha256").update(content).digest("hex");
  const fingerprint = `snapshot-${Math.random().toString(36).slice(2, 10)}`;
  return {
    proposalId: "prop-test-1",
    snapshotAt: "2026-06-19T12:00:00.000Z",
    action: "update_agent_card",
    target: { kind: "agent_card", id: "card-1" },
    filePath: "/tmp/test-card.json",
    content: contentBase64,
    contentHash,
    fingerprint,
    ...overrides,
  };
}

describe("SnapshotStore", () => {
  let dir: string;
  let store: SnapshotStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "snap-"));
    store = new SnapshotStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("saves and loads a snapshot (round-trip)", async () => {
    const snapshot = makeSnapshot();
    await store.save(snapshot);
    const loaded = await store.load(snapshot.proposalId);
    expect(loaded).not.toBeNull();
    expect(loaded!.proposalId).toBe(snapshot.proposalId);
    expect(loaded!.content).toBe(snapshot.content);
    expect(loaded!.contentHash).toBe(snapshot.contentHash);
    expect(loaded!.fingerprint).toBe(snapshot.fingerprint);
    expect(loaded!.snapshotAt).toBe(snapshot.snapshotAt);
    expect(loaded!.action).toBe(snapshot.action);
    expect(loaded!.target).toEqual(snapshot.target);
    expect(loaded!.filePath).toBe(snapshot.filePath);
  });

  it("load returns null for missing snapshot", async () => {
    const loaded = await store.load("nonexistent-id");
    expect(loaded).toBeNull();
  });

  it("verify returns true for a valid snapshot with matching contentHash", async () => {
    const snapshot = makeSnapshot();
    await store.save(snapshot);
    const valid = await store.verify(snapshot);
    expect(valid).toBe(true);
  });

  it("verify returns false for tampered content (changed on disk)", async () => {
    const snapshot = makeSnapshot();
    await store.save(snapshot);

    // Tamper with the file on disk: change the content field but keep contentHash unchanged
    const filePath = join(dir, `${snapshot.proposalId}.json`);
    const tampered = { ...snapshot, content: Buffer.from("tampered content!", "utf-8").toString("base64") };
    writeFileSync(filePath, JSON.stringify(tampered, null, 2), "utf-8");

    const loaded = await store.load(snapshot.proposalId);
    expect(loaded).not.toBeNull();
    const valid = await store.verify(loaded!);
    expect(valid).toBe(false);
  });

  it("verify returns false for tampered contentHash (mismatch with content)", async () => {
    const snapshot = makeSnapshot();
    await store.save(snapshot);

    // Tamper: change contentHash to a wrong value but keep correct content
    const filePath = join(dir, `${snapshot.proposalId}.json`);
    const badHash = createHash("sha256").update("wrong content").digest("hex");
    const tampered = { ...snapshot, contentHash: badHash };
    writeFileSync(filePath, JSON.stringify(tampered, null, 2), "utf-8");

    const loaded = await store.load(snapshot.proposalId);
    expect(loaded).not.toBeNull();
    const valid = await store.verify(loaded!);
    expect(valid).toBe(false);
  });

  it("save writes via temp file then renames to final", async () => {
    const snapshot = makeSnapshot();
    await store.save(snapshot);

    // Final snapshot file exists and has correct content
    const targetPath = join(dir, `${snapshot.proposalId}.json`);
    expect(existsSync(targetPath)).toBe(true);

    // .tmp file should not remain after successful save
    const tmpPath = targetPath + ".tmp";
    expect(existsSync(tmpPath)).toBe(false);

    // Content is valid JSON matching the snapshot
    const loaded = await store.load(snapshot.proposalId);
    expect(loaded).not.toBeNull();
    expect(loaded!.proposalId).toBe(snapshot.proposalId);
  });

  it("failed write does not leave a partial final snapshot", async () => {
    const snapshot = makeSnapshot();
    const targetPath = join(dir, `${snapshot.proposalId}.json`);

    // Make the directory read-only to force a write failure
    const stat = statSync(dir);
    const origMode = stat.mode;
    chmodSync(dir, 0o444); // read-only

    try {
      // Save should throw because the directory is read-only
      await expect(store.save(snapshot)).rejects.toThrow();

      // Final snapshot file should NOT exist — no partial artifact
      expect(existsSync(targetPath)).toBe(false);
    } finally {
      // Restore permissions for cleanup
      chmodSync(dir, origMode);
    }
  });
});
