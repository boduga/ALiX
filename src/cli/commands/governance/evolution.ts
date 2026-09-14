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

import { join } from "node:path";
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
import { runLearnCli } from "../../../evolution/learning/learning-cli.js";
// A9 Slice 5 — pre-execution risk forecast CLI surface.
import { runForecastCli } from "../../../evolution/forecast/forecast-cli.js";
import type { EnrichedProposal } from "../../../adaptation/intelligence-types.js";
import { EventLog } from "../../../events/event-log.js";

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// A8 T7 — `alix governance evolution learn [--dimension ...] [--json]`
//
// Composes EventLog + GovernanceStore + EnrichedProposal[] from the
// standard `.alix/...` layout and delegates to `runLearnCli`. The
// engine construction (4 adapters) happens inside the CLI module to
// keep that seam co-located with the engine contract. We never regress
// to 3 adapters — per A8 wayfinder map #517, RecommendationsAdapter is
// structural.
// ---------------------------------------------------------------------------
export async function runEvolutionLearn(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");
  const dimIdx = args.indexOf("--dimension");
  const dimension = dimIdx >= 0 ? args[dimIdx + 1] : undefined;

  const cwd = process.cwd();

  // 1. EventLog — pick the most-recent session that has events.jsonl.
  //    Falls back to a sentinel non-existent path; LearningEngine will
  //    then observe an empty EventLog and emit no findings (organizational
  //    patterns surface only when capability governance has run).
  const sessionsDir = join(cwd, ".alix", "sessions");
  let sessionDir = join(cwd, ".alix", "sessions", "capability-cmd");
  try {
    const { readdir, stat } = await import("node:fs/promises");
    const entries = await readdir(sessionsDir, { withFileTypes: true });
    const dirs = await Promise.all(
      entries
        .filter((d) => d.isDirectory())
        .map(async (d) => {
          const p = join(sessionsDir, d.name);
          const s = await stat(p);
          return { name: d.name, mtimeMs: s.mtimeMs };
        }),
    );
    dirs.sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (dirs.length > 0 && dirs[0]) sessionDir = join(sessionsDir, dirs[0].name);
  } catch {
    // sessions dir may not exist on a fresh repo — fall through.
  }
  const eventLog = new EventLog(sessionDir);

  // 2. A2.5 recommendations (4th adapter) — sourced from the A2.5-owned
  //    RecommendationStore (.alix/verification/recommendations.jsonl,
  //    Q-A8-REC locked surface). NOT the P9.x GovernanceStore
  //    `.alix/governance/recommendations.jsonl` (a different artifact type —
  //    P9.1 governance reports, not A2.5 recommendations). The default
  //    constructor reads that A2.5 path; an empty file maps to [].
  const { RecommendationStore } = await import("../../../evolution/verification/recommendation/recommendation-store.js");
  const recommendations = new RecommendationStore(join(cwd, ".alix", "verification"));

  // 3. EnrichedProposal[] — the 3rd adapter's source. Currently
  //    read-and-void-discarded by the engine (T2/T6 ruling, A8 wayfinder
  //    map #517: "keep the seam alive for a future detector"). Deriving it
  //    here would require AdaptationProposalStore + EffectivenessStore + EvidenceStore
  //    wiring plus a ProposalLifecycleAnalyzer constructor chain that
  //    exceeds the v1 scope. Passing [] is safe because no detector
  //    currently consumes it; a future architectural increment that
  //    introduces such a detector MUST revisit this seam.
  const enrichedProposals: ReadonlyArray<never> = [];

  const result = await runLearnCli({
    eventLog,
    recommendations,
    enrichedProposals,
    json: jsonMode,
    dimension,
  });

  console.log(result.output);
  process.exitCode = result.exitCode;
}


// ---------------------------------------------------------------------------
// A1 — `alix governance evolution discover [--json]`
//
// Production entry point for pattern discovery (#709). Composes the
// ExecutionEvidenceStore + governance FileAuditStore from the standard
// `.alix/...` layout with a fresh EvolutionStateMachine, then delegates
// to `runDiscoverCli`, which builds the engine (4 strategies + generator),
// runs detection, and intakes candidates as PROPOSED evolutions.
// ---------------------------------------------------------------------------
export async function runEvolutionDiscover(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");
  const cwd = process.cwd();

  const { ExecutionEvidenceStore } = await import("../../../runtime/execution-evidence-store.js");
  const { FileAuditStore } = await import("../../../governance/audit-store.js");
  const { EvolutionStateMachine } = await import("../../../evolution/evolution-state-machine.js");
  const { runDiscoverCli } = await import("../../../evolution/pattern-discovery/discovery-cli.js");

  // Same storefront as the `evolution` read-only CLI: evidence store rooted
  // at cwd, governance audit at .alix/governance, in-memory state machine.
  const result = await runDiscoverCli({
    evidenceStore: new ExecutionEvidenceStore(cwd),
    auditStore: new FileAuditStore(cwd),
    stateMachine: new EvolutionStateMachine(),
    json: jsonMode,
  });

  console.log(result.output);
  process.exitCode = result.exitCode;
}


