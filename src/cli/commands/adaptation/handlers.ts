/**
 * P5.1g — adaptation CLI command.
 *
 * Closes the reflection → propose → approve → apply loop:
 *
 *   ReflectionReport
 *     → `propose` converts recommendations into pending proposals
 *     → `approve`/`reject` route through ApprovalGate (records evidence)
 *     → `apply` routes through ApprovalGate, which dispatches to the
 *       AgentCardApplier or SkillApplier selected by `proposal.target.kind`
 *
 * Governance invariant (owned by ApprovalGate, not this module): **no approval,
 * no mutation**. The CLI never calls an applier directly — it selects the
 * applier by target kind and hands it to the gate, which is the sole owner of
 * status transitions and evidence recording for approve/reject/apply. Only the
 * `propose` step records evidence itself (`adaptation_proposed`), because that
 * happens before any gate involvement.
 *
 * Subcommands:
 *   list [--status <status>]       List proposals (optionally filtered by status)
 *   show <id>                      Show full proposal details
 *   propose <report.json>          Convert a ReflectionReport into proposals
 *   approve <id1> [id2] ... [--by <actor>]  Approve one or more pending proposals
 *   reject <id> [--reason <text>]  Reject a pending proposal
 *   apply <id>                     Apply an approved proposal
 *   revert <id> [--reason <text>]  Create a revert proposal for an applied proposal
 *
 *   intelligence [--since] [--until] [--min-bucket-size <n>] [--min-confidence <n>] [--json]
 * @module
 */

import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { AdaptationProposalStore } from "../../../adaptation/adaptation-proposal-store.js";
import { RecommendationToProposal } from "../../../adaptation/recommendation-to-proposal.js";
import { ApprovalGate } from "../../../adaptation/approval-gate.js";
import "../../../adaptation/appliers/agent-card-applier.js";
import "../../../adaptation/appliers/skill-applier.js";
import "../../../adaptation/revert-applier.js";
import "../../../adaptation/appliers/governance-change-applier.js";
import { SnapshotStore } from "../../../adaptation/snapshot-store.js";
import { nextProposalId } from "../../../adaptation/recommendation-to-proposal.js";
import { EffectivenessReporter } from "../../../adaptation/effectiveness-reporter.js";
import { EffectivenessStore } from "../../../adaptation/effectiveness-store.js";
import { AutomaticProposalGenerator } from "../../../adaptation/auto-proposal-generator.js";
import { EvidenceStore } from "../../../security/evidence/evidence-store.js";
import { EvidenceEventWriter } from "../../../workflow/evidence-writer.js";
import type { AdaptationProposal, ProposalStatus } from "../../../adaptation/adaptation-types.js";
import type { ReflectionReport } from "../../../reflection/reflection-types.js";
import { IntelligenceReporter } from "../../../adaptation/intelligence-reporter.js";
import { IntelligenceStore } from "../../../adaptation/intelligence-store.js";
import { ProposalLifecycleAnalyzer } from "../../../adaptation/proposal-lifecycle-analyzer.js";
import { ProposalScorer } from "../../../adaptation/proposal-scorer.js";
import { PriorityStore } from "../../../adaptation/priority-store.js";
import { EffectivenessTrendAnalyzer } from "../../../adaptation/effectiveness-trend-analyzer.js";
import { BucketAggregator } from "../../../adaptation/bucket-aggregator.js";
import { RevertSignalAnalyzer } from "../../../adaptation/revert-signal-analyzer.js";
import { ConfidenceCalibrationAnalyzer } from "../../../adaptation/confidence-calibration-analyzer.js";
import { CapabilityEvolutionStore } from "../../../adaptation/capability-evolution-store.js";
import { CapabilityEvolutionProposalGenerator } from "../../../adaptation/capability-evolution-proposal-generator.js";
import type { CapabilityEvolutionGenerateOptions } from "../../../adaptation/capability-evolution-proposal-generator.js";
import { CapabilityEvolutionReporter } from "../../../adaptation/capability-evolution-reporter.js";
import type { CapabilityEvolutionReport } from "../../../adaptation/capability-evolution-types.js";
import { LineageBuilder } from "../../../adaptation/lineage-builder.js";
import { computeProposalReadiness } from "../../../adaptation/proposal-readiness.js";
import "../../../executive/executive-orchestrator.js";
import type { OrchestrationHook } from "../../../executive/executive-orchestrator.js";
import "../../../executive/execution-state-store.js";
import "../../../executive/execution-engine.js";
import "../../../executive/plan-store.js";
import "../../../executive/step-runner.js";
import { printManualAction, describeTarget, printProposal, printEffectiveness, printGenerateSummary, printIntelligenceReport, printPriorityReport, printCapabilityEvolutionReport } from "./renderers.js";
import { selectApplier } from "./appliers.js";
import { EFFECTIVENESS_DIR, INTELLIGENCE_DIR, CARDS_DIR, detectActor } from "./shared.js";

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

