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
import type { ActionProposalStatusTransition } from "../../../governance/action-queue.js";
import { eventTypeColor, parseInlineFlag } from "./audit.js";
import { BOLD, DIM, RED, RESET, YELLOW } from "./shared.js";

/**
 * P15.1 — `audit stats`: governance audit metrics and diagnostics.
 *
 * Sub-subcommand: `before-after <bf> <bt> <af> <at>` for two-window comparison.
 * Flags: --window (minutes, default 60), --from, --to, --top (default 10), --json.
 */
export async function runAuditStats(
  cwd: string,
  args: string[],
  jsonMode: boolean,
): Promise<void> {
  // Detect before-after sub-subcommand
  if (args.includes("before-after")) {
    const idx = args.indexOf("before-after");
    const isoArgs = [args[idx + 1], args[idx + 2], args[idx + 3], args[idx + 4]];
    if (isoArgs.some((a) => !a)) {
      console.log(RED + "Usage: alix governance audit stats before-after <bf> <bt> <af> <at> [--json]" + RESET);
      process.exit(1);
    }
    for (const a of isoArgs) {
      if (Number.isNaN(new Date(a).getTime())) {
        console.log(RED + `Invalid ISO timestamp: "${a}"` + RESET);
        process.exit(1);
      }
    }

    const { FileAuditStore } = await import("../../../governance/audit-store.js");
    const { beforeAfterComparison } = await import("../../../governance/audit-metrics.js");
    const store = new FileAuditStore(cwd);
    const events = await store.list();
    const result = beforeAfterComparison(events, isoArgs[0]!, isoArgs[1]!, isoArgs[2]!, isoArgs[3]!);

    if (jsonMode) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(BOLD + "Governance Audit — Before/After" + RESET);
    console.log(`  ${DIM}Before:${RESET} ${isoArgs[0]} → ${isoArgs[1]}  (${result.before.totalEvents} events)`);
    console.log(`  ${DIM}After:${RESET}  ${isoArgs[2]} → ${isoArgs[3]}  (${result.after.totalEvents} events)`);
    console.log("");
    console.log(BOLD + "Delta:" + RESET);
    console.log(`  totalEvents:    ${deltaSign(result.delta.totalEvents)}${result.delta.totalEvents}`);
    console.log(`  allowed rate:   ${deltaSign(result.delta.decisionRates.allowed)}${result.delta.decisionRates.allowed.toFixed(3)}`);
    console.log(`  denied rate:    ${deltaSign(result.delta.decisionRates.denied)}${result.delta.decisionRates.denied.toFixed(3)}`);
    console.log(`  escalated rate: ${deltaSign(result.delta.decisionRates.escalated)}${result.delta.decisionRates.escalated.toFixed(3)}`);
    console.log(`  overridden rate:${deltaSign(result.delta.decisionRates.overridden)}${result.delta.decisionRates.overridden.toFixed(3)}`);
    if (result.delta.riskDistribution && Object.keys(result.delta.riskDistribution).length > 0) {
      console.log("  risk delta:");
      for (const [k, v] of Object.entries(result.delta.riskDistribution).sort()) {
        console.log(`    ${k}: ${deltaSign(v)}${v}`);
      }
    }
    console.log("");
    return;
  }

  // Standard stats
  const windowArg = parseInlineFlag(args, "--window");
  const fromArg = parseInlineFlag(args, "--from");
  const toArg = parseInlineFlag(args, "--to");
  const topArg = parseInlineFlag(args, "--top");

  // Validate
  let windowMs = 60 * 60 * 1000; // default 60 minutes
  if (windowArg !== null) {
    const parsed = Number(windowArg);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      console.log(RED + `Invalid --window "${windowArg}". Must be a positive integer of minutes.` + RESET);
      process.exit(1);
    }
    windowMs = parsed * 60 * 1000;
  }

  if (fromArg !== null && Number.isNaN(new Date(fromArg).getTime())) {
    console.log(RED + `Invalid --from "${fromArg}". Must be an ISO timestamp.` + RESET);
    process.exit(1);
  }
  if (toArg !== null && Number.isNaN(new Date(toArg).getTime())) {
    console.log(RED + `Invalid --to "${toArg}". Must be an ISO timestamp.` + RESET);
    process.exit(1);
  }

  let topN = 10;
  if (topArg !== null) {
    const parsed = Number(topArg);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      console.log(RED + `Invalid --top "${topArg}". Must be a positive integer.` + RESET);
      process.exit(1);
    }
    topN = parsed;
  }

  // Fetch events
  const { FileAuditStore } = await import("../../../governance/audit-store.js");
  const store = new FileAuditStore(cwd);
  let events = await store.list();

  // Apply time filter (inclusive lower, exclusive upper)
  if (fromArg !== null) {
    events = events.filter((e) => e.timestamp >= fromArg!);
  }
  if (toArg !== null) {
    events = events.filter((e) => e.timestamp < toArg!);
  }

  // Compute metrics
  const {
    eventTypeDistribution,
    decisionRates,
    riskDistribution,
    timeWindowedCounts,
    topActors,
    topSubjects,
    policyActivity,
    traceVolume,
  } = await import("../../../governance/audit-metrics.js");

  const dist = eventTypeDistribution(events);
  const rates = decisionRates(events);
  const risk = riskDistribution(events);
  const buckets = timeWindowedCounts(events, windowMs);
  const actors = topActors(events, topN);
  const subjects = topSubjects(events, topN);
  const policies = policyActivity(events);
  const trace = traceVolume(events);

  // Render
  if (jsonMode) {
    console.log(JSON.stringify({
      totalEvents: events.length,
      eventTypeDistribution: dist,
      decisionRates: rates,
      riskDistribution: risk,
      timeBuckets: buckets,
      actors,
      subjects,
      policies,
      traceVolume: trace,
    }, null, 2));
    return;
  }

  console.log(BOLD + `Governance Audit Metrics (${events.length} events, ${windowArg ?? "60"}m window)` + RESET);
  console.log(DIM + "─".repeat(50) + RESET);
  console.log("");

  // Event type distribution
  const sortedTypes = Object.entries(dist).sort((a, b) => a[0].localeCompare(b[0]));
  console.log(BOLD + "Event type distribution:" + RESET);
  for (const [type, count] of sortedTypes) {
    const color = eventTypeColor(type as any);
    console.log(`  ${color}${type.padEnd(25)}${RESET} ${count}`);
  }
  console.log("");

  // Decision rates
  console.log(BOLD + "Decision rates:" + RESET);
  for (const [k, v] of Object.entries(rates)) {
    console.log(`  ${k.padEnd(12)} ${(v as number).toFixed(3)}`);
  }
  console.log("");

  // Risk distribution
  const sortedRisk = Object.entries(risk).sort((a, b) => a[0].localeCompare(b[0]));
  console.log(BOLD + "Risk distribution:" + RESET);
  for (const [level, count] of sortedRisk) {
    const color = level === "critical" ? RED : level === "high" ? YELLOW : level === "medium" ? "" : DIM;
    console.log(`  ${color}${level.padEnd(10)}${RESET} ${count}`);
  }
  console.log("");

  // Top actors
  console.log(BOLD + `Top actors (${actors.length}):` + RESET);
  for (const a of actors) {
    console.log(`  ${a.actorId.padEnd(30)} ${a.count}  ${DIM}last: ${a.lastSeen.slice(0, 19).replace("T", " ")}${RESET}`);
  }
  console.log("");

  // Top subjects
  if (subjects.length > 0) {
    console.log(BOLD + `Top subjects (${subjects.length}):` + RESET);
    for (const s of subjects) {
      console.log(`  ${s.subjectType}/${s.subjectId.padEnd(20)} ${s.count}`);
    }
    console.log("");
  }

  // Policy activity
  if (policies.length > 0) {
    console.log(BOLD + `Policy activity (${policies.length}):` + RESET);
    for (const p of policies) {
      console.log(`  ${p.policyId.padEnd(25)} ${p.count}`);
    }
    console.log("");
  }

  // Trace volume
  if (events.length > 0) {
    console.log(BOLD + "Trace volume:" + RESET);
    console.log(`  with trace:  ${trace.eventsWithTrace}  (${(trace.traceRatio * 100).toFixed(0)}%)`);
    console.log(`  without:     ${trace.totalEvents - trace.eventsWithTrace}`);
    console.log("");
  }

  // Time buckets
  if (buckets.length > 0) {
    console.log(BOLD + "Time buckets (" + (windowArg ?? "60") + "m intervals):" + RESET);
    for (const b of buckets) {
      console.log(`  ${b.windowStart.slice(0, 19).replace("T", " ")}  ${b.count}`);
    }
    console.log("");
  }

  // Time window summary
  if (events.length > 0) {
    console.log(DIM + `Time window: ${events.reduce((a, b) => a.timestamp < b.timestamp ? a : b).timestamp.slice(0, 19).replace("T", " ")} → ${events.reduce((a, b) => a.timestamp > b.timestamp ? a : b).timestamp.slice(0, 19).replace("T", " ")}` + RESET);
    console.log("");
  }
}


