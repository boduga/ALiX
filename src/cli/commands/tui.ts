import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Tui, EventLogBridge } from "../../tui/index.js";
import { EventLog } from "../../events/event-log.js";
import { loadConfig } from "../../config/loader.js";
import { runTask } from "../../run.js";
import type { SharedSession } from "../../run.js";

export interface TuiOptions {
  sessionName?: string;
}

export async function runTui(opts: TuiOptions): Promise<void> {
  const cwd = process.cwd();

  const sessionId = opts.sessionName
    ? opts.sessionName.replace(/[^a-zA-Z0-9-_]/g, "-")
    : randomUUID();

  const sessionDir = join(cwd, ".alix", "sessions", sessionId);
  await mkdir(sessionDir, { recursive: true });
  await loadConfig(cwd);

  const tuiLog = new EventLog(sessionDir);
  await tuiLog.init();

  const tui = new Tui({ sessionId, eventLog: tuiLog });
  await tui.init();

  const bridge = tui.getBridge();

  if (!opts.sessionName) {
    console.log("\nALiX TUI - Interactive Session");
    console.log("Type your task below. Press Ctrl+C to exit.\n");

    const { createInterface } = await import("node:readline/promises");
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    try {
      while (true) {
        try {
          const task = await rl.question("alix> ");
          if (!task.trim()) continue;
          if (task.toLowerCase() === "exit" || task.toLowerCase() === "quit") break;

          // Create shared session for real-time event streaming
          const sharedSession: SharedSession = {
            sessionId,
            sessionDir,
            eventLog: tuiLog,
          };

          const result = await runTask(cwd, task, {
            streaming: true,
            sharedSession,
          });

          // Replay final events to ensure sync
          await replayEvents(result.sessionId, bridge);

          console.log("\nSession continues. Type another task or 'exit' to quit.\n");
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ERR_USE_AFTER_CLOSE") break;
          throw err;
        }
      }
    } finally {
      rl.close();
    }
  }

  tui.destroy();
  console.log("\nGoodbye!");
}

async function replayEvents(taskSessionId: string, bridge: EventLogBridge): Promise<void> {
  const path = join(process.cwd(), ".alix", "sessions", taskSessionId, "events.jsonl");
  try {
    const content = await readFile(path, "utf-8");
    for (const line of content.split("\n").filter(Boolean)) {
      const event = JSON.parse(line);
      bridge.applyEvent(event.type, event.payload as Record<string, unknown>);
    }
  } catch { /* ok */ }
}
