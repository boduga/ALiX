/**
 * workspace-registry.ts — File-backed workspace activity registry.
 *
 * Auto-populated by the daemon on each run request.  Lives at
 * ~/.alix/workspaces.json alongside daemon.json and daemon-tasks.json.
 *
 * Atomic writes via .tmp + rename to prevent corruption.
 * Stale entries (older than 24h) are marked "idle" on each write.
 */

import { readFile, writeFile, rename } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";

export type WorkspaceStatus = "active" | "idle";

export type WorkspaceEntry = {
  path: string;
  name: string;
  lastUsed: string; // ISO timestamp
  taskCount: number;
  status: WorkspaceStatus;
};

function workspacesPath(): string {
  return join(homedir(), ".alix", "workspaces.json");
}

/** Load workspaces from disk.  Returns [] on any error (missing file, parse error, or non-array). */
export async function listWorkspaces(): Promise<WorkspaceEntry[]> {
  try {
    const raw = await readFile(workspacesPath(), "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Find a single workspace by its path. */
export async function getWorkspace(path: string): Promise<WorkspaceEntry | undefined> {
  const workspaces = await listWorkspaces();
  return workspaces.find(w => w.path === path);
}

/**
 * Record activity for a project directory.
 *
 * - Upserts the entry for `cwd`
 * - Increments taskCount
 * - Sets status to "active"
 * - Sweeps entries older than 24h to "idle"
 * - Sorts by lastUsed descending
 * - Writes atomically via .tmp + rename
 */
export async function recordWorkspaceActivity(cwd: string): Promise<void> {
  const workspaces = await listWorkspaces();
  const now = new Date().toISOString();
  const name = basename(cwd);
  const idx = workspaces.findIndex(w => w.path === cwd);

  if (idx >= 0) {
    // Update existing entry
    workspaces[idx] = {
      ...workspaces[idx],
      name,
      lastUsed: now,
      taskCount: workspaces[idx].taskCount + 1,
      status: "active",
    };
  } else {
    // Create new entry
    workspaces.push({
      path: cwd,
      name,
      lastUsed: now,
      taskCount: 1,
      status: "active",
    });
  }

  // Mark workspaces older than 24h as idle
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const w of workspaces) {
    if (new Date(w.lastUsed).getTime() < cutoff) {
      w.status = "idle";
    }
  }

  // Sort by lastUsed descending
  workspaces.sort((a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime());

  // Atomic write via .tmp + rename
  const tmp = workspacesPath() + ".tmp";
  await writeFile(tmp, JSON.stringify(workspaces, null, 2), "utf-8");
  await rename(tmp, workspacesPath());
}
