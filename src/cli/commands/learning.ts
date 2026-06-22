/**
 * P8.7 — `alix learning` CLI: report and propose subcommands.
 *
 * Wired to the LearningStore (P8.0b) and ProposalFactory (P8.5).
 *
 * Core invariants:
 *   - `report` is read-only — no side effects beyond store reads
 *   - `propose` creates a PENDING proposal — never approved, never applied
 *   - `propose --dry-run` persists nothing
 *   - This CLI is the ONLY path that instantiates ProposalFactory
 *
 * Note on data availability: the calibration builders (P8.1–P8.4) are pure
 * functions over pre-aggregated inputs. The live pipeline that aggregates
 * P7 outcomes into builder inputs is a separate concern. Until that
 * pipeline is wired, `report` renders whatever signals/profiles are in the
 * LearningStore and is honest about empty state.
 *
 * @module
 */

import { join } from "node:path";
import { LearningStore } from "../../learning/learning-store.js";
import type {
  CalibrationProfile,
  LearningSignal,
} from "../../learning/learning-types.js";
import { ProposalFactory, buildLearningProposal } from "../learning-proposal-factory.js";
import { ProposalStore } from "../../adaptation/proposal-store.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LEARNING_DIR = join(".alix", "learning");
const PROPOSALS_DIR = join(".alix", "adaptation", "proposals");

const TARGET_AREAS = ["recommendation", "risk", "governance", "routing"] as const;
type TargetArea = (typeof TARGET_AREAS)[number];

const PROFILE_TARGET_TO_AREA: Record<string, TargetArea> = {
  recommendation_confidence_multiplier: "recommendation",
  risk_dimension_weight: "risk",
  governance_lens_weight: "governance",
  routing_model_preference: "routing",
};

// ---------------------------------------------------------------------------
// Command entry
// ---------------------------------------------------------------------------

export async function handleLearningCommand(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "";
  const rest = args.slice(1);

  switch (subcommand) {
    case "report":
      await runReport(rest);
      return;
    case "propose":
      await runPropose(rest);
      return;
    default:
      console.error(`Unknown learning subcommand: "${subcommand}"`);
      console.error(
        "Usage: alix learning report [--window N] [--json] [--target <area>] | propose --target <area> [--dry-run]",
      );
      process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

async function runReport(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const windowDays = flags.window ?? 30;
  const jsonMode = flags.json ?? false;
  const targetFilter = flags.target;

  if (targetFilter && !TARGET_AREAS.includes(targetFilter as TargetArea)) {
    console.error(
      `Error: --target must be one of ${TARGET_AREAS.join(", ")}`,
    );
    process.exit(1);
  }

  const cwd = process.cwd();
  const store = new LearningStore(join(cwd, LEARNING_DIR));

  const signals = await store.querySignals({ windowDays });
  const profiles = await store.queryProfiles({ windowDays });

  // Filter by target area if requested
  const filteredSignals = targetFilter
    ? signals.filter((s) => signalArea(s) === targetFilter)
    : signals;
  const filteredProfiles = targetFilter
    ? profiles.filter((p) => PROFILE_TARGET_TO_AREA[p.target] === targetFilter)
    : profiles;

  const lowConfidenceCount = signals.filter((s) => s.confidence < 0.5).length;

  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          windowDays,
          signals: filteredSignals,
          profiles: filteredProfiles,
          proposalSummary: {
            available: filteredProfiles.length,
            alreadyProposed: 0,
          },
          lowConfidenceExcluded: lowConfidenceCount,
        },
        null,
        2,
      ),
    );
    return;
  }

  // ── Terminal renderer ──
  console.log(`═══ Learning Report ═══`);
  console.log(`Window: last ${windowDays} days\n`);

  if (filteredSignals.length === 0 && filteredProfiles.length === 0) {
    console.log(
      `No learning signals found in window.`,
    );
    console.log(
      `\nLearning signals are produced when calibration builders analyze`,
    );
    console.log(
      `P7 outcome data. Until the live calibration pipeline is wired, the`,
    );
    console.log(
      `LearningStore is empty. The builders (P8.1–P8.4) are tested and ready.`,
    );
    return;
  }

  // Group signals/profiles by area
  for (const area of TARGET_AREAS) {
    if (targetFilter && targetFilter !== area) continue;
    const areaSignals = filteredSignals.filter((s) => signalArea(s) === area);
    const areaProfiles = filteredProfiles.filter(
      (p) => PROFILE_TARGET_TO_AREA[p.target] === area,
    );
    if (areaSignals.length === 0 && areaProfiles.length === 0) continue;

    console.log(`── ${titleCase(area)} Calibration ──`);
    for (const sig of areaSignals) {
      console.log(
        `  ${sig.signalType}: ${sig.summary} (strength ${(sig.strength * 100).toFixed(0)}%, confidence ${(sig.confidence * 100).toFixed(0)}%)`,
      );
    }
    for (const prof of areaProfiles) {
      console.log(
        `  Proposal: ${prof.targetName} ${prof.previousValue} → ${prof.suggestedValue}`,
      );
    }
    console.log("");
  }

  if (lowConfidenceCount > 0) {
    console.log(
      `  ${lowConfidenceCount} low-confidence signals (confidence < 50%) included for transparency.`,
    );
  }

  console.log(
    `\nTo propose changes: alix learning propose --target <area>`,
  );
}

