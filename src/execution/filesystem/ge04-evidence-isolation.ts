/**
 * GE-04 evidence-store isolation preflight. Experimental only.
 * This is a static configuration rejection gate, NOT a race-free directory
 * capability or permission to trust receipts. Never authorizes a mutation.
 */
import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export type Ge04EvidenceIsolation = Readonly<{
  workspaceRoot: string;
  evidenceRoot: string;
  workerUid: number;
}>;

function within(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
}

export async function assertGe04EvidenceIsolation(config: Ge04EvidenceIsolation): Promise<void> {
  const { workspaceRoot, evidenceRoot, workerUid } = config;
  if (!isAbsolute(workspaceRoot) || !isAbsolute(evidenceRoot) ||
      !Number.isSafeInteger(workerUid) || workerUid < 0) {
    throw new Error("GE-04: invalid evidence isolation configuration");
  }
  const workspace = await realpath(workspaceRoot);
  const evidence = await realpath(evidenceRoot);
  if (within(workspace, evidence) || within(evidence, workspace)) {
    throw new Error("GE-04: evidence store must be outside workspace ancestry");
  }
  let path = resolve(evidenceRoot);
  while (true) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("GE-04: evidence path must contain only real directories");
    }
    if (path === resolve(evidenceRoot)) {
      if (stat.uid === workerUid) {
        throw new Error("GE-04: worker UID must not own evidence store");
      }
      if ((stat.mode & 0o077) !== 0) {
        throw new Error("GE-04: evidence store must be owner-only");
      }
      if (process.getuid?.() !== stat.uid) {
        throw new Error("GE-04: coordinator must own evidence store");
      }
    } else if ((stat.mode & 0o022) !== 0) {
      throw new Error("GE-04: evidence ancestor writable by group/other");
    }
    const parent = dirname(path);
    if (parent === path) break;
    path = parent;
  }
  // No fd is retained. A same-UID actor can still race or replace paths.
  // Callers MUST NOT infer durable receipt authenticity from this preflight.
}
