/**
 * P12.4 — `alix runs` CLI dispatcher.
 *
 * Three subcommands:
 *   - list   — list ledger entries (newest first)
 *   - show   — show a single entry by runId
 *   - append — dev-only, append a raw JSON entry
 *
 * Core invariant: read-only by default, append is opt-in via --json.
 *
 * @module
 */

import { join } from "node:path";
import {
  FileLedgerStore,
  type LedgerEntry,
} from "../../governance/run-ledger.js";
import {
  approveGate,
  denyGate,
  type ApprovalGate,
  type ApprovalGateName,
  type ApprovalWorkflowResult,
} from "../../governance/approval-workflow.js";

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";

function colorForOutcome(outcome: string): string {
  switch (outcome) {
    case "completed": return GREEN;
    case "failed": return RED;
    case "cancelled": return YELLOW;
    case "denied": return RED;
    default: return RESET;
  }
}

const BAR = "────────────────────────────────────────────────────────────────";

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

function createStore(cwd: string): FileLedgerStore {
  return new FileLedgerStore(join(cwd, ".alix", "governance"));
}

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

export async function handleRunsCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "list":
      return runList(args.slice(1));
    case "show":
      return runShow(args.slice(1));
    case "append":
      return runAppend(args.slice(1));
    case "approve":
      return runApprove(args.slice(1));
    case "deny":
      return runDeny(args.slice(1));
    case "cancel":
      return runCancel(args.slice(1));
    default:
      console.error(
        `Unknown runs subcommand: "${subcommand ?? ""}"`,
      );
      console.error(
        "Usage: alix runs {list|show|append|approve|deny|cancel} [options]",
      );
      process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// runList — `alix runs list [--limit N] [--json]`
// ---------------------------------------------------------------------------

async function runList(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");

  const limitIdx = args.indexOf("--limit");
  let limit: number | undefined;
  if (limitIdx !== -1 && limitIdx + 1 < args.length) {
    const parsed = parseInt(args[limitIdx + 1], 10);
    if (isNaN(parsed) || parsed <= 0) {
      console.error("Error: --limit requires a positive integer");
      process.exit(1);
    }
    limit = parsed;
  }

  const cwd = process.cwd();
  const store = createStore(cwd);
  const entries = await store.list(limit);

  if (jsonMode) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  if (entries.length === 0) {
    console.log(DIM + "No ledger entries found." + RESET);
    return;
  }

  console.log(BOLD + `Run Ledger (${entries.length} entr${entries.length === 1 ? "y" : "ies"})` + RESET);
  console.log(BAR);

  for (const entry of entries) {
    const outcomeColor = colorForOutcome(entry.outcome);
    console.log(
      `  ${CYAN}${entry.runId}${RESET}  ${outcomeColor}${entry.outcome}${RESET}` +
      `  ${DIM}risk: ${entry.riskScore.level}${RESET}` +
      `  ${entry.timestamp}`,
    );
    console.log(`    issue: ${entry.issueId}  files: ${entry.filesChanged.length}  approvals: ${entry.approvals.length}`);
    if (entry.draftPrId) {
      console.log(`    draft PR: ${entry.draftPrId}`);
    }
  }
}

// ---------------------------------------------------------------------------
// runShow — `alix runs show <runId> [--json]`
// ---------------------------------------------------------------------------

async function runShow(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");
  const positional = args.filter((a) => !a.startsWith("--"));
  const runId = positional[0];
  if (!runId) {
    console.error("Usage: alix runs show <runId> [--json]");
    process.exit(2);
  }

  const cwd = process.cwd();
  const store = createStore(cwd);
  const entry = await store.get(runId);

  if (!entry) {
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, error: `Entry not found: ${runId}` }));
    } else {
      console.error(`Entry not found: ${runId}`);
    }
    process.exit(1);
  }

  if (jsonMode) {
    console.log(JSON.stringify(entry, null, 2));
    return;
  }

  renderDetail(entry);
}

// ---------------------------------------------------------------------------
// runAppend — `alix runs append --json '<entry>'` (dev-only, hidden)
// ---------------------------------------------------------------------------

