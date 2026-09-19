/**
 * `alix audit / daemon` subcommands — extracted from `src/cli.ts`
 * (#717 step 6). Bodies moved verbatim; each handler terminates via `process.exit`.
 */

import "node:fs";
import "../../config/model-resolver.js";
import "../../index.js";
import "./prompt.js";
import "../helpers/api-keys.js";
import "../../providers/catalog.js";
import { resolveDaemonTasksReadPath } from "../../daemon/daemon-paths.js";

export async function handleDaemonRoot(args: string[]): Promise<void> {
  const { DaemonManager } = await import("../../daemon/daemon-manager.js");
  const cwd = process.cwd();
  const mgr = new DaemonManager(cwd);

  if (args[0] === "start") {
    try {
      const status = await mgr.start();
      console.log(`Daemon started (pid ${status.pid})`);
      console.log(`Socket: ${status.socketPath}`);
      process.exit(0);
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  }

  if (args[0] === "stop") {
    await mgr.stop();
    console.log("Daemon stopped.");
    process.exit(0);
  }

  if (args[0] === "status") {
    const running = await mgr.isRunning();
    const status = await mgr.status();
    if (!status) {
      console.log("Daemon has never been started.");
    } else {
      console.log(`Status: ${running ? "running" : "stopped"}`);
      console.log(`PID:    ${status.pid}`);
      console.log(`Started: ${status.startedAt ? new Date(status.startedAt).toLocaleString() : "?"}`);
      if (status.socketPath) console.log(`Socket: ${status.socketPath}`);
      if (status.currentSessionId) console.log(`Session: ${status.currentSessionId}`);
    }
    process.exit(0);
  }

  if (args[0] === "tasks") {
    const { readFileSync, existsSync } = await import("node:fs");
    const tasksPath = resolveDaemonTasksReadPath(cwd);
    if (!existsSync(tasksPath)) { console.log("No daemon tasks."); process.exit(0); }
    try {
      const raw = readFileSync(tasksPath, "utf-8");
      let tasks = JSON.parse(raw);
      // --status filter
      const statusIdx = args.indexOf("--status");
      if (statusIdx >= 0) {
        const filter = args[statusIdx + 1];
        tasks = tasks.filter((t: any) => t.status === filter);
      }
      if (tasks.length === 0) { console.log("No daemon tasks."); process.exit(0); }
      console.log(`${"ID".padEnd(28)} ${"Status".padEnd(18)} Session${"".padEnd(20)} Task`);
      console.log("-".repeat(100));
      for (const t of tasks.slice(0, 50)) {
        const sess = (t.sessionId || "-").slice(0, 22);
        console.log(`${t.id.padEnd(28)} ${t.status.padEnd(18)} ${sess.padEnd(22)} ${t.task.slice(0, 30)}`);
      }
      console.log(`\n${tasks.length} tasks (showing ${Math.min(tasks.length, 50)})`);
    } catch { console.log("Could not read task data."); }
    process.exit(0);
  }

  if (args[0] === "doctor") {
    const { existsSync, readFileSync } = await import("node:fs");
    const {  } = await import("node:path");
    console.log("Daemon Doctor — health check\n");
    const running = await mgr.isRunning();
    const status = await mgr.status();
    console.log(`Status:  ${running ? "running" : "stopped"}`);
    if (status) {
      console.log(`PID:     ${status.pid}`);
      console.log(`Started: ${status.startedAt ? new Date(status.startedAt).toLocaleString() : "?"}`);
      if (status.lastHeartbeat) {
        const age = Date.now() - new Date(status.lastHeartbeat).getTime();
        console.log(`Heartbeat: ${Math.round(age / 1000)}s ago ${age > 60000 ? "(STALE)" : "(ok)"}`);
      }
      if (status.socketPath) console.log(`Socket:  ${existsSync(status.socketPath) ? "✓ exists" : "✗ missing"} ${status.socketPath}`);
    }
    // Task summary
    const tasksPath = resolveDaemonTasksReadPath(cwd);
    if (existsSync(tasksPath)) {
      try {
        const tasks = JSON.parse(readFileSync(tasksPath, "utf-8"));
        const byStatus: Record<string, number> = {};
        for (const t of tasks) byStatus[t.status] = (byStatus[t.status] || 0) + 1;
        console.log(`\nTasks: ${tasks.length} total`);
        for (const [s, count] of Object.entries(byStatus)) {
          console.log(`  ${s}: ${count}`);
        }
      } catch {}
    }
    process.exit(0);
  }

  if (args[0] === "cancel") {
    const taskId = args[1];
    if (!taskId) { console.error("Usage: alix daemon cancel <taskId>"); process.exit(1); }
    const { connect } = await import("node:net");
    const status = await mgr.status();
    if (!status?.socketPath) { console.error("Daemon socket not available."); process.exit(1); }
    const client = connect(status.socketPath, () => {
      client.write(JSON.stringify({ command: "cancel", taskId }) + "\n");
    });
    client.on("data", (data: Buffer) => {
      for (const line of data.toString().trim().split("\n")) {
        try {
          const msg = JSON.parse(line);
          if (msg.type === "task.cancelled") {
            console.log(`Cancelled: ${msg.taskId}`);
            if (msg.requested) console.log("(cancel requested — will stop after current operation)");
          } else if (msg.type === "cancel.error") {
            console.error(`Error: ${msg.message}`);
          }
        } catch { console.log(line); }
      }
      client.end();
    });
    client.on("close", () => process.exit(0));
    client.on("error", (err) => { console.error(err.message); process.exit(1); });
  }

  console.log("Usage: alix daemon [start|stop|status|tasks|cancel|doctor]");
  process.exit(0);
}

export async function handleAuditRoot(args: string[]): Promise<void> {
  const cwd = process.cwd();

  // Sd2: verify
  if (args[0] === "verify") {
    const { handleAuditVerify } = await import("./security.js");
    await handleAuditVerify(args.slice(1));
    // handleAuditVerify calls process.exit
    process.exit(0);
  }

  // Sd1.6/#683: activate the integrity chain on a legacy log
  if (args[0] === "activate") {
    const { handleAuditActivate } = await import("./security.js");
    await handleAuditActivate(args.slice(1));
    process.exit(0);
  }

  // Sd2: checkpoint
  if (args[0] === "checkpoint") {
    const { handleAuditCheckpoint } = await import("./security.js");
    await handleAuditCheckpoint(args.slice(1));
    process.exit(0);
  }

  // Sd2: checkpoint-verify
  if (args[0] === "checkpoint-verify") {
    const { handleAuditCheckpointVerify } = await import("./security.js");
    await handleAuditCheckpointVerify(args.slice(1));
    process.exit(0);
  }

  // Legacy: query commands
  const { AuditStore } = await import("../../audit/audit-store.js");
  const store = new AuditStore(cwd);

  if (args[0] === "list") {
    const limitIdx = args.indexOf("--limit");
    const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) || 50 : 50;
    const records = await store.list(limit);
    if (records.length === 0) { console.log("No audit records."); process.exit(0); }
    console.log(`${"ID".padEnd(24)} ${"Action".padEnd(22)} Timestamp`);
    console.log("-".repeat(80));
    for (const r of records) {
      console.log(`${r.id.slice(0, 22).padEnd(24)} ${r.action.padEnd(22)} ${r.timestamp ? new Date(r.timestamp).toLocaleString() : ""}`);
    }
    console.log(`\n${records.length} records`);
    process.exit(0);
  }

  if (args[0] === "by-graph") {
    const graphId = args[1];
    if (!graphId) { console.error("Usage: alix audit by-graph <graphId>"); process.exit(1); }
    const records = await store.findByGraph(graphId);
    if (records.length === 0) { console.log("No records for graph."); process.exit(0); }
    for (const r of records) {
      const detail = `${r.action}${r.details.nodeId ? " node=" + r.details.nodeId : ""}${r.details.capability ? " cap=" + r.details.capability : ""}`;
      console.log(`  [${r.action}] ${new Date(r.timestamp).toLocaleTimeString()} ${detail}`);
      if (r.details.reason) console.log(`    reason: ${r.details.reason}`);
    }
    process.exit(0);
  }

  if (args[0] === "by-approval") {
    const approvalId = args[1];
    if (!approvalId) { console.error("Usage: alix audit by-approval <approvalId>"); process.exit(1); }
    const records = await store.findByApproval(approvalId);
    if (records.length === 0) { console.log("No records for approval."); process.exit(0); }
    for (const r of records) {
      console.log(`  [${r.action}] ${new Date(r.timestamp).toLocaleTimeString()} ${r.details.reason || ""}`);
    }
    process.exit(0);
  }

  if (args[0] === "by-action") {
    const action = args[1];
    if (!action) { console.error("Usage: alix audit by-action <action>"); process.exit(1); }
    const records = await store.findByAction(action as any);
    if (records.length === 0) { console.log("No records for action."); process.exit(0); }
    for (const r of records) {
      console.log(`  ${r.id.slice(0, 22)} ${new Date(r.timestamp).toLocaleTimeString()} ${r.details.capability || ""} ${r.details.reason || ""}`);
    }
    process.exit(0);
  }

  console.log("Usage: alix audit [list|by-graph|by-approval|by-action|verify|checkpoint|checkpoint-verify]");
  console.log("  list              Show recent audit events");
  console.log("  by-graph <id>     Show audit events for a graph");
  console.log("  by-approval <id>  Show audit events for an approval");
  console.log("  by-action <act>   Filter by action type");
  console.log("  verify             Stream-verify the audit log integrity (Sd2)");
  console.log("    --json           Output structured findings as JSON");
  console.log("    --all            Also verify the governance audit chain");
  console.log("  checkpoint         Create signed checkpoint evidence (Sd2)");
  console.log("    --output <path>  Write checkpoint to file");
  console.log("  checkpoint-verify <path>  Verify a checkpoint (Sd2)");
  process.exit(0);
}

