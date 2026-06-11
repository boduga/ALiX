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
  const { ApprovalStore } = await import("../../approvals/approval-store.js");
  const approvalStore = new ApprovalStore(activeCwd);
  await approvalStore.load();

  const approvalManager = new ApprovalManager({
    listPendingApprovals: async () => {
      await approvalStore.load(); // reload to pick up changes
      return approvalStore.listPending();
    },
    resolveApproval: async (id, status) => {
      await approvalStore.load(); // reload from disk — approval may have been created by PolicyGate
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
      if (store.getState().activePanel === "trace") {
        store.toggleTraceDetail();
        renderPanelContent(store, tui);
      } else if (store.getState().activePanel !== "chat") {
        renderPanelContent(store, tui);
      }
      continue;
    }

    // Replay confirmation
    const replayConfirm = (globalThis as any).__replayConfirm;
    if (replayConfirm) {
      const confirmPhrase = task.toLowerCase().trim();
      if (confirmPhrase === "replay yes" || confirmPhrase === "replay yes --approved-live") {
        (globalThis as any).__replayConfirm = null;
        const { plan, mode: confirmMode } = replayConfirm;
        const { ReplayExecutor } = await import("../../runtime/replay-executor.js");
        const { ReplayStatusIndex } = await import("../../runtime/replay-status-index.js");
        const executor = new ReplayExecutor(activeCwd, tuiLog);
        const statusIndex = new ReplayStatusIndex(activeCwd);

        store.setReplayExecuting(true);
        tui.appendOutput("Executing replay...\n", false);

        try {
          const opts: any = {};
          if (confirmMode === "approved-live" && approvalStore) {
            opts.approvalStore = approvalStore;
            const { ReplayDiffStore } = await import("../../runtime/replay-diff-store.js");
            opts.diffStore = new ReplayDiffStore(activeCwd, statusIndex);
          }
          opts.statusIndex = statusIndex;
          const result = await executor.execute(plan, opts);
          store.setReplayResult(result);
          // Load status badge for display
          if (result.replayId) {
            const s = await statusIndex.getStatus(result.replayId);
            store.setReplayStatus(s);
          }
          store.setReplayExecuting(false);
          store.setTraceDetailMode("replay-result");
          tui.appendOutput("Replay complete. " + result.successCount + "/" + result.steps.length + " steps succeeded.\n", false);
        } catch (err: any) {
          store.setReplayExecuting(false);
          tui.appendOutput("Replay error: " + err.message + "\n", false);
        }
      } else {
        // Anything else cancels
        (globalThis as any).__replayConfirm = null;
        tui.appendOutput("Replay cancelled.\n", false);
      }
      continue;
    }

    // Rollback confirmation
    const rollbackConfirm = (globalThis as any).__rollbackConfirm;
    if (rollbackConfirm) {
      const confirmPhrase = task.toLowerCase().trim();
      if (confirmPhrase === "rollback yes") {
        (globalThis as any).__rollbackConfirm = null;
        const { plan, resume } = rollbackConfirm;
        const { RollbackExecutor } = await import("../../runtime/rollback-executor.js");
        const { ReplayStatusIndex } = await import("../../runtime/replay-status-index.js");
        const { ReplayLock } = await import("../../runtime/replay-lock.js");
        const { RollbackProgressStore } = await import("../../runtime/rollback-progress.js");
        const executor = new RollbackExecutor(activeCwd, tuiLog);

        tui.appendOutput("Executing rollback...\n", false);

        try {
          const opts: any = {
            resume,
            statusIndex: new ReplayStatusIndex(activeCwd),
            replayLock: new ReplayLock(activeCwd),
            progressStore: new RollbackProgressStore(activeCwd),
          };
          if (approvalStore) {
            opts.approvalStore = approvalStore;
          }
          const result = await executor.execute(plan, opts);
          store.setReplayResult(result as any);
          store.setTraceDetailMode("rollback-result" as any);

          const statusMsg = result.completionStatus === "noop"
            ? "Rollback already completed — no action taken."
            : result.completionStatus === "blocked"
              ? "Rollback blocked — check warnings."
              : `${result.successCount} files restored, ${result.skippedCount} skipped.`;
          tui.appendOutput("Rollback complete. " + statusMsg + "\n", false);
        } catch (err: any) {
          tui.appendOutput("Rollback error: " + err.message + "\n", false);
        }
      } else {
        (globalThis as any).__rollbackConfirm = null;
        tui.appendOutput("Rollback cancelled.\n", false);
      }
      continue;
    }

    // Trace navigation — ↑/k = up, ↓/j = down (when detail closed)
    if (store.getState().activePanel === "trace") {
      if (task === "\x1b[A" || task === "k") {
        store.selectPreviousTraceEvent();
        renderPanelContent(store, tui);
        continue;
      }
      if (!store.getState().traceSelection.detailOpen && (task === "\x1b[B" || task.toLowerCase() === "j")) {
        store.selectNextTraceEvent();
        renderPanelContent(store, tui);
        continue;
      }
      // Close detail on escape
      if (task === "\x1b" && store.getState().traceSelection.detailOpen) {
        store.closeTraceDetail();
        renderPanelContent(store, tui);
        continue;
      }
    }

    // Trace detail mode switching (when detail is open, j/l/c/s switch modes)
    if (store.getState().activePanel === "trace" && store.getState().traceSelection.detailOpen) {
      if (task.toLowerCase() === "j") {
        store.setTraceDetailMode("json");
        renderPanelContent(store, tui);
        continue;
      }
      if (task.toLowerCase() === "l") {
        store.setTraceDetailMode("links");
        renderPanelContent(store, tui);
        continue;
      }
      if (task.toLowerCase() === "c") {
        store.setTraceDetailMode("chain");
        renderPanelContent(store, tui);
        continue;
      }
      if (task.toLowerCase() === "s") {
        store.setTraceDetailMode("summary");
        renderPanelContent(store, tui);
        continue;
      }
      if (task.toLowerCase() === "p") {
        store.setTraceDetailMode("replay");
        renderPanelContent(store, tui);
        continue;
      }
      if (task.toLowerCase() === "x") {
        const selected = store.getSelectedTraceEvent();
        if (!selected) {
          tui.appendOutput("No trace event selected.\n", false);
          continue;
        }
        const { buildReplayPreview } = await import("../../runtime/replay-preview.js");
        const { buildReplayPlan } = await import("../../runtime/replay-plan.js");

        const preview = buildReplayPreview(selected, store.getState().traceEvents);
        const plan = buildReplayPlan(preview, store.getState().traceEvents, "dry-run");

        if (!plan.executable) {
          tui.appendOutput("Cannot replay: " + plan.reason + " or no executable steps\n", false);
          continue;
        }

        tui.appendOutput("Replay selected chain in dry-run mode? type: replay yes\n", false);
        // Store confirmation context on globalThis
        (globalThis as any).__replayConfirm = { plan };
        continue;
      }
    }

    if (task.toLowerCase() === "r" || task.toLowerCase() === "refresh") {
      const fresh = await buildRuntimeSnapshot(activeCwd);
      if (fresh) applySnapshotToStore(tuiStore, fresh);
      // Also refresh replays data if on replays panel
      if (store.getState().activePanel === "replays" || store.getState().replayIndexData) {
        const { ReplayStatusIndex } = await import("../../runtime/replay-status-index.js");
        const { ReplayLock } = await import("../../runtime/replay-lock.js");
        const statusIndex = new ReplayStatusIndex(activeCwd);
        const replayLock = new ReplayLock(activeCwd);
        const data = await statusIndex.load();
        store.setReplayIndexData(data);
        const lockStates: Record<string, boolean> = {};
        for (const entry of data.entries) {
          lockStates[entry.replayId] = await replayLock.isLocked(entry.replayId);
        }
        store.setReplayLockStates(lockStates);
      }
      tui.appendOutput("Runtime snapshot refreshed.\n", false);
      continue;
    }
    if (task === "?" || task.toLowerCase() === "help") {
      const dState = store.getState().showDashboard ? "on" : "off";
      tui.appendOutput(`Commands: r=refresh tab=next panel d=dashboard(${dState}) /approvals /approve<id> /deny<id> ?=help q=quit\n`, false);
      continue;
    }
    if (task.toLowerCase() === "d") {
      store.toggleDashboard();
      tui.appendOutput(`Dashboard: ${store.getState().showDashboard ? "on" : "off"}\n`, false);
      continue;
    }
    if (task.toLowerCase() === "t") {
      const filters = ["all", "policy", "approval", "continuation", "tool", "task", "session", "daemon", "runtime", "replay", "rollback", "ifamas"] as const;
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
                const executor = new ToolExecutor(activeConfig, tuiLog, activeCwd, undefined, undefined, undefined, undefined, approvalStore);
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

      // Check for /replay command
      if (task.startsWith("/replay ")) {
        const args = task.slice("/replay ".length).trim().split(/\s+/);
        const target = args[0]; // "selected" (ignored for now — always uses selected)
        let modeFlag: "dry-run" | "sandbox" | "approved-live";
        if (args.includes("--approved-live")) {
          modeFlag = "approved-live";
        } else if (args.includes("--sandbox")) {
          modeFlag = "sandbox";
        } else {
          modeFlag = "dry-run";
        }

        const selected = store.getSelectedTraceEvent();
        if (!selected) {
          tui.appendOutput("No trace event selected. Navigate to a trace event first.\n", false);
          continue;
        }

        const { buildReplayPreview } = await import("../../runtime/replay-preview.js");
        const { buildReplayPlan } = await import("../../runtime/replay-plan.js");
        const { ReplayExecutor } = await import("../../runtime/replay-executor.js");

        const preview = buildReplayPreview(selected, store.getState().traceEvents);
        const plan = buildReplayPlan(preview, store.getState().traceEvents, modeFlag);

        if (!plan.executable) {
          tui.appendOutput("Cannot replay: " + (plan.reason || "no executable steps") + "\n", false);
          continue;
        }

        // Get confirmation for sandbox mode
        if (modeFlag === "sandbox") {
          tui.appendOutput("Replay selected chain in sandbox mode? (shell runs in isolated dir) type: replay yes\n", false);
          (globalThis as any).__replayConfirm = { plan, mode: "sandbox" };
          continue;
        }

        // Get confirmation for approved-live mode with warning
        if (modeFlag === "approved-live") {
          tui.appendOutput("WARNING: Approved-live replay will execute tool calls with REAL side effects.\n", false);
          tui.appendOutput("Type: replay yes --approved-live to confirm\n", false);
          (globalThis as any).__replayConfirm = { plan, mode: "approved-live" };
          continue;
        }

        tui.appendOutput("Replaying in " + modeFlag + " mode (" + plan.steps.filter(s => s.status === "ready").length + " ready steps)...\n", false);
        store.setReplayExecuting(true);
        const executor = new ReplayExecutor(activeCwd, tuiLog);
        const { ReplayStatusIndex } = await import("../../runtime/replay-status-index.js");
        const statusIndex = new ReplayStatusIndex(activeCwd);

        try {
          const opts: any = { statusIndex };
          const result = await executor.execute(plan, opts);
          store.setReplayResult(result);
          if (result.replayId) {
            const s = await statusIndex.getStatus(result.replayId);
            store.setReplayStatus(s);
          }
          store.setReplayExecuting(false);
          store.setTraceDetailMode("replay-result");
          tui.appendOutput("Replay complete. " + result.successCount + "/" + result.steps.length + " steps succeeded.\n", false);
        } catch (err: any) {
          store.setReplayExecuting(false);
          tui.appendOutput("Replay error: " + err.message + "\n", false);
        }
        continue;
      }

      // Check for /rollback command
      if (task.startsWith("/rollback ")) {
        const args = task.slice("/rollback ".length).trim().split(/\s+/);
        let modeFlag: "dry-run" | "approved-live" = "dry-run";
        if (args.includes("--approved-live") || args.includes("--live")) {
          modeFlag = "approved-live";
        }
        const resumeFlag = args.includes("--resume");

        // Determine replayId
        let replayId: string | undefined;
        const target = args[0];
        if (target === "selected") {
          const selected = store.getSelectedTraceEvent();
          replayId = selected?.replayId;
          if (!replayId) {
            tui.appendOutput("Selected trace event has no replayId.\n", false);
            continue;
          }
        } else {
          replayId = target;
        }

        const { ReplayDiffStore } = await import("../../runtime/replay-diff-store.js");
        const { buildRollbackPlan } = await import("../../runtime/rollback-plan.js");
        const { RollbackExecutor } = await import("../../runtime/rollback-executor.js");
        const { ReplayStatusIndex } = await import("../../runtime/replay-status-index.js");
        const { ReplayLock } = await import("../../runtime/replay-lock.js");
        const { RollbackProgressStore } = await import("../../runtime/rollback-progress.js");

        const diffStore = new ReplayDiffStore(activeCwd);
        const diffSet = await diffStore.loadIndex(replayId);

        if (!diffSet || diffSet.records.length === 0) {
          tui.appendOutput("No replay diff data found for replayId: " + replayId + "\n", false);
          continue;
        }

        const plan = buildRollbackPlan(replayId, diffSet, modeFlag);
        if (plan.steps.length === 0) {
          tui.appendOutput("No rollback steps to execute.\n", false);
          continue;
        }

        // Confirmation for approved-live
        if (modeFlag === "approved-live") {
          if (resumeFlag) {
            tui.appendOutput("Resuming rollback for replay " + replayId + " from last incomplete step?\n", false);
          } else {
            tui.appendOutput("Rollback replay " + replayId + " with real file changes?\n", false);
          }
          tui.appendOutput("Type: rollback yes\n", false);
          (globalThis as any).__rollbackConfirm = { plan, resume: resumeFlag };
          continue;
        }

        // Dry-run: execute immediately
        const executor = new RollbackExecutor(activeCwd, tuiLog);
        const result = await executor.execute(plan);
        store.setReplayResult(result as any);
        store.setTraceDetailMode("rollback-result" as any);
        tui.appendOutput("Rollback dry-run: " + result.successCount + " would be restored, " + result.skippedCount + " skipped.\n", false);
        continue;
      }

      // Check for /replays command
      if (task === "/replays") {
        const { ReplayStatusIndex } = await import("../../runtime/replay-status-index.js");
        const { ReplayLock } = await import("../../runtime/replay-lock.js");
        const statusIndex = new ReplayStatusIndex(activeCwd);
        const replayLock = new ReplayLock(activeCwd);

        const data = await statusIndex.load();
        store.setReplayIndexData(data);

        // Check lock state for each entry
        const lockStates: Record<string, boolean> = {};
        for (const entry of data.entries) {
          lockStates[entry.replayId] = await replayLock.isLocked(entry.replayId);
        }
        store.setReplayLockStates(lockStates);

        store.setPanel("replays");
        tui.appendOutput(`Replays panel: ${data.entries.length} replays found.\n`, false);
        continue;
      }

      // Check for /replay-status <replayId>
      if (task.startsWith("/replay-status ")) {
        const replayId = task.slice("/replay-status ".length).trim();
        if (!replayId) {
          tui.appendOutput("Usage: /replay-status <replayId>\n", false);
          continue;
        }

        const { ReplayStatusIndex } = await import("../../runtime/replay-status-index.js");
        const { ReplayLock } = await import("../../runtime/replay-lock.js");
        const { RollbackProgressStore } = await import("../../runtime/rollback-progress.js");
        const { ReplayDiffStore } = await import("../../runtime/replay-diff-store.js");

        const statusIndex = new ReplayStatusIndex(activeCwd);
        const replayLock = new ReplayLock(activeCwd);
        const progressStore = new RollbackProgressStore(activeCwd);
        const diffStore = new ReplayDiffStore(activeCwd);

        const entry = await statusIndex.getEntry(replayId);
        if (!entry) {
          tui.appendOutput(`Replay not found: ${replayId}\n`, false);
          continue;
        }

        const lines: string[] = [];
        lines.push(`ReplayId: ${entry.replayId}`);
        lines.push(`Status:   ${entry.status}`);
        if (entry.replayMode) lines.push(`Mode:     ${entry.replayMode}`);
        lines.push(`Created:  ${entry.createdAt}`);
        lines.push(`Updated:  ${entry.updatedAt}`);

        // Lock status
        const locked = await replayLock.isLocked(replayId);
        if (locked) {
          const lockInfo = await replayLock.getLockInfo(replayId);
          if (lockInfo) {
            const stale = await replayLock.isStale(replayId);
            lines.push(`Lock:     held by pid ${lockInfo.pid} on ${lockInfo.hostname} (${stale ? "STALE" : "active"})`);
            if (stale) {
              lines.push(`  ⚠ Stale lock detected — use /rollback ${replayId} --approved-live --resume to recover`);
            }
          } else {
            lines.push(`Lock:     held (unreadable lock file)`);
          }
        } else {
          lines.push(`Lock:     not locked`);
        }

        // Diff info
        const diffSet = await diffStore.loadIndex(replayId);
        if (diffSet) {
          lines.push(`Files:    ${diffSet.totalFilesChanged} changed (${diffSet.totalRollbackable} rollbackable)`);
        }

        // Rollback progress
        const progress = await progressStore.load(replayId);
        if (progress) {
          lines.push(`Rollback:  ${progress.status}`);
          lines.push(`  Steps:  ${progress.lastCompletedStepIndex + 1} completed`);
          if (progress.failedPath) lines.push(`  Failed: ${progress.failedPath}`);
          if (progress.status === "partial") {
            lines.push(`  ⚠ Partial rollback — use /rollback ${replayId} --approved-live --resume to continue`);
          }
        }

        tui.appendOutput(lines.join("\n") + "\n", false);
        continue;
      }

      // /ifamas — run IFÁ-MAS diagnostic pipeline
      if (task.startsWith("/ifamas")) {
        const selected = store.getSelectedTraceEvent();

        if (selected) {
          // Tier 1: Run diagnostic on selected trace event (existing behavior)
          const { createSignalFrame } = await import("../../runtime/signal-frame.js");
          const { runIfamasDiagnostic } = await import("../../runtime/ifamas-pipeline.js");

          const bits = {
            intentClear: true, policyRisk: false, toolRequired: false,
            memoryRequired: false, freshnessRequired: false,
            mutationPossible: false, approvalRequired: false,
            replayRollbackContext: false,
          };
          const signal = createSignalFrame({ bits, domain: "task", intent: selected.label ?? "trace-event" });

          try {
            const diagnostic = await runIfamasDiagnostic({ signal, eventLog: tuiLog });
            const { formatIfamasPanel } = await import("../../tui/ifamas-panel.js");

            const panelData = {
              signalCode: diagnostic.signal.code,
              polarity: diagnostic.signal.polarity,
              offeringAction: diagnostic.offering.action,
              routeTarget: diagnostic.routeDecision.routeHint.targetRole,
              gatewayValid: diagnostic.gatewayValidation.valid,
              guildCandidateCount: diagnostic.guildCandidates.length,
              topGuildCandidate: diagnostic.guildCandidates[0]?.profile?.agentId,
              chronicleRefCount: diagnostic.routeDecision.chronicleEntries.length,
            };

            store.getState().ifamasPanelData = panelData;
            store.setPanel("ifamas");
            const panelLines = formatIfamasPanel(panelData);
            tui.appendOutput(panelLines.join("\n") + "\n", false);
            tui.appendOutput("Diagnostic recorded as trace event.\n", false);
          } catch (err: any) {
            tui.appendOutput("IFÁ-MAS diagnostic error: " + err.message + "\n", false);
          }
        } else if (store.getState().ifamasPanelData) {
          // Tier 2: No trace selected but we have previous diagnostic data
          const { formatIfamasPanel } = await import("../../tui/ifamas-panel.js");
          store.setPanel("ifamas");
          const panelLines = formatIfamasPanel(store.getState().ifamasPanelData!);
          tui.appendOutput("No trace event selected. Showing latest IFÁ-MAS diagnostic instead.\n", false);
          tui.appendOutput(panelLines.join("\n") + "\n", false);
        } else {
          // Tier 3: Nothing available
          tui.appendOutput("No IFÁ-MAS diagnostic available yet.\n", false);
          tui.appendOutput("Run a task in the TUI first, then use /ifamas to diagnose a trace event.\n", false);
          tui.appendOutput("Or type: /ifamas (with a trace event selected) to run a fresh diagnostic.\n", false);
        }
        continue;
      }

      // /chronicle — search IFÁ-MAS Chronicle entries
      if (task.startsWith("/chronicle")) {
        const { ChronicleStore } = await import("../../chronicle/chronicle-store.js");
        const { chronicleEntryToPanelEntry, formatChroniclePanel } = await import("../../tui/chronicle-panel.js");

        const args = task.slice("/chronicle".length).trim();
        const chronicleStore = new ChronicleStore(activeCwd);

        let entries: Awaited<ReturnType<typeof chronicleStore.search>>;
        let queryLabel = "";

        if (args.startsWith("signal:")) {
          entries = await chronicleStore.search({ signalCode: args.slice(7) });
          queryLabel = args;
        } else if (args.startsWith("trace:")) {
          entries = await chronicleStore.search({});
          queryLabel = args;
        } else if (args.startsWith("offering:")) {
          entries = await chronicleStore.search({});
          queryLabel = args;
        } else if (args.startsWith("route:")) {
          entries = await chronicleStore.search({});
          queryLabel = args;
        } else if (args) {
          tui.appendOutput(`Unknown filter: ${args}. Use: signal:<code>, trace:<id>, offering:<action>, route:<target>\n`, false);
          continue;
        } else {
          entries = await chronicleStore.search({});
        }

        const panelEntries = entries.slice(0, 20).map(chronicleEntryToPanelEntry);

        const panelData = {
          query: queryLabel || undefined,
          entries: panelEntries,
          totalEntries: entries.length,
          emptyReason: entries.length === 0 ? "No chronicle entries found. Run /ifamas on a trace event first." : undefined,
        };

        store.getState().chroniclePanelData = panelData;
        store.setPanel("chronicle");

        const panelLines = formatChroniclePanel(panelData);
        tui.appendOutput(panelLines.join("\n") + "\n", false);
        continue;
      }

      // Check for /batch commands
      if (task.startsWith("/batch ")) {
        const args = task.slice("/batch ".length).trim().split(/\s+/);
        const subcommand = args[0];

        if (subcommand === "select") {
          const replayId = args[1];
          if (!replayId) {
            tui.appendOutput("Usage: /batch select <replayId>\n", false);
            continue;
          }
          store.addSelectedReplayId(replayId);
          tui.appendOutput(`Selected: ${replayId}\n`, false);
          continue;
        }

        if (subcommand === "deselect") {
          const replayId = args[1];
          if (!replayId) {
            tui.appendOutput("Usage: /batch deselect <replayId>\n", false);
            continue;
          }
          store.removeSelectedReplayId(replayId);
          tui.appendOutput(`Deselected: ${replayId}\n`, false);
          continue;
        }

        if (subcommand === "clear") {
          store.clearSelectedReplayIds();
          tui.appendOutput("Selection cleared.\n", false);
          continue;
        }

        if (subcommand === "list") {
          const ids = store.getState().selectedReplayIds;
          if (ids.length === 0) {
            tui.appendOutput("No replays selected. Use /batch select <replayId>.\n", false);
          } else {
            tui.appendOutput(`Selected replays (${ids.length}):\n`, false);
            for (const id of ids) {
              tui.appendOutput(`  ${id}\n`, false);
            }
          }
          continue;
        }

        if (subcommand === "rollback-preview") {
          const selectedIds = store.getState().selectedReplayIds;
          if (selectedIds.length === 0) {
            tui.appendOutput("No replays selected. Use /batch select <replayId> first.\n", false);
            continue;
          }

          const { ReplayDiffStore } = await import("../../runtime/replay-diff-store.js");
          const { ReplayStatusIndex } = await import("../../runtime/replay-status-index.js");
          const { buildBatchRollbackPreview, formatBatchRollbackPreview } = await import("../../runtime/batch-preview.js");

          const diffStore = new ReplayDiffStore(activeCwd, new ReplayStatusIndex(activeCwd));
          const diffSets = new Map<string, import("../../runtime/replay-diff-store.js").ReplayDiffSet>();

          for (const id of selectedIds) {
            const ds = await diffStore.loadIndex(id);
            if (ds && ds.records.length > 0) {
              diffSets.set(id, ds);
            } else {
              tui.appendOutput(`  ⚠ No diff data for: ${id}\n`, false);
            }
          }

          if (diffSets.size === 0) {
            tui.appendOutput("No diff data found for any selected replay.\n", false);
            continue;
          }

          const preview = await buildBatchRollbackPreview(diffSets);
          const lines = formatBatchRollbackPreview(preview);
          tui.appendOutput(lines.join("\n") + "\n", false);
          continue;
        }

        if (subcommand === "replay-preview") {
          const selectedIds = store.getState().selectedReplayIds;
          if (selectedIds.length === 0) {
            tui.appendOutput("No replays selected. Use /batch select <replayId> first.\n", false);
            continue;
          }

          const { ReplayStatusIndex } = await import("../../runtime/replay-status-index.js");
          const statusIndex = new ReplayStatusIndex(activeCwd);

          const lines: string[] = [];
          lines.push(`Batch Replay Preview (${selectedIds.length} replays selected)`);
          lines.push("═══════════════════════════════════════════");

          let hasWarnings = false;

          for (const id of selectedIds) {
            const entry = await statusIndex.getEntry(id);
            if (!entry) {
              lines.push(`  ${id}: (not found in index)`);
              continue;
            }
            const mode = entry.replayMode || "dry-run";
            lines.push(`  ${id} (${mode}):`);
            lines.push(`    Status: ${entry.status}`);
            if (entry.status === "rollback-partial") {
              lines.push(`    ⚠ Partial rollback detected -- rollback --resume recommended`);
              hasWarnings = true;
            }
          }

          lines.push("");
          lines.push("Safety Summary:");
          lines.push(`  Total replays:   ${selectedIds.length}`);
          if (hasWarnings) {
            lines.push("  ⚠ Some replays have warnings -- review before execution");
          }

          tui.appendOutput(lines.join("\n") + "\n", false);
          continue;
        }

        // Unknown subcommand
        tui.appendOutput("Unknown /batch command. Available: select, deselect, clear, list, replay-preview, rollback-preview\n", false);
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
          approvalStore: approvalStore,
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
