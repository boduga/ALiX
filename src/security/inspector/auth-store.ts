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
import { readFile, readdir, unlink, rmdir } from "node:fs/promises";
import { join, dirname } from "node:path";

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
  /** ISO 8601 timestamp when the token was created. */
  createdAt: string;
  /** ISO 8601 timestamp when the token expires (optional). */
  expiresAt?: string;
  /** ID of the token this one was rotated from (optional). */
  rotatedFrom?: string;
  /** Revocation record if this token has been revoked. */
  revocation?: TokenRevocation;
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

      return { ok: true, value: data.tokens };
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
   * Fails if the token count is at the maximum bound.
   */
  async add(token: StoredToken): Promise<StoreResult<void>> {
    const result = await this.load();
    if (!result.ok) return result;

    // Check duplicate ID
    if (result.value.some((t) => t.id === token.id)) {
      return { ok: false, error: "duplicate_token_id" };
    }

    // Check count bound
    if (result.value.length >= this.maxTokens) {
      return { ok: false, error: "token_count_exceeded" };
    }

    result.value.push(token);
    return this.writeAll(result.value);
  }

  /**
   * Replace an existing token record (e.g., for revocation or rotation).
   */
  async update(id: string, updates: Partial<StoredToken>): Promise<StoreResult<void>> {
    const result = await this.load();
    if (!result.ok) return result;

    const idx = result.value.findIndex((t) => t.id === id);
    if (idx === -1) {
      return { ok: false, error: "token_not_found" };
    }

    result.value[idx] = { ...result.value[idx], ...updates, id }; // id is immutable
    return this.writeAll(result.value);
  }

  /**
   * Remove expired or revoked tokens from the store (cleanup).
   *
   * Returns the number of tokens removed.
   */
  async cleanup(): Promise<StoreResult<number>> {
    const result = await this.load();
    if (!result.ok) return result;

    const now = new Date().toISOString();
    const before = result.value.length;
    const kept = result.value.filter((t) => {
      // Keep if not expired and not revoked
      if (t.revocation) return false;
      if (t.expiresAt && t.expiresAt < now) return false;
      return true;
    });

    const removed = before - kept.length;
    if (removed > 0) {
      const writeResult = await this.writeAll(kept);
      if (!writeResult.ok) return writeResult;
    }

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
}): StoredToken {
  return {
    id: opts.id,
    hash: opts.hash,
    name: opts.name,
    role: opts.role,
    workspaceIds: opts.workspaceIds,
    createdAt: new Date().toISOString(),
    expiresAt: opts.expiresAt,
    rotatedFrom: opts.rotatedFrom,
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
