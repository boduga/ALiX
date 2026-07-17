// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * SessionStore — pluggable session persistence interface for AgentSession.
 *
 * Per spec (`docs/specs/run-chat-spec.md` §4), persistence is an external
 * concern. The AgentSession runtime owns state but delegates durability
 * to a `SessionStore` implementation. The default implementation is
 * `JsonlSessionStore` (file-backed JSON snapshot + JSONL messages),
 * but the interface allows for SQLite, remote storage, in-memory, etc.
 *
 * @module agent-session-store
 */

import type { NormalizedMessage, ToolCall } from "../providers/types.js";
import type { ToolExecution } from "./session.js";

/**
 * Persisted session snapshot — everything needed to reconstruct a session.
 *
 * All fields are required unless explicitly optional. `scopeSnapshot` and
 * `stateSnapshot` are typed as `unknown` because they originate from the
 * autonomy layer (ScopeTracker / TaskStateMachine) which is consumed opaquely
 * at this layer; callers narrow them on read.
 */
export interface SessionSnapshot {
  readonly sessionId: string;
  readonly task: string;
  readonly sessionMode: "auto" | "ask" | "bypass";
  readonly messages: readonly NormalizedMessage[];
  readonly toolHistory: readonly ToolExecution[];
  readonly turnCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly scopeSnapshot?: unknown;
  readonly stateSnapshot?: unknown;
  readonly completed?: boolean;
}

/**
 * Compact summary of a persisted session, used for `list()` enumeration.
 */
export interface SessionInfo {
  readonly sessionId: string;
  readonly task: string;
  readonly updatedAt: string;
  readonly turnCount: number;
}

/**
 * Pluggable session persistence. Implementations: JSONL (default), SQLite,
 * remote, in-memory. All methods must be safe to call concurrently from a
 * single AgentSession (no cross-session coordination required).
 *
 * `save()` is idempotent — overwrites prior save for the same sessionId.
 * `load()` returns `null` if the session does not exist (not an error).
 * `list()` returns sessions newest-first by `updatedAt`.
 */
export interface SessionStore {
  /** Persist current session state. Idempotent — overwrites prior save. */
  save(snapshot: SessionSnapshot): Promise<void>;
  /** Load a prior session. Returns null if not found. */
  load(sessionId: string): Promise<SessionSnapshot | null>;
  /** List available sessions, newest first. */
  list(limit?: number): Promise<readonly SessionInfo[]>;
}

/**
 * Re-exported ToolCall for convenience — not all callers need to import
 * from `../providers/types.js` directly.
 */
export type { ToolCall };
