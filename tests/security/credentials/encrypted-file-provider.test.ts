/**
 * encrypted-file-provider.test.ts — Phase 3 (issue #350) EncryptedFileProvider tests.
 *
 * The provider encrypts the WHOLE store (values + metadata) at rest with
 * AES-256-GCM, key derived from a passphrase via Argon2id. These tests pin:
 *   1. Round-trip set/get/delete through a real on-disk file.
 *   2. The file on disk contains NO plaintext values (only ciphertext).
 *   3. A wrong passphrase fails to unlock (argon2 verify + GCM tag).
 *   4. Data persists across provider instances (same file, same passphrase).
 *   5. `encrypted: true` + `backend: "encrypted-file"` on entries.
 *   6. Empty passphrase at construction throws.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EncryptedFileProvider } from "../../../src/security/credentials/encrypted-file-provider.js";

const PASSPHRASE = "test-passphrase-for-encrypted-store";

function makeProvider(dir: string, passphrase: string, file = "encrypted-store.json") {
  return new EncryptedFileProvider({
    filePath: join(dir, file),
    passphrase,
  });
}

test("EncryptedFileProvider: round-trip set/get/delete", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-enc-"));
  const provider = makeProvider(dir, PASSPHRASE);
  try {
    await provider.load();
    await provider.set("openrouter", "apiKey", "sk-secret-123");
    assert.equal(provider.get("openrouter", "apiKey"), "sk-secret-123");
    assert.equal(provider.list().length, 1);

    const deleted = await provider.delete("openrouter", "apiKey");
    assert.equal(deleted, true);
    assert.equal(provider.get("openrouter", "apiKey"), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("EncryptedFileProvider: the on-disk file contains no plaintext values", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-enc-"));
  const provider = makeProvider(dir, PASSPHRASE);
  const filePath = join(dir, "encrypted-store.json");
  try {
    await provider.load();
    await provider.set("openrouter", "apiKey", "sk-super-secret-value-42");
    // Force a persist (set already persists).
    const raw = await readFile(filePath, "utf-8");
    assert.ok(!raw.includes("sk-super-secret-value-42"), "plaintext value must not appear on disk");
    assert.ok(!raw.includes("openrouter"), "metadata must not appear in plaintext either");
    assert.ok(raw.includes("ciphertext"), "file is an encrypted envelope");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("EncryptedFileProvider: wrong passphrase fails to unlock", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-enc-"));
  const provider = makeProvider(dir, PASSPHRASE);
  try {
    await provider.load();
    await provider.set("openrouter", "apiKey", "sk-secret");

    const wrong = makeProvider(dir, "wrong-passphrase");
    await assert.rejects(wrong.load(), /Incorrect passphrase|Failed to decrypt/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("EncryptedFileProvider: data persists across instances (same file, same passphrase)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-enc-"));
  try {
    const p1 = makeProvider(dir, PASSPHRASE);
    await p1.load();
    await p1.set("openai", "apiKey", "sk-openai");
    await p1.set("anthropic", "apiKey", "sk-anthropic");

    const p2 = makeProvider(dir, PASSPHRASE);
    await p2.load();
    assert.equal(p2.get("openai", "apiKey"), "sk-openai");
    assert.equal(p2.get("anthropic", "apiKey"), "sk-anthropic");
    assert.equal(p2.list().length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("EncryptedFileProvider: entries are flagged encrypted + encrypted-file backend", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-enc-"));
  const provider = makeProvider(dir, PASSPHRASE);
  try {
    await provider.load();
    const entry = await provider.set("deepseek", "apiKey", "sk-ds", { source: "test" }, "plain-file");
    assert.equal(entry.encrypted, true);
    assert.equal(entry.backend, "encrypted-file");
    assert.equal(entry.migratedFrom, "plain-file");
    assert.equal(entry.metadata?.source, "test");
    assert.equal(provider.backend, "encrypted-file");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("EncryptedFileProvider: empty passphrase at construction throws", () => {
  assert.throws(
    () => new EncryptedFileProvider({ passphrase: "" }),
    /requires a passphrase/,
  );
});

test("EncryptedFileProvider: a fresh file loads empty and persists on first write", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-enc-"));
  const provider = makeProvider(dir, PASSPHRASE);
  const filePath = join(dir, "encrypted-store.json");
  try {
    await provider.load();
    assert.equal(provider.list().length, 0);
    // No file yet until first persist.
    // After a set, the file appears and is encrypted.
    await provider.set("mcp", "header", "Bearer abc");
    const raw = await readFile(filePath, "utf-8");
    assert.ok(!raw.includes("Bearer abc"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
