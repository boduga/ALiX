/**
 * P9.0f — `alix governance` CLI dispatcher + terminal renderers.
 *
 * Five subcommands, each consuming one or more P9 builders:
 *   - health  — buildGovernanceHealth + buildGovernanceAssessment
 *   - drift   — detectGovernanceDrift
 *   - lens-review — reviewLenses
 *   - integrity — buildGovernanceIntegrity
 *   - recommend — generateRecommendations (P9.1)
 *
 * Each subcommand stores its artifact via GovernanceStore.append() and renders
 * either ANSI-colored terminal output or raw JSON.
 *
 * CORE INVARIANT: this module NEVER writes any P8 store. It only calls P9
 * builders (which are read-only analysers) and GovernanceStore (the single
 * permitted P9 write target). Sentinel-enforced.
 *
 * @module
 */

import "node:path";
import "node:crypto";
import "../../../governance/governance-store.js";
import "../../../governance/investigation-store.js";
import "../../../governance/governance-recommendation-generator.js";
import "../../../governance/investigation-generator.js";
import "../../../governance/investigation-compat.js";
import "../governance-dashboard-handler.js";
// A8 T7 imports — learning CLI surface (4-adapter construction, per A8
// wayfinder map #517 locked ruling). Imports are dynamic-free at module
// scope to keep the seam file's load graph small.
import "../../../evolution/learning/learning-cli.js";
// A9 Slice 5 — pre-execution risk forecast CLI surface.
import "../../../evolution/forecast/forecast-cli.js";
import "../../../events/event-log.js";
import { runAuditActor, runAuditAnomalies, runAuditEffectiveness, runAuditPolicy, runAuditReport, runAuditStats } from "./audit-insights.js";
import { BOLD, CYAN, DIM, GREEN, MAGENTA, RED, RESET, YELLOW } from "./shared.js";

// P22-INTELLIGENCE-END

export const EVENT_TYPE_COLORS: Record<string, string> = {
  "policy.evaluated": CYAN,
  "runtime.allowed": GREEN,
  "runtime.blocked": RED,
  "runtime.requires_approval": YELLOW,
  "approval.created": CYAN,
  "approval.approved": GREEN,
  "approval.denied": RED,
  "override.applied": MAGENTA,
};


export function eventTypeColor(eventType: string): string {
  return EVENT_TYPE_COLORS[eventType] ?? RESET;
}


export async function runAudit(rawArgs: string[]): Promise<void> {
  const args = rawArgs.slice(); // copy
  const jsonMode = args.includes("--json");

  const sub = args.shift();
  // Remove --json so subcommand handlers don't see it
  if (jsonMode) {
    const idx = args.indexOf("--json");
    if (idx >= 0) args.splice(idx, 1);
  }

  const cwd = process.cwd();

  switch (sub) {
    case undefined:
      printAuditHelp();
      return;
    case "list":
      return runAuditList(cwd, args, jsonMode);
    case "show":
      return runAuditShow(cwd, args, jsonMode);
    case "trace":
      return runAuditTrace(cwd, args, jsonMode);
    case "timeline":
      return runAuditTimeline(cwd, args, jsonMode);
    case "stats":
      return runAuditStats(cwd, args, jsonMode);
    case "anomalies":
      return runAuditAnomalies(cwd, args, jsonMode);
    case "effectiveness":
      return runAuditEffectiveness(cwd, args, jsonMode);
    case "report":
      return runAuditReport(cwd, args, jsonMode);
    case "actor":
      return runAuditActor(cwd, args, jsonMode);
    case "policy":
      return runAuditPolicy(cwd, args, jsonMode);
    case "verify":
      return runAuditVerify(cwd, jsonMode);
    case "export":
      return runAuditExport(cwd, args, jsonMode);
    default:
      console.log(
        RED +
          'Unknown audit subcommand "' +
          sub +
          '". Expected: list, show, trace, timeline, stats, anomalies, effectiveness, report, actor, policy, verify, export' +
          RESET,
      );
      process.exit(1);
  }
}


/**
 * P14.8 — Help for bare `alix governance audit` (no subcommand).
 * Prints the subcommand surface + examples; exits 0.
 */