// ---------------------------------------------------------------------------
// propose
// ---------------------------------------------------------------------------

async function runPropose(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.target) {
    console.error(
      "Error: --target is required (recommendation | risk | governance | routing)",
    );
    console.error("Usage: alix learning propose --target <area> [--dry-run]");
    process.exit(1);
  }

  if (!TARGET_AREAS.includes(flags.target as TargetArea)) {
    console.error(
      `Error: --target must be one of ${TARGET_AREAS.join(", ")}`,
    );
    process.exit(1);
  }

  const area = flags.target as TargetArea;
  const dryRun = flags["dry-run"] ?? false;
  const windowDays = flags.window ?? 90;

  const cwd = process.cwd();
  const store = new LearningStore(join(cwd, LEARNING_DIR));
  const profiles = (await store.queryProfiles({ windowDays })).filter(
    (p) => PROFILE_TARGET_TO_AREA[p.target] === area,
  );

  if (profiles.length === 0) {
    console.log(
      `No calibration profiles available for area "${area}".`,
    );
    console.log(
      `Profiles are produced when calibration builders detect patterns.`,
    );
    return;
  }

  const proposalType = AREA_TO_PROPOSAL_TYPE[area];
  const learning = buildLearningProposal(
    proposalType,
    profiles,
    new Date().toISOString(),
  );
  const factory = new ProposalFactory();
  const proposal = factory.toAdaptationProposal(learning);

  if (dryRun) {
    console.log(`[dry-run] Would create learning proposal:`);
    console.log(`  id:          ${proposal.id}`);
    console.log(`  action:      ${proposal.action}`);
    console.log(`  target:      ${proposal.target.kind}/${(proposal.target as { area: string }).area}`);
    console.log(`  status:      ${proposal.status}`);
    console.log(`  profiles:    ${profiles.length}`);
    console.log(`  requiresApproval: true`);
    return;
  }

  const proposalStore = new ProposalStore(join(cwd, PROPOSALS_DIR));
  await proposalStore.save(proposal);

  console.log(`Learning proposal created: ${proposal.id}`);
  console.log(`  area:        ${area}`);
  console.log(`  profiles:    ${profiles.length}`);
  console.log(`  status:      pending (requires human approval)`);
  console.log(`\nNext: alix adaptation approve ${proposal.id}`);
  console.log(`      alix adaptation apply  ${proposal.id}  (deferred to P8.9/P9 — no applier yet)`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AREA_TO_PROPOSAL_TYPE: Record<
  TargetArea,
  "recommendation_calibration" | "risk_calibration" | "governance_calibration" | "routing_calibration"
> = {
  recommendation: "recommendation_calibration",
  risk: "risk_calibration",
  governance: "governance_calibration",
  routing: "routing_calibration",
};

/** Map a signal's type to its calibration area. */
function signalArea(s: LearningSignal): TargetArea | undefined {
  if (s.signalType.startsWith("overconfidence") || s.signalType.startsWith("underconfidence")) {
    return "recommendation";
  }
  if (s.signalType.startsWith("risk_dimension")) return "risk";
  if (s.signalType.startsWith("lens_")) return "governance";
  if (s.signalType.startsWith("routing_")) return "routing";
  return undefined;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface ParsedFlags {
  window?: number;
  json?: boolean;
  target?: string;
  "dry-run"?: boolean;
}

function parseFlags(args: string[]): ParsedFlags {
  const flags: ParsedFlags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") flags.json = true;
    else if (a === "--dry-run") flags["dry-run"] = true;
    else if (a === "--window") {
      const parsed = parseInt(args[++i], 10);
      if (!isNaN(parsed) && parsed > 0) flags.window = parsed;
    } else if (a === "--target") {
      flags.target = args[++i];
    }
  }
  return flags;
}
