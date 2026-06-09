/**
 * daemon-client.ts — TUI daemon socket client for submitting tasks and streaming events.
 */

import type { DaemonResponse } from "../daemon/daemon-types.js";

export interface DaemonClientOptions {
  cwd: string;
  task: string;
  onEvent: (event: DaemonResponse & { raw?: string }) => void;
  onError: (error: string) => void;
  onDone: () => void;
}

/** Connect to the daemon socket, submit a task, and stream events back. */
export async function submitTaskViaDaemon(opts: DaemonClientOptions): Promise<void> {
  const { DaemonManager } = await import("../daemon/daemon-manager.js");
  const mgr = new DaemonManager(opts.cwd);
  const running = await mgr.isRunning();
  if (!running) {
    opts.onError("Daemon is not running. Start it with: alix daemon start");
    return;
  }

  const status = await mgr.status();
  const socketPath = status?.socketPath;
  if (!socketPath) {
    opts.onError("No socket path found in daemon status.");
    return;
  }

  const { connect } = await import("node:net");
  return new Promise<void>((resolve) => {
    const client = connect(socketPath, () => {
      client.write(JSON.stringify({ command: "run", task: opts.task }) + "\n");
    });

    client.on("data", (data: Buffer) => {
      for (const line of data.toString().trim().split("\n")) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as DaemonResponse;
          opts.onEvent({ ...msg, raw: line });
          if (msg.type === "task.completed" || msg.type === "task.failed") {
            // Keep reading for session.ended
          }
          if (msg.type === "session.ended") {
            client.end();
          }
        } catch {
          opts.onEvent({ type: "error", message: "Malformed response", raw: line });
        }
      }
    });

    client.on("error", (err: Error) => {
      opts.onError(`Connection error: ${err.message}`);
      resolve();
    });

    client.on("close", () => {
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
    case "error":
      return `Error: ${event.message}`;
    default:
      return null; // skip unhandled
  }
}