export function printAuditHelp(): void {
  console.log(BOLD + "alix governance audit — Governance Audit Trail inspection" + RESET);
  console.log("");
  console.log(DIM + "Subcommands:" + RESET);
  console.log("  list       List audit events (filters: --limit, --event-type, --subject,");
  console.log("             --risk, --decision, --actor-type, --actor-id, --policy, --trace, --from, --to)");
  console.log("  show       Show a single event in detail (--related for correlated events)");
  console.log("  trace      Events for a trace id");
  console.log("  timeline   Compact chronological timeline (--trace, --actor-id, --limit)");
  console.log("  actor      Events for an actor id (--actor-type)");
  console.log("  policy     Events for a policy id");
  console.log("  verify     Verify the hash chain");
  console.log("  export     Export the audit trail to a file");
  console.log("  stats      Governance metrics (--window, --from, --to, --top)");
  console.log("  anomalies      Detect anomalies (--recent, --baseline, --severity, --type)");
  console.log("  effectiveness  Operator outcome signals (--since, --until, --stale-days)");
  console.log("  report     Governance observability report (--section, --since, --until, --json)");
  console.log("");
  console.log(DIM + "All subcommands accept --json for machine-readable output." + RESET);
  console.log("");
  console.log(DIM + "Examples:" + RESET);
  console.log("  alix governance audit list --limit 20 --event-type runtime.requires_approval");
  console.log("  alix governance audit timeline --trace req-123");
  console.log("  alix governance audit show aud-abc123 --related");
}


// ---------------------------------------------------------------------------
// P14.8 — Pure format helpers (unit-testable; return strings, no console I/O)
// ---------------------------------------------------------------------------

/** Structural subset of GovernanceAuditEvent needed for timeline rendering. */
export interface TimelineEvent {
  timestamp: string;
  eventType: string;
  actorType: string;
  actorId: string;
  subjectType: string;
  subjectId: string | null;
  traceId: string | null;
  decision: string;
}


/**
 * Render a metadata object as indented key:value lines.
 * Scalar values render as `key: value`; nested objects/arrays fall back to
 * compact JSON so nothing is silently dropped. Returns "" for empty metadata.
 */
export function formatMetadata(metadata: Record<string, unknown>): string {
  const keys = Object.keys(metadata);
  if (keys.length === 0) return "";
  return keys
    .map((k) => {
      const v = metadata[k];
      const rendered =
        v === null || v === undefined
          ? "-"
          : typeof v === "object"
            ? JSON.stringify(v)
            : String(v);
      return `  ${k}: ${rendered}`;
    })
    .join("\n");
}


/**
 * Render one compact timeline line for an event.
 * Format: <timestamp>  <eventType>  <actorType>:<actorId>  <subjectType>:<subjectId>  <decision/traceId>
 */
export function formatTimelineLine(ev: TimelineEvent): string {
  const ts = ev.timestamp.slice(0, 19).replace("T", " ");
  const subject = ev.subjectId ? `${ev.subjectType}:${ev.subjectId}` : ev.subjectType;
  const tail = ev.traceId ?? ev.decision;
  return `${ts}  ${ev.eventType}  ${ev.actorType}:${ev.actorId}  ${subject}  ${tail}`;
}


/**
 * P14.8 `show --related` — compute correlated events deterministically.
 * Order: (1) same traceId, (2) same sessionId, (3) parent/child via parentEventId,
 * (4) de-dup by eventId, (5) chronological, (6) exclude the event itself.
 * Pure: takes all events + the focal event id, returns the related list.
 */
export function computeRelatedEvents<
  T extends { eventId: string; traceId: string | null; sessionId: string | null; parentEventId: string | null; timestamp: string },
>(all: T[], focalId: string): T[] {
  const focal = all.find((e) => e.eventId === focalId);
  if (!focal) return [];

  const seen = new Set<string>([focalId]);
  const matches = new Set<string>();

  for (const e of all) {
    if (e.eventId === focalId) continue;
    const sameTrace = focal.traceId !== null && e.traceId === focal.traceId;
    const sameSession = focal.sessionId !== null && e.sessionId === focal.sessionId;
    const parentChild =
      (focal.parentEventId !== null && e.eventId === focal.parentEventId) ||
      (e.parentEventId !== null && e.parentEventId === focalId);
    if (sameTrace || sameSession || parentChild) {
      if (!seen.has(e.eventId)) {
        seen.add(e.eventId);
        matches.add(e.eventId);
      }
    }
  }

  return all
    .filter((e) => matches.has(e.eventId))
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
}