// ---------------------------------------------------------------------------
// A9 Slice 5 — `alix governance evolution forecast [--dimension ...] [--json]`
//
// Composes EventLog + EnrichedProposal[] from the standard `.alix/...`
// layout and delegates to `runForecastCli`. The engine construction (2
// adapters) happens inside the CLI module to keep that seam co-located with
// the engine contract (mirrors the A8 `learn` seam). The forecast is
// persisted to the A9-owned `.alix/governance/forecasts.jsonl` store.
// Correlation is automatic and is NOT exposed here.
// ---------------------------------------------------------------------------
export async function runEvolutionForecast(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");
  const dimIdx = args.indexOf("--dimension");
  const rawDimension = dimIdx >= 0 ? args[dimIdx + 1] : undefined;
  // Validate --dimension against the three locked A9 forecast kinds; an
  // unknown value is rejected loudly rather than silently filtering to nothing.
  const dimension =
    rawDimension === "trust-velocity" ||
    rawDimension === "evidence-completeness" ||
    rawDimension === "fingerprint-coincidence"
      ? rawDimension
      : undefined;
  if (rawDimension !== undefined && dimension === undefined) {
    console.error(
      `[a9 forecast] unknown --dimension '${rawDimension}' (expected trust-velocity | evidence-completeness | fingerprint-coincidence)`,
    );
    process.exitCode = 1;
    return;
  }

  const cwd = process.cwd();

  // 1. EventLog — pick the most-recent session that has events.jsonl
  //    (same fallback semantics as runEvolutionLearn).
  const sessionsDir = join(cwd, ".alix", "sessions");
  let sessionDir = join(cwd, ".alix", "sessions", "capability-cmd");
  try {
    const { readdir, stat } = await import("node:fs/promises");
    const entries = await readdir(sessionsDir, { withFileTypes: true });
    const dirs = await Promise.all(
      entries
        .filter((d) => d.isDirectory())
        .map(async (d) => {
          const p = join(sessionsDir, d.name);
          const s = await stat(p);
          return { name: d.name, mtimeMs: s.mtimeMs };
        }),
    );
    dirs.sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (dirs.length > 0 && dirs[0]) sessionDir = join(sessionsDir, dirs[0].name);
  } catch {
    // sessions dir may not exist on a fresh repo — fall through.
  }
  const eventLog = new EventLog(sessionDir);

  // 2. EnrichedProposal[] — derive REAL data from the standard `.alix`
  //    adaptation stores via ProposalLifecycleAnalyzer (the P10.8a pipeline
  //    output the `alix adaptation intelligence` command uses — the A9
  //    evidence-completeness detector consumes EnrichedProposal, so an
  //    empty source would silently disable it on the operator surface).
  //    Phase 20: a failed source contributes nothing and does not destroy the
  //    run — fall back to [] and surface the failure on stderr.
  let enrichedProposals: ReadonlyArray<EnrichedProposal> = [];
  try {
    const { AdaptationProposalStore } = await import("../../../adaptation/adaptation-proposal-store.js");
    const { EffectivenessStore } = await import("../../../adaptation/effectiveness-store.js");
    const { EvidenceStore } = await import("../../../security/evidence/evidence-store.js");
    const { ProposalLifecycleAnalyzer } = await import("../../../adaptation/proposal-lifecycle-analyzer.js");
    const analyzer = new ProposalLifecycleAnalyzer(
      new AdaptationProposalStore(join(cwd, ".alix", "adaptation", "proposals")),
      new EffectivenessStore(join(cwd, ".alix", "adaptation", "effectiveness")),
      new EvidenceStore({ storeDir: join(cwd, ".alix", "security") }),
    );
    enrichedProposals = await analyzer.analyze();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[a9 forecast] enriched-proposal source unavailable: ${message}`);
  }

  // 3. A9-owned forecast store dir — `.alix/governance` (forecasts.jsonl).
  const storeDir = join(cwd, ".alix", "governance");

  const result = await runForecastCli({
    eventLog,
    enrichedProposals,
    storeDir,
    json: jsonMode,
    dimension,
  });

  console.log(result.output);
  process.exitCode = result.exitCode;
}
