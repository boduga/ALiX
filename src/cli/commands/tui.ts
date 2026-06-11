import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface, type Interface as RLInterface } from "node:readline";
import { Tui } from "../../tui/index.js";
import { EventLog } from "../../events/event-log.js";
import { loadConfig } from "../../config/loader.js";
import { runTask } from "../../run.js";
import { taskRouter } from "../../runtime/task-router.js";
import { executeRoute, LocalRuntimeExecutor, type RuntimeContext } from "../../runtime/route-executor.js";
import { WorkspaceManager, promptLabel } from "../../tui/workspace-manager.js";
import { ApprovalManager } from "../../tui/approval-manager.js";

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
  rl.setPrompt(promptLabel(process.cwd()));
  try { process.stdin.resume(); } catch { /* already flowing */ }

  let activeCwd = process.cwd();
  let activeSessionId = opts.sessionName
    ? opts.sessionName.replace(/[^a-zA-Z0-9-_]/g, "-")
    : randomUUID();
  let activeSessionDir = join(activeCwd, ".alix", "sessions", activeSessionId);
  await mkdir(activeSessionDir, { recursive: true });
  let activeConfig = await loadConfig(activeCwd);

  // Workspace manager for /workspaces, /switch, /open commands
  const { listWorkspaces, recordWorkspaceActivity, getWorkspace } = await import("../../daemon/workspace-registry.js");
  const workspaceManager = new WorkspaceManager({
    listWorkspaces, recordWorkspaceActivity, getWorkspace,
    getActiveCwd: () => activeCwd,
  });

  // Approval store + manager for /approvals, /approve, /deny commands
  let approvalStore: any = null;
  const approvalManager = new ApprovalManager({
    listPendingApprovals: async () => {
      const { ApprovalStore } = await import("../../approvals/approval-store.js");
      if (!approvalStore) {
        approvalStore = new ApprovalStore(activeCwd);
        await approvalStore.load();
      }
      return approvalStore.listPending();
    },
    resolveApproval: async (id, status) => {
      const { ApprovalStore } = await import("../../approvals/approval-store.js");
      if (!approvalStore) {
        approvalStore = new ApprovalStore(activeCwd);
        await approvalStore.load();
      }
      const record = await approvalStore.resolve(id, status, `Resolved by user via TUI`);
      if (!record) return { success: false, message: `Approval not found: ${id}` };
      return { success: true, message: `Approval ${id} ${status}.` };
    },
  });

  let tuiLog = new EventLog(activeSessionDir);
  await tuiLog.init();

  // Resolve model context limit for the TUI token budget display
  const { resolveContextLimit } = await import("../../config/context-limits.js");
  const contextInfo = await resolveContextLimit(activeConfig.model.provider, activeConfig.model.name, activeConfig.apiKeys);

  const tui = new Tui({ sessionId: activeSessionId, eventLog: tuiLog, maxTokens: contextInfo.maxTokens });
  await tui.init();

  const mode = opts.sessionMode || "bypass";
  const daemonMode = opts.daemonMode ?? false;

  if (daemonMode) {
    const { DaemonManager } = await import("../../daemon/daemon-manager.js");
    const dm = new DaemonManager(activeCwd);
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
  const snapshot = await buildRuntimeSnapshot(activeCwd);
  if (snapshot) {
    applySnapshotToStore(tuiStore, snapshot);
    if (snapshot.daemonRunning) {
      daemonInfo = snapshot.daemonHeartbeatAge >= 0 ? `, daemon ${snapshot.daemonHeartbeatAge}s heartbeat` : ", daemon running";
    }
  }

  rl.setPrompt(promptLabel(activeCwd, snapshot?.workspaceName, snapshot?.workspacePath));

  // Welcome text
  tui.appendOutput("ALiX TUI - Interactive Session", false);
  const execMode = daemonMode ? "daemon" : "direct";
  tui.appendOutput(`Execution mode: ${execMode} | Session: ${mode}${daemonInfo}`, false);
  const wsName = snapshot?.workspaceName ?? activeCwd.split("/").pop() ?? "";
  tui.appendOutput(`Workspace: ${wsName}`, false);
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

  // Workspace switch re-init — must be inside runTui() for variable scope
  async function softReinitWorkspace(nextCwd: string): Promise<void> {
    const { randomBytes } = await import("node:crypto");
    const { join } = await import("node:path");
    const { mkdir } = await import("node:fs/promises");
    const { EventLog: EL } = await import("../../events/event-log.js");
    const { buildRuntimeSnapshot: bRS, applySnapshotToStore: aSTS } = await import("../../tui/runtime-snapshot.js");

    const newSessionId = `tui_${Date.now()}_${randomBytes(4).toString("hex")}`;
    const newSessionDir = join(nextCwd, ".alix", "sessions", newSessionId);
    await mkdir(newSessionDir, { recursive: true });

    // Update all mutable state
    activeCwd = nextCwd;
    activeSessionId = newSessionId;
    activeSessionDir = newSessionDir;
    activeConfig = await loadConfig(nextCwd);
    tuiLog = new EL(newSessionDir);
    await tuiLog.init();

    const newSnapshot = await bRS(nextCwd);
    if (newSnapshot) aSTS(tuiStore, newSnapshot);

    tuiStore.setSessionId(newSessionId);
    tuiStore.setSessionDir(newSessionDir);
    rl!.setPrompt(promptLabel(nextCwd, newSnapshot?.workspaceName, newSnapshot?.workspacePath));
    rl!.prompt(true);
  }

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
      const fresh = await buildRuntimeSnapshot(activeCwd);
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
    if (task.toLowerCase() === "t") {
      const filters = ["all", "policy", "approval", "continuation", "tool", "task", "session", "daemon", "runtime"] as const;
      const current = store.getState().traceFilter;
      const idx = filters.indexOf(current);
      const next = filters[(idx + 1) % filters.length];
      store.setTraceFilter(next);
      tui.appendOutput(`Trace filter: ${next}\n`, false);
      continue;
    }

    try {
      tui.resetOutput();
      echoTask(task);

      // Check for workspace commands
      const wsResult = await workspaceManager.tryHandleCommand(task);
      if (wsResult.handled) {
        tui.appendOutput(wsResult.message + "\n", false);
        if (wsResult.changedWorkspace && wsResult.nextCwd) {
          await softReinitWorkspace(wsResult.nextCwd);
        }
        continue;
      }

      // Check for approval commands
      const approvalResult = await approvalManager.tryHandleCommand(task);
      if (approvalResult.handled) {
        tui.appendOutput(approvalResult.message + "\n", false);

        // If approved, try to resume the continuation
        if (approvalResult.action === "approved" && approvalResult.approvalId) {
          try {
            const { ContinuationStore } = await import("../../runtime/continuation-store.js");
            const { ContinuationManager } = await import("../../runtime/continuation-manager.js");
            const { ToolExecutor } = await import("../../tools/executor.js");

            const continuationStore = new ContinuationStore(activeCwd);
            await continuationStore.load();
            const contManager = new ContinuationManager({
              continuationStore,
              approvalStore,
              executeTool: async (tc) => {
                const executor = new ToolExecutor(activeConfig, tuiLog, activeCwd);
                const result = await executor.execute(tc);
                return result;
              },
            });
            const resumeResult = await contManager.resumeApproved(approvalResult.approvalId);
            if (resumeResult.resumed) {
              tui.appendOutput(`\n✅ Continued:\n${resumeResult.output}\n`, false);
            } else {
              tui.appendOutput(`\n❌ Could not resume: ${resumeResult.error}\n`, false);
            }
          } catch (err: any) {
            tui.appendOutput(`\n❌ Resume error: ${err.message}\n`, false);
          }
        }
        continue;
      }

      if (daemonMode) {
        // Classify locally, send the route to the daemon
        const route = taskRouter(task);
        await submitTaskViaDaemon({
          cwd: activeCwd, task, route,
          onEvent: (event) => {
            const line = formatDaemonEvent(event);
            if (line) tui.appendOutput(line, false);
            // Bridge daemon events into trace stream
            (async () => {
              const { toTraceEvent } = await import("../../runtime/trace-events.js");
              const traceEvent = toTraceEvent(event);
              if (traceEvent) store.appendTraceEvent(traceEvent);
            })().catch(() => {});
          },
          onError: (err) => tui.appendOutput(`Error: ${err}`, false),
          onDone: async () => { const fresh = await buildRuntimeSnapshot(activeCwd); if (fresh) applySnapshotToStore(tuiStore, fresh); },
        });
      } else {
        // Route through the shared task router
        const route = taskRouter(task);
        const ctx: RuntimeContext = {
          cwd: activeCwd, sessionId: activeSessionId, sessionDir: activeSessionDir,
          eventLog: tuiLog,
          config: activeConfig,
          onStream: (chunk) => {
            if (chunk.type === "text" && typeof chunk.text === "string") {
              tui.appendOutput(chunk.text, true);
            }
          },
        };
        const text = await executeRoute(route, ctx, new LocalRuntimeExecutor());
        if (text) tui.appendOutput(text, false);
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
