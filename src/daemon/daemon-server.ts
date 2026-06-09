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
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const socketPath = args[args.indexOf("--socket") + 1];
const cwd = args[args.indexOf("--cwd") + 1];

if (!socketPath || !cwd) {
  console.error("Usage: daemon-server --socket <path> --cwd <dir>");
  process.exit(1);
}

let currentSessionId: string | undefined;

/** Write a session event to disk. */
async function writeSessionEvent(sessionId: string, event: Record<string, unknown>): Promise<void> {
  const sessionDir = join(cwd, ".alix", "sessions", sessionId);
  if (!existsSync(sessionDir)) {
    await mkdir(sessionDir, { recursive: true });
  }
  const eventWithSeq = { ...event, seq: Date.now(), timestamp: new Date().toISOString() };
  await appendFile(join(sessionDir, "events.jsonl"), JSON.stringify(eventWithSeq) + "\n", "utf-8");
}

/** Handle a single command from a connected client. */
async function handleCommand(command: Record<string, unknown>, client: Socket): Promise<void> {
  if (command.command === "run") {
    const task = String(command.task || "");
    const sessionId = `daemon_${Date.now()}_${randomUUID().slice(0, 8)}`;
    currentSessionId = sessionId;

    await writeSessionEvent(sessionId, {
      type: "session.started", sessionId, actor: "system",
      payload: { task, source: "daemon" },
    });
    client.write(JSON.stringify({ type: "session.started", sessionId }) + "\n");
    client.write(JSON.stringify({ type: "task.accepted", sessionId, task }) + "\n");

    await writeSessionEvent(sessionId, {
      type: "session.ended", sessionId, actor: "system",
    });
    client.write(JSON.stringify({ type: "session.ended", sessionId }) + "\n");

    currentSessionId = undefined;
    return;
  }

  if (command.command === "ping") {
    client.write(JSON.stringify({ type: "pong", sessionId: currentSessionId }) + "\n");
    return;
  }

  client.write(JSON.stringify({ type: "error", message: `Unknown command: ${command.command}` }) + "\n");
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
