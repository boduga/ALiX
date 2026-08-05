/**
 * PlainFileProvider — the file-based `CredentialProvider` backend.
 *
 * This is the extraction of the persistence logic that previously lived
 * inside `CredentialStore` (atomic write, restrictive permissions, symlink
 * rejection, schema validation, bounded count). Moving it behind the
 * `CredentialProvider` interface (issue #350, Phase 1) lets a future
 * `KeychainProvider` / `EncryptedFileProvider` implement the same surface
 * without touching `CredentialStore` or its 47 downstream callers.
 *
 * Selection: today this is the default provider constructed inside
 * `CredentialStore` when no provider is injected. In Phase 2, selection
 * moves to the `createCredentialStore` factory (keychain → encrypted →
 * this plain-file fallback).
 *
 * Security properties preserved from the original implementation:
 * - Atomic writes (temp file + rename)
 * - Restrictive permissions (0o600 file, 0o700 dir)
 * - Symlink attack prevention
 * - Bounded credential count (max 256)
 * - Fail closed (never return partial or fallback data)
 * - Values never exposed through list operations
 */

import { existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  unlink,
  lstat,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getUserStatePaths } from "../platform/user-state-paths.js";
import {
  MAX_CREDENTIAL_ENTRIES,
  type CredentialEntry,
  type StoreSchema,
} from "./credential-store.js";
import type { CredentialProvider } from "./credential-provider.js";

/** Default store file name within the credentials directory. */
const STORE_FILENAME = "credential-store.json";

/** Schema version for forward compatibility. */
const STORE_VERSION = 1;

export interface PlainFileProviderOptions {
  /** Override the store file path (for testing). Defaults to the platform state dir. */
  filePath?: string;
}

/** The shape of a persisted store — a single credential record. */
interface PersistedCredential {
  entry: CredentialEntry;
  /** The actual credential value. Never included in list operations. */
  value: string;
}

function now(): string {
  return new Date().toISOString();
}

function resolveStorePath(override?: string): string {
  if (override) return override;
  const paths = getUserStatePaths();
  return join(paths.dataDir, "credentials", STORE_FILENAME);
}

/**
 * Plain-text JSON file backend. Values are stored in plain text on disk —
 * this is the current security posture (encryption deferred, see
 * credential-store.ts:55). Do NOT reach for this provider when a keychain
 * is available; use it as the legacy/fallback backend (issue #350).
 */
export class PlainFileProvider implements CredentialProvider {
  readonly backend = "plain-file";

  private readonly filePath: string;
  private store: StoreSchema;
  private loaded = false;

  constructor(options: PlainFileProviderOptions = {}) {
    this.filePath = resolveStorePath(options.filePath);
    this.store = { version: STORE_VERSION, credentials: [] };
  }

  // -----------------------------------------------------------------------
  // CredentialProvider
  // -----------------------------------------------------------------------

  async load(): Promise<void> {
    if (this.loaded) return;

    const storeDir = join(this.filePath, "..");
    await mkdir(storeDir, { recursive: true, mode: 0o700 });

    if (!existsSync(this.filePath)) {
      this.store = { version: STORE_VERSION, credentials: [] };
      this.loaded = true;
      return;
    }

    await this.rejectSymlink(this.filePath);

    const raw = await readFile(this.filePath, "utf-8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        `Credential store at ${this.filePath} is corrupt (invalid JSON). ` +
          "Remove the file to reset, or restore from backup."
      );
    }

    if (!this.isValidSchema(parsed)) {
      throw new Error(
        `Credential store at ${this.filePath} has an unsupported schema version. ` +
          "Remove the file to reset, or restore from backup."
      );
    }