export async function runAuditList(
  cwd: string,
  args: string[],
  jsonMode: boolean,
): Promise<void> {
  const { FileAuditStore } = await import("../../../governance/audit-store.js");
  const {
    queryByActor,
    queryByPolicy,
    queryByTraceId,
    queryByDecision,
    queryByTimeRange,
  } = await import("../../../governance/audit-query.js");

  const store = new FileAuditStore(cwd);
  let events = await store.list();

  // Parse filters
  const decisionFilter = parseInlineFlag(args, "--decision");
  const actorTypeFilter = parseInlineFlag(args, "--actor-type");
  const actorIdFilter = parseInlineFlag(args, "--actor-id");
  const policyFilter = parseInlineFlag(args, "--policy");
  const traceFilter = parseInlineFlag(args, "--trace");
  const fromFilter = parseInlineFlag(args, "--from");
  const toFilter = parseInlineFlag(args, "--to");
  const eventTypeFilter = parseInlineFlag(args, "--event-type");
  const subjectFilter = parseInlineFlag(args, "--subject");
  const riskFilter = parseInlineFlag(args, "--risk");
  const limitArg = parseInlineFlag(args, "--limit");

  // P14.8 — validate enum filters against the canonical sets
  if (eventTypeFilter) {
    const { VALID_EVENT_TYPES } = await import("../../../governance/audit-types.js");
    if (!(VALID_EVENT_TYPES as readonly string[]).includes(eventTypeFilter)) {
      console.log(RED + `Invalid --event-type "${eventTypeFilter}". Valid: ${VALID_EVENT_TYPES.join(", ")}` + RESET);
      process.exit(1);
    }
  }
  if (riskFilter) {
    const { VALID_RISK_LEVELS } = await import("../../../governance/audit-types.js");
    if (!(VALID_RISK_LEVELS as readonly string[]).includes(riskFilter)) {
      console.log(RED + `Invalid --risk "${riskFilter}". Valid: ${VALID_RISK_LEVELS.join(", ")}` + RESET);
      process.exit(1);
    }
  }

  // P14.8 --limit: positive integer, default 50, reject 0/negative/non-number
  let limit = 50;
  if (limitArg !== null) {
    const parsed = Number(limitArg);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      console.log(RED + `Invalid --limit "${limitArg}". Must be a positive integer.` + RESET);
      process.exit(1);
    }
    limit = parsed;
  }

  if (decisionFilter) {
    events = queryByDecision(events, decisionFilter as any);
  }
  if (actorTypeFilter) {
    events = queryByActor(events, actorTypeFilter as any, actorIdFilter ?? undefined);
  } else if (actorIdFilter) {
    events = events.filter((e) => e.actorId === actorIdFilter);
  }
  if (policyFilter) {
    events = queryByPolicy(events, policyFilter);
  }
  if (traceFilter) {
    events = queryByTraceId(events, traceFilter);
  }
  if (fromFilter || toFilter) {
    events = queryByTimeRange(events, fromFilter ?? undefined, toFilter ?? undefined);
  }
  // P14.8 — exact-match filters (case-sensitive, consistent with existing filters)
  if (eventTypeFilter) {
    events = events.filter((e) => e.eventType === eventTypeFilter);
  }
  if (subjectFilter) {
    // matches subjectId OR subjectType
    events = events.filter((e) => e.subjectId === subjectFilter || e.subjectType === subjectFilter);
  }
  if (riskFilter) {
    events = events.filter((e) => e.riskLevel === riskFilter);
  }

  if (jsonMode) {
    console.log(JSON.stringify(events, null, 2));
    return;
  }

  if (events.length === 0) {
    console.log(DIM + "No audit events found" + RESET);
    return;
  }

  console.log(
    BOLD + "Governance Audit Events (" + events.length + ")" + RESET,
  );
  console.log("");

  for (const ev of events.slice(0, limit)) {
    const color = eventTypeColor(ev.eventType);
    const tag = ev.eventType.padEnd(30);
    console.log(
      color + tag + RESET +
      ev.timestamp.slice(0, 19).replace("T", " ") + "  " +
      DIM + ev.eventId + RESET,
    );
    console.log(
      "  " + BOLD + ev.decision + RESET +
      "  " + DIM + ev.actorType + "/" + ev.actorId + RESET,
    );
    if (ev.policyId) {
      console.log("  " + DIM + "policy: " + ev.policyId + (ev.policyVersion ? " v" + ev.policyVersion : "") + RESET);
    }
    console.log("  " + ev.reason.slice(0, 120));
    console.log("");
  }

  if (events.length > limit) {
    console.log(DIM + "... and " + (events.length - limit) + " more" + RESET);
  }
}


