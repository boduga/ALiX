#!/usr/bin/env node
import "node:fs";
import { writeFile } from "node:fs/promises";
import "node:os";
import { join } from "node:path";
import { loadConfig, projectConfigDir } from "./config/loader.js";
import { resolveModelConfig } from "./config/model-resolver.js";
import { ALIX_VERSION } from "./index.js";
import "./run.js";
import "./agent/session.js";
import "./providers/base.js";
import "./providers/catalog.js";
import "./providers/catalog.js";
import "./cli/commands/prompt.js";
import "./cli/helpers/api-keys.js";
import { resolveDaemonTasksReadPath } from "./daemon/daemon-paths.js";


const [, , command, ...args] = process.argv;

// ── COMMAND_ROUTER — lazy-loading handler map ──────────────────────
type CliHandler = (args: string[]) => Promise<number>;

const COMMAND_ROUTER: Record<string, () => Promise<{ handler: CliHandler }>> = {};

// Already-extracted commands
COMMAND_ROUTER["runs"] = async () => {
  const { handleRunsCommand } = await import("./cli/commands/runs.js");
  return { handler: async (a) => { await handleRunsCommand(a); return 0; } };
};
COMMAND_ROUTER["init"] = async () => {
  const { runInit } = await import("./cli/commands/init.js");
  return { handler: async (a) => { await runInit(process.cwd(), a); return 0; } };
};
COMMAND_ROUTER["tui"] = async () => {
  const { runTui } = await import("./cli/commands/tui.js");
  return { handler: async (a) => {
    const modeIdx = a.indexOf("--mode");
    const sessionMode = modeIdx >= 0 ? a[modeIdx + 1] as "auto" | "ask" | "bypass" : undefined;
    const daemonMode = a.includes("--daemon");
    const themeIdx = a.indexOf("--theme");
    const themeName = themeIdx >= 0 ? a[themeIdx + 1] : undefined;
    await runTui({ sessionMode, daemonMode, themeName });
    return 0;
  }};
};
COMMAND_ROUTER["demo"] = async () => {
  const { runDemo } = await import("./cli/commands/demo.js");
  return { handler: async (a) => {
    if (a[0] !== "local") { console.error("Usage: alix demo local"); return 1; }
    await runDemo();
    return 0;
  }};
};

// Extracted commands
COMMAND_ROUTER["run"] = async () => {
  const { handler } = await import("./cli/commands/run.js");
  return { handler };
};
COMMAND_ROUTER["session"] = async () => {
  const { handler } = await import("./cli/commands/session.js");
  return { handler };
};
COMMAND_ROUTER["plan"] = async () => {
  const { handler } = await import("./cli/commands/plan.js");
  return { handler };
};
COMMAND_ROUTER["review"] = async () => {
  const { handler } = await import("./cli/commands/review.js");
  return { handler };
};
COMMAND_ROUTER["apply"] = async () => {
  const { handler } = await import("./cli/commands/apply.js");
  return { handler };
};
COMMAND_ROUTER["submit"] = async () => {
  const { handler } = await import("./cli/commands/submit.js");
  return { handler };
};
COMMAND_ROUTER["failures"] = async () => {
  const { handleFailuresCommand } = await import("./cli/commands/failures.js");
  return { handler: async (a) => { await handleFailuresCommand(a); return 0; } };
};

