/** Experimental helper isolation gate; cannot substitute for kernel credentials. */
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import type { Ge04HelperIntegrity } from "./ge04-helper-integrity.js";

export async function assertGe04HelperIsolation(
  config: Ge04HelperIntegrity & Readonly<{ workerUid: number }>,
): Promise<void> {
  if (process.platform !== "linux" || !isAbsolute(config.executable) ||
      !Number.isSafeInteger(config.workerUid) || config.workerUid < 0 ||
      config.workerUid === config.expectedOwnerUid ||
      config.expectedOwnerUid !== process.geteuid?.()) {
    throw new Error("GE-04: helper must be controlled by a distinct coordinator UID");
  }
  // This is a preflight only. It does not hold ancestor directory handles or
  // verify that the worker actually runs with the declared kernel UID.
  let path = dirname(config.executable);
  for (;;) {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o022) !== 0 ||
        (stat.uid !== 0 && stat.uid !== config.expectedOwnerUid)) {
      throw new Error("GE-04: helper ancestor is not coordinator-controlled");
    }
    const parent = dirname(path);
    if (parent === path) break;
    path = parent;
  }
  const handle = await open(config.executable, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== config.expectedOwnerUid ||
        (stat.mode & 0o222) !== 0 || (stat.mode & 0o111) === 0 || stat.nlink !== 1) {
      throw new Error("GE-04: helper must be non-writable, executable and singly linked");
    }
  } finally { await handle.close(); }
}
