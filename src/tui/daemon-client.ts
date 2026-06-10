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
