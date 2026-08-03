import { join } from "node:path";
import { existsSync, rmSync, mkdirSync } from "node:fs";

const originalHome = process.env.HOME;

/**
 * Point HOME at a test dir and ensure ~/.alix/skills exists. Shared by the
 * install and marketplace test files so every HOME-dependent describe uses the
 * same isolation pattern (save original HOME, set per-test, restore after).
 */
export function useTestHome(testDir: string): void {
  process.env.HOME = testDir;
  mkdirSync(join(testDir, ".alix", "skills"), { recursive: true });
}

/** Remove the test dir and restore the original HOME so no state leaks across describes. */
export function restoreTestHome(testDir: string): void {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
}
