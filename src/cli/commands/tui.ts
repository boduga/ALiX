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
  daemonMode?: boolean;
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
  const daemonMode = opts.daemonMode ?? false;

  if (daemonMode) {
    const { DaemonManager } = await import("../../daemon/daemon-manager.js");
    const dm = new DaemonManager(cwd);
    if (!(await dm.isRunning())) {
      tui.appendOutput("ERROR: Daemon is not running. Start it with: alix daemon start\n", false);
      setTimeout(() => { tui.destroy(); process.exit(1); }, 2000);
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
    tui.destroy();
    process.exit(0);
  });

  if (opts.sessionName) return;

  const store = tui.getStore();

  while (true) {
    const task = await readLine();
    if (task === null) break;
    if (!task.trim()) continue;
    if (task.toLowerCase() === "exit" || task.toLowerCase() === "quit") break;

    // Panel navigation
    if (task === "\t") { store.cyclePanel(1); tui.appendOutput(`Panel: ${store.getState().activePanel}\n`, false); continue; }
    if (task.toLowerCase() === "r" || task.toLowerCase() === "refresh") {
      const fresh = await buildRuntimeSnapshot(cwd);
      if (fresh) applySnapshotToStore(tuiStore, fresh);
      tui.appendOutput("Runtime snapshot refreshed.\n", false);
      continue;
    }
    if (task === "?" || task.toLowerCase() === "help") {
      tui.appendOutput("Commands: r=refresh Tab=next panel ?=help q=quit\nPanels: chat daemon approvals sops policy runtime\n", false);
      continue;
    }

    if (task.trim().length < 2 && store.getState().activePanel !== "chat") {
      const s = store.getState();
      const buf: string[] = [];
      if (s.activePanel === "daemon") {
        buf.push("── Daemon ──────────────────────────────");
        buf.push(`Status:  ${s.daemonRunning ? "● running" : "○ stopped"}`);
        if (s.daemonTasks) {
          const t = s.daemonTasks;
          buf.push(`Tasks:   run:${t.running} queued:${t.queued} done:${t.completed} fail:${t.failed}`);
        }
        if (s.daemonTaskRecords && s.daemonTaskRecords.length > 0) {
          buf.push("── Recent Tasks ────────────────────────");
          for (const r of s.daemonTaskRecords.slice(0, 8)) {
            buf.push(`  ${r.status.padEnd(18)} ${r.id} ${r.task.slice(0, 30)}`);
          }
        }
        buf.push(`Events:  ${s.runtimeEventCount}`);
      } else if (s.activePanel === "approvals") {
        buf.push("── Approvals ────────────────────────────");
        buf.push(`Pending: ${s.pendingApprovalsCount}`);
        if (s.pendingApprovalRecords && s.pendingApprovalRecords.length > 0) {
          for (const a of s.pendingApprovalRecords) {
            buf.push(`  ${a.id}  ${a.capability || "?"}  ${a.reason.slice(0, 40)}`);
            buf.push(`    alix approvals approve ${a.id}`);
          }
        } else {
          buf.push("No pending approvals.");
        }
      } else if (s.activePanel === "sops") {
        buf.push("── SOP Packs ────────────────────────────");
        buf.push(`SOPs:    ${s.sopsCount}`);
        buf.push("  research.deep_report      6 nodes");
        buf.push("  infra.docker_compose_audit 1 node");
      } else if (s.activePanel === "policy") {
        buf.push("── Policy Rules ─────────────────────────");
        buf.push(`Rules:   ${s.policyRulesCount}`);
        buf.push("Run: alix policy eval --capability <cap>");
      } else if (s.activePanel === "runtime") {
        buf.push("── Runtime Events ───────────────────────");
        buf.push(`Events:  ${s.runtimeEventCount}`);
        if (s.recentRuntimeEvents && s.recentRuntimeEvents.length > 0) {
          for (const e of s.recentRuntimeEvents.slice(0, 8)) {
            buf.push(`  [${e.source}] ${e.action} ${e.summary ? e.summary.slice(0, 40) : ""}`);
          }
        }
      }
      for (const l of buf) tui.appendOutput(l, false);
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

}
