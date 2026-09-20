/**
 * `alix approvals / capability / doctor` subcommands — extracted from `src/cli.ts`
 * (#717 step 6). Bodies moved verbatim; each handler terminates via `process.exit`.
 */

import "node:fs";
import { join } from "node:path";
import "../../config/model-resolver.js";
import "../../index.js";
import "./prompt.js";
import "../helpers/api-keys.js";
import "../../providers/catalog.js";
import { resolveDaemonTasksReadPath } from "../../daemon/daemon-paths.js";

export async function handleCapabilityRoot(args: string[]): Promise<void> {
  const { handleCapabilityCommand } = await import("./capability.js");
  const { CapabilityPlatform } = await import("../../capability/platform.js");
  const { EventLog } = await import("../../events/event-log.js");
  const cwd = process.cwd();
  const sessionDir = join(cwd, ".alix", "sessions", "capability-cmd");
  const eventLog = new EventLog(sessionDir);
  const platform = new CapabilityPlatform({
    catalogDir: join(cwd, ".alix", "capabilities"),
    eventLog,
  });
  const exitCode = await handleCapabilityCommand(args, {
    cwd,
    service: platform.service,
    definitions: platform.definitions,
  });
  if (typeof exitCode === "number") process.exit(exitCode);
}

export async function handleApprovalsRoot(args: string[]): Promise<void> {
  const { openApprovalStores } = await import("../helpers/approval-stores.js");
  const cwd = process.cwd();
  const { union, owner } = await openApprovalStores(cwd);

  if (args[0] === "list") {
    const all = union((s) => s.list());
    if (all.length === 0) {
      console.log("No approval requests.");
    } else {
      console.log(`${"ID".padEnd(38)} ${"Status".padEnd(10)} Capability${"".padEnd(12)} Created`);
      console.log("-".repeat(90));
      for (const a of all) {
        const cap = ((a.capabilities?.length ? a.capabilities[0] : undefined) || a.toolId || "—").slice(0, 18);
        console.log(`${a.id.padEnd(38)} ${a.status.padEnd(10)} ${cap.padEnd(18)} ${new Date(a.createdAt).toLocaleString()}`);
      }
    }
    process.exit(0);
  }

  if (args[0] === "pending") {
    const pending = union((s) => s.listPending());
    if (pending.length === 0) {
      console.log("No pending approvals.");
    } else {
      console.log(`${"ID".padEnd(38)} Capability${"".padEnd(12)} Reason`);
      console.log("-".repeat(90));
      for (const a of pending) {
        const cap = ((a.capabilities?.length ? a.capabilities[0] : undefined) || a.toolId || "—").slice(0, 18);
        console.log(`${a.id.padEnd(38)} ${cap.padEnd(18)} ${a.reason.slice(0, 40)}`);
      }
    }
    process.exit(0);
  }

  if (args[0] === "show") {
    const id = args[1];
    if (!id) { console.error("Usage: alix approvals show <id>"); process.exit(1); }
    const record = owner(id).get(id);
    if (!record) { console.error(`Approval not found: ${id}`); process.exit(1); }
    console.log(`ID:       ${record.id}`);
    console.log(`Status:   ${record.status}`);
    if (record.capabilities?.length) console.log(`Capability: ${record.capabilities[0]}`);
    if (record.toolId) console.log(`Tool:     ${record.toolId}`);
    if (record.riskLevel) console.log(`Risk:     ${record.riskLevel}`);
    if (record.graphId) console.log(`Graph:    ${record.graphId}`);
    if (record.nodeId) console.log(`Node:     ${record.nodeId}`);
    if (record.sessionId) console.log(`Session:  ${record.sessionId}`);
    if (record.metadata?.scheduleProposal) {
      console.log(`Schedule: ${JSON.stringify(record.metadata.scheduleProposal)}`);
    }
    console.log(`Reason:   ${record.reason}`);
    console.log(`Created:  ${new Date(record.createdAt).toLocaleString()}`);
    if (record.decidedAt) console.log(`Decided:  ${new Date(record.decidedAt).toLocaleString()}`);
    if (record.decisionReason) console.log(`Decision reason: ${record.decisionReason}`);
    process.exit(0);
  }

  if (args[0] === "approve" || args[0] === "deny") {
    const id = args[1];
    if (!id) { console.error(`Usage: alix approvals ${args[0]} <id> [--reason "..."]`); process.exit(1); }
    const reasonIdx = args.indexOf("--reason");
    const decisionReason = reasonIdx >= 0 ? args[reasonIdx + 1] : undefined;
    const status = args[0] === "approve" ? "approved" as const : "denied" as const;
    const result = await owner(id).resolve(id, status, decisionReason);
    if (!result) { console.error(`Approval not found: ${id}`); process.exit(1); }
    console.log(`${status.charAt(0).toUpperCase() + status.slice(1)}: ${id}`);
    process.exit(0);
  }

  console.log("Usage: alix approvals [list|pending|show|approve|deny]");
  console.log("  list              List all approval requests");
  console.log("  pending           List pending approvals only");
  console.log('  show <id>         Show approval details');
  console.log('  approve <id>      Approve a pending request');
  console.log('  deny <id>         Deny a pending request');
  process.exit(0);
}

