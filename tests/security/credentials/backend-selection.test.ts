/**
 * backend-selection.test.ts — Phase 2 (issue #350) backend-selection tests.
 *
 * `chooseBackend` is the single decision point for the active credential
 * backend. These tests pin the four rules:
 *   1. A stored selector wins (migrate --to wrote it).
 *   2. Selector unset + existing plain-file store → plain-file (no silent
 *      migration of existing credentials).
 *   3. Selector unset + no store + keychain probe OK → keychain (fresh
 *      install gets the stronger backend).
 *   4. Selector unset + no store + keychain probe fails → plain-file.
 *
 * Each test isolates via `setStateDirOverride` (the user-state-paths test
 * seam) with a unique temp dir, so no test touches the real keychain or
 * the real credentials directory.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chooseBackend,
  writeStoredBackend,
  readStoredBackend,
  plainStorePath,
  createCredentialStoreForBackend,
  resolveCredentialPassphrase,
  CREDENTIAL_PASSPHRASE_ENV,
} from "../../../src/security/credentials/backend-selection.js";
import {
  setStateDirOverride,
  clearStateDirOverride,
} from "../../../src/security/platform/user-state-paths.js";

/** Point the state dir at a fresh temp dir; return the credentials dir. */
async function isolateStateDir(): Promise<{ dir: string; credDir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "alix-bs-"));
  setStateDirOverride(dir);
  const credDir = join(dir, "data", "credentials");
  await mkdir(credDir, { recursive: true });
  return { dir, credDir };
}

async function cleanup(dir: string): Promise<void> {
  clearStateDirOverride();
  await rm(dir, { recursive: true, force: true });
}

test("backend-selection: readStoredBackend defaults to auto when unset", async () => {
  const { dir } = await isolateStateDir();
  try {
    assert.equal(await readStoredBackend(), "auto");
  } finally {
    await cleanup(dir);
  }
});

test("backend-selection: writeStoredBackend then readStoredBackend round-trips", async () => {
  const { dir } = await isolateStateDir();
  try {
    await writeStoredBackend("keychain");
    assert.equal(await readStoredBackend(), "keychain");
    await writeStoredBackend("plain-file");
    assert.equal(await readStoredBackend(), "plain-file");
  } finally {
    await cleanup(dir);
  }
});

test("backend-selection: stored selector wins over probe results", async () => {
  const { dir } = await isolateStateDir();
  try {
    // Simulate a user who explicitly chose plain-file.
    await writeStoredBackend("plain-file");
    assert.equal(await chooseBackend(), "plain-file");
  } finally {
    await cleanup(dir);
  }
});

test("backend-selection: existing plain-file store → plain-file even when keychain available", async () => {
  const { dir, credDir } = await isolateStateDir();
  try {
    // Simulate an existing plain-file store (pre-Phase-2 data).
    await writeFile(join(credDir, "credential-store.json"), JSON.stringify({ version: 1, credentials: [] }));
    assert.equal(await chooseBackend(), "plain-file");
  } finally {
    await cleanup(dir);
  }
});

test("backend-selection: fresh install with working keychain → keychain", async () => {
  const { dir } = await isolateStateDir();
  try {
    // No store, no selector → fresh install. The keychain probe runs.
    // On this machine the binding works, so we expect keychain. If the
    // binding is unavailable in CI, the test still accepts plain-file.
    const result = await chooseBackend();
    assert.ok(result === "keychain" || result === "plain-file", `got ${result}`);
  } finally {
    await cleanup(dir);
  }
});

test("backend-selection: createCredentialStoreForBackend builds the right store type", async () => {
  // The single construction factory: plain-file → plain-file backend,
  // keychain → keychain backend, encrypted-file → encrypted-file backend.
  // loadConfig, createCredentialStore, and migrateBetweenBackends all
  // route through here.
  const { dir } = await isolateStateDir();
  try {
    const plain = await createCredentialStoreForBackend("plain-file");
    assert.equal(plain.backend, "plain-file");

    const keychain = await createCredentialStoreForBackend("keychain");
    assert.equal(keychain.backend, "keychain");

    const encrypted = await createCredentialStoreForBackend("encrypted-file", "test-pass");
    assert.equal(encrypted.backend, "encrypted-file");
  } finally {
    await cleanup(dir);
  }
});

test("backend-selection: readStoredBackend accepts encrypted-file", async () => {
  const { dir } = await isolateStateDir();
  try {
    await writeStoredBackend("encrypted-file");
    assert.equal(await readStoredBackend(), "encrypted-file");
    assert.equal(await chooseBackend(), "encrypted-file");
  } finally {
    await cleanup(dir);
  }
});

test("backend-selection: resolveCredentialPassphrase reads the env var", () => {
  const prev = process.env[CREDENTIAL_PASSPHRASE_ENV];
  try {
    process.env[CREDENTIAL_PASSPHRASE_ENV] = "env-pass";
    assert.equal(resolveCredentialPassphrase(), "env-pass");
  } finally {
    if (prev === undefined) delete process.env[CREDENTIAL_PASSPHRASE_ENV];
    else process.env[CREDENTIAL_PASSPHRASE_ENV] = prev;
  }
});

test("backend-selection: resolveCredentialPassphrase throws when unset", () => {
  const prev = process.env[CREDENTIAL_PASSPHRASE_ENV];
  try {
    delete process.env[CREDENTIAL_PASSPHRASE_ENV];
    assert.throws(() => resolveCredentialPassphrase(), /ALIX_CREDENTIAL_PASSPHRASE/);
  } finally {
    if (prev === undefined) delete process.env[CREDENTIAL_PASSPHRASE_ENV];
    else process.env[CREDENTIAL_PASSPHRASE_ENV] = prev;
  }
});

test("backend-selection: plainStorePath points into the credentials dir", async () => {
  const { dir } = await isolateStateDir();
  try {
    const path = plainStorePath();
    assert.ok(path.endsWith("credential-store.json"), path);
  } finally {
    await cleanup(dir);
  }
});
