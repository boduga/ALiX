/**
 * daemon-paths.ts — Canonical paths for global daemon state.
 *
 * The daemon is a single per-user background process: its pid file, status
 * file, and socket all live under ~/.alix (see daemon-manager.ts and
 * daemon-server.ts). Its task registry is therefore global too — every
 * record carries the submitting project's `cwd`, so one registry serves all
 * projects.
 *
 * Readers must resolve the global path, never <cwd>/.alix/daemon-tasks.json,
 * with a read fallback to the legacy project-scoped location for files
 * written before the registry was unified.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { DaemonTaskRecord } from "./task-registry.js";

/** Canonical global location of the daemon task registry (writer + readers). */
export function resolveDaemonTasksPath(): string {
  return join(homedir(), ".alix", "daemon-tasks.json");
}

/** True for a Windows named-pipe address (`\\.\pipe\...`). */
export function isNamedPipe(address: string): boolean {
  return address.startsWith("\\\\.\\pipe\\") || address.startsWith("//./pipe/");
}

/**
 * Canonical daemon socket address for the given alix dir (#732).
 *
 * POSIX: a Unix-domain-socket file at `<dir>/alixd.sock`.
 * Windows: a named pipe `\\.\pipe\alixd-<hash>` — Windows AF_UNIX file paths
 * are fragile (EACCES on bind, parent-dir/path-form issues) and the client's
 * `existsSync` pre-check cannot see a pipe. Hashing the absolute dir keeps
 * per-user/per-dir daemons distinct.
 */
export function resolveDaemonSocketAddress(
  dir: string,
  platform: string = process.platform,
): string {
  if (platform === "win32") {
    const hash = createHash("sha256").update(dir).digest("hex").slice(0, 16);
    return `\\\\.\\pipe\\alixd-${hash}`;
  }
  return join(dir, "alixd.sock");
}

/** Legacy project-scoped location (pre-unification writers). Read fallback only. */
export function resolveLegacyDaemonTasksPath(cwd: string): string {
  return join(cwd, ".alix", "daemon-tasks.json");
}

/**
 * Effective read path: the global registry when present, else the legacy
 * project-scoped file when that exists, else the global path (so callers
 * report "none" against the canonical location).
 */
export function resolveDaemonTasksReadPath(cwd: string): string {
  const globalPath = resolveDaemonTasksPath();
  if (existsSync(globalPath)) return globalPath;
  const legacyPath = resolveLegacyDaemonTasksPath(cwd);
  if (existsSync(legacyPath)) return legacyPath;
  return globalPath;
}

/**
 * Read and parse the registry, honouring the legacy fallback.
 * Returns null when no registry exists or it cannot be read/parsed.
 */
export async function readDaemonTasks(cwd: string): Promise<DaemonTaskRecord[] | null> {
  const tasksPath = resolveDaemonTasksReadPath(cwd);
  if (!existsSync(tasksPath)) return null;
  try {
    const raw = await readFile(tasksPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as DaemonTaskRecord[];
  } catch {
    return null;
  }
}
