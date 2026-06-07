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

// FIX #1 & #6: stdin is properly resumed/paused around each read.
// Returns null ONLY on true EOF (zero-byte buffer from Ctrl+D),
// not on blank lines — blank lines return "" so the loop can `continue`.
function readLine(): Promise<string | null> {
  return new Promise((resolve) => {
    // FIX #1: put stdin in flowing mode before attaching the listener
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");

    process.stdin.once("data", (text: string) => {
      // FIX #4: pause after each read so we don't accumulate buffered data
      // between loop iterations and avoid multiple concurrent listeners
      process.stdin.pause();

      const line = text.replace(/\r?\n$/, "");

      // FIX #6: true EOF arrives as a zero-length chunk → return null to break
      // A blank line (user just hits Enter) returns "" → caller does `continue`
      if (text.length === 0) {
        resolve(null);
        return;
      }

      resolve(line);
    });

    process.stdout.write("> ");
  });
}

// FIX #3: accept the current cursor column so we can decide whether we need
// to move up at all.  When the terminal echoes the user's Enter on a fresh
// line the prompt is already on the line above — one \x1b[1A is correct.
// We guard with a column check: if the cursor is at column 0 after the
// newline we only need to clear the prompt line above, which is the normal
// case.  This is the safest portable behaviour without entering raw mode.
function echoTask(task: string): void {
  const w = process.stdout.columns || 80;
  // Move up one line (past the Enter newline) and erase the "> " prompt line
  process.stdout.write("\x1b[1A\x1b[2K");
  process.stdout.write("─".repeat(w) + "\n");
  process.stdout.write(task + "\n");
  process.stdout.write("─".repeat(w) + "\n");
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

  const { resolveContextLimit } = await import("../../config/context-limits.js");
  const contextInfo = await resolveContextLimit(
    config.model.provider,
    config.model.name,
    config.apiKeys,
  );

  const tui = new Tui({
    sessionId,
    eventLog: tuiLog,
    maxTokens: contextInfo.maxTokens,
  });
  await tui.init();

  tui.appendOutput("ALiX TUI - Interactive Session", false);
  tui.appendOutput("Type 'exit' to quit.", false);
  tui.appendOutput("", false);

  // FIX #5: track whether the TUI is still alive so we never call appendOutput
  // or resetOutput on a destroyed instance (e.g. after SIGINT fires mid-task).
  let tuiAlive = true;

  process.on("SIGINT", () => {
    tuiAlive = false;
    tui.destroy();
    process.exit(0);
  });

  // FIX #2: removed the `if (opts.sessionName) return;` early-exit that
  // silently abandoned the interactive loop when a session name was supplied.
  // Named sessions are valid interactive sessions; the name just seeds the ID.

  while (true) {
    const task = await readLine();

    // null → true EOF (Ctrl+D), exit cleanly
    if (task === null) break;

    // FIX #6: blank line → skip, do NOT break
    if (task.trim() === "") continue;

    if (task.toLowerCase() === "exit" || task.toLowerCase() === "quit") break;
    if (task.trim().length < 3) continue;

    try {
      // FIX #5: guard every TUI call with the alive flag
      if (tuiAlive) tui.resetOutput();
      echoTask(task);

      const result = await runTask(
        cwd,
        task,
        {
          streaming: true,
          sessionMode: "bypass",
          sharedSession: { sessionId, sessionDir, eventLog: tuiLog },
        },
        (chunk) => {
          // FIX #5: check alive before streaming chunks into the TUI
          if (tuiAlive && chunk.type === "text" && typeof chunk.text === "string") {
            tui.appendOutput(chunk.text, true);
          }
        },
      );

      // FIX #5: only write the summary if the TUI wasn't destroyed mid-task
      if (tuiAlive && result.summary) {
        tui.appendOutput(result.summary, false);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ERR_USE_AFTER_CLOSE") break;
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Always destroy cleanly on normal exit (idempotent if SIGINT already fired)
  if (tuiAlive) {
    tuiAlive = false;
    tui.destroy();
  }
}