if (!command || command === "--help" || command === "-h") {
  console.log(`ALiX ${ALIX_VERSION}

Usage:
  Core:
    alix run "<task>" [--no-plan] [--no-stream] [--mode=auto|ask|bypass] [--resume <id>]
    alix tui                       Interactive TUI dashboard (TTY)
    alix submit "<task>"
    alix session list|show <id>
    alix plan "<task>"
    alix review <plan-id>
    alix apply <plan-id>

  alix security doctor       Check Inspector boundary state and security config
  alix security gate         Run the security acceptance gate
  alix security config keygen    Generate config signing keypair
  alix security config sign      Sign the current config
  alix security config verify    Verify config signature and anti-rollback
  alix security config trust-key <path>  Import a trusted public key
  alix security config allow-rollback --reason "..."  Accept current config version
  alix security supply-chain lifecycle-check     Check lifecycle scripts against allowlist
  alix security supply-chain exceptions list      List all audit exceptions
  alix security supply-chain exceptions check     Check npm audit against exceptions policy
  alix security supply-chain verify-tarball <p>   Verify tarball contents against policy
  alix credential list        List stored credentials (no values)
  alix credential get <p> <l>  Get credential value
  alix credential set <p> <l> <v> Store credential
  alix credential delete <p> <l> Delete credential
  alix credential migrate      Migrate credentials from config [--dry-run]
  alix policy list        List loaded policy rules
  alix policy doctor      Check policy file health and loading status
  alix policy eval        Evaluate a capability or risk level against policy
  alix audit list [--limit N]    Show recent audit events
  alix audit by-graph <id>       Show audit events for a graph
  alix audit by-approval <id>    Show audit events for an approval
  alix audit by-action <action>  Filter by action type
  alix audit verify              Stream-verify audit log integrity
  alix audit verify --json       Structured integrity report
  alix audit activate            Seal legacy log, start integrity chain
  alix audit checkpoint --output <path>  Create signed checkpoint
  alix audit checkpoint-verify <path>    Verify checkpoint evidence
  alix evidence list [--kind <type>] [--limit <n>] [--json]
                                   List evidence records
  alix evidence show <fingerprint> Show evidence record by fingerprint
  alix evidence query --kind <type> [--after <iso>] [--before <iso>] [--json]
                                   Query evidence by type and time range
  alix evidence verify             Run fingerprint chain verification
  alix reflection report           Generate a reflection report with observability metrics
  alix adaptation <subcommand>     Guided adaptation: list/show/propose/approve/reject/apply
  alix decision context <id>   Show DecisionContext for a proposal (P6.0a)
  alix workflow status <issue>     Show workflow state for an issue
  alix workflow list               List active workflow entries
  alix workflow transition <i> <s>  Manually transition an issue
  alix runtime events     Show unified runtime events (--graph, --session, --approval, --action, --limit)
  alix runtime timeline <graphId>  Show timeline for a graph across all sources
  alix baseline <subcommand>      Baseline intelligence: list, providers, health, show
  alix daemon start      Start the background daemon
  alix daemon stop       Stop the background daemon
  alix daemon status     Show daemon status
  alix daemon tasks      List daemon tasks (--status <filter>)
  alix daemon cancel <id>  Cancel a daemon task
  alix daemon doctor     Daemon health check
  alix submit "<task>"   Submit a task to the daemon
  alix runs list [--limit N] [--json]  List ledger entries (newest first)
  alix runs show <runId> [--json]     Show a single ledger entry
  alix runs approve <runId> --gate <g> --by <op> [--reason]  Approve a gate
  alix runs deny <runId> --gate <g> --by <op> [--reason]     Deny a gate
  alix runs cancel <runId> --by <op> [--reason]               Cancel a run
  alix failures list [--limit N] [--json]  List failure records (newest first)
  alix failures show --run <runId> [--json]  Show failures for a run
  alix failures show --issue <i> [--json]    Show failures for an issue
  alix failures recall --type <type> [--json]  Find similar failures
  alix approvals list     List all approval requests
  alix approvals pending  List pending approvals only
  alix approvals show <id>  Show approval details
  alix approvals approve <id> [--reason "..."]  Approve a pending request
  alix approvals deny <id> [--reason "..."]  Deny a pending request
`);
  process.exit(0);
}

if (command === "--version" || command === "-v") {
  console.log(ALIX_VERSION);
  process.exit(0);
}

// --- alix graph --- TaskGraph management ---
if (command === "graph" && args[0] === "plan") {
  const { handleGraphPlan } = await import("./cli/commands/graph.js");
  await handleGraphPlan(args);
}

// --- alix graph run --- execute a planned graph ---
if (command === "graph" && args[0] === "run") {
  const { handleGraphRun } = await import("./cli/commands/graph.js");
  await handleGraphRun(args);
}

// --- alix graph rerun --- rerun a failed node ---
if (command === "graph" && args[0] === "rerun") {
  const { handleGraphRerun } = await import("./cli/commands/graph.js");
  await handleGraphRerun(args);
}

// --- alix graph continue --- resume after approval ---
if (command === "graph" && args[0] === "continue") {
  const { handleGraphContinue } = await import("./cli/commands/graph.js");
  await handleGraphContinue(args);
}

// --- alix graph runs --- show graph run history ---
if (command === "graph" && args[0] === "runs") {
  const { handleGraphRuns } = await import("./cli/commands/graph.js");
  await handleGraphRuns(args);
}
// --- alix graph preflight --- capability check for each node ---
if (command === "graph" && args[0] === "preflight") {
  const { handleGraphPreflight } = await import("./cli/commands/graph.js");
  await handleGraphPreflight(args);
}

// --- alix graph list --- list saved graphs ---
if (command === "graph" && args[0] === "list") {
  const { handleGraphList } = await import("./cli/commands/graph.js");
  await handleGraphList(args);
}

// --- alix graph inspect --- show graph details ---
if (command === "graph" && args[0] === "inspect") {
  const { handleGraphInspect } = await import("./cli/commands/graph.js");
  await handleGraphInspect(args);
}

// --- alix graph export --- export graph as mermaid or json ---
if (command === "graph" && args[0] === "export") {
  const { handleGraphExport } = await import("./cli/commands/graph.js");
  await handleGraphExport(args);
}

// --- alix sop --- SOP management ---
if (command === "sop") {
  const { handleSopCommand } = await import("./cli/commands/sop.js");
  await handleSopCommand(args);
  process.exit(0);
}

