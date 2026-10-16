/**
 * P4.3-Sb2 — Auth Store
 *
 * Hash-only token storage. Persists token metadata (hash, name, role,
 * expiry, revocation) to a JSON file in the platform state directory.
 * Uses atomic writes (temp file + rename) and validates symlink safety
 * before every write.
 *
 * Key invariants:
 * - Raw tokens are NEVER persisted — only SHA-256 hashes.
 * - Token hashes are NEVER displayed in output.
 * - Token count is bounded (default: 32).
 * - Atomic write with temp-file + rename on same filesystem.
 * - Symlink checks before every write.
 *
 * @module
 */

import { randomUUID } from "node:crypto";
import { writeFileSync, renameSync, unlinkSync, lstatSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { StoreLocks, withStoreLocksResult } from "./store-lock.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Schema version for the store file format. */
export const AUTH_STORE_SCHEMA_VERSION = 1;

/** Maximum number of tokens allowed in the store. */
export const MAX_TOKEN_COUNT = 32;

/**
 * Revocation record for a token.
 */
export interface TokenRevocation {
  /** ISO 8601 timestamp when revoked. */
  revokedAt: string;
  /** Reason for revocation (stable code). */
  reason: string;
}

/**
 * A stored token record (never contains the raw token).
 */
export interface StoredToken {
  /** Unique token identifier (12 base64url chars). */
  id: string;
  /** SHA-256 hash of the full token string. */
  hash: string;
  /** Human-readable name for the token (e.g., "CI pipeline"). */
  name: string;
  /** Role assigned to this token. */
  role: string;
  /** Optional workspace IDs this token is scoped to. */
  workspaceIds?: string[];
  /**
   * Operator principal this credential is bound to (G3-A′). Absent = a
   * genuinely unbound legacy credential: valid for ordinary Inspector access but
   * invalid for any principal-required capability. This is the SINGLE authority
   * for the credential→principal binding. Preserved across revocation for
   * historical attribution.
   */
  principalId?: string;
  /** ISO 8601 timestamp when the token was created. */
  createdAt: string;
  /** ISO 8601 timestamp when the token expires (optional). */
  expiresAt?: string;
  /** ID of the token this one was rotated from (optional). */
  rotatedFrom?: string;
  /** Revocation record if this token has been revoked. */
  revocation?: TokenRevocation;
  /** Monotonic revision for compare-and-set writes (G3-A′). */
  revision?: number;
  /** Schema version at the time this record was created. */
  schemaVersion: number;
}

/**
 * On-disk format of the auth store file.
 */
export interface AuthStoreData {
  /** Schema version for the file. */
  version: number;
  /** Array of stored token records. */
  tokens: StoredToken[];
}

// ---------------------------------------------------------------------------
// Store options
// ---------------------------------------------------------------------------

export interface AuthStoreOptions {
  /** Path to the auth store JSON file. */
  filePath: string;
  /** Maximum number of tokens (default: 32). */
  maxTokens?: number;
}

// ---------------------------------------------------------------------------
// Result types (discriminated unions)
// ---------------------------------------------------------------------------

export type StoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// AuthStore
// ---------------------------------------------------------------------------

export class AuthStore {
  private readonly filePath: string;
  private readonly maxTokens: number;

  constructor(opts: AuthStoreOptions) {
    this.filePath = opts.filePath;
    this.maxTokens = opts.maxTokens ?? MAX_TOKEN_COUNT;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Load all tokens from the store.
   *
   * Returns an empty list if the file does not exist yet.
   */
  async load(): Promise<StoreResult<StoredToken[]>> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf-8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        // File doesn't exist yet — return empty list
        return { ok: true, value: [] };
      }
      // Permission error, etc. — fail closed
      return { ok: false, error: "store_read_failed" };
    }

    try {
      const data = JSON.parse(raw) as AuthStoreData;

      // Validate schema version
      if (typeof data.version !== "number" || data.version < 1) {
        return { ok: false, error: "invalid_store_schema" };
      }

      if (!Array.isArray(data.tokens)) {
        return { ok: false, error: "invalid_store_format" };
      }

      return { ok: true, value: data.tokens.map(normalizeToken) };
    } catch (err) {
      if (err instanceof SyntaxError) {
        return { ok: false, error: "corrupt_store_file" };
      }
      return { ok: false, error: "store_read_failed" };
    }
  }

  /**
   * Look up a single token by its ID.
   */
  async get(id: string): Promise<StoreResult<StoredToken | null>> {
    const result = await this.load();
    if (!result.ok) return result;

    const token = result.value.find((t) => t.id === id) ?? null;
    return { ok: true, value: token };
  }

  /**
   * Add a new token to the store.
   *
   * Fails if the token count is at the maximum bound. Serialized under the
   * token store's cross-process lock; `addUnder` is for callers already holding
   * it (enrollment/migration).
   */
  async add(token: StoredToken): Promise<StoreResult<void>> {
    return withStoreLocksResult(this.getStoreDir(), ["auth-store"], (l) => this.addUnder(l, token));
  }

  /** Add a token while the caller holds the `auth-store` lock. */
  async addUnder(locks: StoreLocks, token: StoredToken): Promise<StoreResult<void>> {
    locks.assertHolds("auth-store");
    return this.mutate((tokens) => {
      if (tokens.some((t) => t.id === token.id)) return { error: "duplicate_token_id" };
      if (tokens.length >= this.maxTokens) return { error: "token_count_exceeded" };
      tokens.push({ ...token, revision: token.revision ?? 1 });
      return { result: undefined };
    });
  }

  /**
   * Replace an existing token record (e.g., for revocation or rotation).
   * Re-reads under the lock and bumps `revision` (CAS). `principalId` is
   * preserved unless explicitly changed — revocation must not delete the binding.
   */
  async update(id: string, updates: Partial<StoredToken>): Promise<StoreResult<void>> {
    return withStoreLocksResult(this.getStoreDir(), ["auth-store"], (l) => this.updateUnder(l, id, updates));
  }

  /** Update a token while the caller holds the `auth-store` lock. */
  async updateUnder(locks: StoreLocks, id: string, updates: Partial<StoredToken>): Promise<StoreResult<void>> {
    locks.assertHolds("auth-store");
    return this.mutate((tokens) => {
      const idx = tokens.findIndex((t) => t.id === id);
      if (idx === -1) return { error: "token_not_found" };
      const current = tokens[idx];
      tokens[idx] = {
        ...current,
        ...updates,
        id,
        revision: (current.revision ?? 1) + 1,
      };
      return { result: undefined };
    });
  }

  /**
   * Remove expired or revoked tokens from the store (cleanup).
   *
   * Returns the number of tokens removed.
   */
  async cleanup(): Promise<StoreResult<number>> {
    return withStoreLocksResult(this.getStoreDir(), ["auth-store"], (l) => this.cleanupUnder(l));
  }

  /** Cleanup while the caller holds the `auth-store` lock. */
  async cleanupUnder(locks: StoreLocks): Promise<StoreResult<number>> {
    locks.assertHolds("auth-store");
    const loaded = await this.load();
    if (!loaded.ok) return loaded;

    const now = new Date().toISOString();
    const kept = loaded.value.filter((t) => {
      // Keep if not expired and not revoked
      if (t.revocation) return false;
      if (t.expiresAt && t.expiresAt < now) return false;
      return true;
    });

    const removed = loaded.value.length - kept.length;
    if (removed === 0) return { ok: true, value: 0 };

    const writeResult = await this.writeAll(kept);
    if (!writeResult.ok) return writeResult;
    return { ok: true, value: removed };
  }

  /**
   * Return the current token count.
   */
  async count(): Promise<StoreResult<number>> {
    const result = await this.load();
    if (!result.ok) return result;
    return { ok: true, value: result.value.length };
  }

  /**
   * Return the maximum number of tokens allowed in the store.
   */
  getMaxTokens(): number {
    return this.maxTokens;
  }

  /** Directory holding the store file (also the lock-file directory). */
  getStoreDir(): string {
    return dirname(this.filePath);
  }

  /**
   * Check if the store file exists.
   */
  async exists(): Promise<boolean> {
    try {
      await readFile(this.filePath, "utf-8");
      return true;
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Read-modify-write the store file under an already-held lock. Re-reads the
   * authoritative state (never mutates a pre-lock snapshot) and applies `fn`.
   */
  private async mutate<R>(
    fn: (tokens: StoredToken[]) => { result: R } | { error: string },
  ): Promise<StoreResult<R>> {
    const loaded = await this.load();
    if (!loaded.ok) return loaded;
    const tokens = loaded.value;
    const outcome = fn(tokens);
    if ("error" in outcome) return { ok: false, error: outcome.error };
    const writeResult = await this.writeAll(tokens);
    return writeResult.ok ? { ok: true, value: outcome.result } : writeResult;
  }

  /**
   * Atomically write all tokens to the store file.
   *
   * Uses temp-file write followed by same-filesystem rename.
   * Validates symlink safety before writing.
   */
  private async writeAll(tokens: StoredToken[]): Promise<StoreResult<void>> {
    const data: AuthStoreData = {
      version: AUTH_STORE_SCHEMA_VERSION,
      tokens,
    };

    const dir = dirname(this.filePath);

    // Ensure directory exists with restrictive permissions
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch {
      return { ok: false, error: "store_dir_create_failed" };
    }

    // Symlink check: detect leaf-path symlinks on the store file and its
    // parent directory using lstatSync. This prevents the most common
    // symlink replacement attacks. Full ancestor-path symlink resolution
    // (traversing each path component) is not implemented for this threat
    // model — a determined attacker with filesystem access could bypass
    // this check by symlinking an intermediate directory. The existing
    // directory creation with restrictive permissions (0o700) mitigates
    // the practical attack surface.

    // Detect symlinked store file or directory
    try {
      const dirStat = lstatSync(dir);
      if (dirStat.isSymbolicLink()) {
        return { ok: false, error: "store_path_is_symlink" };
      }
    } catch {
      // dir doesn't exist yet — that's fine, we created it above
    }

    try {
      const fileStat = lstatSync(this.filePath);
      if (fileStat.isSymbolicLink()) {
        return { ok: false, error: "store_path_is_symlink" };
      }
    } catch {
      // file doesn't exist yet — that's fine
    }

    // Atomic write: temp file + rename
    const tmpPath = join(dir, `.auth-store-${randomUUID()}.tmp`);
    try {
      const json = JSON.stringify(data, null, 2) + "\n";
      writeFileSync(tmpPath, json, { mode: 0o600, flag: "wx" });
      renameSync(tmpPath, this.filePath);
    } catch (err) {
      // Clean up temp file on failure
      try { unlinkSync(tmpPath); } catch { /* best effort */ }
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `write_failed: ${message}` };
    }

    return { ok: true, value: undefined };
  }
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/** Default the revision for legacy records written before G3-A′. */
function normalizeToken(token: StoredToken): StoredToken {
  return { ...token, revision: typeof token.revision === "number" ? token.revision : 1 };
}

/**
 * Create a new token record (does NOT persist — use store.add()).
 */
export function createTokenRecord(opts: {
  id: string;
  hash: string;
  name: string;
  role: string;
  workspaceIds?: string[];
  expiresAt?: string;
  rotatedFrom?: string;
  principalId?: string;
}): StoredToken {
  return {
    id: opts.id,
    hash: opts.hash,
    name: opts.name,
    role: opts.role,
    workspaceIds: opts.workspaceIds,
    principalId: opts.principalId,
    createdAt: new Date().toISOString(),
    expiresAt: opts.expiresAt,
    rotatedFrom: opts.rotatedFrom,
    revision: 1,
    schemaVersion: AUTH_STORE_SCHEMA_VERSION,
  };
}

/**
 * Create a revocation record.
 */
export function createRevocation(reason: string): TokenRevocation {
  return {
    revokedAt: new Date().toISOString(),
    reason,
  };
}
