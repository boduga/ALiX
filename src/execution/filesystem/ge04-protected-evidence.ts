/**
 * Experimental Linux evidence writer using a pinned directory descriptor.
 * Only a distinct OS security principal can protect it from a worker.
 * Not a native-helper receipt, recovery authority, or production integration.
 */
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { assertGe04EvidenceIsolation, type Ge04EvidenceIsolation } from "./ge04-evidence-isolation.js";

export async function recordGe04ProtectedEvidence(
  config: Ge04EvidenceIsolation,
  evidence: Readonly<{ approvalId: string; invocationFingerprint: string }>,
): Promise<string> {
  if (process.platform !== "linux" || !process.getuid) {
    throw new Error("GE-04: Linux evidence store required");
  }
  if (!evidence.approvalId || !evidence.invocationFingerprint) {
    throw new Error("GE-04: incomplete evidence binding");
  }
  await assertGe04EvidenceIsolation(config);
  const dir = await open(config.evidenceRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const stat = await dir.stat();
    if (!stat.isDirectory() || stat.uid !== process.getuid() || stat.uid === config.workerUid ||
        (stat.mode & 0o077) !== 0) {
      throw new Error("GE-04: pinned evidence directory failed isolation");
    }
    // Linux procfs resolves the leaf relative to the already-open directory
    // inode. A renamed pathname cannot redirect the write to another inode.
    const id = randomUUID();
    const path = join("/proc/self/fd", String(dir.fd), id + ".json");
    const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await file.writeFile(JSON.stringify({
        version: 1, attemptId: id, approvalId: evidence.approvalId,
        invocationFingerprint: evidence.invocationFingerprint, state: "pre_spawn",
      }) + "\n");
      await file.sync();
    } finally { await file.close(); }
    await dir.sync();
    return id;
  } finally { await dir.close(); }
}
