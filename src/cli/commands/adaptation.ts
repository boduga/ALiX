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
 * @module
 */

import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { ProposalStore } from "../../adaptation/proposal-store.js";
import { RecommendationToProposal } from "../../adaptation/recommendation-to-proposal.js";
import { ApprovalGate } from "../../adaptation/approval-gate.js";
import type { Applier } from "../../adaptation/approval-gate.js";
import { AgentCardApplier } from "../../adaptation/appliers/agent-card-applier.js";
import { SkillApplier } from "../../adaptation/appliers/skill-applier.js";
import { RevertApplier } from "../../adaptation/revert-applier.js";
import { SnapshotStore } from "../../adaptation/snapshot-store.js";
import { nextProposalId } from "../../adaptation/recommendation-to-proposal.js";
import { EffectivenessReporter } from "../../adaptation/effectiveness-reporter.js";
import { EffectivenessStore } from "../../adaptation/effectiveness-store.js";
import type { ProposalEffectivenessReport } from "../../adaptation/effectiveness-types.js";
import { AutomaticProposalGenerator } from "../../adaptation/auto-proposal-generator.js";
import { EvidenceStore } from "../../security/evidence/evidence-store.js";
import { EvidenceEventWriter } from "../../workflow/evidence-writer.js";
import type { AdaptationProposal, ProposalStatus } from "../../adaptation/adaptation-types.js";
import type { ReflectionReport } from "../../reflection/reflection-types.js";

// ---------------------------------------------------------------------------
// Constants — .alix path conventions (mirror the appliers' docstrings)
// ---------------------------------------------------------------------------

/** Append-only proposal JSON store (P5.1b). */
const PROPOSALS_DIR = join(".alix", "adaptation", "proposals");
const EFFECTIVENESS_DIR = join(".alix", "adaptation", "effectiveness");

/** Evidence store directory relative to cwd (P4.4 convention). */
const EVIDENCE_DIR = join(".alix", "security");

/** Agent cards directory (P5.1e). */
const CARDS_DIR = join(".alix", "cards", "agents");

/** Skill definitions directory (P5.1f). */
const SKILLS_DIR = join(".alix", "skills", "workflow");

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

/**
 * Handle `alix adaptation <subcommand>`.
 *
 * Wires up ProposalStore, EvidenceStore (+ EvidenceEventWriter), ApprovalGate,
 * and the two appliers. `apply` selects an applier by `proposal.target.kind`
 * and routes THROUGH ApprovalGate.apply — never calling the applier directly.
 */