export async function runAuditShow(
  cwd: string,
  args: string[],
  jsonMode: boolean,
): Promise<void> {
  const eventId = args.find((a) => !a.startsWith("--"));
  if (!eventId) {
    console.log(RED + "Usage: alix governance audit show <event-id> [--related]" + RESET);
    process.exit(1);
  }

  const relatedRequested = args.includes("--related");

  const { FileAuditStore } = await import("../../../governance/audit-store.js");
  const store = new FileAuditStore(cwd);
  const event = await store.getById(eventId);

  if (!event) {
    console.log(RED + "Audit event not found: " + eventId + RESET);
    process.exit(1);
  }

  // P14.8 — related events (deterministic correlation via computeRelatedEvents)
  const related = relatedRequested ? computeRelatedEvents(await store.list(), event.eventId) : [];

  if (jsonMode) {
    console.log(JSON.stringify(relatedRequested ? { ...event, related } : event, null, 2));
    return;
  }

  const color = eventTypeColor(event.eventType);
  console.log("");
  console.log(BOLD + "Event: " + event.eventId + RESET);
  console.log("");
  console.log( BOLD + "Type:" + RESET + "      " + color + event.eventType + RESET);
  console.log( BOLD + "Timestamp:" + RESET + " " + event.timestamp);
  console.log("");
  console.log( BOLD + "Actor:" + RESET + "     " + event.actorType + "/" + event.actorId);
  console.log( BOLD + "Subject:" + RESET + "   " + event.subjectType + (event.subjectId ? " (" + event.subjectId + ")" : ""));
  console.log("");
  console.log( BOLD + "Action:" + RESET + "   " + event.action);
  console.log( BOLD + "Decision:" + RESET + " " + event.decision);
  console.log( BOLD + "Risk:" + RESET + "     " + event.riskLevel + (event.requiresHumanReview ? " (requires human review)" : ""));
  console.log("");

  if (event.policyId) {
    console.log( BOLD + "Policy:" + RESET + "   " + event.policyId + (event.policyVersion ? " v" + event.policyVersion : ""));
    if (event.ruleId) console.log("  Rule: " + event.ruleId);
  }

  console.log( BOLD + "Reason:" + RESET + "   " + event.reason);
  if (event.evidenceRefs.length > 0) {
    console.log( BOLD + "Evidence:" + RESET + "  " + event.evidenceRefs.join(", "));
  }

  if (event.requestId || event.traceId || event.sessionId) {
    console.log("");
    console.log( BOLD + "Trace:" + RESET + "     " + (event.traceId ?? "-"));
    console.log( BOLD + "Request:" + RESET + "   " + (event.requestId ?? "-"));
    console.log( BOLD + "Session:" + RESET + "   " + (event.sessionId ?? "-"));
  }

  if (Object.keys(event.metadata).length > 0) {
    console.log("");
    console.log( BOLD + "Metadata:" + RESET);
    console.log(formatMetadata(event.metadata));
  }

  if (relatedRequested) {
    console.log("");
    console.log( BOLD + "Related events (" + related.length + "):" + RESET);
    if (related.length === 0) {
      console.log(DIM + "  (none)" + RESET);
    } else {
      for (const r of related) {
        console.log("  " + eventTypeColor(r.eventType) + r.eventType + RESET + "  " +
          r.timestamp.slice(0, 19).replace("T", " ") + "  " + DIM + r.eventId + RESET);
      }
    }
  }

  console.log("");
  console.log( BOLD + "Chain:" + RESET);
  console.log( "  Hash:          " + event.eventHash);
  console.log( "  Previous hash: " + (event.previousHash ?? DIM + "(none)" + RESET));
  console.log("");
}


export async function runAuditTrace(
  cwd: string,
  args: string[],
  jsonMode: boolean,
): Promise<void> {
  const traceId = args.find((a) => !a.startsWith("--"));
  if (!traceId) {
    console.log(RED + "Usage: alix governance audit trace <trace-id>" + RESET);
    process.exit(1);
  }

  const { FileAuditStore } = await import("../../../governance/audit-store.js");
  const { queryByTraceId } = await import("../../../governance/audit-query.js");

  const store = new FileAuditStore(cwd);
  const events = queryByTraceId(await store.list(), traceId);

  if (jsonMode) {
    console.log(JSON.stringify(events, null, 2));
    return;
  }

  if (events.length === 0) {
    console.log(DIM + "No events found for trace: " + traceId + RESET);
    return;
  }

  console.log(
    BOLD + "Trace: " + traceId + " (" + events.length + " events)" + RESET,
  );
  console.log("");

  for (const ev of events) {
    const color = eventTypeColor(ev.eventType);
    console.log(
      color + ev.eventType.padEnd(28) + RESET +
      ev.timestamp.slice(0, 19).replace("T", " ") + "  " +
      ev.eventId,
    );
    console.log(
      "  " + BOLD + ev.decision + RESET +
      "  " + ev.reason.slice(0, 100),
    );
    console.log("");
  }
}


