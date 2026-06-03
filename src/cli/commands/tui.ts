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

  // Print header above the TUI status area
  tui.appendOutput("ALiX TUI - Interactive Session");
  tui.appendOutput("Type 'exit' to quit.\n");

  const bridge = tui.getBridge();

  if (opts.sessionName) {
    // Single-shot mode for named sessions (TUI dashboard view)
    return;
  }

  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    while (true) {
      try {
        const task = await rl.question("");
        if (!task.trim()) continue;
        if (task.toLowerCase() === "exit" || task.toLowerCase() === "quit") break;

        // Echo the task in the output area
        tui.appendOutput(`> ${task}`);

        // Create shared session for real-time event streaming
        const sharedSession: SharedSession = {
          sessionId,
          sessionDir,
          eventLog: tuiLog,
        };

        const result = await runTask(cwd, task, {
          streaming: true,
          sharedSession,
        }, (chunk) => {
          if (chunk.type === "text" && typeof chunk.text === "string") {
            tui.appendOutput(chunk.text);
          }
        });

        // Replay final events to ensure sync
        await replayEvents(result.sessionId, bridge);

        // Print a blank line separator (NOT console.log — use appendOutput)
        tui.appendOutput("");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ERR_USE_AFTER_CLOSE") break;
        tui.appendOutput(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    rl.close();
  }

  tui.destroy();
}
