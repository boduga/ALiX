/**
 * #713 G1.3 — Inspector auth audit on the shared AuditEventStore contract.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AuthAuditStore } from "../../../src/security/inspector/auth-audit-store.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "auth-audit-"));
}

describe("AuthAuditStore", () => {
  it("appends a record and reads it back with the legacy shape", async () => {
    const dir = tempDir();
    try {
      const store = new AuthAuditStore(join(dir, "auth", "audit.jsonl"));
      const written = await store.append({ action: "token.create", tokenId: "t1", details: { role: "admin" } });

      assert.ok(written.id.length > 0);
      assert.ok(Date.parse(written.timestamp) > 0);

      const records = await store.list();
      assert.equal(records.length, 1);
      assert.equal(records[0].action, "token.create");
      assert.equal(records[0].tokenId, "t1");
      assert.deepEqual(records[0].details, { role: "admin" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves append order", async () => {
    const dir = tempDir();
    try {
      const store = new AuthAuditStore(join(dir, "audit.jsonl"));
      await store.append({ action: "a", tokenId: "1" });
      await store.append({ action: "b", tokenId: "2" });
      await store.append({ action: "c", tokenId: "3" });
      assert.deepEqual((await store.list()).map((r) => r.action), ["a", "b", "c"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws on write failure (fail-closed)", async () => {
    const dir = tempDir();
    try {
      // A file where a directory is expected makes ensureDir/append fail.
      const blocker = join(dir, "blocker");
      writeFileSync(blocker, "not a dir");
      const store = new AuthAuditStore(join(blocker, "audit.jsonl"));
      await assert.rejects(() => store.append({ action: "token.create", tokenId: "t1" }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates the file with 0o600 permissions on POSIX", async (t) => {
    if (process.platform === "win32") return t.skip("POSIX-only permission check");
    const dir = tempDir();
    try {
      const filePath = join(dir, "auth", "audit.jsonl");
      const store = new AuthAuditStore(filePath);
      await store.append({ action: "token.create", tokenId: "t1" });
      assert.equal(statSync(filePath).mode & 0o777, 0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
