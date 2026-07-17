// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * JsonlSessionStore — file-backed SessionStore implementation.
 *
 * Layout (per session, rooted at `rootDir`):
 *   <rootDir>/<sessionId>/snapshot.json  — atomic-write full snapshot
 *   <rootDir>/<sessionId>/messages.jsonl — append-only message log
 *
 * The snapshot.json is the authoritative source for `load()` and `list()`.
 * messages.jsonl is an append-only audit trail for crash-resilient resume
 * (compatible with `src/session/persist.ts` consumers).
 *
 * All writes use the atomic-write-temp-then-rename pattern: write to a
 * `.tmp` file and `rename()` into place. POSIX rename is atomic, so a
 * crash mid-write leaves either the prior snapshot intact or the new one
 * fully written — never a half-written file.
 *
 * @module agent-session-store-jsonl
 */

import { existsSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type {
  SessionSnapshot,
  SessionInfo,
  SessionStore,
} from "./session-store.js";

const SNAPSHOT_FILE = "snapshot.json";
const MESSAGES_FILE = "messages.jsonl";
const TMP_SUFFIX = ".tmp";

/**
 * Strip volatile fields before serialising. The snapshot itself stores
 * `messages` and `toolHistory` inline (snapshot.json is authoritative),
 * but messages.jsonl is kept in sync as an append-only audit log.
 */
export class JsonlSessionStore implements SessionStore {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  /**
   * Get the directory in which this session's files live.
   * Exposed for tests and debugging.
   */
  sessionDir(sessionId: string): string {
    return join(this.rootDir, sessionId);
  }

  /**
   * Get the root directory for all sessions.
   */
  getRootDir(): string {
    return this.rootDir;
  }

  async save(snapshot: SessionSnapshot): Promise<void> {
    const dir = this.sessionDir(snapshot.sessionId);
    await mkdir(dir, { recursive: true });

    // Serialise snapshot deterministically. Date objects would already be
    // ISO strings by contract (see SessionSnapshot), but we guard against
    // accidental Date instances by re-stringifying any Date we encounter.
    const serialisable = serialiseSnapshot(snapshot);
    const json = JSON.stringify(serialisable, null, 2) + "\n";

    // Atomic write: tmp file then rename. POSIX rename is atomic, so a
    // crash mid-write cannot leave snapshot.json half-written.
    const snapshotPath = join(dir, SNAPSHOT_FILE);
    const tmpPath = snapshotPath + TMP_SUFFIX;
    await writeFile(tmpPath, json, "utf-8");
    await rename(tmpPath, snapshotPath);

    // Append any messages beyond what is already on disk to messages.jsonl.
    // We track the "last saved" count via a sidecar file to keep this
    // idempotent across multiple save() calls within a single session.
    await this.appendMessages(dir, snapshot.messages);
  }

  async load(sessionId: string): Promise<SessionSnapshot | null> {
    const snapshotPath = join(this.sessionDir(sessionId), SNAPSHOT_FILE);
    if (!existsSync(snapshotPath)) return null;
    const raw = await readFile(snapshotPath, "utf-8");
    try {
      const parsed = JSON.parse(raw) as SessionSnapshot;
      return parsed;
    } catch {
      // Corrupt snapshot — treat as not-found rather than throwing.
      return null;
    }
  }

  async list(limit: number = 20): Promise<readonly SessionInfo[]> {
    if (!existsSync(this.rootDir)) return [];
    const entries = await readdir(this.rootDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());

    const infos: SessionInfo[] = [];
    for (const dir of dirs) {
      const snapshotPath = join(this.rootDir, dir.name, SNAPSHOT_FILE);
      if (!existsSync(snapshotPath)) continue;
      try {
        const raw = await readFile(snapshotPath, "utf-8");
        const snap = JSON.parse(raw) as SessionSnapshot;
        infos.push({
          sessionId: snap.sessionId,
          task: snap.task,
          updatedAt: snap.updatedAt,
          turnCount: snap.turnCount,
        });
      } catch {
        // Skip corrupt entries — they're surfaced via load() = null, not list().
      }
    }

    infos.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return infos.slice(0, Math.max(0, limit));
  }

  /**
   * Append messages to messages.jsonl, skipping any that are already on disk.
   * Tracks the "last saved count" via `<dir>/.lastMessageCount`.
   */
  private async appendMessages(
    dir: string,
    messages: readonly unknown[],
  ): Promise<void> {
    const messagesPath = join(dir, MESSAGES_FILE);
    const cursorPath = join(dir, ".lastMessageCount");

    let lastCount = 0;
    if (existsSync(cursorPath)) {
      try {
        lastCount = parseInt(await readFile(cursorPath, "utf-8"), 10);
        if (!Number.isFinite(lastCount) || lastCount < 0) lastCount = 0;
      } catch {
        lastCount = 0;
      }
    }

    const unsaved = messages.slice(lastCount);
    if (unsaved.length === 0) return;

    const lines = unsaved.map((m) => JSON.stringify(m) + "\n").join("");
    await writeFile(messagesPath, lines, { flag: "a", encoding: "utf-8" });
    await writeFile(cursorPath, String(messages.length), "utf-8");
  }
}

/**
 * Defensive serialisation: walk the snapshot and convert any `Date`
 * instance to an ISO string. The public contract guarantees ISO strings,
 * but we guard against accidental Date leakage from upstream callers.
 */
function serialiseSnapshot(snapshot: SessionSnapshot): SessionSnapshot {
  return {
    sessionId: String(snapshot.sessionId),
    task: String(snapshot.task),
    sessionMode: snapshot.sessionMode,
    messages: snapshot.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    toolHistory: snapshot.toolHistory.map((t) => ({
      toolName: t.toolName,
      args: t.args,
      result: t.result,
      error: t.error,
      timestamp: t.timestamp,
    })),
    turnCount: snapshot.turnCount,
    createdAt: toIso(snapshot.createdAt),
    updatedAt: toIso(snapshot.updatedAt),
    scopeSnapshot: snapshot.scopeSnapshot,
    stateSnapshot: snapshot.stateSnapshot,
    completed: snapshot.completed,
  };
}

function toIso(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  return value;
}
