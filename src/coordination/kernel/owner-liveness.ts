/**
 * owner-liveness.ts — Worker/execution-owner liveness (R3.3: ONE module).
 *
 * Owns BOTH liveness signals and the single reclaim verdict:
 * 1. PID probe — coordination schedulers tag workers with an
 *    `executionOwnerId` of the form `<kind>-<pid>` (web/tool/cli/daemon).
 *    When a host process dies mid-run, its workers stay `running` with a
 *    dead owner. Unparseable owners (e.g. a named daemon) report alive:
 *    we must never steal a run from a host we cannot prove is dead.
 * 2. Heartbeat staleness — a worker with NO owner is only reclaimable once
 *    its heartbeat exceeds the orphan threshold (missing heartbeat is no
 *    evidence and never proves staleness).
 *
 * `shouldReclaimWorker` is the ONE verdict reconciliation, resume, and
 * dead-host sweeps share. Before R3.3 these lived in two places with
 * disagreeing rules (reconciliation reclaimed any different-owner worker on
 * a stale heartbeat; resume required a provably dead PID) — the contradiction
 * let a live-but-slow foreign host be stolen from while ownerless stranded
 * workers were never reclaimed.
 */

const OWNER_PATTERN = /^(?:web|tool|cli|daemon)-(\d+)$/;

/** Default stale-heartbeat window for worker reclaim decisions. */
export const DEFAULT_ORPHAN_THRESHOLD_MS = 90_000;

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

/**
 * True when the worker's heartbeat is older than `thresholdMs`.
 * Missing or unparseable timestamps are NOT stale — absence of evidence
 * never justifies reclaiming.
 */
export function heartbeatStale(
  lastHeartbeatAt: string | undefined | null,
  thresholdMs: number,
  now: Date = new Date(),
): boolean {
  if (!lastHeartbeatAt) return false;
  const at = Date.parse(lastHeartbeatAt);
  if (!Number.isFinite(at)) return false;
  return now.getTime() - at > thresholdMs;
}

export type WorkerLivenessQuery = {
  status: string;
  lastHeartbeatAt?: string | null;
  executionOwnerId?: string | null;
  locallyActive?: boolean;
  orphanThresholdMs: number;
  now?: Date;
};

/**
 * The single worker-reclaim verdict (R3.3):
 * - never anything but a `running` worker;
 * - never a locally active execution (its own host is working on it);
 * - an OWNERED worker is reclaimable only when its owner is PROVABLY dead
 *   (PID probe; unknown/named owners read alive — never steal);
 * - an OWNERLESS worker is reclaimable only on a stale heartbeat.
 */
export function shouldReclaimWorker(query: WorkerLivenessQuery): boolean {
  if (query.status !== "running") return false;
  if (query.locallyActive) return false;
  if (query.executionOwnerId) return !isOwnerAlive(query.executionOwnerId);
  return heartbeatStale(query.lastHeartbeatAt, query.orphanThresholdMs, query.now);
}