// --- alix report --- report artifact commands ---
if (command === "report") {
  const { runReportCommand } = await import("./cli/commands/report.js");
  await runReportCommand(args);
  process.exit(0);
}


if (command === "config" && args[0] === "set-key") {
  const { handleConfigSetKey } = await import("./cli/commands/config.js");
  await handleConfigSetKey(args);
}

// --- alix config get <path> ---
if (command === "config" && args[0] === "get") {
  const { handleConfigGet } = await import("./cli/commands/config.js");
  await handleConfigGet(args);
}

// --- alix config set <path> <value> ---
if (command === "config" && args[0] === "set") {
  const { handleConfigSet } = await import("./cli/commands/config.js");
  await handleConfigSet(args);
}

// --- alix config delete <path> ---
if (command === "config" && args[0] === "delete") {
  const { handleConfigDelete } = await import("./cli/commands/config.js");
  await handleConfigDelete(args);
}

// --- alix config history ---
if (command === "config" && args[0] === "history") {
  const { handleConfigHistory } = await import("./cli/commands/config.js");
  await handleConfigHistory(args);
}

// --- alix config provenance [--json] [<path>] ---
if (command === "config" && args[0] === "provenance") {
  const { handleConfigProvenance } = await import("./cli/commands/config.js");
  await handleConfigProvenance(args);
}

// --- alix config rollback <version> --force --reason "<reason>" ---
if (command === "config" && args[0] === "rollback") {
  const { handleConfigRollback } = await import("./cli/commands/config.js");
  await handleConfigRollback(args);
}

if (command === "config" && args[0] === "show") {
  const { handleConfigShow } = await import("./cli/commands/config.js");
  await handleConfigShow(args);
}

if (command === "serve") {
  const config = await loadConfig(process.cwd());
  if (!config.ui?.enabled) {
    console.error("UI inspector is not enabled. Set ui.enabled=true in your config.");
    process.exit(1);
  }
  // Startup security check
  const { checkStartupSafety } = await import("./security/inspector/remote-access-policy.js");
  const safety = checkStartupSafety(config);
  for (const w of safety.warnings) {
    console.error(`\x1b[33m${w}\x1b[0m`); // yellow
  }
  if (!safety.ok) {
    console.error(`\x1b[31m${safety.error}\x1b[0m`); // red
    process.exit(1);
  }
  const { startServer } = await import("./server/server.js");
  const sec = config.ui.security;
  const server = await startServer(
    process.cwd(),
    config.ui.host,
    config.ui.port,
    sec?.allowedHosts,
    sec?.allowedOrigins,
    sec?.trustedProxyCidrs,
    sec?.authentication,
  );
  console.log(`ALiX inspector running at ${server.url}`);
  await new Promise(() => undefined);
}

// --- alix inspector -- start Inspector server and open browser ---
if (command === "inspector" && args[0] === "open") {
  const { startServer } = await import("./server/server.js");
  const { execFile } = await import("node:child_process");
  const { platform } = await import("node:os");

  const config = await loadConfig(process.cwd());
  const host = config.ui?.host ?? "localhost";
  const port = config.ui?.port ?? 4137;

  // Startup security check
  const { checkStartupSafety } = await import("./security/inspector/remote-access-policy.js");
  const safety = checkStartupSafety(config);
  for (const w of safety.warnings) {
    console.error(`\x1b[33m${w}\x1b[0m`);
  }
  if (!safety.ok) {
    console.error(`\x1b[31m${safety.error}\x1b[0m`);
    process.exit(1);
  }

  const sec = config.ui?.security;
  const server = await startServer(
    process.cwd(),
    host,
    port,
    sec?.allowedHosts,
    sec?.allowedOrigins,
    sec?.trustedProxyCidrs,
    sec?.authentication,
  );
  const url = server.url;

  // Open browser (platform-aware, best-effort)
  const platformName = platform();
  const openBrowser = (cmd: string, args: string[]) => {
    try {
      execFile(cmd, args, () => {});
    } catch {
      // Browser open is best-effort — user can copy the URL
    }
  };

  if (platformName === "darwin") {
    openBrowser("open", [url]);
  } else if (platformName === "win32") {
    openBrowser("cmd", ["/c", "start", url]);
  } else {
    openBrowser("xdg-open", [url]);
  }

  console.log(`\n  ALiX Inspector: ${url}\n`);
  console.log("  Press Ctrl+C to stop the server.\n");

  // Block until SIGINT
  await new Promise(() => {});
}

if (command === "mcp") {
  const { handleMcpRoot } = await import("./cli/commands/mcp-extension.js");
  await handleMcpRoot(args);
}

if (command === "extension") {
  const { handleExtensionRoot } = await import("./cli/commands/mcp-extension.js");
  await handleExtensionRoot(args);
}