/**
 * P14.8 — `audit timeline`: compact chronological view (oldest→newest).
 * Optional --trace / --actor-id / --limit. Presentation only.
 */
export async function runAuditTimeline(
  cwd: string,
  args: string[],
  jsonMode: boolean,
): Promise<void> {
  const traceFilter = parseInlineFlag(args, "--trace");
  const actorIdFilter = parseInlineFlag(args, "--actor-id");
  const limitArg = parseInlineFlag(args, "--limit");

  let limit = 50;
  if (limitArg !== null) {
    const parsed = Number(limitArg);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      console.log(RED + `Invalid --limit "${limitArg}". Must be a positive integer.` + RESET);
      process.exit(1);
    }
    limit = parsed;
  }

  const { FileAuditStore } = await import("../../../governance/audit-store.js");
  const { queryByTraceId } = await import("../../../governance/audit-query.js");
  const store = new FileAuditStore(cwd);

  let events = await store.listChronological(); // oldest → newest
  if (traceFilter) events = queryByTraceId(events, traceFilter);
  if (actorIdFilter) events = events.filter((e) => e.actorId === actorIdFilter);
  events = events.slice(0, limit);

  if (jsonMode) {
    console.log(JSON.stringify(events, null, 2));
    return;
  }

  if (events.length === 0) {
    console.log(DIM + "No audit events" + RESET);
    return;
  }

  console.log(BOLD + "Governance Audit Timeline (" + events.length + ")" + RESET);
  console.log(DIM + "time  eventType  actor  subject  ref   (oldest → newest)" + RESET);
  for (const ev of events) {
    console.log(eventTypeColor(ev.eventType) + formatTimelineLine(ev) + RESET);
  }
  console.log("");
}


export async function runAuditVerify(
  cwd: string,
  jsonMode: boolean,
): Promise<void> {
  const { FileAuditStore } = await import("../../../governance/audit-store.js");
  const { verifyChain } = await import("../../../governance/audit-chain.js");

  const store = new FileAuditStore(cwd);
  const events = await store.listChronological();
  const result = verifyChain(events);

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.valid) {
    console.log(GREEN + BOLD + "Chain integrity verified" + RESET);
    console.log(DIM + "Events: " + result.eventCount + RESET);
  } else {
    console.log(RED + BOLD + "Chain integrity FAILED" + RESET);
    console.log(DIM + "Events: " + result.eventCount + " | Findings: " + result.findings.length + RESET);
    for (const f of result.findings) {
      console.log(
        "  " + RED + f.type + RESET +
        "  " + DIM + f.eventId + RESET +
        "  " + f.detail,
      );
    }
  }
}


export async function runAuditExport(
  cwd: string,
  args: string[],
  jsonMode: boolean,
): Promise<void> {
  const formatFlag = parseInlineFlag(args, "--format") ?? "jsonl";
  const format = formatFlag === "json" ? "json" : "jsonl";
  const doRedact = args.includes("--redact");
  const outputFlag = parseInlineFlag(args, "--output");

  const { FileAuditStore } = await import("../../../governance/audit-store.js");
  const { exportEvents } = await import("../../../governance/audit-export.js");

  const store = new FileAuditStore(cwd);
  const events = await store.list();
  const output = exportEvents(events, format, {
    redact: doRedact,
    pretty: format === "json",
  });

  if (outputFlag) {
    // Delegate file write to separate export module (preserves P8 store invariant)
    const { exportAuditEventsToFile } = await import("../governance-audit-exporter.js");
    const result = await exportAuditEventsToFile(outputFlag, output, format, doRedact);

    if (jsonMode) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(
        GREEN + "Exported " + result.count + " events to " + result.exported + RESET,
      );
    }
  } else {
    // Print to stdout (use console.log to avoid P8 sentinel false positive)
    console.log(output);
  }
}


export function parseInlineFlag(args: string[], flag: string): string | null {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return null;
  const value = args[idx + 1];
  if (value.startsWith("--")) return null; // next arg is another flag, not a value
  return value;
}


/**
 * Extract a positional argument from args, skipping over flag values consumed
 * by parseInlineFlag for the given known value-taking flags.
 *
 * Unlike args.find(a => !a.startsWith("-")), this correctly skips flag values
 * even when they don't start with "-".
 */
export function extractPositionalArg(args: string[], valueFlags: string[]): string | undefined {
  const consumed = new Set<number>();
  for (const flag of valueFlags) {
    const idx = args.indexOf(flag);
    if (idx !== -1) {
      consumed.add(idx);
      if (idx + 1 < args.length) consumed.add(idx + 1);
    }
  }
  return args.find((a, i) => !a.startsWith("-") && !consumed.has(i));
}
