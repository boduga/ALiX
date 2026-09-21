#!/usr/bin/env node
import "node:fs";
import "node:fs/promises";
import "node:os";
import "node:path";
import { loadConfig } from "./config/loader.js";
import { resolveModelConfig } from "./config/model-resolver.js";
import { ALIX_VERSION } from "./index.js";
import "./run.js";
import "./agent/session.js";
import "./providers/base.js";
import "./providers/catalog.js";
import "./providers/catalog.js";
import "./cli/commands/prompt.js";
import "./cli/helpers/api-keys.js";
import "./daemon/daemon-paths.js";


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
  alix audit verify --all        Also verify the governance audit chain
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
  alix schedule list     List approved scheduled jobs
  alix schedule show <name>  Show a scheduled job
  alix schedule run-now <name>  Enqueue one run now
  alix schedule revoke <name>  Remove a scheduled job
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
  const { handleServe } = await import("./cli/commands/security-ops.js");
  await handleServe(args);
}

// --- alix inspector -- start Inspector server and open browser ---
if (command === "inspector" && args[0] === "open") {
  const { handleInspectorOpen } = await import("./cli/commands/security-ops.js");
  await handleInspectorOpen(args);
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
// (--task-id, --prompt, --mode, --session-id, --provider, --model, --session-mode, --owned-paths...).
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
  const { handleDaemonRoot } = await import("./cli/commands/daemon-audit.js");
  await handleDaemonRoot(args);
}

// Track whether a command was successfully dispatched. Some handlers
// (e.g. `alix submit`) keep the event loop alive and handle their own
// exit; without this flag the file's fallthrough would print a
// misleading "Unknown command" error after a successful submit.
if (command === "audit") {
  const { handleAuditRoot } = await import("./cli/commands/daemon-audit.js");
  await handleAuditRoot(args);
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

// ── Jev decision-subsystem command (J4/J5 operator surface) ───────
if (command === "jev") {
  const { handleJevCommand } = await import("./cli/commands/jev.js");
  await handleJevCommand(args);
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
  const { handleCapabilityRoot } = await import("./cli/commands/approvals-doctor-capability.js");
  await handleCapabilityRoot(args);
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
  const { handleApprovalsRoot } = await import("./cli/commands/approvals-doctor-capability.js");
  await handleApprovalsRoot(args);
}

if (command === "schedule") {
  const { handleSchedule } = await import("./cli/commands/schedule.js");
  await handleSchedule(args);
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
  const { handleDoctorRoot } = await import("./cli/commands/approvals-doctor-capability.js");
  await handleDoctorRoot(args);
}

if (command === "security" && args[0] === "doctor") {
  const { handleSecurityDoctor } = await import("./cli/commands/security-ops.js");
  await handleSecurityDoctor(args);
}

// --- alix security gate --- P4.3-Sg2 ---
if (command === "security" && args[0] === "gate") {
  const { handleSecurityGate } = await import("./cli/commands/security-ops.js");
  await handleSecurityGate(args);
}

// --- alix security config keygen --- P4.3-Se3 ---
if (command === "security" && args[0] === "config" && args[1] === "keygen") {
  const { handleSecurityConfigKeygen } = await import("./cli/commands/security-ops.js");
  await handleSecurityConfigKeygen(args);
}

// --- alix security config sign --- P4.3-Se3 ---
if (command === "security" && args[0] === "config" && args[1] === "sign") {
  const { handleSecurityConfigSign } = await import("./cli/commands/security-ops.js");
  await handleSecurityConfigSign(args);
}

// --- alix security config verify --- P4.3-Se3 ---
if (command === "security" && args[0] === "config" && args[1] === "verify") {
  const { handleSecurityConfigVerify } = await import("./cli/commands/security-ops.js");
  await handleSecurityConfigVerify(args);
}

// --- alix security config trust-key <path> --- P4.3-Se3 ---
if (command === "security" && args[0] === "config" && args[1] === "trust-key") {
  const { handleSecurityConfigTrustKey } = await import("./cli/commands/security-ops.js");
  await handleSecurityConfigTrustKey(args);
}

// --- alix security config allow-rollback --- P4.3-Se3 ---
if (command === "security" && args[0] === "config" && args[1] === "allow-rollback") {
  const { handleSecurityConfigAllowRollback } = await import("./cli/commands/security-ops.js");
  await handleSecurityConfigAllowRollback(args);
}

// --- alix credential --- P4.3-Se1 credential store management ---
if (command === "credential") {
  const { handleCredential } = await import("./cli/commands/security-ops.js");
  await handleCredential(args);
}

// --- alix inspector auth --- P4.3-Sb2 token management ---
if (command === "inspector" && args[0] === "auth") {
  const { handleInspectorAuth } = await import("./cli/commands/security-ops.js");
  await handleInspectorAuth(args);
}

// --- alix security supply-chain --- P4.3-Sf supply-chain policy ---
if (command === "security" && args[0] === "supply-chain") {
  const { handleSecuritySupplyChain } = await import("./cli/commands/security-ops.js");
  await handleSecuritySupplyChain(args);
}

if (command === "security") {
  const { handleSecurity } = await import("./cli/commands/security-ops.js");
  await handleSecurity(args);
}

if (command === "recovery") {
  const { handleRecovery } = await import("./cli/commands/security-ops.js");
  await handleRecovery(args);
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