if (command === "skill") {
  const { handleSkillRoot } = await import("./cli/commands/skill.js");
  await handleSkillRoot(args);
}

// --- alix agent <role> "prompt" --- runs subagent in same process (no recursion)
const agentRole = process.argv[3];
if (command === "agent" && agentRole) {
  // Separate flags (--flag) from prompt words after position 3
  const restArgs = process.argv.slice(4);
  const promptWords: string[] = [];
  const extraArgs: string[] = [];
  for (let i = 0; i < restArgs.length; i++) {
    if (restArgs[i].startsWith("--") && !restArgs[i].startsWith("--prompt")) {
      // Flag arg; collect it and its value (if next arg isn't a flag)
      extraArgs.push(restArgs[i]);
      if (i + 1 < restArgs.length && !restArgs[i + 1].startsWith("--")) {
        extraArgs.push(restArgs[++i]);
      }
    } else {
      promptWords.push(restArgs[i]);
    }
  }
  const prompt = promptWords.join(" ");
  if (!prompt) { console.error("Usage: alix agent <role> <prompt>"); process.exit(1); }
  const config = await loadConfig(process.cwd());
  const resolved = resolveModelConfig(config);
  const provider = resolved.provider;
  const model = resolved.name;
  const { SubagentCLI } = await import("./agents/subagent-cli.js");
  await SubagentCLI.main([
    "--subagent", agentRole,
    "--task-id", crypto.randomUUID(),
    "--prompt", prompt,
    "--mode", "read_only",
    "--session-id", `cli-${Date.now()}`,
    "--provider", provider,
    "--model", model,
    "--output", "text",
    ...extraArgs,
  ]);
  // SubagentCLI.main() exits the process itself — if we reach here, something went wrong
  process.exit(1);
}

// --- alix run --subagent <role> --- subagent process entry point (called by parent) ---
// Contract: args[0]=--subagent, args[1]=role, args[2..]=remaining flag-style args
// (--task-id, --prompt, --mode, --session-id, --provider, --model, --owned-paths...).
// These are passed through verbatim to SubagentCLI.main, which parses them with
// node parseArgs (flag-style). The parent (SubagentManager.spawn) emits them in
// flag style, so no positional reshuffling is performed here.
if (command === "run" && args[0] === "--subagent") {
  const { SubagentCLI } = await import("./agents/subagent-cli.js");
  const subagentRole = args[1];
  const restFlags = args.slice(2);
  await SubagentCLI.main(["--subagent", subagentRole, ...restFlags]);
  process.exit(1);
}

// --- alix metrics --- observability metrics display command ---
if (command === "metrics") {
  const { handleMetricsRoot } = await import("./cli/commands/metrics-db-memory.js");
  await handleMetricsRoot(args);
}

// --- alix db --- database management ---
if (command === "db") {
  const { handleDbRoot } = await import("./cli/commands/metrics-db-memory.js");
  await handleDbRoot(args);
}

// --- alix memory --- memory management commands ---
if (command === "memory") {
  const { handleMemoryRoot } = await import("./cli/commands/metrics-db-memory.js");
  await handleMemoryRoot(args);
}

// --- alix session --- session management commands ---
if (command === "skills") {
  const { runSkillsCommand } = await import("./cli/commands/skills/run-skills.js");
  await runSkillsCommand(args);
  process.exit(0);
}

if (command === "policy") {
  const { handlePolicyRoot } = await import("./cli/commands/policy-registry-runtime.js");
  await handlePolicyRoot(args);
}

if (command === "registry") {
  const { handleRegistryRoot } = await import("./cli/commands/policy-registry-runtime.js");
  await handleRegistryRoot(args);
}

if (command === "runtime") {
  const { handleRuntimeRoot } = await import("./cli/commands/policy-registry-runtime.js");
  await handleRuntimeRoot(args);
}

