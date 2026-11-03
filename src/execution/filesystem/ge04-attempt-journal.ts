/** Experimental GE-04 pre-spawn evidence; not a terminal receipt. */
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { ScopedMutationAuthority, ScopedMutationOperation } from "./scoped-mutation.js";
import { computeScopedMutationInvocation } from "./scoped-mutation-authorization.js";

// Defense in depth only: path-based checks cannot eliminate concurrent rename
// races by a workspace attacker. Do not treat these records as trusted receipts.
async function assertRealDirectory(path: string): Promise<void> {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("GE-04: journal path must be a real directory: " + path);
  }
}

async function ensureJournalDirectory(workspaceRoot: string): Promise<string> {
  if (!isAbsolute(workspaceRoot)) throw new Error("GE-04: absolute workspace required");
  const ancestors: string[] = [];
  for (let path = workspaceRoot; ; path = dirname(path)) {
    ancestors.unshift(path);
    if (dirname(path) === path) break;
  }
  for (const path of ancestors) await assertRealDirectory(path);
  let path = workspaceRoot;
  for (const part of [".alix", "ge04", "attempts"]) {
    path = join(path, part);
    try { await mkdir(path, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    await assertRealDirectory(path);
    // A shared or differently-owned journal component permits another local
    // account to replace or alter evidence. Refuse it rather than trusting it.
    const stat = await lstat(path);
    if (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) {
      throw new Error("GE-04: journal directory must be owner-only: " + path);
    }
  }
  return path;
}

export async function recordGe04Attempt(authority: ScopedMutationAuthority, operation: ScopedMutationOperation): Promise<string> {
  if (!authority.approvalId || !authority.leaseId || !authority.workerId) throw new Error("GE-04: missing attempt authority");
  const directory = await ensureJournalDirectory(authority.workspaceRoot);
  const id = randomUUID();
  const record = {
    version: 1, attemptId: id, approvalId: authority.approvalId,
    leaseId: authority.leaseId, workerId: authority.workerId,
    invocation: computeScopedMutationInvocation(authority, operation),
    hostPid: process.pid, recordedAt: new Date().toISOString(), state: "pre_spawn",
  };
  const file = await open(join(directory, id + ".json"),
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(JSON.stringify(record) + "\n"); await file.sync(); }
  finally { await file.close(); }
  const dir = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await dir.sync(); } finally { await dir.close(); }
  return id;
}
