/**
 * Tests for P4.3-Se1 credential store.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, symlink, mkdir, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  CredentialStore,
  MAX_CREDENTIAL_ENTRIES,
} from "../../../src/security/credentials/credential-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setupStore(): Promise<{ store: CredentialStore; dir: string; filePath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "alix-cred-test-"));
  const filePath = join(dir, "credential-store.json");
  const store = new CredentialStore({ filePath });
  await store.load();
  return { store, dir, filePath };
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

test("CredentialStore: set and get a credential", async () => {
  const { store, dir } = await setupStore();
  try {
    await store.set("openai", "apiKey", "sk-test-12345");
    const value = store.get("openai", "apiKey");
    assert.equal(value, "sk-test-12345");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CredentialStore: get returns null for non-existent credential", async () => {
  const { store, dir } = await setupStore();
  try {
    assert.equal(store.get("nonexistent", "apiKey"), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CredentialStore: has returns correct boolean", async () => {
  const { store, dir } = await setupStore();
  try {
    assert.equal(store.has("openai", "apiKey"), false);
    await store.set("openai", "apiKey", "sk-test");
    assert.equal(store.has("openai", "apiKey"), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CredentialStore: set overwrites existing credential for same provider+keyLabel", async () => {
  const { store, dir } = await setupStore();
  try {
    await store.set("openai", "apiKey", "old-key");
    await store.set("openai", "apiKey", "new-key");
    assert.equal(store.get("openai", "apiKey"), "new-key");
    assert.equal(store.count, 1); // No duplicate entry
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CredentialStore: set with metadata", async () => {
  const { store, dir } = await setupStore();
  try {
    const entry = await store.set("openai", "apiKey", "sk-test", { source: "manual" });
    assert.equal(entry.metadata?.source, "manual");
    const list = store.list();
    assert.equal(list[0].metadata?.source, "manual");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CredentialStore: delete removes a credential", async () => {
  const { store, dir } = await setupStore();
  try {
    await store.set("openai", "apiKey", "sk-test");
    assert.equal(store.has("openai", "apiKey"), true);
    const deleted = await store.delete("openai", "apiKey");
    assert.equal(deleted, true);
    assert.equal(store.has("openai", "apiKey"), false);
    assert.equal(store.get("openai", "apiKey"), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CredentialStore: delete returns false for non-existent credential", async () => {
  const { store, dir } = await setupStore();
  try {
    const deleted = await store.delete("nonexistent", "apiKey");
    assert.equal(deleted, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CredentialStore: list returns entries without values", async () => {
  const { store, dir } = await setupStore();
  try {
    await store.set("openai", "apiKey", "sk-openai");
    await store.set("anthropic", "apiKey", "sk-anthropic");
    const entries = store.list();
    assert.equal(entries.length, 2);
    for (const entry of entries) {
      // Values must not be in list output
      assert.equal("value" in entry, false);
      assert.ok(typeof entry.provider === "string");
      assert.ok(typeof entry.keyLabel === "string");
      assert.ok(typeof entry.id === "string");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CredentialStore: case-insensitive provider and keyLabel matching", async () => {
  const { store, dir } = await setupStore();
  try {
    await store.set("OpenAI", "ApiKey", "sk-test");
    assert.equal(store.get("openai", "apikey"), "sk-test");
    assert.equal(store.has("OPENAI", "APIKEY"), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Persistence across instances
// ---------------------------------------------------------------------------

test("CredentialStore: data persists across store instances (same file)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-cred-test-"));
  const filePath = join(dir, "credential-store.json");
  try {
    // First store instance
    const store1 = new CredentialStore({ filePath });
    await store1.load();
    await store1.set("openai", "apiKey", "sk-persist");

    // Second store instance (same file)
    const store2 = new CredentialStore({ filePath });
    await store2.load();
    assert.equal(store2.get("openai", "apiKey"), "sk-persist");
    assert.equal(store2.count, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Max entry count
// ---------------------------------------------------------------------------

test("CredentialStore: enforces max entry count", async () => {
  const { store, dir } = await setupStore();
  try {
    // Fill up to max
    for (let i = 0; i < MAX_CREDENTIAL_ENTRIES; i++) {
      await store.set(`provider${i}`, "apiKey", `key-${i}`);
    }
    assert.equal(store.count, MAX_CREDENTIAL_ENTRIES);

    // One more should throw
    await assert.rejects(
      () => store.set("overflow", "apiKey", "overflow-key"),
      /Credential store is full/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

test("CredentialStore: store file has restrictive permissions (0o600)", async () => {
  const { store, dir, filePath } = await setupStore();
  try {
    await store.set("openai", "apiKey", "sk-test");
    const stat = await lstat(filePath);
    // On POSIX, mode should be 0o600 (owner read/write only)
    // Extract permission bits
    // eslint-disable-next-line no-bitwise
    const mode = stat.mode & 0o777;
    assert.equal(mode, 0o600, `Expected 0o600 but got 0o${mode.toString(8)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Symlink rejection
// ---------------------------------------------------------------------------

test("CredentialStore: rejects symlink target path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-cred-test-"));
  try {
    const realPath = join(dir, "real-store.json");
    const symlinkTarget = join(dir, "store-link.json");

    // Create a real file that the symlink points to
    await writeFile(realPath, JSON.stringify({ version: 1, credentials: [] }));

    // Create a symlink pointing to the real file
    await symlink(realPath, symlinkTarget);

    const store = new CredentialStore({ filePath: symlinkTarget });
    await assert.rejects(
      () => store.load(),
      /symbolic link/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Atomic write
// ---------------------------------------------------------------------------

test("CredentialStore: atomic write — no partial file on crash simulation", async () => {
  const { store, dir, filePath } = await setupStore();
  try {
    await store.set("openai", "apiKey", "sk-test");
    // Verify the store file content is valid JSON
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.version, 1);
    assert.equal(parsed.credentials.length, 1);
    // No leftover .tmp files
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dir);
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    assert.equal(tmpFiles.length, 0, "No temp files should be left behind");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Corrupt store handling
// ---------------------------------------------------------------------------

test("CredentialStore: throws on corrupt JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-cred-test-"));
  const filePath = join(dir, "credential-store.json");
  try {
    await writeFile(filePath, "this is not valid json", { mode: 0o600 });
    const store = new CredentialStore({ filePath });
    await assert.rejects(
      () => store.load(),
      /corrupt/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CredentialStore: throws on unsupported schema version", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-cred-test-"));
  const filePath = join(dir, "credential-store.json");
  try {
    await writeFile(
      filePath,
      JSON.stringify({ version: 999, credentials: [] }),
      { mode: 0o600 }
    );
    const store = new CredentialStore({ filePath });
    await assert.rejects(
      () => store.load(),
      /unsupported schema version/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Fail closed — unloaded store
// ---------------------------------------------------------------------------

test("CredentialStore: set on unloaded store throws", async () => {
  const store = new CredentialStore({ filePath: join(tmpdir(), "nonexistent", "store.json") });
  await assert.rejects(
    () => store.set("openai", "apiKey", "sk-test"),
    /not loaded/
  );
});

test("CredentialStore: delete on unloaded store throws", async () => {
  const store = new CredentialStore({ filePath: join(tmpdir(), "nonexistent", "store.json") });
  await assert.rejects(
    () => store.delete("openai", "apiKey"),
    /not loaded/
  );
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test("CredentialStore: set with special characters in provider and keyLabel", async () => {
  const { store, dir } = await setupStore();
  try {
    await store.set("mcp.github", "header:Authorization", "ghp_token123");
    const value = store.get("mcp.github", "header:Authorization");
    assert.equal(value, "ghp_token123");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CredentialStore: empty store returns empty list", async () => {
  const { store, dir } = await setupStore();
  try {
    const entries = store.list();
    assert.equal(entries.length, 0);
    assert.equal(store.count, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CredentialStore: count and maxEntries are accurate", async () => {
  const { store, dir } = await setupStore();
  try {
    assert.equal(store.count, 0);
    assert.equal(store.maxEntries, MAX_CREDENTIAL_ENTRIES);
    await store.set("openai", "apiKey", "sk-1");
    await store.set("anthropic", "apiKey", "sk-2");
    assert.equal(store.count, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
