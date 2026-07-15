// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * REPL Renderer — interactive terminal session for `alix run --chat`.
 *
 * P3: Readline-based prompt loop that processes user input through
 * an AgentSession and displays results. Supports /exit, /quit, /save,
 * and /status commands.
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { AgentSession, AgentTurnResult, AgentSessionState } from "../../agent/session.js";

export interface AgentRenderer {
  start(): Promise<void>;
  render(result: AgentTurnResult): Promise<void>;
  stop(): Promise<void>;
}

export interface ReplRendererOptions {
  /** Session mode label for /status display (default: "auto"). */
  sessionMode?: string;
}

export function createReplRenderer(
  session: AgentSession,
  options?: ReplRendererOptions,
): AgentRenderer {
  const sessionMode = options?.sessionMode ?? "auto";
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
          switch (trimmed) {
            case "/exit":
            case "/quit":
              break loop;
            case "/save":
              try {
                await session.save();
                console.log("Saved.");
              } catch (err) {
                console.error("Save failed:", err);
              }
              continue;
            case "/status": {
              const state = session.getState();
              printStatus(state);
              continue;
            }
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