export async function handleAdaptationCommand(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "";
  const rest = args.slice(1);

  const cwd = process.cwd();
  const store = new ProposalStore(join(cwd, PROPOSALS_DIR));
  const evidenceStore = new EvidenceStore({ storeDir: join(cwd, EVIDENCE_DIR) });
  const writer = new EvidenceEventWriter((type, payload) => evidenceStore.append(type, payload));
  const gate = new ApprovalGate(store, writer);

  switch (subcommand) {
    case "list":
      await runList(store, rest);
      return;
    case "show":
      await runShow(store, rest);
      return;
    case "propose":
      await runPropose(store, writer, rest);
      return;
    case "approve":
      await runApprove(gate, rest);
      return;
    case "reject":
      await runReject(gate, rest);
      return;
    case "apply":
      await runApply(cwd, store, gate, writer, rest);
      return;
    case "effectiveness":
      await runEffectiveness(cwd, store, evidenceStore, rest);
      return;
    case "generate":
      await runGenerate(cwd, store, writer, rest);
      return;
    case "revert":
      await runRevert(cwd, store, writer, rest);
      return;
    default:
      console.error(`Unknown adaptation subcommand: "${subcommand}"`);
      printUsage(true);
      process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

/** `list [--status <status>]` */
async function runList(store: ProposalStore, args: string[]): Promise<void> {
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
    `${"ID".padEnd(26)} ${"Status".padEnd(10)} ${"Action".padEnd(26)} Target`,
  );
  console.log("-".repeat(90));
  for (const p of proposals) {
    console.log(
      `${p.id.padEnd(26)} ${p.status.padEnd(10)} ${p.action.padEnd(26)} ${describeTarget(p)}`,
    );
  }
  console.log(`\n${proposals.length} proposal${proposals.length === 1 ? "" : "s"}`);
}

/** `show <id>` */
async function runShow(store: ProposalStore, args: string[]): Promise<void> {
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
}

/** `propose <report.json>` */
async function runPropose(
  store: ProposalStore,
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
async function runApprove(gate: ApprovalGate, args: string[]): Promise<void> {
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
async function runReject(gate: ApprovalGate, args: string[]): Promise<void> {
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
async function runApply(
  cwd: string,
  store: ProposalStore,
  gate: ApprovalGate,
  writer: EvidenceEventWriter,
  args: string[],
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

  // Manual-action kinds have no automated applier by design — the human
  // performs them out-of-band (create an issue, edit a routing weight,
  // declare a capability). Surface actionable guidance and return cleanly
  // (exit 0): this is a successful guided outcome, not an error. We never
  // reach the gate and never mutate anything.
  if (isManualKind(proposal.target.kind)) {
    printManualAction(proposal);
    return;
  }

  const applier = selectApplier(cwd, proposal, writer);

  try {
    const updated = await gate.apply(id, applier);
    console.log(`Applied: ${updated.id} → ${updated.action} (${describeTarget(updated)})`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Applier selection
// ---------------------------------------------------------------------------

/**
 * Select the Applier callback for a proposal by `target.kind`.
 *
 * The gate owns the no-approval-no-mutation invariant; this function only
 * decides WHICH applier to hand the gate.
 *
 * Recognized manual-action kinds ("capability", "issue", "routing_weight")
 * are intercepted in runApply before this function is reached and surfaced
 * as human guidance. selectApplier's default throw therefore only fires for
 * genuinely unexpected target kinds — the gate never runs for them, so no
 * mutation occurs.
 */
function selectApplier(cwd: string, proposal: AdaptationProposal, writer: EvidenceEventWriter): Applier {
  switch (proposal.target.kind) {
    case "agent_card": {
      const applier = new AgentCardApplier(join(cwd, CARDS_DIR));
      return (p) => applier.apply(p);
    }
    case "skill": {
      const applier = new SkillApplier(join(cwd, SKILLS_DIR));
      return (p) => applier.apply(p);
    }
    case "revert": {
      const snapshotsDir = join(cwd, ".alix", "adaptation", "snapshots");
      const revertApplier = new RevertApplier(snapshotsDir, writer);
      return (p) => revertApplier.apply(p);
    }
    default:
      throw new Error(
        `No applier registered for target.kind "${proposal.target.kind}" (proposal ${proposal.id}). ` +
          `Supports "agent_card", "skill", and "revert".`,
      );
  }
}

// ---------------------------------------------------------------------------
// Formatting / helpers
// ---------------------------------------------------------------------------

/**
 * Target kinds that have no automated applier — the human must perform the
 * action out-of-band (file an issue, edit a routing weight, declare a
 * capability). runApply intercepts these before the gate and surfaces
 * actionable guidance instead of mutating.
 */
const MANUAL_KINDS = new Set<string>(["capability", "issue", "routing_weight"]);

/** Whether a proposal target kind requires manual (out-of-band) action. */
function isManualKind(kind: string): boolean {
  return MANUAL_KINDS.has(kind);
}

/**
 * Print actionable manual-action guidance for a proposal that cannot be
 * auto-applied. Writes to stdout (this is a guided success, not an error),
 * does not mutate anything, does not touch the gate or evidence.
 *
 * The proposal status stays "approved" — the human performs the action
 * out-of-band; tracking manual completion is a future concern.
 */
function printManualAction(p: AdaptationProposal): void {
  console.log("Manual action required — this proposal cannot be auto-applied.");
  console.log(`  Proposal: ${p.id}`);
  console.log(`  Action:   ${p.action}`);
  console.log(`  Reason:   ${p.reason}`);

  // The P5.0 recommendation's free-text action — the most concrete steer the
  // system has. Surface it verbatim so the operator gets the specific change.
  const recommendedAction = p.payload.recommendedAction;
  if (typeof recommendedAction === "string" && recommendedAction.length > 0) {
    console.log(`  Suggested change: ${recommendedAction}`);
  }

  console.log("  What to do by hand:");

  switch (p.target.kind) {
    case "issue":
      console.log(`    - Open a GitHub issue titled: "${p.target.title}"`);
      console.log(`      Use the reason above as the issue body / starting point.`);
      break;
    case "routing_weight": {
      const agent = p.payload.agentId;
      const weight = p.payload.weight;
      console.log(
        `    - Adjust the routing weight for the "${p.target.capability}" capability` +
          (typeof agent === "string" ? ` on agent "${agent}"` : "") +
          (typeof weight === "number" || typeof weight === "string" ? ` to ${weight}` : "") +
          ".",
      );
      break;
    }
    case "capability": {
      const agent = p.target.agentId ?? p.payload.agentId;
      console.log(
        `    - Add the "${p.target.capability}" capability` +
          (typeof agent === "string" ? ` to agent "${agent}"` : "") +
          " (declare it on the relevant agent card).",
      );
      break;
    }
  }

  console.log("  No files were changed. Proposal remains \"approved\".");
}

/** Human-readable one-liner for a proposal's target. */
function describeTarget(p: AdaptationProposal): string {
  switch (p.target.kind) {
    case "agent_card":
      return `agent_card:${p.target.id}`;
    case "skill":
      return `skill:${p.target.id}`;
    case "capability":
      return `capability:${p.target.capability}`;
    case "issue":
      return `issue:"${p.target.title}"`;
    case "routing_weight":
      return `routing_weight:${p.target.capability}`;
    case "revert":
      return `revert proposal ${p.target.sourceProposalId}`;
  }
}

/** Print full proposal details. */
function printProposal(p: AdaptationProposal): void {
  console.log(`ID:              ${p.id}`);
  console.log(`Status:          ${p.status}`);
  console.log(`Action:          ${p.action}`);
  console.log(`Target:          ${describeTarget(p)}`);
  console.log(`Created:         ${p.createdAt}`);
  console.log(`Source:          ${p.sourceRecommendationType} (confidence ${p.sourceConfidence})`);
  console.log(`Reason:          ${p.reason}`);
  if (p.evidenceFingerprints.length > 0) {
    console.log(`Evidence:        ${p.evidenceFingerprints.join(", ")}`);
  }
  if (p.approvedBy) console.log(`Approved by:    ${p.approvedBy}${p.approvedAt ? ` at ${p.approvedAt}` : ""}`);
  if (p.appliedAt) console.log(`Applied at:      ${p.appliedAt}`);
  if (p.error) console.log(`Error:           ${p.error}`);
  console.log(`Payload:`);
  console.log(JSON.stringify(p.payload, null, 2));
}

/** Best-effort actor identity from the environment. */
function detectActor(): string {
  return process.env.USER || process.env.USERNAME || "cli-user";
}

function printUsage(toStderr: boolean): void {
  const lines = [
    "Usage: alix adaptation <subcommand> [options]",
    "  list [--status <status>]       List proposals (optionally filtered by status)",
    "  show <id>                      Show full proposal details",
    "  propose <report.json>          Convert a ReflectionReport into proposals",
    "  approve <id1> [id2] ... [--by <actor>]  Approve one or more pending proposals",
    "  reject <id> [--reason <text>]  Reject a pending proposal",
    "  apply <id>                     Apply an approved proposal",
    "  revert <id> [--reason <text>]  Create a revert proposal for an applied proposal (approve then apply to execute)",
    "  effectiveness <id> [--all]     Assess an applied proposal (keep/revert/investigate)",
    "  generate [--reflection <path> | --effectiveness <id> | --all-effectiveness] [--min-confidence <n>]",
    "                               Auto-create pending proposals from reflection or effectiveness (no approve/apply)",
  ];
  for (const line of lines) {
    if (toStderr) console.error(line);
    else console.log(line);
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
async function runEffectiveness(
  cwd: string,
  store: ProposalStore,
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

function printEffectiveness(r: ProposalEffectivenessReport): void {
  console.log(`Proposal:       ${r.proposalId}`);
  console.log(`Applied at:    ${r.appliedAt}  (window ±${r.windowDays}d)`);
  console.log(`Recommendation: ${r.recommendation.toUpperCase()}  — ${r.reason}`);
  if (r.primary) {
    console.log(`Primary:       ${r.primary.metric} ${r.primary.before} → ${r.primary.after}`);
  } else {
    console.log(`Primary:       (none — manual-action proposal)`);
  }
  console.log(`Data sufficient: ${r.dataSufficient}`);
  console.log("");
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
async function runGenerate(
  cwd: string,
  store: ProposalStore,
  writer: EvidenceEventWriter,
  args: string[],
): Promise<void> {
  const reflectionIdx = args.indexOf("--reflection");
  const effectivenessIdx = args.indexOf("--effectiveness");
  const allEffIdx = args.indexOf("--all-effectiveness");

  const sourceFlagsPresent = [
    reflectionIdx >= 0,
    effectivenessIdx >= 0,
    allEffIdx >= 0,
  ].filter(Boolean).length;

  if (sourceFlagsPresent !== 1) {
    console.error(
      "Usage: alix adaptation generate " +
        "--reflection <path> | --effectiveness <id> | --all-effectiveness " +
        "[--min-confidence <n>]\n" +
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
  const reports = await effStore.list();
  const result = await generator.generateFromAllEffectiveness(reports, {
    minConfidence,
  });
  printGenerateSummary(result);
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
async function runRevert(
  cwd: string,
  store: ProposalStore,
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

/**
 * Print the standard "Generated: N proposal(s)" summary line. The skip
 * count is reported as a raw integer — per-source breakdown (e.g.
 * low-confidence vs routing_adjustment) lives at the per-method level
 * in the AutomaticProposalGenerator. The CLI keeps the summary simple
 * to avoid duplicating the generator's internal classification here.
 */
function printGenerateSummary(result: {
  generated: number;
  skipped: number;
  proposals: AdaptationProposal[];
}): void {
  const ids = result.proposals.map((p) => p.id).join(", ");
  console.log(`Generated: ${result.generated} proposal(s) [${ids}]`);
  console.log(`Skipped:   ${result.skipped}`);
}
