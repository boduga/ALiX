/**
 * daemon-client.ts — TUI daemon socket client for submitting tasks and streaming events.
 */

import type { DaemonResponse } from "../daemon/daemon-types.js";
import type { TaskRoute } from "../runtime/task-router.js";

export interface DaemonClientOptions {
  cwd: string;
  task: string;
  route?: TaskRoute;
  onEvent: (event: DaemonResponse & { raw?: string }) => void;
  onError: (error: string) => void;
  onDone: () => void;
}

/** Connect to the global daemon socket, submit a task, and stream events back. */
export async function submitTaskViaDaemon(opts: DaemonClientOptions): Promise<void> {
  const { homedir } = await import("node:os");
  const { join } = await import("node:path");
  const { connect } = await import("node:net");
  const { existsSync } = await import("node:fs");

  const socketPath = join(homedir(), ".alix", "alixd.sock");

  if (!existsSync(socketPath)) {
    opts.onError("Daemon is not running (no socket at ~/.alix/alixd.sock). Start it with: alix daemon start");
    return;
  }

  return new Promise<void>((resolve) => {
    const client = connect(socketPath, () => {
      client.write(JSON.stringify({ command: "run", task: opts.task, cwd: opts.cwd, route: opts.route }) + "\n");
    });

    let sawSessionEnded = false;
    let buffer = "";
    client.on("data", (data: Buffer) => {
      buffer += data.toString("utf8");
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as DaemonResponse;
          opts.onEvent({ ...msg, raw: line });
          if (msg.type === "session.ended") {
            sawSessionEnded = true;
            client.end();
          }
        } catch {
          opts.onEvent({ type: "error" as any, message: "Malformed response", raw: line });
        }
      }
    });

    client.on("error", (err: Error) => {
      opts.onError(`Connection error: ${err.message}`);
      resolve();
    });

    client.on("close", () => {
      if (!sawSessionEnded) opts.onError("Daemon connection closed before session ended.");
      opts.onDone();
      resolve();
    });
  });
}

/** Format a daemon response event into a readable TUI line. */
export function formatDaemonEvent(event: DaemonResponse & { raw?: string }): string | null {
  switch (event.type) {
    case "session.started":
      return `Session started: ${event.sessionId}`;
    case "task.accepted":
      return `Task accepted: ${event.sessionId}`;
    case "queue.position":
      return `Queue position: ${event.position}`;
    case "tool.event":
      return event.status === "completed"
        ? `  ✓ ${event.toolName || "tool"} completed`
        : event.status === "failed"
        ? `  ✗ ${event.toolName || "tool"} failed`
        : `  → ${event.toolName || "tool"} ${event.status || "started"}`;
    case "task.completed":
      return `✓ Task completed: ${event.status}`;
    case "task.failed":
      return `✗ Task failed: ${event.error}`;
    case "session.ended":
      return `Session ended: ${event.sessionId}`;
    case "assistant.text":
      return (event as any).text || null;
    case "error":
      return `Error: ${event.message}`;
    default:
      return null; // skip unhandled
  }
}

/**
 * DaemonAgentSession — wraps the daemon socket protocol into the
 * AgentSession interface so the TUI can use processTurn/processChat
 * through the daemon instead of a local session.
 *
 * Each call to processTurn/processChat opens a fresh connection to
 * the daemon socket, sends a "run" command, collects streaming
 * events, and returns the final summary when the session ends.
 */
import type { AgentSession, AgentTurnResult } from '../agent/session.js';
import type { SessionPhase } from './state.js';

export class DaemonAgentSession implements AgentSession {
  private id: string;
  private _phase: SessionPhase = 'Idle' as SessionPhase;

  constructor(
    private cwd: string,
    private socketPath: string | null,
    private sessionMode: string,
  ) {
    this.id = `daemon-${Date.now()}`;
  }

  getSessionId(): string { return this.id; }
  getPhase(): SessionPhase { return this._phase; }
  getState(): any { return { sessionId: this.id, messages: [], toolHistory: [], turnCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; }
  async save(): Promise<void> {}
  async resume(_id: string): Promise<void> {}

  /**
   * Send a chat/agent text through the daemon socket and return the
   * summary. Used by both processTurn and processChat — the daemon
   * doesn't distinguish between the two.
   */
  private async submitViaDaemon(text: string): Promise<AgentTurnResult> {
    const { homedir } = await import("node:os");
    const { join } = await import("node:path");
    const { connect } = await import("node:net");
    const { existsSync } = await import("node:fs");

    const socketPath = this.socketPath ?? join(homedir(), ".alix", "alixd.sock");

    if (!existsSync(socketPath)) {
      return {
        summary: `[daemon] Daemon is not running. Start it with: alix daemon start`,
        sessionId: this.id,
        toolCalls: [],
        reason: 'daemon-offline',
      };
    }

    return new Promise<AgentTurnResult>((resolve) => {
      const client = connect(socketPath, () => {
        client.write(JSON.stringify({
          command: "run",
          task: text,
          cwd: this.cwd,
          sessionMode: this.sessionMode,
        }) + "\n");
      });

      let summary = `[daemon] ${text}`;
      let buffer = "";
      let sessionId = this.id;

      client.on("data", (data: Buffer) => {
        buffer += data.toString("utf8");
        let idx;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.sessionId) sessionId = msg.sessionId;
            if (msg.type === "session.started") {
              summary = "Processing...";
            }
            if (msg.type === "task.completed") {
              summary = msg.status || "Completed";
            }
            if (msg.type === "task.failed") {
              summary = msg.error || "Failed";
            }
            if (msg.type === "assistant.text" && msg.text) {
              summary = msg.text;
            }
            if (msg.type === "session.ended") {
              client.end();
            }
          } catch { /* skip malformed lines */ }
        }
      });

      client.on("error", () => {
        resolve({ summary: `[daemon] Connection error`, sessionId, toolCalls: [], reason: 'daemon-error' });
      });

      client.on("close", () => {
        this.id = sessionId;
        resolve({ summary, sessionId, toolCalls: [], reason: summary.startsWith("[daemon]") ? 'daemon-error' : undefined });
      });

      // 120s timeout
      setTimeout(() => {
        client.end();
        resolve({ summary: summary.startsWith("[daemon]") ? text : summary, sessionId, toolCalls: [], reason: 'daemon-timeout' });
      }, 120_000);
    });
  }

  async processTurn(text: string): Promise<AgentTurnResult> {
    this._phase = 'Executing' as SessionPhase;
    return this.submitViaDaemon(text);
  }

  async processChat(text: string): Promise<AgentTurnResult> {
    return this.submitViaDaemon(text);
  }
}
