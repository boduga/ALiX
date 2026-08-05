/**
 * keychain-provider.test.ts — Phase 2 (issue #350) KeychainProvider tests.
 *
 * The KeychainProvider is tested with an injected in-memory fake entry
 * factory, so no real OS keychain / Secret Service daemon is touched. The
 * real binding probe was verified manually (SET+GET+DELETE OK on this
 * machine). These tests pin:
 *   1. delegation — set/get/delete route to the keychain entry factory
 *   2. metadata hygiene — values never appear in the metadata store
 *   3. the `encrypted: true` + `backend: "keychain"` flags on entries
 *   4. load() probes the keychain (throws on a failing factory)
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  KeychainProvider,
  KEYCHAIN_SERVICE,
  type KeychainEntryLike,
} from "../../../src/security/credentials/keychain-provider.js";

/** In-memory fake of the @napi-rs/keyring Entry. */
class FakeEntry implements KeychainEntryLike {
  private password: string | null = null;
  deleted = false;
  constructor(private readonly name: string) {}
  setPassword(p: string): void {
    this.password = p;
  }
  getPassword(): string | null {
    return this.deleted ? null : this.password;
  }
  deletePassword(): void {
    this.deleted = true;
  }
}

/** A fake factory that records every entry it creates. */
function fakeFactory(registry: Map<string, FakeEntry>) {
  return (name: string): KeychainEntryLike => {
    const e = new FakeEntry(name);
    registry.set(name, e);
    return e;
  };
}

function makeProvider(opts: { metadataPath: string; registry: Map<string, FakeEntry> }) {
  return new KeychainProvider({
    metadataPath: opts.metadataPath,
    entryFactory: fakeFactory(opts.registry),
  });
}

test("KeychainProvider: set/get/delete delegate to the keychain entry factory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-kc-test-"));
  const registry = new Map<string, FakeEntry>();
  const provider = makeProvider({ metadataPath: join(dir, "metadata.json"), registry });

  await provider.load();
  await provider.set("openrouter", "apiKey", "sk-test-123");

  // The keychain entry was written. nameOf() lowercases provider+keyLabel.
  const entry = registry.get("openrouter:apikey");
  assert.ok(entry, "keychain entry created");
  assert.equal(entry.getPassword(), "sk-test-123");

  // Read through the provider.
  assert.equal(provider.get("openrouter", "apiKey"), "sk-test-123");
  assert.equal(provider.list().length, 1);

  // Delete clears the keychain entry.
  const deleted = await provider.delete("openrouter", "apiKey");
  assert.equal(deleted, true);
  assert.equal(provider.get("openrouter", "apiKey"), null);
  assert.equal(provider.list().length, 0);

  await rm(dir, { recursive: true, force: true });
});

test("KeychainProvider: metadata store never contains the value; entries flagged encrypted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-kc-meta-"));
  const registry = new Map<string, FakeEntry>();
  const metadataPath = join(dir, "metadata.json");
  const provider = makeProvider({ metadataPath, registry });

  await provider.load();
  const entry = await provider.set("openai", "apiKey", "sk-secret-abc", { source: "test" });

  // The in-memory metadata + on-disk metadata file must not contain the value.
  const raw = await readFile(metadataPath, "utf-8");
  assert.ok(!raw.includes("sk-secret-abc"), "metadata file must not contain the secret");
  assert.ok(raw.includes("openai"), "metadata file lists the provider");
  assert.equal(provider.serialize().credentials[0].value, "", "in-memory value slot is empty");

  // Flags: OS keychain encrypts at rest.
  assert.equal(entry.encrypted, true);
  assert.equal(entry.backend, "keychain");
  assert.equal(entry.metadata?.source, "test");

  await rm(dir, { recursive: true, force: true });
});

test("KeychainProvider: set records migratedFrom as a top-level entry field", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-kc-mig-"));
  const registry = new Map<string, FakeEntry>();
  const provider = makeProvider({ metadataPath: join(dir, "metadata.json"), registry });

  await provider.load();
  const entry = await provider.set("openai", "apiKey", "sk-test", { source: "manual" }, "plain-file");

  // migratedFrom is lifted to the top-level CredentialEntry field (issue
  // #350 metadata spec), NOT buried in metadata.
  assert.equal(entry.migratedFrom, "plain-file");
  assert.equal(entry.backend, "keychain");
  assert.equal(entry.metadata?.source, "manual");
  const listed = provider.list()[0];
  assert.equal(listed.migratedFrom, "plain-file");

  await rm(dir, { recursive: true, force: true });
});

test("KeychainProvider: get returns null when the keychain entry is absent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-kc-null-"));
  const registry = new Map<string, FakeEntry>();
  const provider = makeProvider({ metadataPath: join(dir, "metadata.json"), registry });

  await provider.load();
  assert.equal(provider.get("nonexistent", "apiKey"), null);

  await rm(dir, { recursive: true, force: true });
});

test("KeychainProvider: load() probes the keychain and throws when the factory fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-kc-probe-"));
  const failing = new KeychainProvider({
    metadataPath: join(dir, "metadata.json"),
    entryFactory: () => {
      throw new Error("keychain daemon not running");
    },
  });

  await assert.rejects(failing.load(), /keychain daemon not running/);
  await rm(dir, { recursive: true, force: true });
});

test("KeychainProvider: KEYCHAIN_SERVICE is 'alix'", () => {
  assert.equal(KEYCHAIN_SERVICE, "alix");
});
