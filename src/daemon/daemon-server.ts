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
import { homedir } from "node:os";
import type { DaemonResponse } from "./daemon-types.js";
import { EventLog } from "../events/event-log.js";
import { TaskRegistry, type DaemonTaskRecord } from "./task-registry.js";
import type { TaskRoute } from "../runtime/task-router.js";
import { recordWorkspaceActivity } from "./workspace-registry.js";

const args = process.argv.slice(2);
const socketPath = args[args.indexOf("--socket") + 1];
const defaultCwd = args[args.indexOf("--cwd") + 1];

if (!socketPath || !defaultCwd) {
  console.error("Usage: daemon-server --socket <path> --cwd <dir>");
  process.exit(1);
}

const globalDir = join(homedir(), ".alix");
let currentSessionId: string | undefined;

const registry = new TaskRegistry();  // global ~/.alix/ path

const taskQueue: Array<{ task: string; taskId: string; cwd?: string; route?: TaskRoute; client: Socket }> = [];
let taskRunning = false;

async function processQueue(): Promise<void> {
  if (taskRunning || taskQueue.length === 0) return;
  taskRunning = true;
  const { task, taskId, cwd: requestCwd, route, client } = taskQueue.shift()!;
  try {
    await handleRun(task, taskId, client, requestCwd ?? defaultCwd, route);
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

/** Write heartbeat timestamp to global daemon.json every 30 seconds. */
function startHeartbeat(): void {
  const statusPath = join(globalDir, "daemon.json");
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

/** Create a pass-through EventLog that writes to project session file AND socket client. */
function createDaemonEventLog(sessionId: string, client: Socket, projectCwd: string): EventLog {
  const events: any[] = [];
  const log = new EventLog(join(projectCwd, ".alix", "sessions", sessionId));
  // Override append to also forward to client socket
  const origAppend = log.append.bind(log);
  (log as any).append = async (event: any) => {
    events.push(event);
    const enriched = { ...event, sessionId, seq: events.length, timestamp: new Date().toISOString() };
    // Write to session file using the real EventLog
    const result = await origAppend(event);
    // Forward key events to client — skip lifecycle events (daemon already
    // sends them explicitly) and internal noise (m09./embedder./context./mcp.).
    const forwardedLifecycle = new Set(["session.started", "session.ended"]);
    if (
      !forwardedLifecycle.has(event.type) &&
      !event.type?.startsWith("m09.") &&
      !event.type?.startsWith("embedder.") &&
      !event.type?.startsWith("context.") &&
      !event.type?.startsWith("mcp.")
    ) {
      client.write(JSON.stringify(enriched) + "\n");
    }
    return result;
  };
  // Expose collected events for fallback extraction in handleRun()
  (log as any)._events = events;
  return log;
}

/** Handle a single command from a connected client. */
async function handleCommand(cmd: Record<string, unknown>, client: Socket): Promise<void> {
  if (cmd.command === "run") {
    const task = String(cmd.task || "");
    const requestCwd = String(cmd.cwd || defaultCwd);  // use request cwd or startup default
    const record = registry.create(task, requestCwd);
    // Auto-register workspace activity (fire-and-forget)
    recordWorkspaceActivity(requestCwd).catch(() => {});
    taskQueue.push({ task, taskId: record.id, cwd: requestCwd, route: cmd.route as TaskRoute | undefined, client });
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

/** Extract a human-readable fallback from collected events when no text was streamed. */
function extractFallbackOutput(events: any[]): string | null {
  const candidates = events
    .map((e) => e.payload?.output ?? e.payload?.stdout ?? e.payload?.result ?? e.payload?.summary)
    .filter((v) => typeof v === "string" && v.trim().length > 0);
  if (candidates.length === 0) return null;
  return candidates.slice(-3).join("\n");
}

// ─── Daemon-side route executors ────────────────────────────────────

/** Execute a tool route in the daemon process via ToolExecutor. */
async function executeToolRoute(
  route: TaskRoute & { kind: "tool" },
  taskId: string, sessionId: string,
  cwd: string, client: Socket, eventLog: EventLog,
): Promise<void> {
  const { loadConfig } = await import("../config/loader.js");
  const config = await loadConfig(cwd);
  const { ToolExecutor } = await import("../tools/executor.js");
  const { randomBytes } = await import("node:crypto");

  const executor = new ToolExecutor(config, eventLog, cwd);
  const toolCallId = `daemon_${Date.now()}_${randomBytes(4).toString("hex")}`;

  safeWrite(client, { type: "assistant.text" as const, sessionId, text: `→ ${route.tool} ${JSON.stringify(route.args)}\n` });

  const result = await executor.execute({ toolCallId, name: route.tool, args: route.args });

  if (result.kind === "success") {
    safeWrite(client, { type: "assistant.text" as const, sessionId, text: result.output ?? result.content ?? "(tool completed)" });
  } else if (result.kind === "denied") {
    safeWrite(client, { type: "assistant.text" as const, sessionId, text: `Blocked by policy: ${result.reason}` });
  } else if (result.kind === "error") {
    safeWrite(client, { type: "assistant.text" as const, sessionId, text: `Tool error: ${result.message}` });
  }
}

/** Execute a chat route in the daemon process: direct model call. */
async function executeChatRoute(
  route: TaskRoute & { kind: "chat" },
  taskId: string, sessionId: string,
  cwd: string, client: Socket, eventLog: EventLog,
): Promise<void> {
  const { loadConfig } = await import("../config/loader.js");
  const config = await loadConfig(cwd);
  const { createProvider } = await import("../providers/registry.js");

  const provider = await createProvider({ provider: config.model.provider, model: config.model.name });
  const response = await provider.complete({
    systemPrompt: "You are ALiX, a helpful AI assistant. Answer concisely.",
    messages: [{ role: "user", content: route.prompt }],
  });

  safeWrite(client, { type: "assistant.text" as const, sessionId, text: response.text || "(no response)" });
}

/** Execute a grounded_chat route: model + read-only tools, max 2 rounds. */
async function executeGroundedChatRoute(
  route: TaskRoute & { kind: "grounded_chat" },
  sessionId: string, cwd: string, client: Socket, eventLog: EventLog,
): Promise<void> {
  const { loadConfig } = await import("../config/loader.js");
  const config = await loadConfig(cwd);
  const { createProvider } = await import("../providers/registry.js");
  const { ToolExecutor } = await import("../tools/executor.js");
  const { randomBytes } = await import("node:crypto");

  const provider = await createProvider({ provider: config.model.provider, model: config.model.name });
  const executor = new ToolExecutor(config, eventLog, cwd);

  // First call: model may issue a tool call for fresh information
  const response = await provider.complete({
    systemPrompt: "You are ALiX, a helpful AI assistant. If you need current information, use the available tools to search. Answer concisely.",
    messages: [{ role: "user", content: route.prompt }],
  });

  if (response.toolCalls.length > 0) {
    if (response.toolCalls.length > 1) {
      safeWrite(client, { type: "assistant.text" as const, sessionId, text: "Grounded chat supports only one tool call at a time." });
      return;
    }
    const tc = response.toolCalls[0];

    // Enforce allowedTools allowlist
    if (!route.allowedTools.includes(tc.name)) {
      safeWrite(client, { type: "assistant.text" as const, sessionId, text: `Tool "${tc.name}" is not allowed for this query type.` });
      return;
    }

    const toolResult = await executor.execute({
      toolCallId: `daemon_${Date.now()}_${randomBytes(4).toString("hex")}`,
      name: tc.name, args: tc.args,
    });

    const toolContent = toolResult.kind === "success"
      ? (toolResult.output || toolResult.content || "(no output)")
      : toolResult.kind === "error"
        ? `Error: ${toolResult.message}`
        : "Tool request denied by policy";

    const finalResponse = await provider.complete({
      systemPrompt: "Answer the user's question based on the tool result.",
      messages: [
        { role: "user", content: route.prompt },
        { role: "assistant", content: response.text || "" },
        { role: "user", content: `[Tool result from ${tc.name}]\n${toolContent}` },
      ],
    });
    safeWrite(client, { type: "assistant.text" as const, sessionId, text: finalResponse.text || "(no response)" });
  } else {
    safeWrite(client, { type: "assistant.text" as const, sessionId, text: response.text || "(no response)" });
  }
}

/** Run a task via the shared task router.
 *
 * If route is provided (pre-classified by client), use it directly.
 * Otherwise, classify the task via taskRouter() for backward compatibility.
 * `requestCwd` is the project directory from the run command; defaults to
 * the startup `--cwd` if not provided. */
async function handleRun(task: string, taskId: string, client: Socket, requestCwd: string, route?: TaskRoute): Promise<void> {
  const sessionId = `daemon_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  currentSessionId = sessionId;

  registry.update(taskId, { status: "running", sessionId, startedAt: new Date().toISOString() });

  client.write(JSON.stringify({ type: "session.started", sessionId } satisfies DaemonResponse) + "\n");
  client.write(JSON.stringify({ type: "task.accepted", sessionId, task } satisfies DaemonResponse) + "\n");

  const eventLog = createDaemonEventLog(sessionId, client, requestCwd);
  await eventLog.init();

  await eventLog.append({
    actor: "system", type: "session.started", sessionId,
    payload: { task, source: "daemon" },
  });

  // Guard to ensure session.ended fires exactly once
  let ended = false;
  const endSession = async () => {
    if (ended) return;
    ended = true;
    currentSessionId = undefined;
    await eventLog.append({ actor: "system", type: "session.ended", sessionId, payload: {} });
    client.write(JSON.stringify({ type: "session.ended", sessionId } satisfies DaemonResponse) + "\n");
  };

  // Resolve route: use pre-classified route, or classify from scratch
  if (!route) {
    const { taskRouter } = await import("../runtime/task-router.js");
    route = taskRouter(task);
  }

  try {
    // Route execution — tool/chat/grounded_chat complete here, agent falls through
    switch (route.kind) {
      case "tool":
        await executeToolRoute(route, taskId, sessionId, requestCwd, client, eventLog);
        break;
      case "chat":
        await executeChatRoute(route, taskId, sessionId, requestCwd, client, eventLog);
        break;
      case "grounded_chat":
        await executeGroundedChatRoute(route, sessionId, requestCwd, client, eventLog);
        break;
      case "agent":
        break; // fall through to runTask() below
    }

    if (route.kind !== "agent") {
      registry.update(taskId, { status: "completed", completedAt: new Date().toISOString() });
      safeWrite(client, { type: "task.completed" as const, sessionId, status: "completed" });
      await endSession();
      return;
    }

    // Agent route — runTask path
    const { loadConfig } = await import("../config/loader.js");
    const config = await loadConfig(requestCwd);
    const { runTask } = await import("../run.js");

    let streamedText = false;
    const result = await runTask(requestCwd, task, {
      planMode: false,
      streaming: true,
      sessionMode: "bypass",
      skipContext: true,
      sharedSession: {
        sessionId,
        sessionDir: join(requestCwd, ".alix", "sessions", sessionId),
        eventLog,
      },
    }, (chunk: any) => {
      if (chunk.type === "text" && typeof chunk.text === "string") {
        streamedText = true;
        client.write(JSON.stringify({ type: "assistant.text", sessionId, text: chunk.text } satisfies DaemonResponse) + "\n");
      }
    });

    if (!streamedText) {
      if (result.summary) {
        safeWrite(client, { type: "assistant.text" as const, sessionId, text: result.summary });
      } else {
        const fallback = extractFallbackOutput((eventLog as any)._events ?? []);
        if (fallback) {
          safeWrite(client, { type: "assistant.text" as const, sessionId, text: fallback });
        } else {
          safeWrite(client, { type: "assistant.text" as const, sessionId, text: "Task completed, but no textual output was produced." });
        }
      }
    }

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
    const error = err instanceof Error ? (err.stack ?? err.message) : String(err);
    registry.update(taskId, { status: "failed", error });
    safeWrite(client, { type: "task.failed" as const, sessionId, error });
  } finally {
    await endSession();
  }
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
  console.error("[daemon] server error", { code: err.code, message: err.message, socketPath, defaultCwd });
  process.exit(1);
});

server.listen(socketPath, () => {
  init().catch(() => {});
  startHeartbeat();
  const statusPath = join(globalDir, "daemon.json");
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
