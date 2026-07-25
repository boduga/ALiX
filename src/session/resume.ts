/**
 * Session reconstruction for resume — loads persisted state from a prior session
 * and returns it in a form the agent loop can use.
 *
 * Task 6 (action-based routing): on resume, attempt to load the structured
 * `.tasks.json` sidecar (written by `runPlanPhase`). When the sidecar is
 * missing, malformed, or fails schema-version validation, fall back to
 * `parsePlanTasks(planContent, sessionId)` so resume never fails due to a
 * sidecar issue.
 */
import { join } from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { NormalizedMessage } from "../providers/types.js";
import { loadMessages, loadScope, loadState } from "./persist.js";
import type { ScopeSnapshot } from "../autonomy/scope-tracker.js";
import type { StateSnapshot } from "../autonomy/state-machine.js";
import {
  parsePlanTasks,
  type PlanTask,
  type PlanTaskList,
  type PlanTaskStatus,
} from "../planning/plan-task.js";

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
  /**
   * Structured plan tasks restored from the `.tasks.json` sidecar when
   * present + valid (schemaVersion === 1). When the sidecar is missing,
   * malformed, or has an unrecognised schema, this is populated from
   * `parsePlanTasks(planContent, sessionId)` instead. May be `undefined`
   * when no plan content is available either.
   */
  planTasks?: readonly PlanTask[];
  completed: boolean;
};

const SESSIONS_DIR = ".alix/sessions";
const TASKS_SIDECAR_SCHEMA_VERSION = 1 as const;
const PLAN_STATUSES: ReadonlySet<PlanTaskStatus> = new Set([
  "pending",
  "in_progress",
  "completed",
  "skipped",
]);

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
 * Validate a parsed sidecar object matches the expected schema.
 *
 * Pure / no I/O. Returns true when the sidecar can be trusted as-is; false
 * for malformed input (missing fields, wrong types, unsupported version).
 *
 * The check is intentionally structural — we don't accept an unknown
 * `schemaVersion` so future migrations are explicit (bump the constant +
 * add a reader that tolerates both versions).
 */
export function isValidTasksSidecar(value: unknown): value is PlanTaskList {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.schemaVersion !== TASKS_SIDECAR_SCHEMA_VERSION) return false;
  if (typeof v.sessionId !== "string" || v.sessionId.length === 0) return false;
  if (typeof v.summary !== "string") return false;
  if (!Array.isArray(v.tasks)) return false;
  for (const task of v.tasks) {
    if (!task || typeof task !== "object") return false;
    const t = task as Record<string, unknown>;
    if (typeof t.id !== "string" || t.id.length === 0) return false;
    if (typeof t.index !== "number" || !Number.isInteger(t.index)) return false;
    if (typeof t.title !== "string" || t.title.length === 0) return false;
    if (typeof t.status !== "string" || !PLAN_STATUSES.has(t.status as PlanTaskStatus)) return false;
    if (t.detail !== undefined && typeof t.detail !== "string") return false;
  }
  return true;
}

/**
 * Load + validate the `.tasks.json` sidecar for a session. Returns the
 * parsed `PlanTaskList` when valid; `null` when the sidecar is missing,
 * malformed, or fails schema validation.
 *
 * Pure I/O wrapper around `isValidTasksSidecar`. Read errors (other than
 * ENOENT) are treated as "missing" — resume must never fail because of a
 * sidecar problem.
 */
async function loadTasksSidecar(planDir: string, sessionId: string): Promise<PlanTaskList | null> {
  const sidecarPath = join(planDir, `${sessionId}.tasks.json`);
  if (!existsSync(sidecarPath)) return null;
  let raw: string;
  try {
    raw = await readFile(sidecarPath, "utf-8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isValidTasksSidecar(parsed)) return null;
  return parsed;
}

/**
 * Resolve plan tasks for a resumed session.
 *
 * Order:
 *   1. Valid `.tasks.json` sidecar → return its tasks verbatim.
 *   2. Plan markdown present → fall back to `parsePlanTasks(planContent, sessionId)`.
 *   3. No plan at all → return `undefined`.
 *
 * Never throws. The brief requires resume to succeed even when the sidecar
 * is missing/malformed/schema-incompatible.
 */
async function resolvePlanTasks(
  cwd: string,
  sessionId: string,
  planContent: string | null,
): Promise<readonly PlanTask[] | undefined> {
  const planDir = join(cwd, ".alix", "plans");
  const sidecar = await loadTasksSidecar(planDir, sessionId);
  if (sidecar) return sidecar.tasks;
  if (planContent && planContent.length > 0) {
    return parsePlanTasks(planContent, sessionId);
  }
  return undefined;
}

/**
 * Full reconstruction of a prior session for resume.
 * Loads messages, scope, state, plan, and structured plan tasks from disk.
 *
 * Task 6: `planTasks` is now exposed on the result. When the
 * `.tasks.json` sidecar is missing, malformed, or schema-incompatible,
 * we fall back to `parsePlanTasks(planContent, sessionId)` so resume
 * never fails due to sidecar problems. If neither sidecar nor plan
 * content exists, `planTasks` is `undefined`.
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

  // Restore structured plan tasks: sidecar first, markdown fallback,
  // never throw. See `resolvePlanTasks` for full policy.
  const planTasks = await resolvePlanTasks(cwd, sessionId, planContent);

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
    planTasks,
    completed,
  };
}