/** `list [--status <status>]` */
export async function runList(store: AdaptationProposalStore, args: string[]): Promise<void> {
  const statusIdx = args.indexOf("--status");
  let status: ProposalStatus | undefined;
  if (statusIdx >= 0) {
    const raw = args[statusIdx + 1];
    if (!raw) {
      console.error("Usage: alix adaptation list [--status <pending|approved|rejected|applied|failed>]");
      process.exit(1);
    }
    status = raw as ProposalStatus;
  }

  const proposals = await store.list(status);

  if (proposals.length === 0) {
    console.log(`No proposals${status ? ` with status "${status}"` : ""}.`);
    return;
  }

  console.log(
    `${"ID".padEnd(26)} ${"Status".padEnd(10)} ${"Readiness".padEnd(20)} ${"Applyable".padEnd(10)} ${"Action".padEnd(26)} Target`,
  );
  console.log("-".repeat(110));
  for (const p of proposals) {
    const info = computeProposalReadiness(p);
    console.log(
      `${p.id.padEnd(26)} ${p.status.padEnd(10)} ${info.readiness.padEnd(20)} ${(info.applyable ? "yes" : "no").padEnd(10)} ${p.action.padEnd(26)} ${describeTarget(p)}`,
    );
  }
  console.log(`\n${proposals.length} proposal${proposals.length === 1 ? "" : "s"}`);
}


/** `show <id>` */
export async function runShow(store: AdaptationProposalStore, args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    console.error("Usage: alix adaptation show <id>");
    process.exit(1);
  }

  const proposal = await store.load(id);
  if (!proposal) {
    console.error(`Proposal not found: ${id}`);
    process.exit(1);
  }

  printProposal(proposal);

  // P10.9.2a — derived readiness block
  const info = computeProposalReadiness(proposal);
  console.log(`Readiness:      ${info.readiness}`);
  console.log(`Applyable:      ${info.applyable ? "yes" : "no"}`);
  if (info.blocker) {
    console.log(`Blocker:        ${info.blocker}`);
  }
  console.log(`Next action:    ${info.nextAction}`);
}


