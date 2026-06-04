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

function readLine(): Promise<string | null> {
  return new Promise((resolve) => {
    process.stdin.once("data", (buffer: Buffer) => {
      const text = buffer.toString("utf-8").replace(/\r?\n$/, "");
      if (text === "") { resolve(null); return; }
      resolve(text);
    });
    process.stdout.write("> ");
  });
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

  process.on("SIGINT", () => {
    tui.destroy();
    process.exit(0);
  });

  console.log("ALiX TUI - Interactive Session");
  console.log("Type 'exit' to quit.\n");

  if (opts.sessionName) return;

  while (true) {
    const task = await readLine();
    if (task === null) break;
    if (!task.trim()) continue;
    if (task.toLowerCase() === "exit" || task.toLowerCase() === "quit") break;
    if (task.trim().length < 3) continue;

    try {
      const result = await runTask(cwd, task, {
        streaming: true,
        sharedSession: { sessionId, sessionDir, eventLog: tuiLog },
      });

      // Print the full result summary. In non-TTY mode streaming is
      // auto-disabled, so the text comes only via result.summary.
      if (result.summary) process.stdout.write(result.summary + "\n");
      console.log("");
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ERR_USE_AFTER_CLOSE") break;
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  tui.destroy();
}
