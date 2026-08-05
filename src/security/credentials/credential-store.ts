/**
 * P4.3-Se1 — Credential Store
 *
 * Platform-level secure credential storage. Moves API keys and MCP
 * credentials out of project config files into a versioned, permission-
 * controlled file in the user's platform state directory.
 *
 * `CredentialStore` is the PUBLIC facade. Since issue #350 Phase 1, the
 * persistence logic lives behind a `CredentialProvider` interface
 * (`credential-provider.ts`); this class delegates to an injected provider
 * and exposes the same surface it always has. A future `KeychainProvider`
 * or `EncryptedFileProvider` implements the same interface, and selection
 * happens in one factory (`createCredentialStore` in cli/commands/security.ts).
 *
 * Properties (preserved from the original file-backed implementation):
 * - Atomic writes (temp file + rename)
 * - Restrictive permissions (0o600)
 * - Symlink attack prevention
 * - Bounded credential count (max 256)
 * - Fail closed (never return partial or fallback data)
 * - Values never exposed through list operations
 *
 * @module
 */

import { PlainFileProvider } from "./plain-file-provider.js";
import type { CredentialProvider } from "./credential-provider.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of credential entries in the store. */
export const MAX_CREDENTIAL_ENTRIES = 256;

// NOTE: STORE_VERSION and STORE_FILENAME are owned by the providers (see
// plain-file-provider.ts). The facade must not redefine them — that was a
// Phase-1 duplication the review flagged; the values live beside the
// provider that persists them.

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
  /**
   * Which storage backend holds this entry: "plain-file" | "keychain" |
   * "encrypted-file". Absent (undefined) on entries written before Phase 2
   * records it. Surfaced for diagnostics and migration tooling.
   */
  backend?: string;
  /**
   * The backend this entry was migrated from, when it was moved to the
   * current backend. Absent on freshly-written entries. Never the secret.
   */
  migratedFrom?: string;
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
  /**
   * Inject a custom persistence provider (issue #350). When omitted, the
   * default `PlainFileProvider` (file-backed, plain text at rest) is used —
   * the pre-Phase-1 behavior. The provider is what future keychain /
   * encrypted-file backends plug in behind.
   */
  provider?: CredentialProvider;
}

// ---------------------------------------------------------------------------
// CredentialStore
// ---------------------------------------------------------------------------

/**
 * Public facade over a `CredentialProvider`. The constructor keeps the
 * pre-Phase-1 surface (`{ filePath }`), so the 47 downstream callers —
 * including `loadConfig`, which every CLI command reaches — are untouched.
 */
export class CredentialStore {
  private readonly provider: CredentialProvider;

  constructor(options: CredentialStoreOptions = {}) {
    this.provider =
      options.provider ??
      new PlainFileProvider({ filePath: options.filePath });
  }

  // -----------------------------------------------------------------------
  // Load / Save
  // -----------------------------------------------------------------------

  /**
   * Load the credential store. Delegates to the provider. Must be called
   * before any read/write operation. Idempotent.
   */
  async load(): Promise<void> {
    await this.provider.load();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Retrieve a credential value by provider and keyLabel.
   * Returns `null` if the credential is not found.
   */
  get(provider: string, keyLabel: string): string | null {
    return this.provider.get(provider, keyLabel);
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
    return this.provider.set(provider, keyLabel, value, metadata);
  }

  /**
   * Delete a credential by provider and keyLabel.
   * Returns `true` if the credential was found and deleted, `false` otherwise.
   */
  async delete(provider: string, keyLabel: string): Promise<boolean> {
    return this.provider.delete(provider, keyLabel);
  }

  /**
   * List all stored credential entries (without values).
   * Safe to display in logs, doctor output, etc.
   */
  list(): CredentialEntry[] {
    return this.provider.list();
  }

  /**
   * Check whether a credential exists for the given provider + keyLabel.
   */
  has(provider: string, keyLabel: string): boolean {
    return this.provider.get(provider, keyLabel) !== null;
  }

  /**
   * Return the number of stored credentials.
   */
  get count(): number {
    return this.provider.list().length;
  }

  /**
   * Return the maximum allowed credentials (for capacity reporting).
   */
  get maxEntries(): number {
    return MAX_CREDENTIAL_ENTRIES;
  }

  /**
   * The storage backend identifier (e.g. "plain-file", "keychain",
   * "encrypted-file"). Surfaced for diagnostics and future migration tooling.
   */
  get backend(): string {
    return this.provider.backend;
  }
}
