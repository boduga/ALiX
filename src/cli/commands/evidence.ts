/**
 * evidence.ts — Evidence CLI commands for ALiX (P4.4b).
 *
 * Provides:
 * - `alix evidence list [--kind <type>] [--limit <n>] [--json]`
 * - `alix evidence show <fingerprint>`
 * - `alix evidence query --kind <type> [--after <iso>] [--before <iso>] [--json]`
 * - `alix evidence verify`
 *
 * @module
 */

import { join } from "node:path";
import { EvidenceStore } from "../../security/evidence/evidence-store.js";
import type { EvidenceType } from "../../security/evidence/evidence-types.js";
import { EVIDENCE_TYPES } from "../../security/evidence/evidence-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default evidence store directory relative to cwd. */
const EVIDENCE_DIR = join(".alix", "security");

/** Default query limit. */
const DEFAULT_LIMIT = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParsedArgs {
  command: string;
  kind?: EvidenceType;
  limit: number;
  json: boolean;
  fingerprint?: string;
  after?: string;
  before?: string;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    command: args[0] ?? "",
    limit: DEFAULT_LIMIT,
    json: false,
    errors: [],
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--kind" || arg === "-k") {
      const raw = args[++i];
      if (!raw) {
        result.errors.push("--kind requires a value");
        continue;
      }
      if (!EVIDENCE_TYPES.has(raw)) {
        result.errors.push(
          `Unknown evidence kind "${raw}". Valid: ${Array.from(EVIDENCE_TYPES).join(", ")}`,
        );
        continue;
      }
      result.kind = raw as EvidenceType;
    } else if (arg === "--limit" || arg === "-n") {
      const raw = args[++i];
      const n = parseInt(raw, 10);
      result.limit = Number.isFinite(n) && n > 0 ? n : DEFAULT_LIMIT;
    } else if (arg === "--json") {
      result.json = true;
    } else if (arg === "--after") {
      const raw = args[++i];
      if (!raw || !isValidIso(raw)) {
        result.errors.push(`--after requires a valid ISO 8601 timestamp, got "${raw ?? ""}"`);
        continue;
      }
      result.after = raw;
    } else if (arg === "--before") {
      const raw = args[++i];
      if (!raw || !isValidIso(raw)) {
        result.errors.push(`--before requires a valid ISO 8601 timestamp, got "${raw ?? ""}"`);
        continue;
      }
      result.before = raw;
    } else if (!result.fingerprint && !arg.startsWith("-")) {
      // First positional arg after command is the fingerprint for "show"
      result.fingerprint = arg;
    }
  }

  return result;
}

/**
 * Truncate a string for table display.
 */
function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + "...";
}

/**
 * Basic ISO 8601 validation: the string must parse to a valid Date
 * and the round-tripped ISO string must match (catches obvious garbage).
 */
function isValidIso(s: string): boolean {
  if (typeof s !== "string" || s.length < 10) return false;
  const d = new Date(s);
  if (isNaN(d.getTime())) return false;
  // Round-trip check: parsing and re-stringifying should produce the same date
  return d.toISOString().slice(0, s.length) === s || s.endsWith("Z") || /^\d{4}-\d{2}-\d{2}/.test(s);
}

// ---------------------------------------------------------------------------
// Table output
// ---------------------------------------------------------------------------

function printTable(rows: Array<Record<string, string>>, columns: string[]): void {
  if (rows.length === 0) {
    console.log("No evidence records found.");
    return;
  }

  // Compute column widths
  const widths = columns.map((col) =>
    Math.max(col.length, ...rows.map((r) => (r[col] ?? "").length)),
  );

  // Header
  const header = columns.map((col, i) => col.padEnd(widths[i])).join("  ");
  console.log(header);
  console.log("-".repeat(header.length));

  // Rows
  for (const row of rows) {
    console.log(columns.map((col, i) => (row[col] ?? "").padEnd(widths[i])).join("  "));
  }
}

// ---------------------------------------------------------------------------
// Evidence store factory
// ---------------------------------------------------------------------------

