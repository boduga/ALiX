/**
 * G3-A′ — cross-process store locks for the Inspector auth stores.
 *
 * Atomic temp-file replacement prevents *torn files*; it does not prevent two
 * processes reading the same snapshot and overwriting each other (a lost
 * update). Every read-modify-write on `PrincipalStore` and `AuthStore` is
 * therefore serialized by the shared cross-process file lock in
 * `../audit/audit-lock.js` (O_EXCL create, PID+host stale detection, bounded
 * exponential backoff) — the same primitive already used by the audit chain
 * writer, the evidence store, and workflow state files.
 *
 * Rules (see the G3-A′ design/plan):
 * - Lock order is canonical: `principals` before `auth-store`, never reversed,
 *   released in reverse. {@link StoreLocks.acquire} sorts any requested set into
 *   this order, so a caller cannot deadlock by passing them backwards.
 * - Stale locks fail **closed** (`staleRecovery: "manual"`): a held or stale lock
 *   makes the mutation write nothing. Breaking a security-mutation lock is an
 *   explicit operator action, never automatic.
 * - {@link StoreLocks} is a proof-of-hold capability: the `*Under` store methods
 *   require it, so a caller cannot mutate a store without holding its lock.
 *
 * @module
 */

import { join } from "node:path";
import { acquire, release } from "../audit/audit-lock.js";
import type { AcquireError, AcquireResult, LockHandle, LockOptions } from "../audit/audit-lock.js";

/** The Inspector auth stores that participate in cross-process locking. */
export type StoreLockName = "principals" | "auth-store";

/** Canonical acquisition order — prevents deadlock. Never reorder. */
export const STORE_LOCK_ORDER: readonly StoreLockName[] = ["principals", "auth-store"];

/** Failure shape mirroring the stores' `StoreResult`. */
export interface StoreLockError {
  ok: false;
  error: "store_locked" | "lock_timeout" | "lock_io_error";
}

export type StoreLockResult<T> = { ok: true; value: T } | StoreLockError;

/** Absolute lock-file path for a store, beside the store file. */
export function storeLockFile(authStateDir: string, name: StoreLockName): string {
  return join(authStateDir, `${name}.lock`);
}

function mapAcquireError(err: AcquireError): StoreLockError["error"] {
  if (err.code === "LOCK_TIMEOUT") return "lock_timeout";
  if (err.code === "LOCK_STALE" || err.code === "LOCK_ALREADY_HELD") return "store_locked";
  return "lock_io_error";
}

/**
 * A set of held store locks. Constructed only by {@link StoreLocks.acquire} /
 * {@link withStoreLocks}; passed to the `*Under` store methods as proof that the
 * caller holds the required lock.
 */
export class StoreLocks {
  private readonly held: ReadonlySet<StoreLockName>;
  private readonly handles: LockHandle[];

  private constructor(held: ReadonlySet<StoreLockName>, handles: LockHandle[]) {
    this.held = held;
    this.handles = handles;
  }

  /** Acquire one or more store locks in canonical order. */
  static async acquire(
    authStateDir: string,
    names: readonly StoreLockName[] = STORE_LOCK_ORDER,
    opts?: LockOptions,
  ): Promise<{ ok: true; locks: StoreLocks } | StoreLockError> {
    const ordered = STORE_LOCK_ORDER.filter((n) => names.includes(n));
    const handles: LockHandle[] = [];
    for (const name of ordered) {
      const result: AcquireResult = await acquire(storeLockFile(authStateDir, name), {
        staleRecovery: "manual",
        ...opts,
      });
      if (!result.ok) {
        // Release anything already held before failing closed.
        for (const h of handles) release(h);
        return { ok: false, error: mapAcquireError(result) };
      }
      handles.push(result);
    }
    return { ok: true, locks: new StoreLocks(new Set(ordered), handles) };
  }

  /** Whether this handle holds the named lock. */
  holds(name: StoreLockName): boolean {
    return this.held.has(name);
  }

  /** Throw when the named lock is not held — a programming error, not a runtime one. */
  assertHolds(name: StoreLockName): void {
    if (!this.held.has(name)) {
      throw new Error(`store lock "${name}" is required but not held`);
    }
  }

  /** Release every held lock (idempotent, best-effort). */
  release(): void {
    for (const h of this.handles) {
      try {
        release(h);
      } catch {
        // Best-effort: a lock file may already be gone.
      }
    }
  }
}

/**
 * Acquire the named store locks (canonical order), run `fn`, and release.
 * Returns a {@link StoreLockError} — never running `fn` — when a lock cannot be
 * acquired, so a mutation writes nothing on lock failure.
 */
export async function withStoreLocks<T>(
  authStateDir: string,
  names: readonly StoreLockName[],
  fn: (locks: StoreLocks) => Promise<T> | T,
  opts?: LockOptions,
): Promise<StoreLockResult<T>> {
  const acquired = await StoreLocks.acquire(authStateDir, names, opts);
  if (!acquired.ok) return acquired;
  try {
    return { ok: true, value: await fn(acquired.locks) };
  } finally {
    acquired.locks.release();
  }
}

/** Minimal result shape shared with the stores (`StoreResult`). */
type ResultLike<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Like {@link withStoreLocks} but unwraps an inner `{ ok, value/error }` result,
 * mapping a lock-acquisition failure to an `{ ok: false, error }` without
 * running `fn`. Used by the store convenience methods.
 */
export async function withStoreLocksResult<T>(
  authStateDir: string,
  names: readonly StoreLockName[],
  fn: (locks: StoreLocks) => Promise<ResultLike<T>> | ResultLike<T>,
  opts?: LockOptions,
): Promise<ResultLike<T>> {
  const acquired = await StoreLocks.acquire(authStateDir, names, opts);
  if (!acquired.ok) return { ok: false, error: acquired.error };
  try {
    return await fn(acquired.locks);
  } finally {
    acquired.locks.release();
  }
}
