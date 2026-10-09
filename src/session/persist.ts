/**
 * Session state persistence — saves messages, scope, and state machine counters
 * to the session directory for crash-resilient resume.
 *
 * All operations are append-only (messages) or atomic-write (scope/state JSON).
 */
import { mkdir, writeFile, readFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import type { NormalizedMessage } from "../providers/types.js";
import type { ScopeSnapshot } from "../autonomy/scope-tracker.js";
import type { StateSnapshot } from "../autonomy/state-machine.js";
import { getSharedLedger, appendFact, currentEntityVersion } from "../storage/runtime-ledger.js";

const MESSAGES_FILE = "messages.jsonl";
const SCOPE_FILE = "scope.json";
const STATE_FILE = "state.json";

/** Ledger event vocabulary for the session-persistence domain (R2.18). */
export const SESSION_LEDGER_EVENT_TYPES = [
  "session.message_appended",
  "session.scope_saved",
  "session.state_saved",
] as const;

/**
 * Ledger entity ids for the session domain. Kept here (not inline at each
 * call site) so persist and the reconciler cannot drift.
 */
export function sessionMessageEntityId(sessionId: string, index: number): string {
  return `${sessionId}#msg-${index}`;
}
export function sessionScopeEntityId(sessionId: string): string {
  return `scope:${sessionId}`;
}
export function sessionStateEntityId(sessionId: string): string {
  return `state:${sessionId}`;
}

// ─── R2.18 dual-write status (per workspace root) ─────────────────────
type SessionLedgerStatus = { appends: number; failures: number; projectionFailures: number; lastError?: string; lastProjectionError?: string };
const statusByRoot = new Map<string, SessionLedgerStatus>();

function statusFor(root: string): SessionLedgerStatus {
  let s = statusByRoot.get(root);
  if (!s) {
    s = { appends: 0, failures: 0, projectionFailures: 0 };
    statusByRoot.set(root, s);
  }
  return s;
}

/** Observable authority health (R2: failures must never be silent). */
export function sessionLedgerStatus(root: string): SessionLedgerStatus {
  const s = statusFor(root);
  return {
    ...s,
    ...(s.lastError !== undefined ? { lastError: s.lastError } : {}),
    ...(s.lastProjectionError !== undefined ? { lastProjectionError: s.lastProjectionError } : {}),
  };
}

/** Reset counters (tests). */
export function resetSessionLedgerStatus(root: string): void {
  statusByRoot.delete(root);
}

/** Workspace root implied by `<root>/.alix/sessions/<sessionId>`. */
function ledgerRootFor(sessionDir: string): string {
  const parts = sessionDir.split(/[\\/]/);
  const alixIdx = parts.lastIndexOf(".alix");
  if (alixIdx > 0) return parts.slice(0, alixIdx).join("/");
  return sessionDir;
}

function sessionIdOf(sessionDir: string): string {
  return basename(sessionDir);
}

/**
 * Append one session fact — THE COMMIT (ledger is authoritative). Failure
 * counts, then THROWS. Duplicate entity versions (immutable message index /
 * idempotent retry) are an accepted no-op skip.
 */
function appendSessionFact(
  sessionDir: string,
  entityType: "sessionMessage" | "sessionScope" | "sessionState",
  entityId: string,
  eventType: (typeof SESSION_LEDGER_EVENT_TYPES)[number],
  payload: Record<string, unknown>,
  occurredAt: string,
): void {
  const root = ledgerRootFor(sessionDir);
  const s = statusFor(root);
  const expected = currentEntityVersion(root, s, entityId);
  if (expected > 0 && entityType === "sessionMessage") return; // immutable index — already mirrored
  appendFact(root, s, {
    eventType,
    entityType,
    entityId,
    payload,
    correlationId: entityId,
    sessionId: sessionIdOf(sessionDir),
    actor: { type: "system", id: "session-persist" },
    occurredAt,
    expectedVersion: expected,
    errorLabel: "session ledger",
  });
}

function countProjectionFailure(sessionDir: string, err: unknown): void {
  const s = statusFor(ledgerRootFor(sessionDir));
  s.projectionFailures += 1;
  s.lastProjectionError = err instanceof Error ? err.message : String(err);
}

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * Append messages to messages.jsonl.
 * Only new messages (beyond the last saved count) are appended.
 * Returns the number of messages now saved.
 */
export async function saveMessages(
  sessionDir: string,
  messages: NormalizedMessage[],
  lastSavedCount: number = 0
): Promise<number> {
  const unsaved = messages.slice(lastSavedCount);
  if (unsaved.length === 0) return messages.length;

  // R2.18 authority: each new message's fact is the commit (index is part
  // of the entity id, so retries of the same index are idempotent skips);
  // the JSONL append is a tolerated projection.
  const sessionId = sessionIdOf(sessionDir);
  unsaved.forEach((m, i) => {
    const index = lastSavedCount + i;
    appendSessionFact(
      sessionDir,
      "sessionMessage",
      sessionMessageEntityId(sessionId, index),
      "session.message_appended",
      { message: m, index, sessionId },
      new Date().toISOString(),
    );
  });

  try {
    await ensureDir(sessionDir);
    const filePath = join(sessionDir, MESSAGES_FILE);
    const lines = unsaved.map(m => JSON.stringify(m) + "\n").join("");
    await appendFile(filePath, lines, "utf-8");
  } catch (err) {
    countProjectionFailure(sessionDir, err);
  }
  return messages.length;
}

/**
 * Save scope snapshot to scope.json (atomically via writeFile).
 */
export async function saveScope(
  sessionDir: string,
  scope: ScopeSnapshot
): Promise<void> {
  // R2.18 authority: fact first, projection tolerated.
  appendSessionFact(
    sessionDir,
    "sessionScope",
    sessionScopeEntityId(sessionIdOf(sessionDir)),
    "session.scope_saved",
    { scope, sessionId: sessionIdOf(sessionDir) },
    new Date().toISOString(),
  );
  try {
    await ensureDir(sessionDir);
    await writeFile(
      join(sessionDir, SCOPE_FILE),
      JSON.stringify(scope, null, 2) + "\n",
      "utf-8"
    );
  } catch (err) {
    countProjectionFailure(sessionDir, err);
  }
}

/**
 * Save state machine snapshot to state.json.
 */
export async function saveState(
  sessionDir: string,
  state: StateSnapshot
): Promise<void> {
  // R2.18 authority: fact first, projection tolerated.
  appendSessionFact(
    sessionDir,
    "sessionState",
    sessionStateEntityId(sessionIdOf(sessionDir)),
    "session.state_saved",
    { state, sessionId: sessionIdOf(sessionDir) },
    new Date().toISOString(),
  );
  try {
    await ensureDir(sessionDir);
    await writeFile(
      join(sessionDir, STATE_FILE),
      JSON.stringify(state, null, 2) + "\n",
      "utf-8"
    );
  } catch (err) {
    countProjectionFailure(sessionDir, err);
  }
}

/**
 * Batch-save all three artifacts.
 */
export async function saveSessionState(
  sessionDir: string,
  state: { messages: NormalizedMessage[]; scope?: ScopeSnapshot; stateMachine?: StateSnapshot }
): Promise<void> {
  await Promise.all([
    saveMessages(sessionDir, state.messages),
    state.scope ? saveScope(sessionDir, state.scope) : Promise.resolve(),
    state.stateMachine ? saveState(sessionDir, state.stateMachine) : Promise.resolve(),
  ]);
}

/**
 * Load the full messages array from messages.jsonl.
 * Returns [] if the file doesn't exist.
 */
/**
 * R2.18 authority read: message facts in ledger-seq order, merged with
 * legacy file lines that have no ledger facts (index-keyed; ledger wins).
 * Ledger db errors count and THROW — never masked by a file fallback.
 */
export async function loadMessages(sessionDir: string): Promise<NormalizedMessage[]> {
  const root = ledgerRootFor(sessionDir);
  const sessionId = sessionIdOf(sessionDir);
  let rows: Array<{ entityId: string; payload: unknown }>;
  try {
    const ledger = getSharedLedger(root);
    const collected: typeof rows = [];
    let cursor = 0;
    for (let page = 0; page < 50; page++) {
      const batch = ledger.readEvents({ sinceSeq: cursor, limit: 2000 });
      for (const r of batch) {
        if (r.entityType === "sessionMessage" && r.sessionId === sessionId) {
          collected.push({ entityId: r.entityId, payload: r.payload });
        }
        cursor = r.ledgerSeq;
      }
      if (batch.length < 2000) break;
    }
    rows = collected;
  } catch (err) {
    const s = statusFor(root);
    s.failures += 1;
    s.lastError = err instanceof Error ? err.message : String(err);
    throw err;
  }

  const byIndex = new Map<number, NormalizedMessage>();
  for (const row of rows) {
    const payload = row.payload as { message?: NormalizedMessage; index?: number } | null;
    if (!payload?.message || typeof payload.index !== "number") {
      throw new Error(`session ledger event for ${row.entityId} missing message payload`);
    }
    byIndex.set(payload.index, payload.message);
  }

  // Legacy file lines (no ledger facts) fill the gaps; ledger wins on overlap.
  const filePath = join(sessionDir, MESSAGES_FILE);
  if (existsSync(filePath)) {
    try {
      const raw = await readFile(filePath, "utf-8");
      const lines = raw.split("\n").filter(Boolean);
      lines.forEach((l, i) => {
        if (!byIndex.has(i)) byIndex.set(i, JSON.parse(l) as NormalizedMessage);
      });
    } catch {
      // corrupt projection — ledger view still applies
    }
  }

  return [...byIndex.keys()].sort((a, b) => a - b).map(i => byIndex.get(i)!);
}

/**
 * Load scope snapshot from scope.json.
 * Returns null if the file doesn't exist.
 */
/** R2.18 authority read: latest scope fact; file only for legacy sessions. */
export async function loadScope(sessionDir: string): Promise<ScopeSnapshot | null> {
  const root = ledgerRootFor(sessionDir);
  const entityId = `scope:${sessionIdOf(sessionDir)}`;
  try {
    const last = getSharedLedger(root).lastEvent(entityId, "sessionScope");
    if (last) {
      const payload = last.payload as { scope?: ScopeSnapshot } | null;
      if (!payload?.scope) throw new Error(`session ledger event for ${entityId} missing scope payload`);
      return payload.scope;
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("missing scope payload")) throw err;
    const s = statusFor(root);
    s.failures += 1;
    s.lastError = err instanceof Error ? err.message : String(err);
    throw err;
  }
  const filePath = join(sessionDir, SCOPE_FILE);
  if (!existsSync(filePath)) return null;
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as ScopeSnapshot;
}

/**
 * Load state snapshot from state.json.
 * Returns null if the file doesn't exist.
 */
/** R2.18 authority read: latest state-machine fact; file only for legacy sessions. */
export async function loadState(sessionDir: string): Promise<StateSnapshot | null> {
  const root = ledgerRootFor(sessionDir);
  const entityId = `state:${sessionIdOf(sessionDir)}`;
  try {
    const last = getSharedLedger(root).lastEvent(entityId, "sessionState");
    if (last) {
      const payload = last.payload as { state?: StateSnapshot } | null;
      if (!payload?.state) throw new Error(`session ledger event for ${entityId} missing state payload`);
      return payload.state;
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("missing state payload")) throw err;
    const s = statusFor(root);
    s.failures += 1;
    s.lastError = err instanceof Error ? err.message : String(err);
    throw err;
  }
  const filePath = join(sessionDir, STATE_FILE);
  if (!existsSync(filePath)) return null;
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as StateSnapshot;
}

/**
 * Count the number of messages currently saved in messages.jsonl.
 */
/** R2.18: count reflects AUTHORITY (ledger facts ∪ legacy file lines). */
export async function countSavedMessages(sessionDir: string): Promise<number> {
  const root = ledgerRootFor(sessionDir);
  const sessionId = sessionIdOf(sessionDir);
  let ledgerCount = 0;
  try {
    const ledger = getSharedLedger(root);
    let cursor = 0;
    for (let page = 0; page < 50; page++) {
      const batch = ledger.readEvents({ sinceSeq: cursor, limit: 2000 });
      for (const r of batch) {
        if (r.entityType === "sessionMessage" && r.sessionId === sessionId) ledgerCount += 1;
        cursor = r.ledgerSeq;
      }
      if (batch.length < 2000) break;
    }
  } catch (err) {
    const s = statusFor(root);
    s.failures += 1;
    s.lastError = err instanceof Error ? err.message : String(err);
    throw err;
  }
  const filePath = join(sessionDir, MESSAGES_FILE);
  if (!existsSync(filePath)) return ledgerCount;
  try {
    const raw = await readFile(filePath, "utf-8");
    const fileCount = raw.split("\n").filter(Boolean).length;
    return Math.max(fileCount, ledgerCount);
  } catch {
    return ledgerCount;
  }
}
