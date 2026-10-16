/**
 * G3-A′ — Principal Store (operator identity).
 *
 * Persists the operator identity layer: `PrincipalRecord` with a stable,
 * server-generated `principalId` and an `active`/`disabled` status. This store
 * owns operator **identity and lifecycle only** — it holds no secrets and is NOT
 * the credential→principal binding authority (that is `StoredToken.principalId`
 * in `auth-store.ts`; membership is derived by scanning tokens, so there is no
 * `credentialIds` list here that could drift).
 *
 * Persistence mirrors `auth-store.ts`: atomic temp+rename, `0o600`, and explicit
 * `lstatSync` symlink rejection of the file and its parent (the shared JSON
 * primitive gives atomicity but not the symlink check).
 *
 * Concurrency: every mutation is a cross-process-locked, revision-checked
 * compare-and-set (see `store-lock.ts`).
 *
 * @module
 */

import { randomBytes } from "node:crypto";
import { dirname } from "node:path";
import { StoreLocks, withStoreLocksResult } from "./store-lock.js";
import { readStoreFile, writeStoreFileAtomic } from "./store-file.js";
import type { StoreResult } from "./store-file.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Schema version for the principal store file format. */
export const PRINCIPAL_STORE_SCHEMA_VERSION = 1;

/** Maximum number of principals allowed in the store. */
export const MAX_PRINCIPAL_COUNT = 128;

/** Status of an operator principal. */
export type PrincipalStatus = "active" | "disabled";

/** A durable operator identity. */
export interface PrincipalRecord {
  /** Stable server-generated operator id (`prin_<12 base64url>`). Never a credential id. */
  id: string;
  /** Human-readable label. */
  name: string;
  /** Lifecycle status, read fresh at authentication. */
  status: PrincipalStatus;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 timestamp when disabled. */
  disabledAt?: string;
  /** Stable code explaining disablement. */
  disabledReason?: string;
  /** Monotonic revision for compare-and-set writes. */
  revision: number;
  /** Schema version at the time this record was created. */
  schemaVersion: number;
}

/** On-disk format of the principal store file. */
export interface PrincipalStoreData {
  version: number;
  principals: PrincipalRecord[];
}

export interface PrincipalStoreOptions {
  filePath: string;
  maxPrincipals?: number;
}

/** Whitelisted update fields for {@link PrincipalStore.setStatusUnder}. */
interface StatusChange {
  status: PrincipalStatus;
  reason?: string;
}

// ---------------------------------------------------------------------------
// PrincipalStore
// ---------------------------------------------------------------------------

export class PrincipalStore {
  private readonly filePath: string;
  private readonly maxPrincipals: number;

  constructor(opts: PrincipalStoreOptions) {
    this.filePath = opts.filePath;
    this.maxPrincipals = opts.maxPrincipals ?? MAX_PRINCIPAL_COUNT;
  }

  /** Directory holding the store file (also the lock-file directory). */
  getStoreDir(): string {
    return dirname(this.filePath);
  }

  /** Load all principals (empty when the file does not exist yet). */
  async load(): Promise<StoreResult<PrincipalRecord[]>> {
    const parsed = await readStoreFile<PrincipalStoreData>(this.filePath);
    if (!parsed.ok) return parsed;
    if (parsed.value === null) return { ok: true, value: [] };
    const data = parsed.value;
    if (typeof data.version !== "number" || data.version < 1) {
      return { ok: false, error: "invalid_store_schema" };
    }
    if (!Array.isArray(data.principals)) {
      return { ok: false, error: "invalid_store_format" };
    }
    return { ok: true, value: data.principals.map(normalizeRecord) };
  }

  /** Look up a single principal by id. */
  async get(id: string): Promise<StoreResult<PrincipalRecord | null>> {
    const result = await this.load();
    if (!result.ok) return result;
    return { ok: true, value: result.value.find((p) => p.id === id) ?? null };
  }

  /** List all principals (safe metadata). */
  async list(): Promise<StoreResult<PrincipalRecord[]>> {
    return this.load();
  }

  /**
   * Create a principal. Acquires the principal lock unless `locks` is supplied
   * (the enrollment/migration orchestrator holds it).
   */
  async create(record: PrincipalRecord, locks?: StoreLocks): Promise<StoreResult<void>> {
    if (locks) return this.createUnder(locks, record);
    return withStoreLocksResult(this.getStoreDir(), ["principals"], (l) => this.createUnder(l, record));
  }

