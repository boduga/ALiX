import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Tui } from "../../tui/index.js";
import { EventLog } from "../../events/event-log.js";
import { loadConfig } from "../../config/loader.js";
import { runTask } from "../../run.js";

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

  // Ensure cleanup on Ctrl+C
  process.on("SIGINT", () => {
    tui.destroy();
    process.exit(0);
  });

  // Print header above the TUI status area
  tui.appendOutput("ALiX TUI - Interactive Session");
  tui.appendOutput("Type 'exit' to quit.\n");

  if (opts.sessionName) {
    // Single-shot mode for named sessions (TUI dashboard view)
    return;
  }

  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    while (true) {
      try {
        const task = await rl.question("> ");
        if (!task.trim()) continue;
        if (task.toLowerCase() === "exit" || task.toLowerCase() === "quit") break;
        // Skip very short inputs that are likely stray keystrokes (1-2 chars)
        if (task.trim().length < 3) continue;

        // Echo the task in the output area
        tui.appendOutput(`> ${task}`);

        await runTask(cwd, task, {
          streaming: true,
          sharedSession: { sessionId, sessionDir, eventLog: tuiLog },
        }, (chunk) => {
          // Stream text into the TUI buffer so it persists through redraws
          if (chunk.type === "text" && typeof chunk.text === "string") {
            tui.appendOutput(chunk.text);
          }
        });

        // Print a blank line separator
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
