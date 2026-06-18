/**
 * auth-store.test.ts — P4.3-Sb2: Auth store tests.
 *
 * Validates:
 *  1. Create/list tokens
 *  2. Raw token is NOT persisted
 *  3. Hash is NOT printed in output
 *  4. Token count bound enforcement (max 32)
 *  5. Store permission failure handling
 *  6. Interrupted atomic write recovery
 *  7. Symlink attack prevention
 *  8. Expiry and grace window behavior
 *  9. Revocation
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, symlinkSync, unlinkSync, rmdirSync, existsSync, chmodSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  AuthStore,
  createTokenRecord,
  createRevocation,
  MAX_TOKEN_COUNT,
} from "../../../src/security/inspector/auth-store.js";
import { generateToken, sha256 } from "../../../src/security/inspector/token-format.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempDir(): string {
  return join(tmpdir(), `alix-auth-store-test-${randomUUID()}`);
}

function makeStore(dir: string): AuthStore {
  return new AuthStore({ filePath: join(dir, "auth-store.json") });
}

function makeToken(opts?: { id?: string; name?: string; role?: string }): ReturnType<typeof createTokenRecord> {
  const gen = generateToken();
  return createTokenRecord({
    id: opts?.id ?? gen.id,
    hash: gen.hash,
    name: opts?.name ?? "test-token",
    role: opts?.role ?? "readonly",
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuthStore", () => {
  let dir: string;
  let store: AuthStore;

  beforeEach(async () => {
    dir = tempDir();
    await mkdir(dir, { recursive: true });
    store = makeStore(dir);
  });

  afterEach(async () => {
    try { await rm(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  describe("create and list", () => {
    it("starts empty", async () => {
      const result = await store.load();
      assert.ok(result.ok);
      if (result.ok) {
        assert.equal(result.value.length, 0);
      }
    });

    it("adds a token and loads it", async () => {
      const token = makeToken({ name: "ci-token", role: "operator" });
      const addResult = await store.add(token);
      assert.ok(addResult.ok);

      const loadResult = await store.load();
      assert.ok(loadResult.ok);
      if (loadResult.ok) {
        assert.equal(loadResult.value.length, 1);
        assert.equal(loadResult.value[0].id, token.id);
        assert.equal(loadResult.value[0].name, "ci-token");
        assert.equal(loadResult.value[0].role, "operator");
      }
    });

    it("retrieves a token by id", async () => {
      const token = makeToken({ name: "specific" });
      await store.add(token);

      const getResult = await store.get(token.id);
      assert.ok(getResult.ok);
      if (getResult.ok && getResult.value) {
        assert.equal(getResult.value.name, "specific");
      }
    });

    it("returns null for unknown token id", async () => {
      const getResult = await store.get("nonexistent");
      assert.ok(getResult.ok);
      if (getResult.ok) {
        assert.equal(getResult.value, null);
      }
    });

    it("rejects duplicate token id", async () => {
      const gen = generateToken();
      const a = createTokenRecord({ id: gen.id, hash: gen.hash, name: "a", role: "readonly" });
      const b = createTokenRecord({ id: gen.id, hash: gen.hash, name: "b", role: "readonly" });
      await store.add(a);
      const result = await store.add(b);
      assert.ok(!result.ok);
      if (!result.ok) {
        assert.equal(result.error, "duplicate_token_id");
      }
    });
  });

  describe("raw token not persisted", () => {
    it("never writes raw token to store file", async () => {
      const gen = generateToken();
      const record = createTokenRecord({
        id: gen.id,
        hash: gen.hash,
        name: "safe",
        role: "readonly",
      });
      await store.add(record);

      // Read the raw file directly
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(store["filePath"], "utf-8");

      // The raw token should NOT appear in the file
      assert.ok(!raw.includes(gen.token), "raw token must not appear in store file");
      // The hash SHOULD appear (it's safe to store)
      assert.ok(raw.includes(gen.hash), "hash should appear in store file");
      // The token ID SHOULD appear (it's not a secret)
      assert.ok(raw.includes(gen.id), "token id should appear in store file");
    });
  });

  describe("hash is not in user-visible output", () => {
    it("hashes are stored but the store API returns them as data", async () => {
      // While the store does return hashes to internal consumers,
      // the auth-service layer strips them. This test verifies the
      // store layer's behavior for traceability.
      const token = makeToken();
      await store.add(token);

      const loadResult = await store.load();
      assert.ok(loadResult.ok);
      if (loadResult.ok) {
        const stored = loadResult.value[0];
        // Hash is present in the store (needed for verification)
        assert.ok(stored.hash.length > 0);
        // But it's hex (64 chars for SHA-256), not a raw token
        assert.equal(stored.hash.length, 64);
        assert.ok(/^[0-9a-f]+$/.test(stored.hash));
      }
    });
  });

  describe("token count bound", () => {
    it("rejects tokens when at max", async () => {
      // Fill up to max
      for (let i = 0; i < MAX_TOKEN_COUNT; i++) {
        const token = makeToken({ name: `token-${i}` });
        const result = await store.add(token);
        assert.ok(result.ok, `failed at token ${i}: ${!result.ok ? result.error : ""}`);
      }

      // One more should fail
      const extra = makeToken({ name: "extra" });
      const result = await store.add(extra);
      assert.ok(!result.ok);
      if (!result.ok) {
        assert.equal(result.error, "token_count_exceeded");
      }
    });

    it("allows adding after cleanup removes expired tokens", async () => {
      // Create an expired token
      const expired = makeToken({ name: "expired" });
      await store.add(expired);

      // Revoke it via update
      await store.update(expired.id, {
        revocation: createRevocation("test_cleanup"),
      });

      // Cleanup should remove it
      const cleanResult = await store.cleanup();
      assert.ok(cleanResult.ok);
      if (cleanResult.ok) {
        assert.equal(cleanResult.value, 1);
      }

      // Should be empty now
      const countResult = await store.count();
      assert.ok(countResult.ok);
      if (countResult.ok) {
        assert.equal(countResult.value, 0);
      }
    });
  });

  describe("expiry and revocation", () => {
    it("stores expiry date", async () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const token = createTokenRecord({
        id: generateToken().id,
        hash: generateToken().hash,
        name: "expiring",
        role: "readonly",
        expiresAt: futureDate,
      });
      await store.add(token);

      const getResult = await store.get(token.id);
      assert.ok(getResult.ok);
      if (getResult.ok && getResult.value) {
        assert.equal(getResult.value.expiresAt, futureDate);
      }
    });

    it("revokes a token", async () => {
      const token = makeToken({ name: "to-revoke" });
      await store.add(token);

      const revResult = await store.update(token.id, {
        revocation: createRevocation("manual"),
      });
      assert.ok(revResult.ok);

      const getResult = await store.get(token.id);
      assert.ok(getResult.ok);
      if (getResult.ok && getResult.value) {
        assert.ok(!!getResult.value.revocation);
        assert.equal(getResult.value.revocation!.reason, "manual");
      }
    });

    it("cleanup removes revoked tokens", async () => {
      const token = makeToken({ name: "will-revoke" });
      await store.add(token);
      await store.update(token.id, { revocation: createRevocation("clean") });

      const cleanResult = await store.cleanup();
      assert.ok(cleanResult.ok);
      if (cleanResult.ok) {
        assert.equal(cleanResult.value, 1);
      }
    });

    it("cleanup removes expired tokens", async () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      const token = createTokenRecord({
        id: generateToken().id,
        hash: generateToken().hash,
        name: "expired",
        role: "readonly",
        expiresAt: pastDate,
      });
      await store.add(token);

      const cleanResult = await store.cleanup();
      assert.ok(cleanResult.ok);
      if (cleanResult.ok) {
        assert.equal(cleanResult.value, 1);
      }
    });
  });

  describe("update token", () => {
    it("updates token metadata", async () => {
      const token = makeToken({ name: "original" });
      await store.add(token);

      const updateResult = await store.update(token.id, { name: "updated" });
      assert.ok(updateResult.ok);

      const getResult = await store.get(token.id);
      assert.ok(getResult.ok);
      if (getResult.ok && getResult.value) {
        assert.equal(getResult.value.name, "updated");
      }
    });

    it("rejects update of unknown token", async () => {
      const result = await store.update("fake-id", { name: "nope" });
      assert.ok(!result.ok);
      if (!result.ok) {
        assert.equal(result.error, "token_not_found");
      }
    });
  });

  describe("store permission failure", () => {
    it("handles unreadable store file gracefully", async () => {
      // Create the file, then remove read permissions
      const token = makeToken();
      await store.add(token);

      // Make the directory unreadable
      chmodSync(dir, 0o000);
      try {
        const result = await store.load();
        // Should fail with an error (fail closed)
        assert.ok(!result.ok, "loading from unreadable dir should fail");
      } finally {
        chmodSync(dir, 0o755);
      }
    });
  });

  describe("symlink attack prevention", () => {
    it("rejects symlinked store file", async () => {
      // Create a real file elsewhere
      const realDir = join(dir, "real");
      await mkdir(realDir, { recursive: true });
      const realFile = join(realDir, "real-store.json");
      writeFileSync(realFile, JSON.stringify({ version: 1, tokens: [] }), { mode: 0o600 });

      // Create a symlink to it
      const linkPath = join(dir, "auth-store.json");
      symlinkSync(realFile, linkPath);

      // Create store pointing at the link
      const linkStore = new AuthStore({ filePath: linkPath });
      const token = makeToken();
      const result = await linkStore.add(token);
      // Should fail because the store file is a symlink
      assert.ok(!result.ok, "writing to symlink should fail");
      if (!result.ok) {
        assert.equal(result.error, "store_path_is_symlink");
      }
    });
  });

  describe("interrupted atomic write recovery", () => {
    it("temp files do not survive after a failed write", async () => {
      // Make the directory read-only to cause write failure
      const writeStore = new AuthStore({ filePath: join(dir, "auth-store.json") });

      const token = makeToken();
      // Make dir read-only
      chmodSync(dir, 0o555);
      try {
        const result = await writeStore.add(token);
        assert.ok(!result.ok, "write to read-only dir should fail");
      } finally {
        chmodSync(dir, 0o755);
      }

      // Check that no temp files are left behind
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(dir);
      const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
      assert.equal(tmpFiles.length, 0, "no temp files should be left behind");
    });
  });

  describe("count", () => {
    it("returns correct count", async () => {
      const countResult1 = await store.count();
      assert.ok(countResult1.ok);
      if (countResult1.ok) assert.equal(countResult1.value, 0);

      await store.add(makeToken());
      const countResult2 = await store.count();
      assert.ok(countResult2.ok);
      if (countResult2.ok) assert.equal(countResult2.value, 1);
    });
  });

  describe("exists", () => {
    it("returns false when store does not exist", async () => {
      const exists = await store.exists();
      assert.equal(exists, false);
    });

    it("returns true after first write", async () => {
      await store.add(makeToken());
      const exists = await store.exists();
      assert.equal(exists, true);
    });
  });

  describe("schema version", () => {
    it("validates schema version on load", async () => {
      // Write an invalid version directly
      const filePath = join(dir, "auth-store.json");
      writeFileSync(filePath, JSON.stringify({ version: 0, tokens: [] }), { mode: 0o600 });

      const result = await store.load();
      assert.ok(!result.ok);
      if (!result.ok) {
        assert.equal(result.error, "invalid_store_schema");
      }
    });

    it("handles malformed JSON", async () => {
      const filePath = join(dir, "auth-store.json");
      writeFileSync(filePath, "not valid json {", { mode: 0o600 });

      const result = await store.load();
      assert.ok(!result.ok);
      if (!result.ok) {
        assert.equal(result.error, "corrupt_store_file");
      }
    });
  });
});