  /** Create a principal while the caller holds the principal lock. */
  async createUnder(locks: StoreLocks, record: PrincipalRecord): Promise<StoreResult<void>> {
    locks.assertHolds("principals");
    return this.mutatePrimitive((principals) => {
      if (principals.some((p) => p.id === record.id)) return { error: "duplicate_principal_id" };
      if (principals.length >= this.maxPrincipals) return { error: "principal_count_exceeded" };
      principals.push({ ...record, revision: 1 });
      return { result: undefined };
    });
  }

  /**
   * Set a principal's status (active/disabled), preserving history. Re-reads the
   * record under the lock and asserts `expectedRevision` when supplied (CAS).
   */
  async setStatus(
    id: string,
    change: StatusChange,
    expectedRevision?: number,
  ): Promise<StoreResult<void>> {
    return withStoreLocksResult(this.getStoreDir(), ["principals"], (l) =>
      this.setStatusUnder(l, id, change, expectedRevision),
    );
  }

  /** Set status while the caller holds the principal lock. */
  async setStatusUnder(
    locks: StoreLocks,
    id: string,
    change: StatusChange,
    expectedRevision?: number,
  ): Promise<StoreResult<void>> {
    locks.assertHolds("principals");
    return this.mutatePrimitive((principals) => {
      const idx = principals.findIndex((p) => p.id === id);
      if (idx === -1) return { error: "principal_not_found" };
      const current = principals[idx];
      if (expectedRevision !== undefined && current.revision !== expectedRevision) {
        return { error: "revision_conflict" };
      }
      const next: PrincipalRecord = { ...current, status: change.status, revision: current.revision + 1 };
      if (change.status === "disabled") {
        next.disabledAt = new Date().toISOString();
        next.disabledReason = change.reason;
      } else {
        delete next.disabledAt;
        delete next.disabledReason;
      }
      principals[idx] = next;
      return { result: undefined };
    });
  }

  /**
   * Remove a principal record (explicit operator action only). The caller must
   * have verified the principal has no bound credentials; this store does not
   * check token state.
   */
  async removeUnder(locks: StoreLocks, id: string): Promise<StoreResult<void>> {
    locks.assertHolds("principals");
    return this.mutatePrimitive((principals) => {
      const idx = principals.findIndex((p) => p.id === id);
      if (idx === -1) return { error: "principal_not_found" };
      principals.splice(idx, 1);
      return { result: undefined };
    });
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /**
   * Read-modify-write the store file. Callers MUST hold the principal lock; this
   * helper only performs the atomic file rewrite.
   */
  private async mutatePrimitive<R>(
    fn: (principals: PrincipalRecord[]) => { result: R } | { error: string },
  ): Promise<StoreResult<R>> {
    const loaded = await this.load();
    if (!loaded.ok) return loaded;
    const principals = loaded.value;
    const outcome = fn(principals);
    if ("error" in outcome) return { ok: false, error: outcome.error };
    return this.writeAll(principals).then((w) =>
      w.ok ? { ok: true, value: outcome.result } : w,
    );
  }

  private async writeAll(principals: PrincipalRecord[]): Promise<StoreResult<void>> {
    const data: PrincipalStoreData = { version: PRINCIPAL_STORE_SCHEMA_VERSION, principals };
    return writeStoreFileAtomic(this.filePath, data);
  }
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/** Normalize a persisted record, defaulting the revision for legacy rows. */
function normalizeRecord(record: PrincipalRecord): PrincipalRecord {
  return { ...record, revision: typeof record.revision === "number" ? record.revision : 1 };
}

/** Generate a stable server-side operator id: `prin_<12 base64url>`. */
function generatePrincipalId(): string {
  return `prin_${randomBytes(9).toString("base64url")}`;
}

/** Create a new active principal record (does NOT persist — use `create`). */
export function createPrincipalRecord(opts: { name: string; id?: string }): PrincipalRecord {
  return {
    id: opts.id ?? generatePrincipalId(),
    name: opts.name,
    status: "active",
    createdAt: new Date().toISOString(),
    revision: 1,
    schemaVersion: PRINCIPAL_STORE_SCHEMA_VERSION,
  };
}