if (command === "daemon") {
  const { DaemonManager } = await import("./daemon/daemon-manager.js");
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

// Track whether a command was successfully dispatched. Some handlers
// (e.g. `alix submit`) keep the event loop alive and handle their own
// exit; without this flag the file's fallthrough would print a
// misleading "Unknown command" error after a successful submit.
if (command === "audit") {
  const cwd = process.cwd();

  // Sd2: verify
  if (args[0] === "verify") {
    const { handleAuditVerify } = await import("./cli/commands/security.js");
    await handleAuditVerify(args.slice(1));
    // handleAuditVerify calls process.exit
    process.exit(0);
  }

  // Sd1.6/#683: activate the integrity chain on a legacy log
  if (args[0] === "activate") {
    const { handleAuditActivate } = await import("./cli/commands/security.js");
    await handleAuditActivate(args.slice(1));
    process.exit(0);
  }

  // Sd2: checkpoint
  if (args[0] === "checkpoint") {
    const { handleAuditCheckpoint } = await import("./cli/commands/security.js");
    await handleAuditCheckpoint(args.slice(1));
    process.exit(0);
  }

  // Sd2: checkpoint-verify
  if (args[0] === "checkpoint-verify") {
    const { handleAuditCheckpointVerify } = await import("./cli/commands/security.js");
    await handleAuditCheckpointVerify(args.slice(1));
    process.exit(0);
  }

  // Legacy: query commands
  const { AuditStore } = await import("./audit/audit-store.js");
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
  console.log("  checkpoint         Create signed checkpoint evidence (Sd2)");
  console.log("    --output <path>  Write checkpoint to file");
  console.log("  checkpoint-verify <path>  Verify a checkpoint (Sd2)");
  process.exit(0);
}

// ── Evidence commands (P4.4b) ──────────────────────────────────────
if (command === "evidence") {
  const { handleEvidenceCommand } = await import("./cli/commands/evidence.js");
  await handleEvidenceCommand(args);
  process.exit(0);
}

// ── Workflow commands (P4.5c) ─────────────────────────────────────
if (command === "workflow") {
  const { handleWorkflowCommand } = await import("./cli/commands/workflow.js");
  await handleWorkflowCommand(args);
  process.exit(0);
}

// ── Reflection command (P5.0g) ────────────────────────────────────
if (command === "reflection") {
  const { handleReflectionCommand } = await import("./cli/commands/reflection.js");
  await handleReflectionCommand(args);
  process.exit(0);
}

// ── Adaptation command (P5.1g) ───────────────────────────────────
if (command === "adaptation") {
  const { handleAdaptationCommand } = await import("./cli/commands/adaptation.js");
  await handleAdaptationCommand(args);
  process.exit(0);
}

// ── Decision command (P6.0a) ──────────────────────────────────────
if (command === "decision") {
  const { handleDecisionCommand } = await import("./cli/commands/decision.js");
  await handleDecisionCommand(args);
  process.exit(0);
}

// ── Learning command (P8.7) ───────────────────────────────────────
if (command === "learning") {
  const { handleLearningCommand } = await import("./cli/commands/learning.js");
  await handleLearningCommand(args);
  process.exit(0);
}

// ── Explain command (P8.5c) ──────────────────────────────────────
if (command === "explain") {
  const { handleExplainCommand } = await import("./cli/commands/explain.js");
  await handleExplainCommand(args);
  process.exit(0);
}

// ── Governance command (P9.0b) ───────────────────────────────────
if (command === "governance") {
  const { handleGovernanceCommand } = await import("./cli/commands/governance.js");
  await handleGovernanceCommand(args);
  process.exit(0);
}

// ── Executive command (P10.0) ────────────────────────────────────
if (command === "executive") {
  const { handleExecutiveCommand } = await import("./cli/commands/executive.js");
  await handleExecutiveCommand(args);
  process.exit(0);
}

// ── Capability command (singular; CAP-11 owner of alix capability namespace) ──
if (command === "capability") {
  const { handleCapabilityCommand } = await import("./cli/commands/capability.js");
  const { CapabilityPlatform } = await import("./capability/platform.js");
  const { EventLog } = await import("./events/event-log.js");
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

// ── Baseline command (P10.10) ──────────────────────────────────
if (command === "baseline") {
  const { handleBaselineCommand } = await import("./cli/commands/baseline.js");
  await handleBaselineCommand(args);
  process.exit(0);
}
if (command === "research") {
  const { research } = await import("./cli/commands/research.js");
  await research(args);
  process.exit(0);
}

if (command === "approvals") {
  const { ApprovalStore } = await import("./approvals/approval-store.js");
  const cwd = process.cwd();
  const store = new ApprovalStore(cwd);
  await store.load();

  if (args[0] === "list") {
    const all = store.list();
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
    const pending = store.listPending();
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
    const record = store.get(id);
    if (!record) { console.error(`Approval not found: ${id}`); process.exit(1); }
    console.log(`ID:       ${record.id}`);
    console.log(`Status:   ${record.status}`);
    if (record.capabilities?.length) console.log(`Capability: ${record.capabilities[0]}`);
    if (record.toolId) console.log(`Tool:     ${record.toolId}`);
    if (record.riskLevel) console.log(`Risk:     ${record.riskLevel}`);
    if (record.graphId) console.log(`Graph:    ${record.graphId}`);
    if (record.nodeId) console.log(`Node:     ${record.nodeId}`);
    if (record.sessionId) console.log(`Session:  ${record.sessionId}`);
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
    const result = await store.resolve(id, status, decisionReason);
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

if (command === "models") {
  const { handleModelsCommand } = await import("./cli/commands/models.js");
  await handleModelsCommand(args);
  process.exit(0);
}

if (command === "benchmark") {
  const { handleBenchmarkCommand } = await import("./cli/commands/benchmark.js");
  await handleBenchmarkCommand(args);
  process.exit(0);
}
if (command === "evals") {
  const { handleEvalsCommand } = await import("./cli/commands/evals.js");
  await handleEvalsCommand(args);
  process.exit(0);
}

if (command === "doctor") {
  if (args.includes("--performance")) {
    const { runPerformanceDoctor } = await import("./cli/commands/performance-doctor.js");
    process.exit(await runPerformanceDoctor(process.cwd()));
  }
  const cwd = process.cwd();
  const { existsSync, readFileSync } = await import("node:fs");
  const {  } = await import("node:path");
  let failed = false;

  console.log("ALiX Doctor — system health check\n");

  try {
    const { loadCardRegistry, defaultAgentCards } = await import("./registry/card-loader.js");
    const reg = await loadCardRegistry(cwd);
    console.log(`[${reg.listAgents().length === defaultAgentCards().length ? "✓" : "⚠"}] Cards: ${reg.listAgents().length} agents, ${reg.listTools().length} tools`);
  } catch (e: any) { console.log(`[✗] Cards: ${e.message}`); failed = true; }

  try {
    const { loadRuleEvaluator } = await import("./policy/policy-loader.js");
    const eval1 = await loadRuleEvaluator(cwd);
    console.log(`[✓] Policy: ${eval1.getAllRules().length} rules loaded`);
  } catch (e: any) { console.log(`[✗] Policy: ${e.message}`); failed = true; }

  try {
    const { ApprovalStore } = await import("./approvals/approval-store.js");
    const store = new ApprovalStore(cwd);
    await store.load();
    console.log(`[✓] Approvals: ${store.list().length} total, ${store.listPending().length} pending`);
  } catch (e: any) { console.log(`[✗] Approvals: ${e.message}`); failed = true; }

  try {
    const { AuditStore } = await import("./audit/audit-store.js");
    const store = new AuditStore(cwd);
    const list = await store.list(5);
    console.log(`[✓] Audit: ${list.length >= 5 ? ">=5" : list.length} records`);
  } catch (e: any) { console.log(`[✗] Audit: ${e.message}`); failed = true; }

  try {
    const { DaemonManager } = await import("./daemon/daemon-manager.js");
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
    const { buildRuntimeIndex } = await import("./runtime/runtime-index.js");
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

if (command === "security" && args[0] === "doctor") {
  const { handleSecurityDoctor } = await import("./cli/commands/security.js");
  await handleSecurityDoctor(args.slice(1));
  process.exit(0);
}

// --- alix security config keygen --- P4.3-Se3 ---
if (command === "security" && args[0] === "config" && args[1] === "keygen") {
  const { ConfigSigner } = await import("./config/signing.js");
  try {
    const result = await ConfigSigner.generateAndPersistKey();
    console.log(`Signing keypair generated.`);
    console.log(`Private key: ${result.keyPath}`);
    console.log(`Key ID:      ${result.publicKey.slice(0, 20)}...`);
    console.log();
    console.log("Public key (share this with config verifiers):");
    console.log(result.publicKey);
  } catch (err: any) {
    console.error(`Key generation failed: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

// --- alix security config sign --- P4.3-Se3 ---
if (command === "security" && args[0] === "config" && args[1] === "sign") {
  const alixDir = projectConfigDir(process.cwd());
  const { ConfigSigner } = await import("./config/signing.js");
  const { ConfigMutationService } = await import("./config/mutation.js");
  try {
    const signer = new ConfigSigner();
    const service = new ConfigMutationService(alixDir);
    const version = await service.getVersion();
    const provenance = await service.getProvenance();
    const prevHash = provenance.length > 0 ? provenance[provenance.length - 1].configHash : null;
    const sig = await signer.sign(alixDir, version, prevHash);
    console.log(`Config signed successfully.`);
    console.log(`Key ID:      ${sig.keyId}`);
    console.log(`Version:     ${sig.configVersion}`);
    console.log(`Config hash: ${sig.configHash}`);
    console.log(`Signed at:   ${sig.signedAt}`);
    console.log(`Signature:   .alix/config.sig`);

    // P4.4c: Record signing evidence
    try {
      const { ConfigTrustHistory } = await import("./security/evidence/config-trust-history.js");
      const history = new ConfigTrustHistory();
      const ev = await history.recordSign(sig);
      if (ev) {
        console.log(`Evidence:    ${ev.fingerprint}`);
      }
    } catch {
      // Evidence recording is best-effort
    }
  } catch (err: any) {
    console.error(`Signing failed: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

// --- alix security config verify --- P4.3-Se3 ---
if (command === "security" && args[0] === "config" && args[1] === "verify") {
  const alixDir = projectConfigDir(process.cwd());
  const { ConfigSigner } = await import("./config/signing.js");
  const { ConfigMutationService } = await import("./config/mutation.js");
  try {
    const signer = new ConfigSigner();
    const publicKeyPem = await signer.getPublicKey().catch(() => null);
    if (!publicKeyPem) {
      console.error("No signing key found. Generate one with: alix security config keygen");
      console.error("Or import a trusted key with: alix security config trust-key <path>");
      process.exit(1);
    }

    const verifyResult = await signer.verify(alixDir, publicKeyPem);
    if (verifyResult.ok) {
      const sig = await ConfigSigner.readSignature(alixDir);
      const service = new ConfigMutationService(alixDir);
      const version = await service.getVersion();
      const rollback = await ConfigSigner.checkRollback(sig?.configVersion ?? version);

      console.log("Config signature: VALID");
      if (sig) {
        console.log(`Key ID:      ${sig.keyId}`);
        console.log(`Version:     ${sig.configVersion}`);
        console.log(`Config hash: ${sig.configHash}`);
        console.log(`Signed at:   ${sig.signedAt}`);
      }
      if (rollback.ok) {
        console.log("Anti-rollback: OK");
      } else {
        console.log(`Anti-rollback: WARNING — ${rollback.error}`);
      }
    } else {
      console.error(`Config signature: INVALID`);
      console.error(`  ${verifyResult.error}`);
      process.exit(1);
    }
  } catch (err: any) {
    console.error(`Verification failed: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

// --- alix security config trust-key <path> --- P4.3-Se3 ---
if (command === "security" && args[0] === "config" && args[1] === "trust-key") {
  const keyPath = args[2];
  if (!keyPath) {
    console.error("Usage: alix security config trust-key <path-to-public-key.pem>");
    process.exit(1);
  }
  const { readFile, mkdir: mkdirP } = await import("node:fs/promises");
  const { existsSync: existsP } = await import("node:fs");
  if (!existsP(keyPath)) {
    console.error(`File not found: ${keyPath}`);
    process.exit(1);
  }
  try {
    const pem = await readFile(keyPath, "utf-8");
    if (!pem.includes("PUBLIC KEY")) {
      console.error("File does not contain a valid public key (PEM format).");
      process.exit(1);
    }
    // Store trusted key in user config
    const homedirP = (await import("node:os")).homedir();
    const trustedDir = join(homedirP, ".config", "alix");
    await mkdirP(trustedDir, { recursive: true });
    const trustedPath = join(trustedDir, "trusted-signing-key.pem");
    await writeFile(trustedPath, pem);
    console.log(`Trusted key imported: ${trustedPath}`);
    const { createHash } = await import("node:crypto");
    const keyId = createHash("sha256").update(pem).digest("hex").slice(0, 16);
    console.log(`Key ID: ${keyId}`);
  } catch (err: any) {
    console.error(`Failed to import key: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

// --- alix security config allow-rollback --- P4.3-Se3 ---
if (command === "security" && args[0] === "config" && args[1] === "allow-rollback") {
  const reasonIdx = args.indexOf("--reason");
  const reason = reasonIdx >= 0 ? args[reasonIdx + 1] : undefined;
  if (!reason) {
    console.error('Usage: alix security config allow-rollback --reason "<reason>"');
    process.exit(1);
  }
  const alixDir = projectConfigDir(process.cwd());
  const { ConfigMutationService } = await import("./config/mutation.js");
  const { ConfigSigner } = await import("./config/signing.js");
  try {
    const service = new ConfigMutationService(alixDir);
    const version = await service.getVersion();
    await ConfigSigner.acceptVersion(version);
    console.log(`Accepted config version ${version}.`);
    console.log(`Reason: ${reason}`);
  } catch (err: any) {
    console.error(`Failed: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

// --- alix credential --- P4.3-Se1 credential store management ---
if (command === "credential") {
  const sub = args[0] ?? "";
  const subArgs = args.slice(1);
  const {
    handleCredentialList,
    handleCredentialGet,
    handleCredentialSet,
    handleCredentialDelete,
    handleCredentialMigrate,
  } = await import("./cli/commands/security.js");

  if (sub === "list") {
    await handleCredentialList(subArgs);
  } else if (sub === "get") {
    await handleCredentialGet(subArgs);
  } else if (sub === "set") {
    await handleCredentialSet(subArgs);
  } else if (sub === "delete") {
    await handleCredentialDelete(subArgs);
  } else if (sub === "migrate") {
    await handleCredentialMigrate(subArgs);
  } else {
    console.error("Usage: alix credential {list|get|set|delete|migrate} [options]");
    console.error("  list [--json]");
    console.error("  get <provider> <keyLabel>");
    console.error("  set <provider> <keyLabel> <value>");
    console.error("  delete <provider> <keyLabel>");
    console.error("  migrate [--dry-run] [--json]");
    process.exit(1);
  }
  process.exit(0);
}

// --- alix inspector auth --- P4.3-Sb2 token management ---
if (command === "inspector" && args[0] === "auth") {
  const sub = args[1] ?? "";
  const subArgs = args.slice(2);
  const {
    handleInspectorAuthCreate,
    handleInspectorAuthList,
    handleInspectorAuthRotate,
    handleInspectorAuthRevoke,
    handleInspectorAuthDoctor,
  } = await import("./cli/commands/security.js");

  if (sub === "create") {
    await handleInspectorAuthCreate(subArgs);
  } else if (sub === "list") {
    await handleInspectorAuthList(subArgs);
  } else if (sub === "rotate") {
    await handleInspectorAuthRotate(subArgs);
  } else if (sub === "revoke") {
    await handleInspectorAuthRevoke(subArgs);
  } else if (sub === "doctor") {
    await handleInspectorAuthDoctor(subArgs);
  } else {
    console.error("Usage: alix inspector auth {create|list|rotate|revoke|doctor}");
    console.error("  create --name <name> --role <role> [--json]");
    console.error("  list [--json]");
    console.error("  rotate <token-id> --grace <duration> [--json]");
    console.error("  revoke <token-id> [--yes] [--json]");
    console.error("  doctor [--json]");
    process.exit(1);
  }
  process.exit(0);
}

// --- alix security supply-chain --- P4.3-Sf supply-chain policy ---
if (command === "security" && args[0] === "supply-chain") {
  const sub = args[1] ?? "";
  const subArgs = args.slice(2);

  if (sub === "lifecycle-check") {
    const { handleSupplyChainLifecycleCheck } = await import("./cli/commands/security.js");
    await handleSupplyChainLifecycleCheck(subArgs);
    process.exit(0);
  }

  if (sub === "exceptions") {
    const { handleSupplyChainExceptions } = await import("./cli/commands/security.js");
    await handleSupplyChainExceptions(subArgs);
    process.exit(0);
  }

  if (sub === "verify-tarball") {
    const { handleSupplyChainVerifyTarball } = await import("./cli/commands/security.js");
    await handleSupplyChainVerifyTarball(subArgs);
    process.exit(0);
  }

  console.error("Usage: alix security supply-chain {lifecycle-check|exceptions|verify-tarball} [--json]");
  console.error("  lifecycle-check          Check lifecycle scripts against allowlist");
  console.error("  exceptions list           List all audit exceptions");
  console.error("  exceptions check          Check npm audit against exceptions policy");
  console.error("  verify-tarball <path>     Verify tarball contents against security policy");
  process.exit(1);
}

if (command === "security") {
  console.error("Usage: alix security doctor");
  console.error("       alix security config keygen|sign|verify|trust-key|allow-rollback");
  console.error("       alix security supply-chain lifecycle-check|exceptions|verify-tarball");
  console.error("       alix security gate [--json]");
  console.error("Usage: alix security doctor [--json]");
  console.error("       alix security gate [--json]");

  console.error("       alix credential list|get|set|delete|migrate");
  process.exit(1);
}

if (command === "recovery") {
  const { cmdScan, cmdInspect, cmdRepair, cmdVerify } = await import("./cli/commands/recover.js");
  const sub = args[0];
  if (sub === "scan") await cmdScan(args.slice(1));
  else if (sub === "inspect") await cmdInspect(args.slice(1));
  else if (sub === "repair") await cmdRepair(args.slice(1));
  else if (sub === "verify") await cmdVerify(args.slice(1));
  else {
    console.error("Usage: alix recovery {scan|inspect|repair|verify} [options]");
    process.exit(1);
  }
  process.exit(0);
}

if (command === "coordination") {
  const { handleCoordination } = await import("./cli/commands/coordination.js");
  await handleCoordination(args);
  process.exit(0);
}

if (command === "approval") {
  const { handleApproval } = await import("./cli/commands/approval.js");
  await handleApproval(args);
  process.exit(0);
}

// --- alix observability --- P4.2 observability commands ---
if (command === "observability") {
  const { handleObservability } = await import("./cli/commands/observability.js");
  try {
    await handleObservability(args, process.cwd());
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
  process.exit(0);
}

if (command === "ownership") {
  const { handleOwnershipCommand } = await import("./cli/commands/ownership.js");
  await handleOwnershipCommand(args);
  process.exit(0);
}

if (command === "provider" && args[0] === "doctor") {
  const { handleProviderDoctor } = await import("./cli/commands/provider-doctor.js");
  await handleProviderDoctor(args.slice(1));
  process.exit(0);
}

if (command === "issue" && args[0] === "run") {
  const { handleIssueRunCommand } = await import("./cli/commands/issue-run-handler.js");
  await handleIssueRunCommand(args.slice(1));
  process.exit(0);
}

// ── COMMAND_ROUTER dispatcher ───────────────────────────────────
const loader = COMMAND_ROUTER[command];
if (loader) {
  const mod = await loader();
  const code = await mod.handler(args);
  process.exit(code);
}

console.error(`Unknown command: ${command}`);
process.exit(1);