export async function handleDoctorRoot(args: string[]): Promise<void> {
  if (args.includes("--performance")) {
    const { runPerformanceDoctor } = await import("./performance-doctor.js");
    process.exit(await runPerformanceDoctor(process.cwd()));
  }
  const cwd = process.cwd();
  const { existsSync, readFileSync } = await import("node:fs");
  const {  } = await import("node:path");
  let failed = false;

  console.log("ALiX Doctor — system health check\n");

  try {
    const { loadCardRegistry, defaultAgentCards } = await import("../../registry/card-loader.js");
    const reg = await loadCardRegistry(cwd);
    console.log(`[${reg.listAgents().length === defaultAgentCards().length ? "✓" : "⚠"}] Cards: ${reg.listAgents().length} agents, ${reg.listTools().length} tools`);
  } catch (e: any) { console.log(`[✗] Cards: ${e.message}`); failed = true; }

  try {
    const { loadRuleEvaluator } = await import("../../policy/policy-loader.js");
    const eval1 = await loadRuleEvaluator(cwd);
    console.log(`[✓] Policy: ${eval1.getAllRules().length} rules loaded`);
  } catch (e: any) { console.log(`[✗] Policy: ${e.message}`); failed = true; }

  try {
    const { ApprovalStore } = await import("../../approvals/approval-store.js");
    const store = new ApprovalStore(cwd);
    await store.load();
    console.log(`[✓] Approvals: ${store.list().length} total, ${store.listPending().length} pending`);
  } catch (e: any) { console.log(`[✗] Approvals: ${e.message}`); failed = true; }

  try {
    const { AuditStore } = await import("../../audit/audit-store.js");
    const store = new AuditStore(cwd);
    const list = await store.list(5);
    console.log(`[✓] Audit: ${list.length >= 5 ? ">=5" : list.length} records`);
  } catch (e: any) { console.log(`[✗] Audit: ${e.message}`); failed = true; }

  try {
    const { DaemonManager } = await import("../../daemon/daemon-manager.js");
    const mgr = new DaemonManager(cwd);
    const running = await mgr.isRunning();
    if (running) {
      const status = await mgr.status();
      const hb = status?.lastHeartbeat ? `${Math.round((Date.now() - new Date(status.lastHeartbeat).getTime()) / 1000)}s ago` : "none";
      console.log(`[✓] Daemon: running (pid ${status?.pid}, heartbeat ${hb})`);
    } else {
      console.log(`[○] Daemon: stopped`);
    }
  } catch (e: any) { console.log(`[✗] Daemon: ${e.message}`); failed = true; }

  try {
    const { buildRuntimeIndex } = await import("../../runtime/runtime-index.js");
    const idx = await buildRuntimeIndex(cwd);
    const sources = new Set(idx.events.map((e: any) => e.source)).size;
    console.log(`[✓] RuntimeIndex: ${idx.events.length} events across ${sources} sources`);
  } catch (e: any) { console.log(`[✗] RuntimeIndex: ${e.message}`); failed = true; }

  const tasksPath = resolveDaemonTasksReadPath(cwd);
  if (existsSync(tasksPath)) {
    try {
      const tasks = JSON.parse(readFileSync(tasksPath, "utf-8"));
      console.log(`[✓] Daemon tasks: ${tasks.length} records`);
    } catch { console.log(`[○] Daemon tasks: unreadable`); }
  } else {
    console.log(`[○] Daemon tasks: none`);
  }

  console.log(`\n${failed ? "⚠ Some checks failed" : "✓ All checks passed"}`);
  process.exit(failed ? 1 : 0);
}

