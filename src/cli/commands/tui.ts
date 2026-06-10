import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface, type Interface as RLInterface } from "node:readline";
import { Tui } from "../../tui/index.js";
import { EventLog } from "../../events/event-log.js";
import { loadConfig } from "../../config/loader.js";
import { runTask } from "../../run.js";

export interface TuiOptions {
  sessionName?: string;
  sessionMode?: "auto" | "ask" | "bypass";
  daemonMode?: boolean;
}

// One readline interface per runTui() — created in runTui() after the TTY
// guard and closed on exit/SIGINT. `terminal: true` puts stdin in cooked mode
// and resumes the stream; without it the TUI hangs silently in a real
// terminal because Node keeps `process.stdin` paused.
let rl: RLInterface | null = null;

function readLine(): Promise<string | null> {
  const current = rl;
  if (!current) return Promise.resolve(null);
  return new Promise((resolve) => {
    const onLine = (line: string) => {
      current.removeListener("line", onLine);
      if (line === "") { resolve(""); return; }
      if (line === "\t" || line.toLowerCase() === "tab") { resolve("\t"); return; }
      if (line.toLowerCase() === "exit" || line.toLowerCase() === "quit") { resolve(null); return; }
      resolve(line);
    };
    current.once("line", onLine);
    current.prompt(true);
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
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("ALiX TUI requires an interactive terminal. Try: alix tui --daemon < /dev/tty");
    process.exitCode = 1;
    return;
  }

  // Wire up a persistent readline interface for interactive input.
  // `terminal: true` is required so Node resumes stdin in cooked mode and
  // the `line` event fires for typed input.
  rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  rl.setPrompt("> ");
  try { process.stdin.resume(); } catch { /* already flowing */ }

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

  const mode = opts.sessionMode || "bypass";
  const daemonMode = opts.daemonMode ?? false;

  if (daemonMode) {
    const { DaemonManager } = await import("../../daemon/daemon-manager.js");
    const dm = new DaemonManager(cwd);
    if (!(await dm.isRunning())) {
      tui.appendOutput("ERROR: Daemon is not running. Start it with: alix daemon start\n", false);
      setTimeout(() => { tui.destroy(); process.exit(1); }, 2000);
      return;
    }
  }

  // Load runtime snapshot
  const { buildRuntimeSnapshot, applySnapshotToStore } = await import("../../tui/runtime-snapshot.js");
  let daemonInfo = "";
  const tuiStore = tui.getStore();
  const snapshot = await buildRuntimeSnapshot(cwd);
  if (snapshot) {
    applySnapshotToStore(tuiStore, snapshot);
    if (snapshot.daemonRunning) {
      daemonInfo = snapshot.daemonHeartbeatAge >= 0 ? `, daemon ${snapshot.daemonHeartbeatAge}s heartbeat` : ", daemon running";
    }
  }

  // Welcome text
  tui.appendOutput("ALiX TUI - Interactive Session", false);
  const execMode = daemonMode ? "daemon" : "direct";
  tui.appendOutput(`Execution mode: ${execMode} | Session: ${mode}${daemonInfo}`, false);
  if (daemonMode) tui.appendOutput("Daemon mode: policy handled by daemon runtime gate.", false);
  tui.appendOutput("Type 'exit' to quit. 'r' to refresh snapshot, '?' for help.", false);
  tui.appendOutput("", false);

  const { submitTaskViaDaemon, formatDaemonEvent } = await import("../../tui/daemon-client.js");

  process.on("SIGINT", () => {
    try { rl?.close(); } catch { /* ignore */ }
    rl = null;
    tui.destroy();
    process.exit(0);
  });

  if (opts.sessionName) return;

  const store = tui.getStore();
  const { renderPanelContent } = await import("../../tui/panel-renderer.js");

  while (true) {
    const task = await readLine();
    if (task === null) break;
    if (task.toLowerCase() === "exit" || task.toLowerCase() === "quit") break;

    // Tab navigation MUST come before trim/empty handling
    if (task === "\t" || task.toLowerCase() === "tab") {
      store.cyclePanel(1);
      tui.appendOutput(`Panel: ${store.getState().activePanel}
`, false);
      continue;
    }

    // Panel content rendering on empty Enter
    if (!task.trim()) {
      if (store.getState().activePanel !== "chat") {
        renderPanelContent(store, tui);
      }
      continue;
    }

    if (task.toLowerCase() === "r" || task.toLowerCase() === "refresh") {
      const fresh = await buildRuntimeSnapshot(cwd);
      if (fresh) applySnapshotToStore(tuiStore, fresh);
      tui.appendOutput("Runtime snapshot refreshed.\n", false);
      continue;
    }
    if (task === "?" || task.toLowerCase() === "help") {
      const dState = store.getState().showDashboard ? "on" : "off";
      tui.appendOutput(`Commands: r=refresh tab=next panel d=dashboard(${dState}) ?=help q=quit\n`, false);
      continue;
    }
    if (task.toLowerCase() === "d") {
      store.toggleDashboard();
      tui.appendOutput(`Dashboard: ${store.getState().showDashboard ? "on" : "off"}\n`, false);
      continue;
    }

    try {
      tui.resetOutput();
      echoTask(task);

      if (daemonMode) {
        await submitTaskViaDaemon({
          cwd, task,
          onEvent: (event) => { const line = formatDaemonEvent(event); if (line) tui.appendOutput(line, false); },
          onError: (err) => tui.appendOutput(`Error: ${err}`, false),
          onDone: async () => { const fresh = await buildRuntimeSnapshot(cwd); if (fresh) applySnapshotToStore(tuiStore, fresh); },
        });
      } else {
        const msgsPath = join(sessionDir, "messages.jsonl");
        const { isShellTask } = await import("../../task-classifier.js");
        const isShell = isShellTask(task);
        let allMessages: any[] = [{ role: "user" as const, content: task }];
        if (!isShell && existsSync(msgsPath)) {
          const raw = await readFile(msgsPath, "utf-8");
          const prevMessages = raw.trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
          allMessages = [...prevMessages, ...allMessages];
        }

        const hasPriorMessages = allMessages.length > 1;
        const result = await runTask(cwd, task, {
          messages: isShell ? undefined : allMessages,
          streaming: true,
          sessionMode: mode,
          skipContext: hasPriorMessages,
          sharedSession: { sessionId, sessionDir, eventLog: tuiLog },
        }, (chunk) => {
          if (chunk.type === "text" && typeof chunk.text === "string") {
            tui.appendOutput(chunk.text, true);
          }
        });

        if (result.summary) tui.appendOutput(result.summary, false);

        if (!isShell) {
          const savedMessages = [...allMessages];
          if (result.summary) savedMessages.push({ role: "assistant" as const, content: result.summary });
          const capped = savedMessages.length > 20 ? savedMessages.slice(-20) : savedMessages;
          const jsonLines = capped.map((m: any) => JSON.stringify(m) + "\n").join("");
          await writeFile(msgsPath, jsonLines, "utf-8").catch(() => {});
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ERR_USE_AFTER_CLOSE") break;
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  tui.destroy();

  try { rl.close(); } catch { /* already closed */ }
  rl = null;

}
