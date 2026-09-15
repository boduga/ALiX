/**
 * temp.ts — cross-platform temp-dir cleanup for tests (#732).
 *
 * On Windows, `rm`/`rmdir` of a directory whose files are still open fails with
 * `EBUSY`/`EPERM`. Node retries these codes when `maxRetries`/`retryDelay` are
 * set, which makes teardown deterministic instead of racy.
 */
import { rmSync } from "node:fs";
import { rm } from "node:fs/promises";

const RETRY = { recursive: true, force: true, maxRetries: 10, retryDelay: 50 } as const;

/** Synchronously remove a temp dir, retrying on Windows EBUSY/EPERM. */
export function removeTempDirSync(dir: string): void {
  rmSync(dir, RETRY);
}

/** Remove a temp dir, retrying on Windows EBUSY/EPERM. */
export async function removeTempDir(dir: string): Promise<void> {
  await rm(dir, RETRY);
}
