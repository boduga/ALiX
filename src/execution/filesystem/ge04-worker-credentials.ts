/**
 * Linux worker credential observation, not a durable process capability.
 * A /proc PID lookup can race process exit/reuse; do not use it alone to
 * authorize filesystem mutation, receipts, or crash reconciliation.
 */
import { readFile } from "node:fs/promises";

export type Ge04WorkerCredentials = Readonly<{
  pid: number;
  uid: number;
  gid: number;
  startTimeTicks: string;
}>;

export async function inspectGe04WorkerCredentials(pid: number): Promise<Ge04WorkerCredentials> {
  if (process.platform !== "linux" || !process.getuid || !Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error("GE-04: Linux worker PID required");
  }
  // Bracket the credential read with process start identity observations.
  // This detects ordinary PID replacement during inspection, but is not a
  // substitute for a supervised pidfd-bound child lifecycle.
  const statBefore = await readFile(`/proc/${pid}/stat`, "utf8");
  const status = await readFile(`/proc/${pid}/status`, "utf8");
  const statAfter = await readFile(`/proc/${pid}/stat`, "utf8");
  const uidLine = /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/m.exec(status);
  const gidLine = /^Gid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/m.exec(status);
  const startTime = (stat: string): string | undefined => {
    const end = stat.lastIndexOf(")");
    if (end < 0) return undefined;
    return stat.slice(end + 2).trim().split(/\s+/)[19]; // field 22
  };
  const startTimeTicks = startTime(statBefore);
  if (!startTimeTicks || startTimeTicks !== startTime(statAfter)) {
    throw new Error("GE-04: worker process identity changed during inspection");
  }
  if (!uidLine || !gidLine || !startTimeTicks) {
    throw new Error("GE-04: incomplete kernel credential observation");
  }
  const uids = uidLine.slice(1).map(Number);
  const gids = gidLine.slice(1).map(Number);
  if (uids.some(uid => !Number.isSafeInteger(uid)) ||
      gids.some(gid => !Number.isSafeInteger(gid)) ||
      new Set(uids).size !== 1 || new Set(gids).size !== 1) {
    throw new Error("GE-04: worker has inconsistent credentials");
  }
  if (uids[0] === process.getuid()) {
    throw new Error("GE-04: worker shares coordinator UID");
  }
  return { pid, uid: uids[0]!, gid: gids[0]!, startTimeTicks };
}
