/**
 * G3-A′ — shared JSON store-file I/O for the Inspector auth stores.
 *
 * `AuthStore` and `PrincipalStore` share one persistence discipline: atomic
 * temp+rename, `0o600`, and explicit `lstatSync` symlink rejection of the file
 * and its parent. The shared `runtime-state/storage` primitive gives atomicity
 * but not the symlink check, so this thin helper centralises the discipline (and
 * `StoreResult`) instead of duplicating it per store.
 *
 * @module
 */

import { randomUUID } from "node:crypto";
import { writeFileSync, renameSync, unlinkSync, lstatSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";

/** Discriminated result shared by the Inspector auth stores. */
export type StoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/**
 * Read and parse a JSON store file.
 *
 * - missing file → `{ ok: true, value: null }`
 * - malformed JSON → `{ ok: false, error: "corrupt_store_file" }`
 * - any other read failure → `{ ok: false, error: "store_read_failed" }` (fail closed)
 */
export async function readStoreFile<T>(filePath: string): Promise<StoreResult<T | null>> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, value: null };
    return { ok: false, error: "store_read_failed" };
  }
  try {
    return { ok: true, value: JSON.parse(raw) as T };
  } catch (err) {
    return { ok: false, error: err instanceof SyntaxError ? "corrupt_store_file" : "store_read_failed" };
  }
}

/**
 * Atomically write a JSON store file: `0o700` dir, `lstatSync` symlink rejection
 * of the file and its parent, then a `0o600` temp file renamed into place.
 */
export function writeStoreFileAtomic(filePath: string, data: unknown): StoreResult<void> {
  const dir = dirname(filePath);

  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {
    return { ok: false, error: "store_dir_create_failed" };
  }

  // Symlink rejection on the store file and its parent directory. Full
  // ancestor-path resolution is out of scope for this threat model; the 0o700
  // directory plus these leaf checks cover the practical attack surface.
  try {
    if (lstatSync(dir).isSymbolicLink()) return { ok: false, error: "store_path_is_symlink" };
  } catch {
    // Directory was just created — fine.
  }
  try {
    if (lstatSync(filePath).isSymbolicLink()) return { ok: false, error: "store_path_is_symlink" };
  } catch {
    // File does not exist yet — fine.
  }

  const tmpPath = join(dir, `.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmpPath, JSON.stringify(data, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    renameSync(tmpPath, filePath);
  } catch (err) {
    try { unlinkSync(tmpPath); } catch { /* best effort */ }
    return { ok: false, error: `write_failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { ok: true, value: undefined };
}
