/**
 * daemon-server.ts — Daemon process entry point.
 *
 * Listens on a Unix socket, accepts JSON-line commands,
 * writes session events, and reports status.
 *
 * Run as: node dist/src/daemon/daemon-server.js --socket <path> --cwd <dir>
 */

import { createServer, type Socket } from "node:net";
import { readFile, writeFile, appendFile, mkdir, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DaemonResponse } from "./daemon-types.js";
import { EventLog } from "../events/event-log.js";
import { TaskRegistry, type DaemonTaskRecord } from "./task-registry.js";

const args = process.argv.slice(2);
const socketPath = args[args.indexOf("--socket") + 1];
const cwd = args[args.indexOf("--cwd") + 1];

if (!socketPath || !cwd) {
  console.error("Usage: daemon-server --socket <path> --cwd <dir>");
  process.exit(1);
}

let currentSessionId: string | undefined;

const registry = new TaskRegistry(cwd);

const taskQueue: Array<{ task: string; taskId: string; client: Socket }> = [];
let taskRunning = false;

async function processQueue(): Promise<void> {
  if (taskRunning || taskQueue.length === 0) return;
  taskRunning = true;
  const { task, taskId, client } = taskQueue.shift()!;
  try {
    await handleRun(task, taskId, client);
  } finally {
    taskRunning = false;
    processQueue(); // process next
  }
}

async function init(): Promise<void> {
  await registry.load();
  const { reconciled } = registry.reconcileOnStartup();
  if (reconciled > 0) {
    console.error(`Reconciled ${reconciled} task(s) on startup`);
  }
}

/** Write heartbeat timestamp to daemon.json every 30 seconds. */
function startHeartbeat(): void {
  const statusPath = join(cwd, ".alix", "daemon.json");
  setInterval(async () => {
    try {
      const raw = await readFile(statusPath, "utf-8");
      const status = JSON.parse(raw);
      status.lastHeartbeat = new Date().toISOString();
      status.currentSessionId = currentSessionId;
      const tmp = statusPath + ".tmp";
      await writeFile(tmp, JSON.stringify(status, null, 2), "utf-8");
      await rename(tmp, statusPath);
    } catch { /* skip if status file not available */ }
  }, 30000);
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
    const record = registry.create(String(cmd.task || ""));
    taskQueue.push({ task: String(cmd.task || ""), taskId: record.id, client });
    client.write(JSON.stringify({ type: "task.created", taskId: record.id, task: String(cmd.task || ""), position: taskQueue.length } satisfies DaemonResponse) + "\n");
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
  if (cmd.command === "cancel") {
    const taskId = String(cmd.taskId || "");
    const record = registry.get(taskId);
    if (!record) {
      client.write(JSON.stringify({ type: "cancel.error", taskId, message: "Task not found" } satisfies DaemonResponse) + "\n");
      return;
    }

    switch (record.status) {
      case "queued": {
        // Remove from queue
        const qIdx = taskQueue.findIndex(item => item.taskId === taskId);
        if (qIdx >= 0) taskQueue.splice(qIdx, 1);
        registry.update(taskId, { status: "cancelled", cancelledAt: new Date().toISOString() });
        client.write(JSON.stringify({ type: "task.cancelled", taskId } satisfies DaemonResponse) + "\n");
        break;
      }
      case "running": {
        registry.update(taskId, { status: "cancel_requested" });
        client.write(JSON.stringify({ type: "task.cancelled", taskId, requested: true } satisfies DaemonResponse) + "\n");
        break;
      }
      case "cancel_requested":
        client.write(JSON.stringify({ type: "cancel.error", taskId, message: "Cancel already requested" } satisfies DaemonResponse) + "\n");
        break;
      case "completed":
        client.write(JSON.stringify({ type: "cancel.error", taskId, message: "Cannot cancel completed task" } satisfies DaemonResponse) + "\n");
        break;
      case "failed":
        client.write(JSON.stringify({ type: "cancel.error", taskId, message: "Cannot cancel failed task" } satisfies DaemonResponse) + "\n");
        break;
      case "cancelled":
        client.write(JSON.stringify({ type: "cancel.error", taskId, message: "Task already cancelled" } satisfies DaemonResponse) + "\n");
        break;
    }
    return;
  }
  client.write(JSON.stringify({ type: "error", message: `Unknown command: ${cmd.command}` } satisfies DaemonResponse) + "\n");
}

