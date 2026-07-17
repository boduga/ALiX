// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * REPL Renderer — interactive terminal session for `alix run --chat`.
 *
 * P3: Readline-based prompt loop that processes user input through
 * an AgentSession and displays results. Supports /exit, /quit, /save,
 * /resume, /sessions, and /status commands.
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { AgentSession, AgentTurnResult, AgentSessionEvents, AgentSessionState } from "../../agent/session.js";
import type { SessionStore } from "../../agent/session-store.js";

export interface AgentRenderer {
  start(): Promise<void>;
  render(result: AgentTurnResult): Promise<void>;
  stop(): Promise<void>;
}

export interface ReplRendererOptions {
  /** Session mode label for /status display (default: "auto"). */
  sessionMode?: string;
  /**
   * Optional session event subscription (spec §13). When provided, the
   * renderer uses this object to stream output to the terminal as the session
   * emits tokens, tool calls, and tool results.
   */
  events?: AgentSessionEvents;
  /**
   * Optional SessionStore reference so the REPL can list available sessions
   * (`/sessions`) and confirm resumable ids. When omitted, `/resume` and
   * `/sessions` are unavailable (the legacy in-memory stubs remain).
   */
  store?: SessionStore;
}

/**
 * Build a default `AgentSessionEvents` that renders to stdout. Used by the
 * REPL when the caller does not pass its own `events` object.
 */
export function createReplEvents(): AgentSessionEvents {
  return {
    onToken(token: string): void {
      // Tokens stream without newlines — the model output controls spacing.
      process.stdout.write(token);
    },
    onToolCall(call): void {
      console.log(`\n→ ${call.name}`);
    },
    onToolResult(result): void {
      if (result.isError) {
        console.log(`  ✗ ${result.content.split("\n")[0]}`);
      } else if (result.content) {
        console.log(`  ${result.content.split("\n")[0]}`);
      }
    },
  };
}

export function createReplRenderer(
  session: AgentSession,
  options?: ReplRendererOptions,
): AgentRenderer {
  const sessionMode = options?.sessionMode ?? "auto";
  // The renderer subscribes to its own events so multiple subscribers (e.g.
  // a logger and the renderer) can co-exist. We do not mutate the session
  // here — callers wire the same `events` object into `AgentSessionConfig`
  // when constructing the session.
  const events = options?.events ?? createReplEvents();
  let rl: readline.Interface | null = null;

  /** Print formatted session status. */
  function printStatus(state: AgentSessionState): void {
    console.log(`Session:  ${state.sessionId}`);
    console.log(`Turns:    ${state.turnCount}`);
    console.log(`Tools:    ${state.toolHistory.length}`);
    console.log(`Policy:   ${sessionMode}`);
    console.log(`Created:  ${state.createdAt}`);
  }

  const renderer: AgentRenderer = {
    async start(): Promise<void> {
      // terminal: true when stdin is a TTY (interactive), false for piped input
      rl = readline.createInterface({ input, output, terminal: input.isTTY ?? false });

      // Handle EOF (Ctrl+D) gracefully
      rl.on("close", () => {
        // The outer loop catches the question() rejection
      });

      try {
        loop: while (true) {
          let line: string;
          try {
            line = await rl.question("> ");
          } catch {
            // EOF (Ctrl+D) or interface closed
            break;
          }

          const trimmed = line.trim();
          if (trimmed === "") continue;

          // Built-in commands
          if (trimmed === "/exit" || trimmed === "/quit") {
            break loop;
          }
          if (trimmed === "/save") {
            try {
              await session.save();
              console.log("Saved.");
            } catch (err) {
              console.error("Save failed:", err);
            }
            continue;
          }
          if (trimmed === "/status") {
            const state = session.getState();
            printStatus(state);
            continue;
          }
          if (trimmed === "/sessions") {
            await handleSessionsCommand(options?.store);
            continue;
          }
          if (trimmed.startsWith("/resume")) {
            await handleResumeCommand(trimmed, session, options?.store);
            continue;
          }

          // Process as regular user input
          try {
            const result = await session.processTurn(trimmed);
            await renderer.render(result);
          } catch (err) {
            console.error("Error:", err);
          }
        }
      } finally {
        await renderer.stop();
      }
    },

    async render(result: AgentTurnResult): Promise<void> {
      // When streaming, tokens already printed via onStream — skip summary to avoid dupes
      if (!result.streamed) console.log(result.summary);
    },

    async stop(): Promise<void> {
      if (rl) {
        rl.close();
        rl = null;
      }
    },
  };

  return renderer;
}

/**
 * `/sessions` command — list the most recent persisted sessions.
 *
 * When no store is wired, this command is a no-op (prints a hint).
 *
 * Exported for testing — the REPL routes `/sessions` through this function.
 */
export async function handleSessionsCommand(
  store: SessionStore | undefined,
): Promise<void> {
  if (!store) {
    console.log("(No SessionStore wired — list unavailable in this mode.)");
    return;
  }
  const sessions = await store.list(10);
  if (sessions.length === 0) {
    console.log("No saved sessions.");
    return;
  }
  console.log("Saved sessions (newest first):");
  for (const s of sessions) {
    const shortId = s.sessionId.length > 12 ? s.sessionId.slice(0, 12) + "…" : s.sessionId;
    const truncated = s.task.length > 60 ? s.task.slice(0, 60) + "…" : s.task;
    console.log(`  ${shortId}  turns=${s.turnCount}  ${s.updatedAt}  ${truncated}`);
  }
}

/**
 * `/resume <sessionId>` command — restore the runtime state from a prior
 * persisted session. The user-facing message confirms the id or reports
 * "not found" when the store has no record of it.
 *
 * Exported for testing — the REPL routes `/resume <id>` through this
 * function. `line` is the full user-entered line (including the leading
 * `/resume` prefix).
 */
export async function handleResumeCommand(
  line: string,
  session: AgentSession,
  store: SessionStore | undefined,
): Promise<void> {
  // Trim the leading command and any extra whitespace, accepting a single
  // id argument. Anything else (multiple ids, missing id) is an error.
  const rest = line.slice("/resume".length).trim();
  if (!rest) {
    console.log("Usage: /resume <sessionId>");
    return;
  }
  const tokens = rest.split(/\s+/);
  if (tokens.length !== 1) {
    console.log("Usage: /resume <sessionId>");
    return;
  }
  const sessionId = tokens[0];

  // Pre-flight existence check so we can give a precise error rather than
  // a silent no-op. We only check when a store is wired — the legacy
  // `resume(sessionId)` path in AgentSession falls back to disk-based
  // reconstruction.
  if (store) {
    const existing = await store.load(sessionId);
    if (!existing) {
      console.log(`Session ${sessionId} not found.`);
      return;
    }
  }

  try {
    await session.resume(sessionId);
    console.log(`Resumed session ${sessionId}.`);
  } catch (err) {
    console.error("Resume failed:", err);
  }
}