/** Format a signed delta for display. */
export function deltaSign(v: number): string {
  return v > 0 ? "+" : v < 0 ? "" : " ";
}


/**
 * P15.2 — `audit anomalies`: deterministic, explainable anomaly detection.
 * Computed on demand — no persistent anomaly store.
 *
 * Flags: --recent (min, default 60), --baseline (min, default 1440),
 *        --since, --until, --severity, --type, --json.
 */
export async function runAuditAnomalies(
  cwd: string,
  args: string[],
  jsonMode: boolean,
): Promise<void> {
  const { detectAnomalies } = await import("../../../governance/audit-anomalies.js");

  const recentArg = parseInlineFlag(args, "--recent");
  const baselineArg = parseInlineFlag(args, "--baseline");
  const sinceArg = parseInlineFlag(args, "--since");
  const untilArg = parseInlineFlag(args, "--until");
  const severityFilter = parseInlineFlag(args, "--severity");
  const typeFilter = parseInlineFlag(args, "--type");

  // Determine time boundaries
  const now = new Date().toISOString();
  let recentMinutes = 60;
  let baselineMinutes = 1440;

  if (recentArg !== null) {
    const p = Number(recentArg);
    if (!Number.isInteger(p) || p <= 0) {
      console.log(RED + `Invalid --recent "${recentArg}". Must be a positive integer of minutes.` + RESET);
      process.exit(1);
    }
    recentMinutes = p;
  }
  if (baselineArg !== null) {
    const p = Number(baselineArg);
    if (!Number.isInteger(p) || p <= 0) {
      console.log(RED + `Invalid --baseline "${baselineArg}". Must be a positive integer of minutes.` + RESET);
      process.exit(1);
    }
    baselineMinutes = p;
  }

  let recentStart: string;
  let recentEnd: string;
  let baselineStart: string | undefined;
  let baselineEnd: string | undefined;

  if (sinceArg !== null) {
    if (Number.isNaN(new Date(sinceArg).getTime())) {
      console.log(RED + `Invalid --since "${sinceArg}". Must be an ISO timestamp.` + RESET);
      process.exit(1);
    }
    recentStart = sinceArg;
    recentEnd = untilArg ?? now;
    // Baseline is the window of baselineMinutes immediately before recentStart
    const baselineMs = new Date(recentStart).getTime() - baselineMinutes * 60 * 1000;
    baselineStart = new Date(baselineMs).toISOString();
    baselineEnd = recentStart;
  } else {
    recentEnd = now;
    recentStart = new Date(new Date(now).getTime() - recentMinutes * 60 * 1000).toISOString();
    baselineEnd = recentStart;
    baselineStart = new Date(new Date(now).getTime() - (recentMinutes + baselineMinutes) * 60 * 1000).toISOString();
  }

  const { FileAuditStore } = await import("../../../governance/audit-store.js");
  const store = new FileAuditStore(cwd);
  const allEvents = await store.list();

  // Filter recent window (inclusive lower, exclusive upper)
  const recentEvents = allEvents.filter(
    (e) => e.timestamp >= recentStart && e.timestamp < recentEnd,
  );

  // Filter baseline window
  const baselineEvents = baselineStart
    ? allEvents.filter((e) => e.timestamp >= baselineStart! && e.timestamp < baselineEnd!)
    : [];

  const includeBaseline = baselineEvents.length > 0;

  const anomalies = detectAnomalies(recentEvents, includeBaseline ? baselineEvents : undefined);

  // Client-side filters
  let filtered = anomalies;
  if (severityFilter) {
    const allowed = ["critical", "warning", "info"];
    if (!(allowed as string[]).includes(severityFilter)) {
      console.log(RED + `Invalid --severity "${severityFilter}". Valid: ${allowed.join(", ")}` + RESET);
      process.exit(1);
    }
    filtered = filtered.filter((a) => {
      const order = { critical: 0, warning: 1, info: 2 };
      return order[a.severity] >= order[severityFilter as "critical" | "warning" | "info"];
    });
  }
  if (typeFilter) {
    filtered = filtered.filter((a) => a.type === typeFilter);
  }

  if (jsonMode) {
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }

  if (filtered.length === 0) {
    console.log(DIM + "No anomalies detected" + RESET);
    return;
  }

  console.log(BOLD + `Governance Audit Anomalies (${filtered.length} found)` + RESET);
  console.log(DIM + "─".repeat(50) + RESET);
  console.log("");

  let currentSeverity = "";
  for (const a of filtered) {
    if (a.severity !== currentSeverity) {
      currentSeverity = a.severity;
      const sevLabel = a.severity === "critical" ? RED + "CRITICAL" : a.severity === "warning" ? YELLOW + "WARNING" : BOLD + "INFO";
      console.log(sevLabel + RESET + ":");
    }
    console.log(`  ${a.type} — ${a.reason}`);
    console.log(`  ${DIM}Evidence: ${a.evidenceEventIds.join(", ") || "(none)"}${RESET}`);
    console.log(`  ${DIM}Window: ${a.windowStart.slice(0, 19).replace("T", " ")} → ${a.windowEnd.slice(0, 19).replace("T", " ")}${RESET}`);
    console.log("");
  }
}


