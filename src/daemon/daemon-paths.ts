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
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { DaemonTaskRecord } from "./task-registry.js";

/** Canonical global location of the daemon task registry (writer + readers). */
export function resolveDaemonTasksPath(): string {
  return join(homedir(), ".alix", "daemon-tasks.json");
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
