/**
 * CredentialProvider — the storage-backend abstraction for the credential
 * store (issue #350, Phase 1).
 *
 * `CredentialStore` is the public facade that CLI commands and config load
 * talk to. It delegates persistence to a `CredentialProvider`, so a future
 * OS-keychain or encrypted-file backend can be added without touching the
 * 47 downstream symbols that construct `CredentialStore`.
 *
 * The interface mirrors the store's public surface: `load` (required before
 * any operation), `get`, `set`, `delete`, `list`. The current file-based
 * implementation is `PlainFileProvider`; a future `KeychainProvider` and
 * `EncryptedFileProvider` will implement the same interface (issue #350
 * Phase 2 / Phase 3).
 *
 * Design constraints from impact analysis (gitnexus, `CredentialStore`
 * upstream, CRITICAL risk, 47 symbols):
 * 1. This interface must NOT leak to callers — `CredentialStore` stays the
 *    only public entry point.
 * 2. Provider selection happens in one factory (`createCredentialStore`),
 *    never inline at call sites.
 * 3. Providers must be lazy — a slow keychain probe or missing keychain
 *    daemon must never block `loadConfig`, which every CLI command reaches.
 */

import type { CredentialEntry, StoredCredential, StoreSchema } from "./credential-store.js";

/**
 * Persistence backend for the credential store.
 *
 * All methods are async (providers may need to reach an external service —
 * keychain daemon, network, etc.). Callers must await `load()` before any
 * read/write operation; behavior before `load()` is provider-specific but
 * SHOULD throw a descriptive error (the store's contract today).
 */
export interface CredentialProvider {
  /** Load the store from backing storage. Idempotent; must precede get/set/delete. */
  load(): Promise<void>;

  /** Retrieve a credential value by provider + keyLabel, or `null` when absent. */
  get(provider: string, keyLabel: string): string | null;

  /** Store or update a credential. Returns the stored entry metadata. */
  set(
    provider: string,
    keyLabel: string,
    value: string,
    metadata?: Record<string, string>,
  ): Promise<CredentialEntry>;

  /** Delete a credential. Returns `true` when found and removed, `false` otherwise. */
  delete(provider: string, keyLabel: string): Promise<boolean>;

  /** List all credential entries WITHOUT their values. Safe to display. */
  list(): CredentialEntry[];

  /**
   * Serialize the current in-memory store to the on-disk schema. Only the
   * file-based providers need this; a keychain provider would return an
   * empty/null representation. Kept on the interface so `CredentialStore`
   * can remain backend-agnostic about its in-memory model.
   */
  serialize(): StoreSchema;

  /**
   * A stable identifier for the backend, e.g. "plain-file" | "keychain" |
   * "encrypted-file". Recorded in diagnostics and future migration tooling.
   */
  readonly backend: string;
}

/**
 * True when a provider's stored value is encrypted at rest. The file-based
 * store's `encrypted: false` on each entry reflects the deferred-encryption
 * state (credential-store.ts:55). A `KeychainProvider` or
 * `EncryptedFileProvider` returns `true`.
 */
export function isEncryptedBackend(backend: string): boolean {
  return backend !== "plain-file";
}
