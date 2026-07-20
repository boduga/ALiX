/**
 * Session reconstruction for resume — loads persisted state from a prior session
 * and returns it in a form the agent loop can use.
 */
import { join, resolve } from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { NormalizedMessage } from "../providers/types.js";
import { loadMessages, loadScope, loadState } from "./persist.js";
import type { ScopeSnapshot } from "../autonomy/scope-tracker.js";
import type { StateSnapshot } from "../autonomy/state-machine.js";

export type SessionInfo = {
  sessionId: string;
  task: string;
  status: "completed" | "interrupted" | "in_progress" | "cancelled";
  iterations: number;
  repairs: number;
  fileChanges: number;
  shellCommands: number;
  createdAt: string;
  updatedAt: string;
  provider: string;
  model: string;
};

export type ReconstructedSession = {
  sessionId: string;
  sessionDir: string;
  messages: NormalizedMessage[];
  scopeSnapshot: ScopeSnapshot | null;
  stateSnapshot: StateSnapshot | null;
  planContent: string | null;
  completed: boolean;
};

const SESSIONS_DIR = ".alix/sessions";

/**
 * List all sessions in a project, newest first.
 */
export async function listSessions(cwd: string, limit = 20): Promise<SessionInfo[]> {
  const sessionsPath = join(cwd, SESSIONS_DIR);
  if (!existsSync(sessionsPath)) return [];

  const entries = await readdir(sessionsPath, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory());

  // Accept UUID-style directories (hex with hyphens) and TUI sessions (tui-<timestamp>)
  const validSessionDir = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|tui-\d+)$/i;
  const filteredDirs = dirs.filter(d => validSessionDir.test(d.name));

  const sessions: SessionInfo[] = [];

  for (const dir of filteredDirs) {
    try {
      const info = await sessionInfo(cwd, dir.name);
      if (info) sessions.push(info);
    } catch {
      // Skip corrupted session directories
    }
  }

  // NaN-safe sort: sessions with valid dates come first (newest),
  // sessions with missing/invalid dates sort to the end.
  const safeTime = (d: string) => { const t = new Date(d).getTime(); return Number.isFinite(t) ? t : 0; };
  return sessions
    .sort((a, b) => safeTime(b.createdAt) - safeTime(a.createdAt))
    .slice(0, limit);
}

/**
 * Get metadata for a single session.
 */
export async function sessionInfo(cwd: string, sessionId: string): Promise<SessionInfo | null> {
  const sessionDir = join(cwd, SESSIONS_DIR, sessionId);
  if (!existsSync(sessionDir)) return null;

  // Try to load persisted state
  const state = await loadState(sessionDir);
  const messages = await loadMessages(sessionDir);
  const eventsPath = join(sessionDir, "events.jsonl");

  // Extract first user message as task
  const firstUserMsg = messages.find(m => m.role === "user");
  const task = firstUserMsg
    ? (typeof firstUserMsg.content === "string" ? firstUserMsg.content.slice(0, 120) : "(file content)")
    : "(unknown task)";

  // Determine status from events
  let status: SessionInfo["status"] = "in_progress";
  let createdAt = "";
  let updatedAt = "";

  // Fall back to directory mtime when no events file exists (e.g. empty TUI sessions)
  if (!existsSync(eventsPath)) {
    try {
      const dirStat = await stat(sessionDir);
      createdAt = dirStat.mtime.toISOString();
      updatedAt = dirStat.mtime.toISOString();
    } catch { /* stat failed — keep defaults */ }
  } else {
    const raw = await readFile(eventsPath, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const ev = JSON.parse(line);
        if (ev.type === "session.started") {
          createdAt = ev.timestamp ?? createdAt;
        }
        if (ev.type === "session.ended") {
          const reason = ev.payload?.reason;
          if (reason === "completed") status = "completed";
          else if (reason === "rejected" || reason === "cancelled") status = "cancelled";
          else status = "interrupted";
        }
        updatedAt = ev.timestamp ?? updatedAt;
      } catch { /* skip malformed lines */ }
    }
  }

  // If no session.ended event but state exists, infer from state
  if (status === "in_progress" && state) {
    if (state.state === "stopped") {
      status = state.counters.iterations > 0 ? "interrupted" : "cancelled";
    }
  }

  const counters = state?.counters;

  return {
    sessionId,
    task,
    status,
    iterations: counters?.iterations ?? 0,
    repairs: counters?.repairs ?? 0,
    fileChanges: counters?.fileChanges ?? 0,
    shellCommands: counters?.shellCommands ?? 0,
    createdAt,
    updatedAt,
    provider: "",
    model: "",
  };
}

/**
 * Full reconstruction of a prior session for resume.
 * Loads messages, scope, state, and plan from disk.
 */
export async function reconstructSession(
  cwd: string,
  sessionId: string
): Promise<ReconstructedSession> {
  const sessionDir = join(cwd, SESSIONS_DIR, sessionId);

  if (!existsSync(sessionDir)) {
    throw new Error(`Session not found: ${sessionId} (${sessionDir})`);
  }

  const [messages, scopeSnapshot, stateSnapshot] = await Promise.all([
    loadMessages(sessionDir),
    loadScope(sessionDir),
    loadState(sessionDir),
  ]);

  // Load plan if it exists
  let planContent: string | null = null;
  const planPath = join(cwd, ".alix", "plans", `${sessionId}.md`);
  if (existsSync(planPath)) {
    planContent = await readFile(planPath, "utf-8");
  }

  // Determine if session was completed from state or events
  let completed = false;
  if (stateSnapshot?.state === "stopped" && stateSnapshot.counters.iterations > 0) {
    // Check events for completed reason
    const eventsPath = join(sessionDir, "events.jsonl");
    if (existsSync(eventsPath)) {
      const raw = await readFile(eventsPath, "utf-8");
      const lines = raw.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const ev = JSON.parse(line);
          if (ev.type === "session.ended" && ev.payload?.reason === "completed") {
            completed = true;
            break;
          }
        } catch { /* skip */ }
      }
    }
  }

  return {
    sessionId,
    sessionDir,
    messages,
    scopeSnapshot,
    stateSnapshot,
    planContent,
    completed,
  };
}
