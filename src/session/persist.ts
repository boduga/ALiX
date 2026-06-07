/**
 * Session state persistence — saves messages, scope, and state machine counters
 * to the session directory for crash-resilient resume.
 *
 * All operations are append-only (messages) or atomic-write (scope/state JSON).
 */
import { mkdir, writeFile, readFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { NormalizedMessage } from "../providers/types.js";
import type { ScopeSnapshot } from "../autonomy/scope-tracker.js";
import type { StateSnapshot } from "../autonomy/state-machine.js";

const MESSAGES_FILE = "messages.jsonl";
const SCOPE_FILE = "scope.json";
const STATE_FILE = "state.json";

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
  await ensureDir(sessionDir);
  const filePath = join(sessionDir, MESSAGES_FILE);
  const unsaved = messages.slice(lastSavedCount);
  if (unsaved.length === 0) return messages.length;

  const lines = unsaved.map(m => JSON.stringify(m) + "\n").join("");
  await appendFile(filePath, lines, "utf-8");
  return messages.length;
}

/**
 * Save scope snapshot to scope.json (atomically via writeFile).
 */
export async function saveScope(
  sessionDir: string,
  scope: ScopeSnapshot
): Promise<void> {
  await ensureDir(sessionDir);
  await writeFile(
    join(sessionDir, SCOPE_FILE),
    JSON.stringify(scope, null, 2) + "\n",
    "utf-8"
  );
}

/**
 * Save state machine snapshot to state.json.
 */
export async function saveState(
  sessionDir: string,
  state: StateSnapshot
): Promise<void> {
  await ensureDir(sessionDir);
  await writeFile(
    join(sessionDir, STATE_FILE),
    JSON.stringify(state, null, 2) + "\n",
    "utf-8"
  );
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
export async function loadMessages(sessionDir: string): Promise<NormalizedMessage[]> {
  const filePath = join(sessionDir, MESSAGES_FILE);
  if (!existsSync(filePath)) return [];
  const raw = await readFile(filePath, "utf-8");
  const lines = raw.split("\n").filter(Boolean);
  return lines.map(l => JSON.parse(l) as NormalizedMessage);
}

/**
 * Load scope snapshot from scope.json.
 * Returns null if the file doesn't exist.
 */
export async function loadScope(sessionDir: string): Promise<ScopeSnapshot | null> {
  const filePath = join(sessionDir, SCOPE_FILE);
  if (!existsSync(filePath)) return null;
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as ScopeSnapshot;
}

/**
 * Load state snapshot from state.json.
 * Returns null if the file doesn't exist.
 */
export async function loadState(sessionDir: string): Promise<StateSnapshot | null> {
  const filePath = join(sessionDir, STATE_FILE);
  if (!existsSync(filePath)) return null;
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as StateSnapshot;
}

/**
 * Count the number of messages currently saved in messages.jsonl.
 */
export async function countSavedMessages(sessionDir: string): Promise<number> {
  const filePath = join(sessionDir, MESSAGES_FILE);
  if (!existsSync(filePath)) return 0;
  const raw = await readFile(filePath, "utf-8");
  return raw.split("\n").filter(Boolean).length;
}