/**
 * P15.3a — `audit effectiveness`: operator outcome signals.
 * Decision stability, escalation effectiveness, review completeness,
 * stale/stuck deferrals, throughput context (no ranking).
 *
 * Flags: --since, --until, --stale-days, --json.
 */
export async function runAuditEffectiveness(
  cwd: string,
  args: string[],
  jsonMode: boolean,
): Promise<void> {
  const sinceArg = parseInlineFlag(args, "--since");
  const untilArg = parseInlineFlag(args, "--until");
  const staleArg = parseInlineFlag(args, "--stale-days");
  const now = new Date().toISOString();

  const staleThresholdDays = staleArg !== null ? (() => {
    const p = Number(staleArg);
    if (!Number.isInteger(p) || p <= 0) {
      console.log(RED + `Invalid --stale-days "${staleArg}". Must be a positive integer.` + RESET);
      process.exit(1);
    }
    return p;
  })() : 7;

  // Default: last 7 days
  const since = sinceArg ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
  const until = untilArg ?? now;

  if (sinceArg !== null && Number.isNaN(new Date(sinceArg).getTime())) {
    console.log(RED + `Invalid --since "${sinceArg}". Must be an ISO timestamp.` + RESET);
    process.exit(1);
  }
  if (untilArg !== null && Number.isNaN(new Date(untilArg).getTime())) {
    console.log(RED + `Invalid --until "${untilArg}". Must be an ISO timestamp.` + RESET);
    process.exit(1);
  }

  // Audit lookahead: include events up to until + staleThresholdDays
  const auditUntil = new Date(new Date(until).getTime() + staleThresholdDays * 86_400_000).toISOString();

  const [
    { FileAuditStore },
    { FileDecisionStore },
    { FileReviewStore },
    { FileActionQueueStore },
    { computeEffectiveness },
  ] = await Promise.all([
    import("../../../governance/audit-store.js"),
    import("../../../governance/decision-capture.js"),
    import("../../../governance/operator-review.js"),
    import("../../../governance/action-queue.js"),
    import("../../../governance/operator-effectiveness.js"),
  ]);

  const auditStore = new FileAuditStore(cwd);
  const decisionStore = new FileDecisionStore(cwd);
  const reviewStore = new FileReviewStore(cwd);
  const actionStore = new FileActionQueueStore(cwd);

  const allProposalsList = await actionStore.list();
  const allTransitionsFull = [];
  for (const p of allProposalsList) {
    const txns = await actionStore.getTransitions(p.proposalId);
    allTransitionsFull.push(...txns);
  }
  const [allEvents, allDecisions, allReviews] = await Promise.all([
    auditStore.list(),
    decisionStore.list(),
    reviewStore.list(),
  ]);

  // Filter decisions/reviews by [since, until)
  const filteredDecisions = allDecisions.filter(
    (d: { createdAt: string }) => d.createdAt >= since && d.createdAt < until,
  );
  const filteredReviews = allReviews.filter(
    (r: { createdAt: string }) => r.createdAt >= since && r.createdAt < until,
  );
  const filteredEvents = allEvents.filter(
    (e: { timestamp: string }) => e.timestamp >= since && e.timestamp < auditUntil,
  );

  const report = computeEffectiveness(
    filteredEvents,
    filteredDecisions,
    filteredReviews,
    allProposalsList,
    allTransitionsFull,
    { staleThresholdDays, now },
  );

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Human output
  console.log(BOLD + `Operator Effectiveness (${since.slice(0, 10)} → ${until.slice(0, 10)})` + RESET);
  console.log(DIM + "─".repeat(50) + RESET);
  console.log("");

  console.log(BOLD + "Decision stability:" + RESET);
  console.log(`  total decisions: ${report.decisionStability.totalDecisions}`);
  console.log(`  reversal rate:   ${(report.decisionStability.reversalRate * 100).toFixed(1)}% (${report.decisionStability.reversed}/${report.decisionStability.totalDecisions})`);
  console.log(`  by kind:         ${Object.entries(report.decisionStability.decisionCounts).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log("");

  console.log(BOLD + "Escalation effectiveness:" + RESET);
  console.log(`  total escalations:        ${report.escalationEffectiveness.totalEscalations}`);
  console.log(`  → proposal rate:          ${(report.escalationEffectiveness.escalationToActionRate * 100).toFixed(0)}%`);
  console.log(`  → resolution rate:        ${(report.escalationEffectiveness.resolutionRate * 100).toFixed(0)}%`);
  console.log(`  → pending:                ${report.escalationEffectiveness.pendingEscalations}`);
  if (report.escalationEffectiveness.medianResolutionMs !== null) {
    console.log(`  → median time to resolve:  ${(report.escalationEffectiveness.medianResolutionMs / 60000).toFixed(0)}m`);
  }
  console.log("");

  console.log(BOLD + "Review completeness:" + RESET);
  console.log(`  total reviews:      ${report.reviewCompleteness.totalReviews}`);
  console.log(`  with notes:         ${report.reviewCompleteness.withNotes}`);
  console.log(`  with classif.:      ${report.reviewCompleteness.withClassification}`);
  console.log(`  with both:          ${report.reviewCompleteness.withBoth}`);
  console.log(`  completeness rate:  ${(report.reviewCompleteness.completenessRate * 100).toFixed(0)}%`);
  console.log("");

  console.log(BOLD + "Stale decisions:" + RESET);
  console.log(`  total deferred:  ${report.staleDecisions.totalDeferred}`);
  console.log(`  stale (≥${report.staleDecisions.staleThresholdDays}d): ${report.staleDecisions.staleCount}`);
  if (report.staleDecisions.averageStaleDays !== null) {
    console.log(`  avg stale age:   ${report.staleDecisions.averageStaleDays.toFixed(1)}d`);
  }
  console.log("");

  console.log(BOLD + "Throughput (descriptive):" + RESET);
  for (const op of report.throughputContext.decisionsByOperator) {
    console.log(`  ${op.operatorId}: ${op.count} decisions`);
  }
  for (const op of report.throughputContext.reviewsByOperator) {
    console.log(`  ${op.operatorId}: ${op.count} reviews`);
  }
  console.log("");
}


/**
 * P15.4 — `alix governance audit report`.
 * Composition layer: aggregates P15.1 trends, P15.2 anomalies, P15.3a effectiveness.
 */
export async function runAuditReport(
  cwd: string,
  args: string[],
  jsonMode: boolean,
): Promise<void> {
  const sinceArg = parseInlineFlag(args, "--since");
  const untilArg = parseInlineFlag(args, "--until");
  const sectionArg = parseInlineFlag(args, "--section");
  const now = new Date().toISOString();

  const sections = sectionArg !== null
    ? sectionArg === "all"
      ? ["trends", "anomalies", "effectiveness"]
      : [sectionArg]
    : ["trends", "anomalies", "effectiveness"];

  const since = sinceArg ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
  const until = untilArg ?? now;

  const [
    { FileAuditStore },
    { FileDecisionStore },
    { FileReviewStore },
    { FileActionQueueStore },
    { buildReport },
  ] = await Promise.all([
    import("../../../governance/audit-store.js"),
    import("../../../governance/decision-capture.js"),
    import("../../../governance/operator-review.js"),
    import("../../../governance/action-queue.js"),
    import("../../../governance/report-orchestrator.js"),
  ]);

  const auditStore = new FileAuditStore(cwd);
  const decisionStore = new FileDecisionStore(cwd);
  const reviewStore = new FileReviewStore(cwd);
  const actionStore = new FileActionQueueStore(cwd);

  const allProposals = await actionStore.list();
  const allTransitions: ActionProposalStatusTransition[] = [];
  for (const p of allProposals) {
    const t = await actionStore.getTransitions(p.proposalId);
    allTransitions.push(...t);
  }

  const [allEvents, allDecisions, allReviews] = await Promise.all([
    auditStore.list(),
    decisionStore.list(),
    reviewStore.list(),
  ]);

  const report = buildReport(
    allEvents, allDecisions, allReviews,
    allProposals, allTransitions,
    { since, until, now, staleThresholdDays: 7, sections: sections as any },
  );

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(BOLD + `Governance Audit Report (${since.slice(0, 10)} → ${until.slice(0, 10)})` + RESET);
  console.log(DIM + "═".repeat(50) + RESET);
  console.log("");

  if (report.trends) {
    const t = report.trends;
    console.log(BOLD + "Trends:" + RESET);
    console.log(`  events: ${t.totalEvents}`);
    if (t.eventTypeDistribution) {
      const et = Object.entries(t.eventTypeDistribution as Record<string, number>).sort();
      for (const [k, v] of et) console.log(`  ${k}: ${v}`);
    }
    console.log("");
  }

  if (report.anomalies) {
    const list = report.anomalies as any[];
    console.log(BOLD + "Anomalies:" + RESET + (list.length > 0 ? "" : DIM + " none detected" + RESET));
    for (const a of list) {
      const s = a.severity === "critical" ? RED + "CRITICAL" : a.severity === "warning" ? YELLOW + "WARNING" : "INFO";
      console.log(`  ${s + RESET} ${a.type} — ${a.reason}`);
    }
    console.log("");
  }

  if (report.effectiveness) {
    const e = report.effectiveness as any;
    console.log(BOLD + "Effectiveness:" + RESET);
    console.log(`  stability:     ${((e.decisionStability?.reversalRate ?? 0) * 100).toFixed(0)}% reversal`);
    console.log(`  escalation:    ${((e.escalationEffectiveness?.escalationToActionRate ?? 0) * 100).toFixed(0)}% to action`);
    console.log(`  completeness:  ${((e.reviewCompleteness?.completenessRate ?? 0) * 100).toFixed(0)}% with notes+class`);
    console.log(`  stale deferred: ${e.staleDecisions?.staleCount ?? 0} > ${e.staleDecisions?.staleThresholdDays ?? 7}d`);
    console.log("");
  }
}


export async function runAuditActor(
  cwd: string,
  args: string[],
  jsonMode: boolean,
): Promise<void> {
  const actorId = args.find((a) => !a.startsWith("--"));
  if (!actorId) {
    console.log(RED + "Usage: alix governance audit actor <actor-id> [--actor-type <type>]" + RESET);
    process.exit(1);
  }

  const actorTypeFilter = parseInlineFlag(args, "--actor-type");

  const { FileAuditStore } = await import("../../../governance/audit-store.js");
  const { queryByActor } = await import("../../../governance/audit-query.js");

  const store = new FileAuditStore(cwd);
  const all = await store.list();
  const events = actorTypeFilter
    ? queryByActor(all, actorTypeFilter as any, actorId)
    : all.filter((e) => e.actorId === actorId);

  if (jsonMode) {
    console.log(JSON.stringify(events, null, 2));
    return;
  }

  if (events.length === 0) {
    console.log(DIM + "No events found for actor: " + actorId + RESET);
    return;
  }

  console.log(
    BOLD + "Actor: " + actorId + " (" + events.length + " events)" + RESET,
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
      "  " + DIM + ev.actorType + RESET +
      "  " + ev.reason.slice(0, 100),
    );
    console.log("");
  }
}


export async function runAuditPolicy(
  cwd: string,
  args: string[],
  jsonMode: boolean,
): Promise<void> {
  const policyId = args.find((a) => !a.startsWith("--"));
  if (!policyId) {
    console.log(RED + "Usage: alix governance audit policy <policy-id>" + RESET);
    process.exit(1);
  }

  const { FileAuditStore } = await import("../../../governance/audit-store.js");
  const { queryByPolicy } = await import("../../../governance/audit-query.js");

  const store = new FileAuditStore(cwd);
  const events = queryByPolicy(await store.list(), policyId);

  if (jsonMode) {
    console.log(JSON.stringify(events, null, 2));
    return;
  }

  if (events.length === 0) {
    console.log(DIM + "No events found for policy: " + policyId + RESET);
    return;
  }

  console.log(
    BOLD + "Policy: " + policyId + " (" + events.length + " events)" + RESET,
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
      "  " + DIM + ev.actorType + "/" + ev.actorId + RESET +
      "  " + ev.reason.slice(0, 100),
    );
    console.log("");
  }
}