async function runAppend(args: string[]): Promise<void> {
  const jsonIdx = args.indexOf("--json");
  if (jsonIdx === -1 || jsonIdx + 1 >= args.length) {
    console.error("Usage: alix runs append --json '<entry>'  (dev-only, hidden)");
    process.exit(2);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(args[jsonIdx + 1]) as unknown;
  } catch {
    console.error("Error: --json value must be valid JSON");
    process.exit(1);
  }

  const cwd = process.cwd();
  const store = createStore(cwd);

  try {
    await store.append(parsed as LedgerEntry);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error appending entry: ${message}`);
    process.exit(1);
  }

  console.log("Ledger entry appended.");
}

// ---------------------------------------------------------------------------
// runApprove — `alix runs approve <runId> --gate <gate> --by <op> [--reason]`
// ---------------------------------------------------------------------------

const VALID_GATES: ApprovalGateName[] = [
  "proposal", "file_scope", "verification", "pr", "merge",
];

async function runApprove(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");

  const positional = args.filter((a) => !a.startsWith("--"));
  const runId = positional[0];

  const gateIdx = args.indexOf("--gate");
  const gateName = gateIdx !== -1 && gateIdx + 1 < args.length
    ? args[gateIdx + 1] as ApprovalGateName
    : undefined;

  const byIdx = args.indexOf("--by");
  const operator = byIdx !== -1 && byIdx + 1 < args.length
    ? args[byIdx + 1]
    : undefined;

  const reasonIdx = args.indexOf("--reason");
  const reason = reasonIdx !== -1 && reasonIdx + 1 < args.length
    ? args[reasonIdx + 1]
    : undefined;

  if (!runId || !gateName || !operator) {
    console.error("Usage: alix runs approve <runId> --gate <gate> --by <operator> [--reason <text>]");
    process.exit(2);
  }

  if (!(VALID_GATES as readonly string[]).includes(gateName)) {
    console.error(`Error: --gate must be one of: ${VALID_GATES.join(", ")}`);
    process.exit(1);
  }

  if (gateName === "merge") {
    console.error("Error: merge gate cannot be approved via operator CLI — merges are never autonomous");
    process.exit(1);
  }

  const cwd = process.cwd();
  const store = createStore(cwd);
  const entry = await store.get(runId);

  if (!entry) {
    console.error(`Error: run not found: ${runId}`);
    process.exit(1);
  }

  // Wrap approvals in an ApprovalWorkflowResult-like shape for the pure function
  const workflowResult: ApprovalWorkflowResult = {
    required: true,
    gates: entry.approvals,
    reason: reason ?? "Operator approval",
  };

  const updated = approveGate(workflowResult, gateName, operator);

  const newEntry: LedgerEntry = {
    ...entry,
    approvals: updated.gates,
    timestamp: new Date().toISOString(),
  };

  await store.append(newEntry);

  if (jsonMode) {
    console.log(JSON.stringify({ ok: true, runId, gate: gateName, approvedBy: operator }, null, 2));
    return;
  }

  console.log(`Gate ${CYAN}${gateName}${RESET} approved by ${CYAN}${operator}${RESET} for run ${CYAN}${runId}${RESET}`);
  if (reason) console.log(`  Reason: ${reason}`);
}

// ---------------------------------------------------------------------------
// runDeny — `alix runs deny <runId> --gate <gate> --by <op> [--reason]`
// ---------------------------------------------------------------------------

async function runDeny(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");

  const positional = args.filter((a) => !a.startsWith("--"));
  const runId = positional[0];

  const gateIdx = args.indexOf("--gate");
  const gateName = gateIdx !== -1 && gateIdx + 1 < args.length
    ? args[gateIdx + 1] as ApprovalGateName
    : undefined;

  const byIdx = args.indexOf("--by");
  const operator = byIdx !== -1 && byIdx + 1 < args.length
    ? args[byIdx + 1]
    : undefined;

  const reasonIdx = args.indexOf("--reason");
  const reason = reasonIdx !== -1 && reasonIdx + 1 < args.length
    ? args[reasonIdx + 1]
    : undefined;

  if (!runId || !gateName || !operator) {
    console.error("Usage: alix runs deny <runId> --gate <gate> --by <operator> [--reason <text>]");
    process.exit(2);
  }

  if (!(VALID_GATES as readonly string[]).includes(gateName)) {
    console.error(`Error: --gate must be one of: ${VALID_GATES.join(", ")}`);
    process.exit(1);
  }

  const cwd = process.cwd();
  const store = createStore(cwd);
  const entry = await store.get(runId);

  if (!entry) {
    console.error(`Error: run not found: ${runId}`);
    process.exit(1);
  }

  const workflowResult: ApprovalWorkflowResult = {
    required: true,
    gates: entry.approvals,
    reason: reason ?? "Operator denial",
  };

  const updated = denyGate(workflowResult, gateName, reason);

  const newEntry: LedgerEntry = {
    ...entry,
    approvals: updated.gates,
    outcome: "denied" as const,
    timestamp: new Date().toISOString(),
  };

  await store.append(newEntry);

  if (jsonMode) {
    console.log(JSON.stringify({ ok: true, runId, gate: gateName, deniedBy: operator }, null, 2));
    return;
  }

  console.log(`Gate ${CYAN}${gateName}${RESET} denied by ${CYAN}${operator}${RESET} for run ${CYAN}${runId}${RESET}`);
  if (reason) console.log(`  Reason: ${reason}`);
}

// ---------------------------------------------------------------------------
// runCancel — `alix runs cancel <runId> --by <op> [--reason]`
// ---------------------------------------------------------------------------

async function runCancel(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");

  const positional = args.filter((a) => !a.startsWith("--"));
  const runId = positional[0];

  const byIdx = args.indexOf("--by");
  const operator = byIdx !== -1 && byIdx + 1 < args.length
    ? args[byIdx + 1]
    : undefined;

  const reasonIdx = args.indexOf("--reason");
  const reason = reasonIdx !== -1 && reasonIdx + 1 < args.length
    ? args[reasonIdx + 1]
    : undefined;

  if (!runId || !operator) {
    console.error("Usage: alix runs cancel <runId> --by <operator> [--reason <text>]");
    process.exit(2);
  }

  const cwd = process.cwd();
  const store = createStore(cwd);
  const entry = await store.get(runId);

  if (!entry) {
    console.error(`Error: run not found: ${runId}`);
    process.exit(1);
  }

  const newEntry: LedgerEntry = {
    ...entry,
    outcome: "cancelled" as const,
    timestamp: new Date().toISOString(),
    // Preserve evidence — append `cancel` as a verification-style marker
    verificationResults: [
      ...entry.verificationResults,
      { command: "operator.cancel", status: "operator_cancelled", operator, reason: reason ?? "" },
    ],
  };

  await store.append(newEntry);

  if (jsonMode) {
    console.log(JSON.stringify({ ok: true, runId, cancelledBy: operator }, null, 2));
    return;
  }

  console.log(`Run ${CYAN}${runId}${RESET} cancelled by ${CYAN}${operator}${RESET}`);
  if (reason) console.log(`  Reason: ${reason}`);
}

// ---------------------------------------------------------------------------
// Terminal renderer — single entry detail
// ---------------------------------------------------------------------------

function renderDetail(entry: LedgerEntry): void {
  const outcomeColor = colorForOutcome(entry.outcome);

  console.log(BOLD + "Run Ledger Entry" + RESET);
  console.log(BAR);
  console.log(`  Run ID:     ${CYAN}${entry.runId}${RESET}`);
  console.log(`  Issue ID:   ${entry.issueId}`);
  console.log(`  Outcome:    ${outcomeColor}${entry.outcome}${RESET}`);
  console.log(`  Timestamp:  ${entry.timestamp}`);
  if (entry.draftPrId) console.log(`  Draft PR:   ${entry.draftPrId}`);
  console.log("");

  console.log(BOLD + "Policy Result" + RESET);
  console.log(`  Decision:    ${entry.policyResult.decision}`);
  console.log(`  Reason:      ${entry.policyResult.reason}`);
  console.log(`  Policies:    ${entry.policyResult.matchedPolicies.join(", ") || "(none)"}`);
  console.log("");

  console.log(BOLD + "Risk Score" + RESET);
  console.log(`  Level:  ${entry.riskScore.level}`);
  console.log(`  Score:  ${entry.riskScore.score}`);
  console.log("");

  console.log(BOLD + "Approvals" + RESET);
  if (entry.approvals.length === 0) {
    console.log(DIM + "  (none)" + RESET);
  } else {
    for (const g of entry.approvals) {
      const statusIcon = g.status === "approved" ? "✅" : g.status === "denied" ? "❌" : "⏳";
      console.log(`  ${statusIcon} [${g.status}] ${g.gate}` +
        (g.approvedBy ? ` by ${g.approvedBy}` : "") +
        (g.reason ? ` — ${g.reason}` : ""));
    }
  }
  console.log("");

  console.log(BOLD + "Files Changed" + RESET);
  if (entry.filesChanged.length === 0) {
    console.log(DIM + "  (none)" + RESET);
  } else {
    for (const f of entry.filesChanged) {
      console.log(`  ${f}`);
    }
  }
  console.log("");

  console.log(BOLD + "Verification Results" + RESET);
  if (entry.verificationResults.length === 0) {
    console.log(DIM + "  (none)" + RESET);
  } else {
    for (const vr of entry.verificationResults) {
      const vIcon = vr.status === "passed" ? "✅" : vr.status === "failed" ? "❌" : "⏳";
      console.log(`  ${vIcon} ${vr.command} — ${vr.status}`);
    }
  }
}