    this.store = parsed as StoreSchema;
    this.loaded = true;
  }

  get(provider: string, keyLabel: string): string | null {
    const key = this.lookupKey(provider, keyLabel);
    const found = this.store.credentials.find(
      (c) => this.lookupKey(c.entry.provider, c.entry.keyLabel) === key
    );
    return found ? found.value : null;
  }

  async set(
    provider: string,
    keyLabel: string,
    value: string,
    metadata?: Record<string, string>
  ): Promise<CredentialEntry> {
    if (!this.loaded) {
      throw new Error(
        "CredentialStore not loaded. Call load() before setting credentials."
      );
    }

    const key = this.lookupKey(provider, keyLabel);
    const existing = this.store.credentials.find(
      (c) => this.lookupKey(c.entry.provider, c.entry.keyLabel) === key
    );

    if (existing) {
      existing.value = value;
      existing.entry.updatedAt = now();
      if (metadata !== undefined) {
        existing.entry.metadata = metadata;
      }
      await this.persist();
      return { ...existing.entry };
    }

    if (this.store.credentials.length >= MAX_CREDENTIAL_ENTRIES) {
      throw new Error(
        `Credential store is full: ${MAX_CREDENTIAL_ENTRIES} entries maximum. ` +
          "Delete unused credentials before adding new ones."
      );
    }

    const entry: CredentialEntry = {
      id: randomUUID(),
      provider,
      keyLabel,
      encrypted: false,
      createdAt: now(),
      updatedAt: now(),
      metadata,
    };

    this.store.credentials.push({ entry, value });
    await this.persist();
    return { ...entry };
  }

  async delete(provider: string, keyLabel: string): Promise<boolean> {
    if (!this.loaded) {
      throw new Error(
        "CredentialStore not loaded. Call load() before deleting credentials."
      );
    }

    const key = this.lookupKey(provider, keyLabel);
    const idx = this.store.credentials.findIndex(
      (c) => this.lookupKey(c.entry.provider, c.entry.keyLabel) === key
    );

    if (idx === -1) return false;

    this.store.credentials.splice(idx, 1);
    await this.persist();
    return true;
  }

  list(): CredentialEntry[] {
    return this.store.credentials.map((c) => ({ ...c.entry }));
  }

  serialize(): StoreSchema {
    return this.store;
  }

  // -----------------------------------------------------------------------
  // Persistence
  // -----------------------------------------------------------------------

  private async persist(): Promise<void> {
    const storeDir = join(this.filePath, "..");
    await mkdir(storeDir, { recursive: true, mode: 0o700 });

    const tmpPath = this.filePath + "." + randomUUID() + ".tmp";

    try {
      const json = JSON.stringify(this.store, null, 2) + "\n";
      await writeFile(tmpPath, json, { mode: 0o600, flag: "wx" });
      await this.rejectSymlink(tmpPath);
      await rename(tmpPath, this.filePath);
    } catch (err) {
      try {
        if (existsSync(tmpPath)) await unlink(tmpPath);
      } catch {
        // Ignore cleanup failures
      }
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // Symlink protection
  // -----------------------------------------------------------------------

  private async rejectSymlink(filePath: string): Promise<void> {
    let stat;
    try {
      stat = await lstat(filePath);
    } catch {
      return; // File doesn't exist yet — safe
    }
    if (stat.isSymbolicLink()) {
      throw new Error(
        `Credential store path ${filePath} is a symbolic link. ` +
          "Refusing to operate for security reasons."
      );
    }
  }

  // -----------------------------------------------------------------------
  // Schema validation
  // -----------------------------------------------------------------------

  private isValidSchema(data: unknown): data is StoreSchema {
    if (data === null || typeof data !== "object") return false;
    const d = data as Record<string, unknown>;
    if (d.version !== STORE_VERSION) return false;
    if (!Array.isArray(d.credentials)) return false;
    for (const cred of d.credentials) {
      if (!this.isValidStoredCredential(cred)) return false;
    }
    return true;
  }

  private isValidStoredCredential(data: unknown): data is PersistedCredential {
    if (data === null || typeof data !== "object") return false;
    const c = data as Record<string, unknown>;
    if (c.entry === null || typeof c.entry !== "object") return false;
    if (typeof c.value !== "string") return false;
    const e = c.entry as Record<string, unknown>;
    if (typeof e.id !== "string") return false;
    if (typeof e.provider !== "string") return false;
    if (typeof e.keyLabel !== "string") return false;
    return true;
  }

  // -----------------------------------------------------------------------
  // Lookup key
  // -----------------------------------------------------------------------

  private lookupKey(provider: string, keyLabel: string): string {
    return `${provider.toLowerCase()}:${keyLabel.toLowerCase()}`;
  }
}
