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
    // Register listener first so no keystrokes are missed
    process.stdin.once("data", (buffer: Buffer) => {
      const text = buffer.toString("utf-8").replace(/\r?\n$/, "");
      if (text === "") { resolve(null); return; }
      resolve(text);
    });

    process.stdout.write("> ");
  });
}

function echoTask(task: string): void {
  const w = process.stdout.columns || 80;
  // Move up one line (past the Enter newline) and clear the "> " prompt
  process.stdout.write("\x1b[1A\x1b[K");
  process.stdout.write("\x1b[2m" + "─".repeat(w) + "\x1b[22m\n");
  process.stdout.write("\x1b[36m\x1b[1m" + task + "\x1b[22m\x1b[39m\n");
  process.stdout.write("\x1b[2m" + "─".repeat(w) + "\x1b[22m\n");
}

export async function runTui(opts: TuiOptions): Promise<void> {
  const cwd = process.cwd();

  const sessionId = opts.sessionName
    ? opts.sessionName.replace(/[^a-zA-Z0-9-_]/g, "-")
    : randomUUID();

  const sessionDir = join(cwd, ".alix", "sessions", sessionId);
  await mkdir(sessionDir, { recursive: true });
  const config = await loadConfig(cwd);

  const tuiLog = new EventLog(sessionDir);
  await tuiLog.init();

  // Resolve model context limit for the TUI token budget display
  const { resolveContextLimit } = await import("../../config/context-limits.js");
  const contextInfo = await resolveContextLimit(config.model.provider, config.model.name, config.apiKeys);

  const tui = new Tui({ sessionId, eventLog: tuiLog, maxTokens: contextInfo.maxTokens });
  await tui.init();

  // Welcome text prints in the output area (above the pinned status bar)
  tui.appendOutput("ALiX TUI - Interactive Session", false);
  tui.appendOutput("Type 'exit' to quit.", false);
  tui.appendOutput("", false);

  process.on("SIGINT", () => {
    tui.destroy();
    process.exit(0);
  });

  if (opts.sessionName) return;

  while (true) {
    const task = await readLine();
    if (task === null) break;
    if (!task.trim()) continue;
    if (task.toLowerCase() === "exit" || task.toLowerCase() === "quit") break;
    if (task.trim().length < 2) continue;

    try {
      tui.resetOutput();
      echoTask(task);
      const result = await runTask(cwd, task, {
        streaming: true,
        sessionMode: "bypass",
        sharedSession: { sessionId, sessionDir, eventLog: tuiLog },
      }, (chunk) => {
        if (chunk.type === "text" && typeof chunk.text === "string") {
          tui.appendOutput(chunk.text, true);
        }
      });

      if (result.summary) tui.appendOutput(result.summary, false);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ERR_USE_AFTER_CLOSE") break;
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  tui.destroy();
}
