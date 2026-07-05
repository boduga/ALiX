/**
 * P12.5 — `alix failures` CLI dispatcher.
 *
 * Five subcommands:
 *   - list   — list failure records (newest first)
 *   - show   — show failures for a run or issue
 *   - recall — find similar failures by type or field
 *   - append — dev-only, append a raw JSON record
 *
 * Core invariant: read-only by default, append is opt-in via --json.
 * Never mutates policy, risk, approval, or ledger state.
 *
 * @module
 */

import { join } from "node:path";
import {
  FileFailureMemoryStore,
  VALID_FAILURE_TYPES,
  type FailureRecord,
  type FailureRecallQuery,
  type FailureType,
} from "../../governance/failure-memory.js";

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

const BAR = "────────────────────────────────────────────────────────────────";

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

function createStore(cwd: string): FileFailureMemoryStore {
  return new FileFailureMemoryStore(join(cwd, ".alix", "governance"));
}

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

export async function handleFailuresCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "list":
      return runList(args.slice(1));
    case "show":
      return runShow(args.slice(1));
    case "recall":
      return runRecall(args.slice(1));
    case "append":
      return runAppend(args.slice(1));
    default:
      console.error(
        `Unknown failures subcommand: "${subcommand ?? ""}"`,
      );
      console.error(
        "Usage: alix failures {list|show|recall|append} [options]",
      );
      process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// runList — `alix failures list [--limit N] [--json]`
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
  const records = await store.list(limit);

  if (jsonMode) {
    console.log(JSON.stringify(records, null, 2));
    return;
  }

  if (records.length === 0) {
    console.log(DIM + "No failure records found." + RESET);
    return;
  }

  console.log(BOLD + `Failure Memory (${records.length} record${records.length === 1 ? "" : "s"})` + RESET);
  console.log(BAR);

  for (const r of records) {
    console.log(
      `  ${CYAN}${r.runId}${RESET}  ${colorForType(r.failureType)}${r.failureType}${RESET}` +
      `  ${r.timestamp}`,
    );
    console.log(`    issue: ${r.issueId}  detail: ${r.detail.slice(0, 80)}${r.detail.length > 80 ? "…" : ""}`);
  }
}

// ---------------------------------------------------------------------------
// runShow — `alix failures show --run <runId> [--json]`
//            `alix failures show --issue <issueId> [--json]`
// ---------------------------------------------------------------------------

async function runShow(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");

  const runIdx = args.indexOf("--run");
  const issueIdx = args.indexOf("--issue");

  if (runIdx === -1 && issueIdx === -1) {
    console.error("Error: provide --run <runId> or --issue <issueId>");
    console.error("Usage: alix failures show --run <runId> [--json]");
    console.error("       alix failures show --issue <issueId> [--json]");
    process.exit(2);
  }

  const cwd = process.cwd();
  const store = createStore(cwd);

  if (runIdx !== -1 && runIdx + 1 < args.length) {
    const runId = args[runIdx + 1];
    const records = await store.getByRun(runId);

    if (jsonMode) {
      console.log(JSON.stringify(records, null, 2));
      return;
    }

    if (records.length === 0) {
      console.log(DIM + "No failure records for run: " + runId + RESET);
      return;
    }

    console.log(BOLD + `Failures for run ${CYAN}${runId}${RESET}` + RESET);
    console.log(BAR);
    for (const r of records) {
      renderRecordBrief(r);
    }
    return;
  }

  if (issueIdx !== -1 && issueIdx + 1 < args.length) {
    const issueId = args[issueIdx + 1];
    const records = await store.getByIssue(issueId);

    if (jsonMode) {
      console.log(JSON.stringify(records, null, 2));
      return;
    }

    if (records.length === 0) {
      console.log(DIM + "No failure records for issue: " + issueId + RESET);
      return;
    }

    console.log(BOLD + `Failures for issue ${CYAN}${issueId}${RESET}` + RESET);
    console.log(BAR);
    for (const r of records) {
      renderRecordBrief(r);
    }
    return;
  }

  console.error("Error: --run or --issue requires a value");
  process.exit(2);
}

// ---------------------------------------------------------------------------
// runRecall — `alix failures recall --type <type> [--limit N] [--json]`
// ---------------------------------------------------------------------------

async function runRecall(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");

  const typeIdx = args.indexOf("--type");
  let failureType: FailureType | undefined;
  if (typeIdx !== -1 && typeIdx + 1 < args.length) {
    const val = args[typeIdx + 1];
    if (!(VALID_FAILURE_TYPES as readonly string[]).includes(val)) {
      console.error(`Error: --type must be one of: ${VALID_FAILURE_TYPES.join(", ")}`);
      process.exit(1);
    }
    failureType = val as FailureType;
  }

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

  const query: FailureRecallQuery = {};
  if (failureType) query.failureType = failureType;

  const cwd = process.cwd();
  const store = createStore(cwd);
  const records = await store.findSimilar(query, limit);

  if (jsonMode) {
    console.log(JSON.stringify(records, null, 2));
    return;
  }

  if (records.length === 0) {
    console.log(DIM + "No similar failures found." + RESET);
    return;
  }

  console.log(BOLD + `Similar Failures (${records.length})` + RESET);
  console.log(BAR);
  for (const r of records) {
    renderRecordBrief(r);
  }
}

// ---------------------------------------------------------------------------
// runAppend — `alix failures append --json '<record>'` (dev-only, hidden)
// ---------------------------------------------------------------------------

async function runAppend(args: string[]): Promise<void> {
  const jsonIdx = args.indexOf("--json");
  if (jsonIdx === -1 || jsonIdx + 1 >= args.length) {
    console.error("Usage: alix failures append --json '<record>'  (dev-only, hidden)");
    process.exit(2);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(args[jsonIdx + 1]);
  } catch {
    console.error("Error: --json value must be valid JSON");
    process.exit(1);
  }

  const cwd = process.cwd();
  const store = createStore(cwd);

  try {
    await store.append(parsed as FailureRecord);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error appending failure record: ${message}`);
    process.exit(1);
  }

  console.log("Failure record appended.");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function colorForType(failureType: string): string {
  switch (failureType) {
    case "policy_denied":
    case "approval_denied":
    case "pr_rejected":
      return RED;
    case "verification_timeout":
    case "test_failure":
      return YELLOW;
    default:
      return CYAN;
  }
}

function renderRecordBrief(r: FailureRecord): void {
  console.log(`  ${colorForType(r.failureType)}[${r.failureType}]${RESET} ${CYAN}${r.runId}${RESET}`);
  console.log(`    issue: ${r.issueId}  at: ${r.timestamp}`);
  console.log(`    ${r.detail}`);
  if (r.filePaths && r.filePaths.length > 0) {
    console.log(`    files: ${r.filePaths.join(", ")}`);
  }
  if (r.command) {
    console.log(`    command: ${r.command}`);
  }
  if (r.policyIds && r.policyIds.length > 0) {
    console.log(`    policies: ${r.policyIds.join(", ")}`);
  }
  console.log("");
}
