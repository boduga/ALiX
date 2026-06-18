/**
 * P4.3-Se1 — Credential Store
 *
 * Platform-level secure credential storage. Moves API keys and MCP
 * credentials out of project config files into a versioned, permission-
 * controlled file in the user's platform state directory.
 *
 * Properties:
 * - Atomic writes (temp file + rename)
 * - Restrictive permissions (0o600)
 * - Symlink attack prevention
 * - Bounded credential count (max 256)
 * - Fail closed (never return partial or fallback data)
 * - Values never exposed through list operations
 *
 * @module
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of credential entries in the store. */
export const MAX_CREDENTIAL_ENTRIES = 256;

/** Schema version for forward compatibility. */
const STORE_VERSION = 1;

/** Default store file name within the credentials directory. */
const STORE_FILENAME = "credential-store.json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CredentialEntry {
  id: string;
  /** Provider namespace (e.g. "openai", "anthropic", "mcp"). */
  provider: string;
  /** Label within the provider (e.g. "apiKey", "header:Authorization"). */
  keyLabel: string;
  /** Whether the value is encrypted at rest (currently always false; encryption deferred). */
  encrypted: boolean;
  createdAt: string;
  updatedAt: string;
  /** Optional arbitrary metadata attached to this credential. */
  metadata?: Record<string, string>;
}

export interface StoredCredential {
  entry: CredentialEntry;
  /** The actual credential value. Never included in list operations. */
  value: string;
}

export interface StoreSchema {
  version: number;
  credentials: StoredCredential[];
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CredentialStoreOptions {
  /**
   * Override the store file path (for testing).
   * When not provided, the platform state directory is used.
   */
  filePath?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function resolveStorePath(override?: string): string {
  if (override) return override;
  const paths = getUserStatePaths();
  return join(paths.dataDir, "credentials", STORE_FILENAME);
}

// ---------------------------------------------------------------------------
// CredentialStore
// ---------------------------------------------------------------------------

export class CredentialStore {
  private readonly filePath: string;
  private store: StoreSchema;
  private loaded = false;

  constructor(options: CredentialStoreOptions = {}) {
    this.filePath = resolveStorePath(options.filePath);
    this.store = { version: STORE_VERSION, credentials: [] };
  }

  // -----------------------------------------------------------------------
  // Load / Save
  // -----------------------------------------------------------------------

  /**
   * Load the credential store from disk. Must be called before any read/write
   * operations. Idempotent — subsequent calls are no-ops.
   *
   * If the store file does not exist, an empty store is initialized.
   */
  async load(): Promise<void> {
    if (this.loaded) return;

    const storeDir = join(this.filePath, "..");
    await mkdir(storeDir, { recursive: true, mode: 0o700 });

    if (!existsSync(this.filePath)) {
      this.store = { version: STORE_VERSION, credentials: [] };
      this.loaded = true;
      return;
    }

    // Symlink attack prevention: reject if the path is a symlink
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

  // -----------------------------------------------------------------------
  // Persistence
  // -----------------------------------------------------------------------

  /**
   * Atomically persist the store to disk using a temp-file + rename strategy.
   *
   * The temp file is written to the same directory as the target to ensure
   * the rename is on the same filesystem (atomic on POSIX).
   */
  private async persist(): Promise<void> {
    const storeDir = join(this.filePath, "..");
    await mkdir(storeDir, { recursive: true, mode: 0o700 });

    const tmpPath = this.filePath + "." + randomUUID() + ".tmp";

    try {
      const json = JSON.stringify(this.store, null, 2) + "\n";
      await writeFile(tmpPath, json, { mode: 0o600, flag: "wx" });

      // Re-verify the temp file is not a symlink before renaming
      await this.rejectSymlink(tmpPath);

      await rename(tmpPath, this.filePath);
    } catch (err) {
      // Best-effort cleanup of temp file
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

  /**
   * Reject a path if it is a symlink, to prevent symlink attacks that could
   * write credentials to attacker-controlled locations.
   */
  private async rejectSymlink(filePath: string): Promise<void> {
    let stat;
    try {
      stat = await lstat(filePath);
    } catch {
      // File doesn't exist yet — safe
      return;
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

  private isValidStoredCredential(data: unknown): data is StoredCredential {
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

  /**
   * Composite key for lookup. Both provider and keyLabel are normalized to
   * lowercase for case-insensitive matching.
   */
  private lookupKey(provider: string, keyLabel: string): string {
    return `${provider.toLowerCase()}:${keyLabel.toLowerCase()}`;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Retrieve a credential value by provider and keyLabel.
   * Returns `null` if the credential is not found.
   */
  get(provider: string, keyLabel: string): string | null {
    const key = this.lookupKey(provider, keyLabel);
    const found = this.store.credentials.find(
      (c) =>
        this.lookupKey(c.entry.provider, c.entry.keyLabel) === key
    );
    return found ? found.value : null;
  }

  /**
   * Store or update a credential. The provider + keyLabel pair is unique.
   * If one already exists, its value is updated.
   *
   * Throws if the store is at capacity (see {@link MAX_CREDENTIAL_ENTRIES}).
   */
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
      (c) =>
        this.lookupKey(c.entry.provider, c.entry.keyLabel) === key
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

    // Enforce max entries
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

  /**
   * Delete a credential by provider and keyLabel.
   * Returns `true` if the credential was found and deleted, `false` otherwise.
   */
  async delete(provider: string, keyLabel: string): Promise<boolean> {
    if (!this.loaded) {
      throw new Error(
        "CredentialStore not loaded. Call load() before deleting credentials."
      );
    }

    const key = this.lookupKey(provider, keyLabel);
    const idx = this.store.credentials.findIndex(
      (c) =>
        this.lookupKey(c.entry.provider, c.entry.keyLabel) === key
    );

    if (idx === -1) return false;

    this.store.credentials.splice(idx, 1);
    await this.persist();
    return true;
  }

  /**
   * List all stored credential entries (without values).
   * Safe to display in logs, doctor output, etc.
   */
  list(): CredentialEntry[] {
    return this.store.credentials.map((c) => ({ ...c.entry }));
  }

  /**
   * Check whether a credential exists for the given provider + keyLabel.
   */
  has(provider: string, keyLabel: string): boolean {
    const key = this.lookupKey(provider, keyLabel);
    return this.store.credentials.some(
      (c) =>
        this.lookupKey(c.entry.provider, c.entry.keyLabel) === key
    );
  }

  /**
   * Return the number of stored credentials.
   */
  get count(): number {
    return this.store.credentials.length;
  }

  /**
   * Return the maximum allowed credentials (for capacity reporting).
   */
  get maxEntries(): number {
    return MAX_CREDENTIAL_ENTRIES;
  }
}
