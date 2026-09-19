/**
 * owner-liveness.ts — Liveness of a coordination execution owner.
 *
 * Coordination schedulers tag workers with an `executionOwnerId` of the
 * form `<kind>-<pid>` (web/tool/cli/daemon). When a host process dies
 * mid-run, its workers stay `running` with a dead owner. Detecting that
 * lets a new host reclaim and retry them instead of waiting out the
 * heartbeat threshold or leaving the run stuck forever.
 *
 * Unparseable owners (e.g. a named daemon) report alive: we must never
 * steal a run from a host we cannot prove is dead.
 */

const OWNER_PATTERN = /^(?:web|tool|cli|daemon)-(\d+)$/;

export function parseOwnerPid(ownerId: string | undefined | null): number | null {
  if (!ownerId) return null;
  const match = OWNER_PATTERN.exec(ownerId);
  if (!match) return null;
  const pid = Number(match[1]);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** True when the PID exists (or exists but is owned by another user). */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we may not signal it.
    return (err as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

/**
 * True when the owner should be treated as alive. Unknown/absent owners
 * are conservatively alive (no reclaim); a parsed PID is probed.
 */
export function isOwnerAlive(ownerId: string | undefined | null): boolean {
  const pid = parseOwnerPid(ownerId);
  if (pid === null) return true;
  return isPidAlive(pid);
}
