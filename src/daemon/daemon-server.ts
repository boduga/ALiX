/**
 * daemon-server.ts — Daemon process entry point.
 *
 * Listens on a Unix socket, accepts JSON-line commands,
 * writes session events, and reports status.
 *
 * Run as: node dist/src/daemon/daemon-server.js --socket <path> --cwd <dir>
 */

import { createServer, type Socket } from "node:net";
import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DaemonResponse } from "./daemon-types.js";
import { EventLog } from "../events/event-log.js";

const args = process.argv.slice(2);
const socketPath = args[args.indexOf("--socket") + 1];
const cwd = args[args.indexOf("--cwd") + 1];

if (!socketPath || !cwd) {
  console.error("Usage: daemon-server --socket <path> --cwd <dir>");
  process.exit(1);
}

let currentSessionId: string | undefined;

const taskQueue: Array<{ task: string; client: Socket }> = [];
let taskRunning = false;

async function processQueue(): Promise<void> {
  if (taskRunning || taskQueue.length === 0) return;
  taskRunning = true;
  const { task, client } = taskQueue.shift()!;
  try {
    await handleRun(task, client);
  } finally {
    taskRunning = false;
    processQueue(); // process next
  }
}

/** Create a pass-through EventLog that writes to session file AND socket client. */
function createDaemonEventLog(sessionId: string, client: Socket): EventLog {
  const events: any[] = [];
  const log = new EventLog(join(cwd, ".alix", "sessions", sessionId));
  // Override append to also forward to client socket
  const origAppend = log.append.bind(log);
  (log as any).append = async (event: any) => {
    events.push(event);
    const enriched = { ...event, sessionId, seq: events.length, timestamp: new Date().toISOString() };
    // Write to session file using the real EventLog
    const result = await origAppend(event);
    // Forward key events to client
    if (!event.type?.startsWith("m09.") && !event.type?.startsWith("embedder.") && !event.type?.startsWith("context.") && !event.type?.startsWith("mcp.")) {
      client.write(JSON.stringify(enriched) + "\n");
    }
    return result;
  };
  return log;
}

/** Handle a single command from a connected client. */
async function handleCommand(cmd: Record<string, unknown>, client: Socket): Promise<void> {
  if (cmd.command === "run") {
    taskQueue.push({ task: String(cmd.task || ""), client });
    if (taskQueue.length === 1) {
      processQueue();
    } else {
      client.write(JSON.stringify({ type: "queue.position", position: taskQueue.length } satisfies DaemonResponse) + "\n");
    }
    return;
  }
  if (cmd.command === "ping") {
    client.write(JSON.stringify({ type: "pong", sessionId: currentSessionId } satisfies DaemonResponse) + "\n");
    return;
  }
  client.write(JSON.stringify({ type: "error", message: `Unknown command: ${cmd.command}` } satisfies DaemonResponse) + "\n");
}

/** Run a task via runTask() and stream events back to the client. */
async function handleRun(task: string, client: Socket): Promise<void> {
  const sessionId = `daemon_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  currentSessionId = sessionId;

  client.write(JSON.stringify({ type: "session.started", sessionId } satisfies DaemonResponse) + "\n");
  client.write(JSON.stringify({ type: "task.accepted", sessionId, task } satisfies DaemonResponse) + "\n");

  const eventLog = createDaemonEventLog(sessionId, client);

  await eventLog.append({
    actor: "system", type: "session.started", sessionId,
    payload: { task, source: "daemon" },
  });

  try {
    const { loadConfig } = await import("../config/loader.js");
    const config = await loadConfig(cwd);
    const { runTask } = await import("../run.js");

    const result = await runTask(cwd, task, {
      planMode: false,
      sharedSession: {
        sessionId,
        sessionDir: join(cwd, ".alix", "sessions", sessionId),
        eventLog,
      },
    });

    currentSessionId = undefined;

    if (!result.reason || result.reason === "completed") {
      client.write(JSON.stringify({ type: "task.completed", sessionId, status: "completed" } satisfies DaemonResponse) + "\n");
    } else {
      client.write(JSON.stringify({ type: "task.failed", sessionId, error: result.reason } satisfies DaemonResponse) + "\n");
    }
  } catch (err: any) {
    currentSessionId = undefined;
    client.write(JSON.stringify({ type: "task.failed", sessionId, error: err.message } satisfies DaemonResponse) + "\n");
  }

  await eventLog.append({ actor: "system", type: "session.ended", sessionId, payload: {} });
  client.write(JSON.stringify({ type: "session.ended", sessionId } satisfies DaemonResponse) + "\n");
}

// Start server
const server = createServer((client: Socket) => {
  let buffer = "";

  client.on("data", (data: Buffer) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const command = JSON.parse(line);
        handleCommand(command, client).catch((err: Error) => {
          client.write(JSON.stringify({ type: "error", message: err.message }) + "\n");
        });
      } catch {
        client.write(JSON.stringify({ type: "error", message: "Invalid JSON" }) + "\n");
      }
    }
  });
});

server.listen(socketPath, () => {
  const statusPath = join(cwd, ".alix", "daemon.json");
  if (existsSync(statusPath)) {
    readFile(statusPath, "utf-8").then((raw) => {
      try {
        const status = JSON.parse(raw);
        status.currentSessionId = currentSessionId;
        writeFile(statusPath, JSON.stringify(status, null, 2), "utf-8").catch(() => {});
      } catch {}
    }).catch(() => {});
  }
  console.error(`Daemon listening on ${socketPath}`);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