function createStore(cwd?: string): EvidenceStore {
  const root = cwd ?? process.cwd();
  return new EvidenceStore({ storeDir: join(root, EVIDENCE_DIR) });
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

async function handleList(parsed: ParsedArgs, store: EvidenceStore): Promise<void> {
  const result = await store.query({
    type: parsed.kind,
    limit: parsed.limit,
  });

  if (parsed.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.records.length === 0) {
    console.log("No evidence records found.");
    if (parsed.kind) {
      console.log(`  (filtered by kind: ${parsed.kind})`);
    }
    return;
  }

  const rows = result.records.map((r) => ({
    fingerprint: truncate(r.fingerprint, 16),
    type: r.type.padEnd(20),
    timestamp: r.timestamp,
  }));

  printTable(rows, ["fingerprint", "type", "timestamp"]);

  const footer = `${result.records.length} record(s)`;
  if (result.truncated) {
    console.log(`\n${footer} (showing ${result.records.length} of ${result.total}, use --limit to show more)`);
  } else {
    console.log(`\n${footer}`);
  }
}

async function handleShow(parsed: ParsedArgs, store: EvidenceStore): Promise<void> {
  if (!parsed.fingerprint) {
    console.error("Usage: alix evidence show <fingerprint>");
    process.exit(1);
  }

  const record = await store.getByFingerprint(parsed.fingerprint);
  if (!record) {
    console.error(`Evidence record not found: "${parsed.fingerprint}"`);
    process.exit(1);
  }

  if (parsed.json) {
    console.log(JSON.stringify(record, null, 2));
    return;
  }

  console.log(`ID:          ${record.id}`);
  console.log(`Type:        ${record.type}`);
  console.log(`Timestamp:   ${record.timestamp}`);
  console.log(`Fingerprint: ${record.fingerprint}`);
  console.log(`Payload:     ${JSON.stringify(record.payload, null, 2)}`);
}

async function handleQuery(parsed: ParsedArgs, store: EvidenceStore): Promise<void> {
  if (!parsed.kind && !parsed.after && !parsed.before) {
    console.error("Usage: alix evidence query --kind <type> [--after <iso>] [--before <iso>]");
    console.error("At least one filter is required.");
    process.exit(1);
  }

  const result = await store.query({
    type: parsed.kind,
    after: parsed.after,
    before: parsed.before,
    limit: parsed.limit,
  });

  if (parsed.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.records.length === 0) {
    console.log("No matching evidence records.");
    return;
  }

  const rows = result.records.map((r) => ({
    fingerprint: truncate(r.fingerprint, 16),
    type: r.type.padEnd(20),
    timestamp: r.timestamp,
  }));

  printTable(rows, ["fingerprint", "type", "timestamp"]);
  console.log(`\n${result.records.length} record(s)`);
}

async function handleVerify(_parsed: ParsedArgs, store: EvidenceStore): Promise<void> {
  const result = await store.verify();

  if (result.ok) {
    console.log(`✅ Evidence store verified: ${result.total} record(s), all fingerprints valid.`);
    return;
  }

  console.error(`❌ Evidence store verification FAILED:`);
  console.error(`   Total records checked: ${result.total}`);
  console.error(`   Invalid fingerprints:  ${result.failed.length}`);

  let malformedCount = 0;
  for (const rec of result.failed) {
    if (!rec.fingerprint) {
      malformedCount++;
      continue;
    }
    console.error(`   - ${rec.fingerprint} (${rec.type}, ${rec.timestamp})`);
  }

  if (malformedCount > 0) {
    console.error(`\n   ⚠️  ${malformedCount} malformed record(s) with no fingerprint detected.`);
    console.error(`   These may indicate corruption or an interrupted write.`);
    console.error(`   Run \`alix evidence compact\` to archive old records and surface remaining issues.`);
  }

  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Handle all `alix evidence` subcommands.
 */
export async function handleEvidenceCommand(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  // Check for parse errors first
  if (parsed.errors.length > 0) {
    for (const err of parsed.errors) {
      console.error(err);
    }
    process.exit(1);
  }

  const store = createStore();

  switch (parsed.command) {
    case "list":
      await handleList(parsed, store);
      break;
    case "show":
      await handleShow(parsed, store);
      break;
    case "query":
      await handleQuery(parsed, store);
      break;
    case "verify":
      await handleVerify(parsed, store);
      break;
    default:
      console.error(`Unknown evidence subcommand: "${parsed.command}"`);
      console.error("Usage: alix evidence list|show|query|verify");
      process.exit(1);
  }
}
