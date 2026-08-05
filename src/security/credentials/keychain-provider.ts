/**
 * KeychainProvider — OS-keychain `CredentialProvider` backend (issue #350,
 * Phase 2).
 *
 * Uses `@napi-rs/keyring` (a Node binding to the Rust `keyring-rs` crate)
 * to store credential values in the platform keychain:
 *   - macOS: Keychain
 *   - Windows: Credential Manager
 *   - Linux: libsecret (Secret Service)
 *
 * The value is the ONLY thing stored in the keychain; entry metadata
 * (id, createdAt, updatedAt, backend, migratedFrom, metadata) lives in a
 * small JSON metadata file next to the plain-file store. The keychain
 * Entry name is `"${provider}:${keyLabel}"` and the service is `"alix"`.
 *
 * Security posture: values are encrypted at rest by the OS keychain —
 * strictly stronger than `PlainFileProvider` (plain text on disk). This is
 * the preferred backend when the keychain is available.
 *
 * Failure behavior: if the keychain is unavailable (no Secret Service
 * daemon on Linux, headless container, etc.), construction or `load()`
 * throws a descriptive error. `createCredentialStore` catches this and
 * falls back to `PlainFileProvider` — the keychain must NEVER block config
 * load (impact-analysis constraint: a missing keychain daemon must not
 * break every command).
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { Entry } from "@napi-rs/keyring";
import { getUserStatePaths } from "../platform/user-state-paths.js";
import { lookupKey, type CredentialEntry, type StoreSchema } from "./credential-store.js";
import type { CredentialProvider } from "./credential-provider.js";
import type { CredentialBackend } from "./backend-selection.js";

/** The service identifier used for every keychain entry. */
export const KEYCHAIN_SERVICE = "alix";

/** The in-memory metadata store filename (never stores the value). */
const METADATA_FILENAME = "keychain-metadata.json";

/**
 * The shape the keychain binding exposes. Kept narrow so tests can inject
 * a fake without importing the real native module.
 */
export interface KeychainEntryLike {
  setPassword(password: string): void;
  getPassword(): string | null;
  deletePassword(): void;
}

/**
 * Lazy entry factory. `@napi-rs/keyring` is a native module; importing it
 * at module top-level would make a broken/missing binding crash every CLI
 * command. This resolves the binding on first use and throws a descriptive
 * error the caller can catch (→ fall back to plain-file).
 */
export async function resolveKeychainEntryFactory(): Promise<
  (name: string) => KeychainEntryLike
> {
  let mod: typeof import("@napi-rs/keyring");
  try {
    mod = await import("@napi-rs/keyring");
  } catch (err) {
    throw new Error(
      `OS keychain unavailable: could not load @napi-rs/keyring (${err instanceof Error ? err.message : String(err)}). ` +
        "ALiX will fall back to the plain-file credential store.",
    );
  }
  return (name: string) => new mod.Entry(KEYCHAIN_SERVICE, name);
}

/**
 * The magic entry name used for the availability probe.
 * @internal
 */
export const KEYCHAIN_PROBE_ENTRY = "__alix_probe__";

/**
 * Probe whether the keychain is usable through the given factory, using a
 * throwaway entry. The single place the SET+DELETE round-trip lives; both
 * `KeychainProvider.load()` and `backend-selection.probeKeychain()` route
 * through here.
 */
export function probeKeychainWith(factory: (name: string) => KeychainEntryLike): void {
  const probe = factory(KEYCHAIN_PROBE_ENTRY);
  probe.setPassword(KEYCHAIN_PROBE_ENTRY);
  probe.deletePassword();
}

export interface KeychainProviderOptions {
  /** Override the metadata file path (for testing). Defaults to the platform state dir. */
  metadataPath?: string;
  /**
   * Inject the keychain entry factory (for testing). When omitted, the
   * real `@napi-rs/keyring` binding is resolved lazily on `load()`.
   */
  entryFactory?: (name: string) => KeychainEntryLike;
}

/** Resolve the default metadata file path in the platform state dir. */
function defaultMetadataPath(): string {
  const paths = getUserStatePaths();
  return join(paths.dataDir, "credentials", METADATA_FILENAME);
}

/**
 * OS-keychain backend. Values go to the platform keychain; metadata stays
 * in a small JSON file.
 */
export class KeychainProvider implements CredentialProvider {
  readonly backend = "keychain";

  private readonly metadataPath: string;
  private readonly injectedFactory: ((name: string) => KeychainEntryLike) | undefined;
  private readonly nameToEntry: Map<string, KeychainEntryLike> = new Map();
  private resolvedFactory: ((name: string) => KeychainEntryLike) | undefined;
  private metadata: StoreSchema;
  private loaded = false;