/** `propose <report.json>` */
export async function runPropose(
  store: AdaptationProposalStore,
  writer: EvidenceEventWriter,
  args: string[],
): Promise<void> {
  const reportPath = args[0];
  if (!reportPath) {
    console.error("Usage: alix adaptation propose <report.json>");
    process.exit(1);
  }
  if (!existsSync(reportPath)) {
    console.error(`Report file not found: ${reportPath}`);
    process.exit(1);
  }

  let report: ReflectionReport;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf-8")) as ReflectionReport;
  } catch (err) {
    console.error(`Failed to parse report: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const recommendations = Array.isArray(report.recommendations) ? report.recommendations : [];
  if (recommendations.length === 0) {
    console.log("Report contains no recommendations. No proposals created.");
    return;
  }

  const created: AdaptationProposal[] = [];
  for (const rec of recommendations) {
    const proposal = RecommendationToProposal.convert(rec);
    if (!proposal) continue; // unknown recommendation type — skip
    await store.save(proposal);

    // Record adaptation_proposed evidence. The converter is a pure function
    // and the gate only owns approve/reject/apply evidence, so this is the
    // correct place to emit the "proposed" lifecycle event.
    await writer.recordAdaptationProposed(proposal.id, {
      createdAt: proposal.createdAt,
      action: proposal.action,
      target: proposal.target as unknown as Record<string, unknown>,
      sourceRecommendationType: proposal.sourceRecommendationType,
      sourceConfidence: proposal.sourceConfidence,
    });

    created.push(proposal);
  }

  if (created.length === 0) {
    console.log("No convertible recommendations. No proposals created.");
    return;
  }

  console.log(`Created ${created.length} proposal${created.length === 1 ? "" : "s"}:`);
  for (const p of created) {
    console.log(`  ${p.id}  [${p.status}]  ${p.action}  → ${describeTarget(p)}`);
  }
}


/** `approve <id1> [id2] ... [--by <actor>]` */
export async function runApprove(gate: ApprovalGate, args: string[]): Promise<void> {
  const byIdx = args.indexOf("--by");
  const by = byIdx >= 0 ? args[byIdx + 1] : detectActor();

  // Extract positional IDs: all args except --by and its value.
  const ids = args.filter((_, i) => i !== byIdx && (byIdx < 0 || i !== byIdx + 1));

  if (ids.length === 0) {
    console.error("Usage: alix adaptation approve <id1> [id2] ... [--by <actor>]");
    process.exit(1);
  }

  // Fast path: single ID → gate.approve (unchanged behaviour).
  if (ids.length === 1) {
    try {
      const updated = await gate.approve(ids[0], by);
      console.log(`Approved: ${updated.id} by ${updated.approvedBy}`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    return;
  }

  // Batch path: two or more IDs → gate.approveBatch.
  const result = await gate.approveBatch(ids, by);
  const errorIds = new Set(result.errors.map((e) => e.id));

  console.log(`Approved: ${result.approved}/${ids.length}`);
  if (result.approved > 0) {
    const approvedIds = ids.filter((id) => !errorIds.has(id));
    console.log(`  Approved: ${approvedIds.join(", ")}`);
  }
  for (const e of result.errors) {
    console.log(`  Skipped:  ${e.id} (${e.error})`);
  }
}


/** `reject <id> [--reason <text>]` */
export async function runReject(gate: ApprovalGate, args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    console.error("Usage: alix adaptation reject <id> [--reason <text>]");
    process.exit(1);
  }

  const reasonIdx = args.indexOf("--reason");
  const reason = reasonIdx >= 0 ? args[reasonIdx + 1] : "rejected via CLI";

  try {
    const updated = await gate.reject(id, detectActor(), reason);
    console.log(`Rejected: ${updated.id}`);
    if (reason) console.log(`Reason: ${reason}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}


/** `apply <id>` — routes THROUGH the gate, selecting the applier by target kind. */
export async function runApply(
  cwd: string,
  store: AdaptationProposalStore,
  gate: ApprovalGate,
  writer: EvidenceEventWriter,
  args: string[],
  orchestrator?: OrchestrationHook, // ★ NEW
): Promise<void> {
  const id = args[0];
  if (!id) {
    console.error("Usage: alix adaptation apply <id>");
    process.exit(1);
  }

  // Load to select the applier by target.kind. The gate re-loads and enforces
  // the approved-status invariant itself — this read is only for dispatch.
  const proposal = await store.load(id);
  if (!proposal) {
    console.error(`Proposal not found: ${id}`);
    process.exit(1);
  }

  // P10.9.2a — readiness gate: route/refuse before calling selectApplier
  const readinessInfo = computeProposalReadiness(proposal);

  switch (readinessInfo.readiness) {
    case "ready_to_apply":
      // Proceed to selectApplier below
      break;

    case "needs_approval":
      console.error(
        `Proposal ${id} is not yet approved. Run \`alix adaptation approve ${id}\` first.`,
      );
      process.exit(1);

    case "needs_specification":
      console.error(
        `Proposal ${id} requires human specification. Run \`${readinessInfo.support.nextCommand ?? `alix executive remediate ${id}`}\` to fill in details.`,
      );
      process.exit(1);

    case "manual_action":
      printManualAction(proposal);
      return; // clean exit, no mutation

    case "blocked":
      console.error(
        `Proposal ${id} is blocked: ${readinessInfo.blocker ?? "unknown reason"}.`,
      );
      process.exit(1);

    case "completed":
      console.error(
        `Proposal ${id} has already been ${proposal.status}.`,
      );
      process.exit(1);
  }

  const applier = selectApplier(cwd, proposal, writer);

  try {
    const updated = await gate.apply(id, applier);
    // Fire orchestration hook on success (applied)
    if (orchestrator) {
      orchestrator.onProposalTerminal(updated).catch(() => {});
    }
    console.log(`Applied: ${updated.id} → ${updated.action} (${describeTarget(updated)})`);
  } catch (err) {
    // Fire orchestration hook on failure too — gate.apply() sets status
    // to "failed" before re-throwing. Best-effort: if reload fails,
    // the recovery CLI covers missed events.
    if (orchestrator && proposal) {
      try {
        const failed = await store.load(id);
        if (failed) orchestrator.onProposalTerminal(failed).catch(() => {});
      } catch { /* non-blocking — recovery CLI covers this */ }
    }
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}


// ---------------------------------------------------------------------------
// `lineage` (P5.7b)
// ---------------------------------------------------------------------------

/**
 * `alix adaptation lineage <id> [--depth <n>] [--json] [--export <file>]`
 *
 * Builds and renders a LineageGraph for the given proposal. Shows the
 * proposal's lifecycle as a tree in the terminal, or outputs JSON for
 * machine consumption.
 */
export async function runLineage(
  cwd: string,
  store: AdaptationProposalStore,
  evidenceStore: EvidenceStore,
  args: string[],
): Promise<void> {
  const id = args[0];
  if (!id) {
    console.error("Usage: alix adaptation lineage <id> [--depth <n>] [--json] [--export <file>]");
    process.exit(1);
  }

  const depthIdx = args.indexOf("--depth");
  const depth = depthIdx >= 0 ? parseInt(args[depthIdx + 1], 10) || 10 : 10;

  const jsonMode = args.includes("--json");
  const exportIdx = args.indexOf("--export");
  const exportPath = exportIdx >= 0 ? args[exportIdx + 1] : undefined;

  const effStore = new EffectivenessStore(join(cwd, EFFECTIVENESS_DIR));
  const intelStore = new IntelligenceStore(join(cwd, INTELLIGENCE_DIR));
  const builder = new LineageBuilder(store, evidenceStore, effStore, intelStore);

  const graph = await builder.build(id, depth);

  if (jsonMode || exportPath) {
    const json = JSON.stringify(graph, null, 2);
    if (exportPath) {
      writeFileSync(exportPath, json, "utf-8");
      console.log(`Lineage graph exported to ${exportPath}`);
      return;
    }
    console.log(json);
    return;
  }

  // Terminal renderer
  const rootNode = graph.nodes.find((n) => n.id === graph.rootId);
  if (!rootNode) {
    console.error(`Proposal not found: ${id}`);
    process.exit(1);
  }

  console.log(`${rootNode.id} — ${rootNode.label}`);
  for (const edge of graph.edges) {
    const target = graph.nodes.find((n) => n.id === edge.targetId);
    if (!target) continue;
    const icon =
      edge.relation === "approved_as" ? "├─ 👤" :
      edge.relation === "applied_as" ? "├─ 🔧" :
      edge.relation === "measured_as" ? "├─ 📊" :
      edge.relation === "reverted_by" ? "├─ 🔄" :
      edge.relation === "analyzed_in" ? "├─ 🧠" :
      edge.relation === "prioritized_in" ? "├─ 📈" :
      "├─ •";
    console.log(`│  ${icon} ${target.label}`);
  }

  console.log(`\nCompleteness: ${graph.completeness}${graph.completeness === "partial" ? " — proposal has not completed all lifecycle stages" : ""}`);
  if (graph.warnings.length > 0) {
    console.log(`\n⚠️ Warnings (${graph.warnings.length}):`);
    for (const w of graph.warnings) {
      console.log(`  - ${w.message}`);
    }
  }
}


// ---------------------------------------------------------------------------
// Effectiveness assessment (P5.2b)
// ---------------------------------------------------------------------------

/**
 * `effectiveness <id>` — assess a single applied proposal.
 * `effectiveness --all` — assess every applied proposal.
 *
 * Pure read + compute: computes a before/after `ReflectionMetrics` window
 * around the proposal's `appliedAt`, derives the primary-metric delta, and
 * persists an advisory `keep | revert | investigate` recommendation. Never
 * mutates the proposal, agent cards, or skills. "revert" is advisory only —
 * a human acts on it.
 */
export async function runEffectiveness(
  cwd: string,
  store: AdaptationProposalStore,
  evidenceStore: EvidenceStore,
  args: string[],
): Promise<void> {
  const all = args.includes("--all");
  const id = args.find((a) => !a.startsWith("-"));

  const reporter = new EffectivenessReporter(evidenceStore);
  const effStore = new EffectivenessStore(join(cwd, EFFECTIVENESS_DIR));
  const writer = new EvidenceEventWriter((type, payload) => evidenceStore.append(type, payload));

  const targets: AdaptationProposal[] = [];
  if (all) {
    targets.push(...(await store.list("applied")));
  } else {
    if (!id) {
      console.error("Usage: alix adaptation effectiveness <id> | --all");
      process.exit(1);
    }
    const proposal = await store.load(id);
    if (!proposal) {
      console.error(`Proposal not found: ${id}`);
      process.exit(1);
    }
    targets.push(proposal);
  }

  if (targets.length === 0) {
    console.log("No applied proposals to assess.");
    return;
  }

  for (const p of targets) {
    const report = await reporter.assess(p);
    await effStore.save(report);
    await writer.recordAdaptationEffectiveness(p.id, {
      recommendation: report.recommendation,
      primaryMetric: report.primary?.metric ?? null,
      assessedAt: report.assessedAt,
    });
    printEffectiveness(report);
  }
}


// ---------------------------------------------------------------------------
// `generate` (P5.2c.5)
// ---------------------------------------------------------------------------

/**
 * `alix adaptation generate` — auto-create proposals from a reflection
 * report or one-or-more effectiveness reports.
 *
 * Generator-only. NEVER approves, NEVER applies, NEVER mutates agent
 * cards or skill files. The ApprovalGate and the two appliers are owned
 * by the manual `propose`/`approve`/`apply` flow, NOT this subcommand.
 *
 * Exactly one of:
 *   --reflection <path>           ReflectionReport JSON
 *   --effectiveness <id>          single ProposalEffectivenessReport
 *   --all-effectiveness           every saved effectiveness report
 *
 * Optional: --min-confidence <n> (default 0.7; only consulted on
 *                              the reflection path).
 */
export async function runGenerate(
  cwd: string,
  store: AdaptationProposalStore,
  writer: EvidenceEventWriter,
  args: string[],
): Promise<void> {
  const reflectionIdx = args.indexOf("--reflection");
  const effectivenessIdx = args.indexOf("--effectiveness");
  const allEffIdx = args.indexOf("--all-effectiveness");
  const capabilityEvolutionIdx = args.indexOf("--capability-evolution");

  const sourceFlagsPresent = [
    reflectionIdx >= 0,
    effectivenessIdx >= 0,
    allEffIdx >= 0,
    capabilityEvolutionIdx >= 0,
  ].filter(Boolean).length;

  if (sourceFlagsPresent !== 1) {
    console.error(
      "Usage: alix adaptation generate " +
        "--reflection <path> | --effectiveness <id> | --all-effectiveness | --capability-evolution " +
        "[--report <path>] [--min-confidence <n>] " +
        "[--min-gap-signal-strength <n>] [--min-drift-magnitude <n>] " +
        "[--min-capability-usage <n>] [--max-proposals <n>]\n" +
        "Exactly one source flag is required. " +
        "This subcommand is generation-only: it does NOT approve or apply anything.",
    );
    process.exit(1);
  }

  const minConfidenceIdx = args.indexOf("--min-confidence");
  const minConfidence =
    minConfidenceIdx >= 0 ? Number(args[minConfidenceIdx + 1]) : 0.7;
  if (Number.isNaN(minConfidence)) {
    console.error(
      `Invalid --min-confidence value: ${args[minConfidenceIdx + 1]}`,
    );
    process.exit(1);
  }

  const effStore = new EffectivenessStore(join(cwd, EFFECTIVENESS_DIR));
  const generator = new AutomaticProposalGenerator(store, writer);

  if (reflectionIdx >= 0) {
    const reportPath = args[reflectionIdx + 1];
    if (!reportPath) {
      console.error("Missing value for --reflection <path>");
      process.exit(1);
    }
    if (!existsSync(reportPath)) {
      console.error(`Report file not found: ${reportPath}`);
      process.exit(1);
    }

    let report: ReflectionReport;
    try {
      report = JSON.parse(readFileSync(reportPath, "utf-8")) as ReflectionReport;
    } catch (err) {
      console.error(
        `Failed to parse report: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }

    const result = await generator.generateFromReflection(report, {
      minConfidence,
    });
    printGenerateSummary(result);
    return;
  }

  if (effectivenessIdx >= 0) {
    const id = args[effectivenessIdx + 1];
    if (!id) {
      console.error("Missing value for --effectiveness <id>");
      process.exit(1);
    }
    const report = await effStore.load(id);
    if (!report) {
      console.error(`Effectiveness report not found: ${id}`);
      process.exit(1);
    }
    const result = await generator.generateFromEffectiveness(report);
    printGenerateSummary(result);
    return;
  }

  // --all-effectiveness
  if (allEffIdx >= 0) {
    const reports = await effStore.list();
    const result = await generator.generateFromAllEffectiveness(reports, {
      minConfidence,
    });
    printGenerateSummary(result);
    return;
  }

  // --capability-evolution
  if (capabilityEvolutionIdx >= 0) {
    const capabilityEvolutionStore = new CapabilityEvolutionStore(
      join(cwd, ".alix", "adaptation", "capability-evolution"),
    );
    const capGen = new CapabilityEvolutionProposalGenerator(store, writer);

    const reportIdx = args.indexOf("--report");
    let report: CapabilityEvolutionReport;
    if (reportIdx >= 0) {
      const reportPath = args[reportIdx + 1];
      if (!reportPath) {
        console.error("Missing value for --report <path>");
        process.exit(1);
      }
      if (!existsSync(reportPath)) {
        console.error(`Report file not found: ${reportPath}`);
        process.exit(1);
      }
      try {
        report = JSON.parse(readFileSync(reportPath, "utf-8")) as CapabilityEvolutionReport;
      } catch (err) {
        console.error(`Failed to parse report: ${String(err)}`);
        process.exit(1);
      }
    } else {
      const latest = await capabilityEvolutionStore.loadLatest();
      if (!latest) {
        console.error(
          "No CapabilityEvolutionReport found. Run 'alix adaptation capability-evolution' first, or pass --report <path>.",
        );
        process.exit(1);
      }
      report = latest as CapabilityEvolutionReport;
    }

    const opts: CapabilityEvolutionGenerateOptions = {};
    const mgssIdx = args.indexOf("--min-gap-signal-strength");
    if (mgssIdx >= 0) {
      const val = Number(args[mgssIdx + 1]);
      if (Number.isNaN(val)) { console.error("Invalid --min-gap-signal-strength value"); process.exit(1); }
      opts.minGapSignalStrength = val;
    }
    const mdmIdx = args.indexOf("--min-drift-magnitude");
    if (mdmIdx >= 0) {
      const val = Number(args[mdmIdx + 1]);
      if (Number.isNaN(val)) { console.error("Invalid --min-drift-magnitude value"); process.exit(1); }
      opts.minDriftMagnitude = val;
    }
    const mcuIdx = args.indexOf("--min-capability-usage");
    if (mcuIdx >= 0) {
      const val = Number(args[mcuIdx + 1]);
      if (Number.isNaN(val)) { console.error("Invalid --min-capability-usage value"); process.exit(1); }
      opts.minCapabilityUsage = val;
    }
    const mpIdx = args.indexOf("--max-proposals");
    if (mpIdx >= 0) {
      const val = Number(args[mpIdx + 1]);
      if (Number.isNaN(val)) { console.error("Invalid --max-proposals value"); process.exit(1); }
      opts.maxProposalsPerRun = val;
    }

    const capResult = await capGen.generateFromCapabilityEvolution(report, opts);
    printGenerateSummary(capResult);
    return;
  }
}


// ---------------------------------------------------------------------------
// `revert` (P5.2e.6)
// ---------------------------------------------------------------------------

/**
 * `alix adaptation revert <id> [--reason <text>]` — create a revert proposal
 * for a previously applied proposal.
 *
 * Checks that a snapshot exists for the source proposal, loads its fingerprint
 * and contentHash, creates a `pending` `revert_proposal`, saves via the store,
 * and records `adaptation_proposed` evidence with `action: "revert_proposal"`.
 *
 * Creation-only: does NOT approve or apply. The revert proposal must go through
 * the same approve→apply lifecycle as any other proposal.
 */
export async function runRevert(
  cwd: string,
  store: AdaptationProposalStore,
  writer: EvidenceEventWriter,
  args: string[],
): Promise<void> {
  const id = args[0];
  if (!id) {
    console.error("Usage: alix adaptation revert <id> [--reason <text>]");
    process.exit(1);
  }

  // Load the source proposal
  const sourceProposal = await store.load(id);
  if (!sourceProposal) {
    console.error(`Proposal not found: ${id}`);
    process.exit(1);
  }

  // Check snapshot exists
  const snapshotsDir = join(cwd, ".alix", "adaptation", "snapshots");
  const snapshotPath = join(snapshotsDir, `${id}.json`);
  if (!existsSync(snapshotPath)) {
    console.error(
      `Proposal ${id} cannot be reverted (no snapshot found; only update_agent_card, add_capability, and adjust_skill_definition are revertable).`,
    );
    process.exit(1);
  }

  // Load the snapshot to get fingerprint and contentHash
  const snapshotStore = new SnapshotStore(snapshotsDir);
  const snapshot = await snapshotStore.load(id);
  if (!snapshot) {
    console.error(
      `Proposal ${id} cannot be reverted (snapshot file exists but could not be loaded).`,
    );
    process.exit(1);
  }

  // Parse --reason
  const reasonIdx = args.indexOf("--reason");
  const reason = reasonIdx >= 0 ? args.slice(reasonIdx + 1).join(" ") : "Reverting applied proposal via CLI";

  const now = new Date().toISOString();

  const revertProposal: AdaptationProposal = {
    id: nextProposalId(),
    createdAt: now,
    status: "pending",
    action: "revert_proposal",
    target: { kind: "revert", sourceProposalId: id },
    payload: { reason, snapshotFingerprint: snapshot.fingerprint, sourceProposalId: id },
    sourceRecommendationType: "manual_revert",
    sourceConfidence: 1,
    evidenceFingerprints: [snapshot.fingerprint],
    reason,
    provenance: "auto",
  };

  await store.save(revertProposal);

  // Record adaptation_proposed evidence
  await writer.recordAdaptationProposed(revertProposal.id, {
    createdAt: revertProposal.createdAt,
    action: revertProposal.action,
    target: revertProposal.target as unknown as Record<string, unknown>,
    sourceRecommendationType: revertProposal.sourceRecommendationType,
    sourceConfidence: revertProposal.sourceConfidence,
    provenance: "auto",
  });

  console.log(`Revert proposed: ${revertProposal.id} (approve then apply to execute).`);
}


// ---------------------------------------------------------------------------
// `intelligence` (P5.3.9)
// ---------------------------------------------------------------------------

/**
 * `alix adaptation intelligence [--since] [--until] [--min-bucket-size <n>]
 *   [--min-confidence <n>] [--json]`
 *
 * Analyzes cross-proposal effectiveness trends across all completed proposals.
 * Pure read + compute: no proposals created, no approvals, no mutations.
 *
 * Produces an IntelligenceReport with per-dimension buckets, revert signal
 * analysis, and confidence calibration.  Persisted to
 * `.alix/adaptation/intelligence/<generatedAt>.json` automatically.
 */
export async function runIntelligence(
  cwd: string,
  proposalStore: AdaptationProposalStore,
  evidenceStore: EvidenceStore,
  args: string[],
): Promise<void> {
  // Parse flags
  const sinceIdx = args.indexOf("--since");
  const untilIdx = args.indexOf("--until");
  const minBucketSizeIdx = args.indexOf("--min-bucket-size");
  const minConfidenceIdx = args.indexOf("--min-confidence");
  const jsonFlag = args.includes("--json");

  const since = sinceIdx >= 0 ? args[sinceIdx + 1] : undefined;
  const until = untilIdx >= 0 ? args[untilIdx + 1] : undefined;
  const minBucketSize = minBucketSizeIdx >= 0 ? Number(args[minBucketSizeIdx + 1]) : undefined;
  const minConfidence = minConfidenceIdx >= 0 ? Number(args[minConfidenceIdx + 1]) : undefined;

  // Wire up components
  const effectivenessStore = new EffectivenessStore(join(cwd, EFFECTIVENESS_DIR));
  const intelligenceStore = new IntelligenceStore(join(cwd, ".alix", "adaptation", "intelligence"));

  const lifecycleAnalyzer = new ProposalLifecycleAnalyzer(proposalStore, effectivenessStore, evidenceStore);
  const trendAnalyzer = new EffectivenessTrendAnalyzer();
  const bucketAggregator = new BucketAggregator(trendAnalyzer);
  const revertSignalAnalyzer = new RevertSignalAnalyzer();
  const confidenceCalibrationAnalyzer = new ConfidenceCalibrationAnalyzer();

  const reporter = new IntelligenceReporter(
    lifecycleAnalyzer,
    bucketAggregator,
    revertSignalAnalyzer,
    confidenceCalibrationAnalyzer,
    intelligenceStore,
  );

  // Generate report
  const report = await reporter.generateReport({
    since,
    until,
    minBucketSize,
    minConfidence,
  });

  // Output
  if (jsonFlag) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Human-readable output
  printIntelligenceReport(report);
}


// ---------------------------------------------------------------------------
// `prioritize` (P5.4.3)
// ---------------------------------------------------------------------------

/**
 * `alix adaptation prioritize [--top <n>] [--min-score <n>] [--json]`
 *
 * Ranks pending proposals by expected value using the P5.3 IntelligenceReport
 * for historical success rates, confidence calibration, and revert risk.
 *
 * Pure read + compute: no proposals created, no approvals, no mutations.
 *
 * Persisted to `.alix/adaptation/priorities/<generatedAt>.json` automatically.
 */
export async function runPrioritize(
  cwd: string,
  proposalStore: AdaptationProposalStore,
  args: string[],
): Promise<void> {
  // Parse flags
  const topIdx = args.indexOf("--top");
  const minScoreIdx = args.indexOf("--min-score");
  const jsonFlag = args.includes("--json");

  const top = topIdx >= 0 ? Number(args[topIdx + 1]) : undefined;
  const minScore = minScoreIdx >= 0 ? Number(args[minScoreIdx + 1]) : undefined;

  // Wire up components
  const intelligenceStore = new IntelligenceStore(join(cwd, ".alix", "adaptation", "intelligence"));
  const priorityStore = new PriorityStore(join(cwd, ".alix", "adaptation", "priorities"));

  const scorer = new ProposalScorer(proposalStore, intelligenceStore, priorityStore);

  // Generate report
  const report = await scorer.generateReport({ top, minScore });

  // Output
  if (jsonFlag) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Human-readable output
  printPriorityReport(report);
}


// ---------------------------------------------------------------------------
// `capability-evolution` (P5.5.6)
// ---------------------------------------------------------------------------

/**
 * `alix adaptation capability-evolution [--json] [--reflection-dir <dir>]`
 *
 * Analyzes capability health, gaps, overlap, and drift across all registered
 * agents and their capabilities. Read-only analysis — no proposals, no mutations.
 *
 * Produces a CapabilityEvolutionReport persisted to
 * `.alix/adaptation/capability-evolution/<generatedAt>.json` automatically.
 *
 * Flags:
 *   --json                   Output raw JSON report to stdout.
 *   --reflection-dir <dir>   Directory containing reflection report JSON files
 *                             for gap signal detection (optional).
 */
export async function runCapabilityEvolution(
  cwd: string,
  proposalStore: AdaptationProposalStore,
  evidenceStore: EvidenceStore,
  args: string[],
): Promise<void> {
  const jsonFlag = args.includes("--json");

  // Wire up stores
  const cardsDir = join(cwd, CARDS_DIR);
  const intelligenceStore = new IntelligenceStore(join(cwd, ".alix", "adaptation", "intelligence"));
  const capabilityEvolutionStore = new CapabilityEvolutionStore(
    join(cwd, ".alix", "adaptation", "capability-evolution"),
  );

  // Optional reflection directory for gap signal detection from reflection reports
  const reflectionDirFlag = args.indexOf("--reflection-dir");
  const reflectionDir = reflectionDirFlag >= 0
    ? join(cwd, args[reflectionDirFlag + 1])
    : undefined;

  // Build reporter with a query adapter for EvidenceStore type compatibility
  const reporter = new CapabilityEvolutionReporter(
    cardsDir,
    intelligenceStore,
    proposalStore,
    { query: (q) => evidenceStore.query(q as never) },
    capabilityEvolutionStore,
    reflectionDir,
  );

  // Generate report
  const report = await reporter.generateReport();

  // Output
  if (jsonFlag) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Human-readable output
  printCapabilityEvolutionReport(report);
}
