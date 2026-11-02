/** Experimental GE-04 pre-spawn evidence; not a terminal receipt. */
import { randomUUID } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import type { ScopedMutationAuthority, ScopedMutationOperation } from "./scoped-mutation.js";
import { computeScopedMutationInvocation } from "./scoped-mutation-authorization.js";

export async function recordGe04Attempt(authority: ScopedMutationAuthority, operation: ScopedMutationOperation): Promise<string> {
  if (!authority.approvalId || !authority.leaseId || !authority.workerId) throw new Error("GE-04: missing attempt authority");
  const directory = join(authority.workspaceRoot, ".alix", "ge04", "attempts");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const id = randomUUID();
  const record = {
    version: 1, attemptId: id, approvalId: authority.approvalId,
    leaseId: authority.leaseId, workerId: authority.workerId,
    invocation: computeScopedMutationInvocation(authority, operation),
    hostPid: process.pid, recordedAt: new Date().toISOString(), state: "pre_spawn",
  };
  const file = await open(join(directory, id + ".json"), "wx", 0o600);
  try { await file.writeFile(JSON.stringify(record) + "\n"); await file.sync(); }
  finally { await file.close(); }
  const dir = await open(directory, "r");
  try { await dir.sync(); } finally { await dir.close(); }
  return id;
}
