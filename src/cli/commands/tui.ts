import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Tui } from "../../tui/index.js";
import { EventLog } from "../../events/event-log.js";
import { loadConfig } from "../../config/loader.js";
import { runTask } from "../../run.js";

export interface TuiOptions {
  sessionName?: string;
  sessionMode?: "auto" | "ask" | "bypass";
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

  const mode = opts.sessionMode || "bypass";

  // Load daemon status if available
  let daemonInfo = "";
  try {
    const { DaemonManager } = await import("../../daemon/daemon-manager.js");
    const mgr = new DaemonManager(cwd);
    const tuiStore = tui.getStore();
    const running = await mgr.isRunning();
    tuiStore.setDaemonRunning(running);
    if (running) {
      const status = await mgr.status();
      if (status?.lastHeartbeat) {
        const age = Math.round((Date.now() - new Date(status.lastHeartbeat).getTime()) / 1000);
        daemonInfo = `, daemon ${age}s heartbeat`;
      } else {
        daemonInfo = ", daemon running";
      }
    }
    // Load task summary
    const tasksPath = join(cwd, ".alix", "daemon-tasks.json");
    if (await import("node:fs").then(fs => fs.existsSync(tasksPath))) {
      const raw = await import("node:fs/promises").then(f => f.readFile(tasksPath, "utf-8"));
      const tasks = JSON.parse(raw);
      const summary = { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0, failedOrphaned: 0 };
      for (const t of tasks) {
        if (t.status === "queued") summary.queued++;
        else if (t.status === "running") summary.running++;
        else if (t.status === "completed") summary.completed++;
        else if (t.status === "failed" || t.status === "failed_orphaned") summary.failed++;
        else if (t.status === "cancelled") summary.cancelled++;
      }
      tuiStore.setDaemonTaskSummary(summary);
    }
    // Load pending approvals count
    try {
      const { ApprovalStore } = await import("../../approvals/approval-store.js");
      const store = new ApprovalStore(cwd);
      await store.load();
      tuiStore.setPendingApprovalsCount(store.listPending().length);
    } catch {}
    // Load SOP count
    try {
      const { listSops } = await import("../../sop/sop-registry.js");
      tuiStore.setSopsCount(listSops().length);
    } catch {}
    // Load policy rules count
    try {
      const { loadRuleEvaluator } = await import("../../policy/policy-loader.js");
      const eval1 = await loadRuleEvaluator(cwd);
      tuiStore.setPolicyRulesCount(eval1.getAllRules().length);
    } catch {}
    // Load runtime event count
    try {
      const { buildRuntimeIndex } = await import("../../runtime/runtime-index.js");
      const idx = await buildRuntimeIndex(cwd);
      tuiStore.setRuntimeEventCount(idx.events.length);
    } catch {}
  } catch {}

  // Welcome text prints in the output area (above the pinned status bar)
  tui.appendOutput("ALiX TUI - Interactive Session", false);
  tui.appendOutput(`Session mode: ${mode}${daemonInfo}`, false);
  tui.appendOutput("Type 'exit' to quit. Type '?' for commands.", false);
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

      // Load prior conversation for continuous context (non-shell tasks only)
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

      // Save full conversation history for continuous context
      if (!isShell) {
        const savedMessages = [...allMessages];
        if (result.summary) {
          savedMessages.push({ role: "assistant" as const, content: result.summary });
        }
        const capped = savedMessages.length > 20 ? savedMessages.slice(-20) : savedMessages;
        const jsonLines = capped.map((m: any) => JSON.stringify(m) + "\n").join("");
        await writeFile(msgsPath, jsonLines, "utf-8").catch(() => {});
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ERR_USE_AFTER_CLOSE") break;
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  tui.destroy();

}
