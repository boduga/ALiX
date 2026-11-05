/**
 * Existing owned-file replacement for the legacy Node file router.
 *
 * Staging on the same filesystem avoids in-place partial writes and prevents
 * writes through newly-created hard links to the old inode. It is NOT an
 * atomic authorization / pathname transaction: a same-UID attacker can race
 * the final lstat/rename, or rename the parent after its final verification.
 * These gaps require the independently qualified native GE-04 boundary.
 */
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";

export type OwnedFileIdentity = Readonly<{
  dev: number;
  ino: number;
  nlink: number;
}>;

export type OwnedReplaceOptions = Readonly<{
  /** Test-only adversarial scheduler / injected precommit fault. Never passed by router. */
  beforeCommit?: () => Promise<void>;
  /** Test-only simulated post-commit observation/durability failure. */
  afterCommit?: () => Promise<void>;
}>;

/** A rename may already have changed the filesystem. Never replay automatically. */
export class OwnedReplaceAmbiguousError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnedReplaceAmbiguousError";
  }
}

function sameIdentity(actual: OwnedFileIdentity, expected: OwnedFileIdentity): boolean {
  return actual.dev === expected.dev && actual.ino === expected.ino;
}

async function assertCurrentTarget(path: string, expected: OwnedFileIdentity, oldContent: string): Promise<void> {
  const current = await lstat(path);
  if (!current.isFile() || !sameIdentity(current, expected) || current.nlink !== 1) {
    throw new Error("Owned-file target changed or acquired a hard link");
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const pinned = await handle.stat();
    if (!pinned.isFile() || !sameIdentity(pinned, expected) || pinned.nlink !== 1) {
      throw new Error("Owned-file target changed or acquired a hard link");
    }
    if (await handle.readFile("utf8") !== oldContent) {
      throw new Error("Owned-file contents changed before commit");
    }
  } finally {
    await handle.close();
  }
}

/**
 * Create a private temporary inode, fully write it, then rename over the
 * previous owned pathname. Reject obvious replacement races before commit.
 * Does NOT promise a race-free replacement against an attacker who controls
 * parent directory entries; do not use it as the qualified GE-04 backend.
 */
export async function replaceOwnedFileStaged(
  target: string,
  replacement: string,
  expected: OwnedFileIdentity,
  oldContent: string,
  options: OwnedReplaceOptions = {},
): Promise<void> {
  if (expected.nlink !== 1) throw new Error("Hard-linked file cannot be overwritten");

  const dir = dirname(target);
  const parent = await lstat(dir);
  if (!parent.isDirectory() || parent.isSymbolicLink()) {
    throw new Error("Owned-file parent is not a physical directory");
  }
  const canonicalParent = await realpath(dir);

  // Preserve the old write-permission requirement; creating a temp file in a
  // writable directory must not grant overwrite authority to a 0444 target.
  const writable = await open(target, constants.O_RDWR | constants.O_NOFOLLOW);
  let mode: number;
  try {
    const pinned = await writable.stat();
    if (!pinned.isFile() || !sameIdentity(pinned, expected) || pinned.nlink !== 1) {
      throw new Error("Owned-file target changed or acquired a hard link");
    }
    const getuid = process.getuid?.();
    if (getuid !== undefined && pinned.uid !== getuid) {
      throw new Error("Cannot replace owned file with a different filesystem owner");
    }
    // Setuid/setgid/sticky file semantics, ACLs, extended attributes and
    // alternate data streams cannot be faithfully retained by this helper.
    if ((pinned.mode & 0o7000) !== 0) {
      throw new Error("Special-mode files cannot be replaced by the Node router");
    }
    mode = pinned.mode & 0o777;
    if (await writable.readFile("utf8") !== oldContent) {
      throw new Error("Owned-file contents changed before staging");
    }
  } finally {
    await writable.close();
  }

  const staging = join(dir, `.${basename(target)}.alix-stage-${randomUUID()}`);
  let committed = false;
  let stagedIdentity: OwnedFileIdentity | undefined;
  try {
    const handle = await open(staging, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      const payload = Buffer.from(replacement, "utf8");
      let offset = 0;
      while (offset < payload.length) {
        const { bytesWritten } = await handle.write(payload, offset, payload.length - offset, offset);
        if (bytesWritten <= 0) throw new Error("Short write to owned-file staging inode");
        offset += bytesWritten;
      }
      // Staging remains private (0600) until it has been installed. Reapply
      // the target's original access mode only after rename on a verified FD.
      await handle.sync();
      stagedIdentity = await handle.stat();
    } finally {
      await handle.close();
    }
    await options.beforeCommit?.();
    const currentParent = await lstat(dir);
    if (!sameIdentity(currentParent, parent) || !currentParent.isDirectory() ||
        await realpath(dir) !== canonicalParent) {
      throw new Error("Owned-file parent changed before commit");
    }
    await assertCurrentTarget(target, expected, oldContent);
    const staged = await lstat(staging);
    if (!stagedIdentity || !staged.isFile() || staged.nlink !== 1 || !sameIdentity(staged, stagedIdentity)) {
      throw new Error("Owned-file staging inode changed before commit");
    }
    // The only mutation of the old target name is this same-directory rename.
    // This is not an atomic compare-and-swap against a concurrently swapped
    // target or parent; no production GE-04 authority relies on it.
    try {
      await rename(staging, target);
      committed = true;
    } catch (error) {
      throw new OwnedReplaceAmbiguousError(
        `Owned-file rename outcome unverified: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Detect visible post-commit parent/leaf swaps; any failure now represents
    // an AMBIGUOUS effect rather than a claim that nothing changed.
    try {
      await options.afterCommit?.();
      const afterParent = await lstat(dir);
      const afterLeaf = await lstat(target);
      if (!sameIdentity(afterParent, parent) || await realpath(dir) !== canonicalParent ||
          !sameIdentity(afterLeaf, staged)) {
        throw new Error("Owned-file parent or leaf changed after commit");
      }
      if (mode !== 0o600) {
        const installed = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const current = await installed.stat();
          if (!sameIdentity(current, staged)) {
            throw new Error("Owned-file inode changed before mode restoration");
          }
          await installed.chmod(mode);
          await installed.sync();
        } finally {
          await installed.close();
        }
      }
      if (process.platform !== "win32") {
        const directory = await open(dir, constants.O_RDONLY);
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
    } catch (error) {
      throw new OwnedReplaceAmbiguousError(`Owned-file commit outcome unverified: ${error instanceof Error ? error.message : String(error)}`);
    }
  } finally {
    if (!committed) {
      // If another process renamed the parent, the private stage may have
      // moved with it. In that case cleanup is best-effort and no overwrite
      // success is claimed.
      await unlink(staging).catch(() => {});
    }
  }
}