  constructor(options: KeychainProviderOptions = {}) {
    this.metadataPath = options.metadataPath ?? defaultMetadataPath();
    this.injectedFactory = options.entryFactory;
    this.metadata = { version: 1, credentials: [] };
  }

  // -----------------------------------------------------------------------
  // CredentialProvider
  // -----------------------------------------------------------------------

  async load(): Promise<void> {
    if (this.loaded) return;

    // Resolve the keychain factory (real binding) unless one was injected.
    // This is the laziness boundary: a missing/broken native module is
    // caught here (async), never at module import time.
    if (!this.injectedFactory && !this.resolvedFactory) {
      this.resolvedFactory = await resolveKeychainEntryFactory();
    }

    // Confirm the keychain is usable before adopting this backend. Uses a
    // throwaway entry so a missing Secret Service / keychain daemon is
    // caught here, not on the first real credential.
    probeKeychainWith((name) => this.entry(name));

    this.metadata = await readMetadata(this.metadataPath);
    this.loaded = true;
  }

  get(provider: string, keyLabel: string): string | null {
    const entry = this.entry(lookupKey(provider, keyLabel));
    try {
      return entry.getPassword();
    } catch {
      return null;
    }
  }

  async set(
    provider: string,
    keyLabel: string,
    value: string,
    metadata?: Record<string, string>,
    migratedFrom?: CredentialBackend,
  ): Promise<CredentialEntry> {
    const name = lookupKey(provider, keyLabel);
    const existing = this.findEntry(provider, keyLabel);

    this.entry(name).setPassword(value);

    if (existing) {
      existing.entry.updatedAt = new Date().toISOString();
      if (metadata !== undefined) existing.entry.metadata = metadata;
      if (migratedFrom !== undefined) existing.entry.migratedFrom = migratedFrom;
      await this.persistMetadata();
      return { ...existing.entry };
    }

    const entry: CredentialEntry = {
      id: randomUUID(),
      provider,
      keyLabel,
      encrypted: true, // OS keychain encrypts at rest
      backend: "keychain",
      migratedFrom,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata,
    };
    this.metadata.credentials.push({ entry, value: "" }); // value never stored in metadata
    await this.persistMetadata();
    return { ...entry };
  }

  async delete(provider: string, keyLabel: string): Promise<boolean> {
    const entry = this.entry(lookupKey(provider, keyLabel));
    try {
      entry.deletePassword();
    } catch {
      return false; // not present in keychain
    }
    const key = lookupKey(provider, keyLabel);
    const idx = this.metadata.credentials.findIndex(
      (c) => lookupKey(c.entry.provider, c.entry.keyLabel) === key,
    );
    if (idx >= 0) this.metadata.credentials.splice(idx, 1);
    await this.persistMetadata();
    return true;
  }

  list(): CredentialEntry[] {
    return this.metadata.credentials.map((c) => ({ ...c.entry }));
  }

  serialize(): StoreSchema {
    return this.metadata;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private entry(name: string): KeychainEntryLike {
    const cached = this.nameToEntry.get(name);
    if (cached) return cached;
    const factory = this.injectedFactory ?? this.resolvedFactory;
    if (!factory) {
      throw new Error(
        "KeychainProvider has no entry factory. Call load() first (it resolves the real binding), or inject options.entryFactory for tests.",
      );
    }
    const created = factory(name);
    this.nameToEntry.set(name, created);
    return created;
  }

  private findEntry(provider: string, keyLabel: string) {
    const key = lookupKey(provider, keyLabel);
    return this.metadata.credentials.find((c) => lookupKey(c.entry.provider, c.entry.keyLabel) === key);
  }

  private async persistMetadata(): Promise<void> {
    await mkdir(dirname(this.metadataPath), { recursive: true, mode: 0o700 });
    await writeFile(this.metadataPath, JSON.stringify(this.metadata, null, 2) + "\n", { mode: 0o600 });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readMetadata(path: string): Promise<StoreSchema> {
  if (!existsSync(path)) return { version: 1, credentials: [] };
  const raw = await readFile(path, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Keychain metadata at ${path} is corrupt (invalid JSON). ` +
        "Remove the file to reset (the keychain itself still holds the values), or restore from backup.",
    );
  }
  if (!parsed || (parsed as StoreSchema).version !== 1 || !Array.isArray((parsed as StoreSchema).credentials)) {
    throw new Error(
      `Keychain metadata at ${path} has an unsupported schema. ` +
        "Remove the file to reset (the keychain itself still holds the values), or restore from backup.",
    );
  }
  return parsed as StoreSchema;
}