/** Write JSON to a socket if it's still open. */
function safeWrite(client: Socket, payload: DaemonResponse | Record<string, unknown>): void {
  if (client.destroyed || !client.writable) return;
  client.write(JSON.stringify(payload) + "\n");
}

/** Run a task via runTask() and stream events back to the client. */
async function handleRun(task: string, taskId: string, client: Socket): Promise<void> {
  const sessionId = `daemon_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  currentSessionId = sessionId;

  registry.update(taskId, { status: "running", sessionId, startedAt: new Date().toISOString() });

  client.write(JSON.stringify({ type: "session.started", sessionId } satisfies DaemonResponse) + "\n");
  client.write(JSON.stringify({ type: "task.accepted", sessionId, task } satisfies DaemonResponse) + "\n");

  const eventLog = createDaemonEventLog(sessionId, client);
  await eventLog.init();

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
      streaming: true,
      sessionMode: "bypass",
      skipContext: true,
      sharedSession: {
        sessionId,
        sessionDir: join(cwd, ".alix", "sessions", sessionId),
        eventLog,
      },
    }, (chunk: any) => {
      if (chunk.type === "text" && typeof chunk.text === "string") {
        client.write(JSON.stringify({ type: "assistant.text", sessionId, text: chunk.text } satisfies DaemonResponse) + "\n");
      }
    });

    currentSessionId = undefined;

    // Check if cancel was requested during execution
    const current = registry.get(taskId);
    if (current?.status === "cancel_requested") {
      registry.update(taskId, { status: "cancelled", cancelledAt: new Date().toISOString() });
      client.write(JSON.stringify({ type: "task.cancelled", taskId } satisfies DaemonResponse) + "\n");
    } else if (!result.reason || result.reason === "completed") {
      registry.update(taskId, { status: "completed", completedAt: new Date().toISOString() });
      client.write(JSON.stringify({ type: "task.completed", sessionId, status: "completed" } satisfies DaemonResponse) + "\n");
    } else {
      registry.update(taskId, { status: "failed", error: result.reason });
      client.write(JSON.stringify({ type: "task.failed", sessionId, error: result.reason } satisfies DaemonResponse) + "\n");
    }
  } catch (err: any) {
    currentSessionId = undefined;
    const error = err instanceof Error ? (err.stack ?? err.message) : String(err);
    registry.update(taskId, { status: "failed", error });
    safeWrite(client, { type: "task.failed" as const, sessionId, error });
    safeWrite(client, { type: "session.ended" as const, sessionId });
  }

  await eventLog.append({ actor: "system", type: "session.ended", sessionId, payload: {} });
  client.write(JSON.stringify({ type: "session.ended", sessionId } satisfies DaemonResponse) + "\n");
}

process.on("uncaughtException", (err) => { console.error("[daemon] uncaughtException", err); process.exit(1); });
process.on("unhandledRejection", (err) => { console.error("[daemon] unhandledRejection", err); process.exit(1); });

// Remove stale socket file before binding, otherwise `listen()` can fail
// with EADDRINUSE after a crash or unclean shutdown.
if (existsSync(socketPath)) {
  await rm(socketPath, { force: true }).catch(() => {});
}

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

server.on("error", (err: NodeJS.ErrnoException) => {
  console.error("[daemon] server error", { code: err.code, message: err.message, socketPath, cwd });
  process.exit(1);
});

server.listen(socketPath, () => {
  init().catch(() => {});
  startHeartbeat();
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
