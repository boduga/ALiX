/**
 * P23.4 — Governance Replay CLI Handler.
 *
 * `alix governance replay` subcommands:
 *   assemble   — assemble a replay dataset (placeholder for P23.1 store integration)
 *   evaluate   — evaluate counterfactual scenario on a dataset
 *   report     — render replay report (text or JSON)
 *
 * CLI invariants:
 *   - read-only: no writes to governance stores
 *   - no audit emitters
 *   - no execution adapters
 *   - no policy/readiness/approval/handoff/closure writers
 *   - no auto-adoption or auto-close
 *   - no operator ranking
 */

import { readFileSync, existsSync } from "node:fs";

import { evaluateCounterfactual } from "../../governance/replay/counterfactual-readiness-evaluator.js";
import { formatReplayReport } from "../../governance/replay/replay-report.js";
import type { GovernanceReplayDataset, CounterfactualScenario } from "../../governance/replay/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flag(args: string[], name: string): string | null {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

// ---------------------------------------------------------------------------
// Bundle readers
// ---------------------------------------------------------------------------

function tryParseJson<T>(path: string, label: string): T {
  if (!existsSync(path)) {
    throw new Error(`${label} file not found: "${path}"`);
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    return raw as T;
  } catch (err) {
    throw new Error(`Failed to parse ${label} file "${path}": ${(err as Error).message}`);
  }
}

function loadDataset(path: string): GovernanceReplayDataset {
  return tryParseJson<GovernanceReplayDataset>(path, "Dataset");
}

function loadScenario(path: string): CounterfactualScenario {
  return tryParseJson<CounterfactualScenario>(path, "Scenario");
}

// ---------------------------------------------------------------------------
// Default scenario builder from CLI flags
// ---------------------------------------------------------------------------

function buildScenarioFromFlags(args: string[]): CounterfactualScenario {
  const id = "cli-" + Date.now().toString(36);

  const scenario: CounterfactualScenario = {
    scenarioId: id,
    name: "CLI-defined scenario",
    description: "Counterfactual scenario defined via CLI flags",
    createdForReplayOnly: true,
  };

  if (hasFlag(args, "--strict-evidence")) {
    scenario.evidenceAssumptions = { requireFullCompleteness: true };
    scenario.name = "Strict evidence review";
    scenario.description = "Requires full evidence completeness for progression";
  }

  if (hasFlag(args, "--strict-handoff")) {
    scenario.handoffAssumptions = { requireAllEvidenceCaptured: true };
    scenario.name = "Strict handoff review";
    scenario.description = "Requires all handoff evidence to be captured";
  }

  if (hasFlag(args, "--closure-risk-sensitive")) {
    scenario.readinessAssumptions = {
      ...scenario.readinessAssumptions,
      downgradeOnHighClosureRisk: true,
    };
    scenario.name = "Closure risk sensitive";
    scenario.description = "Downgrades readiness when closure risk is high";
  }

  if (hasFlag(args, "--require-complete-review")) {
    scenario.closureAssumptions = { treatNeedsFollowUpAsUnresolved: true };
    scenario.name = "Complete review required";
    scenario.description = "Treats follow-up-needed as unresolved";
  }

  // Combine name if multiple flags
  const flags = ["--strict-evidence", "--strict-handoff", "--closure-risk-sensitive", "--require-complete-review"];
  const activeFlags = flags.filter((f) => hasFlag(args, f));
  if (activeFlags.length > 1) {
    scenario.name = activeFlags.map((f) => f.replace(/^--/, "").replace(/-/g, " ")).join(" + ");
  }

  return scenario;
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

function runAssemble(args: string[]): void {
  const lifecycleId = args[0];
  if (!lifecycleId) {
    console.error("Usage: alix governance replay assemble <lifecycle-id> --input <path>");
    process.exit(2);
  }

  const inputPath = flag(args, "--input");
  if (!inputPath) {
    console.error("Error: --input is required (path to dataset bundle)");
    process.exit(2);
  }

  // Load a pre-assembled dataset (the actual assembly happens in the bundle
  // producer; this CLI is a read-only consumer).
  const dataset = loadDataset(inputPath);

  console.log(`Replay dataset assembled for lifecycle: ${lifecycleId}`);
  console.log(`  Replay ID: ${dataset.replayId}`);
  console.log(`  Source records: ${dataset.sourceSummary.approvalCount} approvals, ${dataset.sourceSummary.handoffCount} handoffs, ${dataset.sourceSummary.closureReviewCount} closure reviews`);

  if (hasFlag(args, "--json")) {
    console.log(JSON.stringify(dataset, null, 2));
  }
}

function runEvaluate(args: string[]): void {
  const lifecycleId = args[0];
  if (!lifecycleId) {
    console.error("Usage: alix governance replay evaluate <lifecycle-id> --input <path> [--scenario <path>] [flags] [--json]");
    process.exit(2);
  }

  const inputPath = flag(args, "--input");
  if (!inputPath) {
    console.error("Error: --input is required (path to dataset bundle)");
    process.exit(2);
  }

  const dataset = loadDataset(inputPath);

  // Load scenario from file or build from CLI flags
  let scenario: CounterfactualScenario;
  const scenarioPath = flag(args, "--scenario");

  if (scenarioPath) {
    scenario = loadScenario(scenarioPath);
  } else if (
    hasFlag(args, "--strict-evidence") ||
    hasFlag(args, "--strict-handoff") ||
    hasFlag(args, "--closure-risk-sensitive") ||
    hasFlag(args, "--require-complete-review")
  ) {
    scenario = buildScenarioFromFlags(args);
  } else {
    console.error("Error: --scenario <path> or one of --strict-evidence/--strict-handoff/--closure-risk-sensitive/--require-complete-review is required");
    process.exit(2);
  }

  const outcome = evaluateCounterfactual(dataset, scenario, {
    now: new Date().toISOString(),
  });

  if (hasFlag(args, "--json")) {
    console.log(JSON.stringify(outcome, null, 2));
  } else {
    console.log(`Counterfactual evaluation complete for lifecycle: ${lifecycleId}`);
    console.log(`  Scenario: ${scenario.name}`);
    console.log(`  Readiness: ${outcome.originalOutcome.readinessLevel ?? "—"} → ${outcome.counterfactualOutcome.readinessLevel ?? "—"}`);
    console.log(`  Risk: ${outcome.originalOutcome.closureRiskLevel ?? "—"} → ${outcome.counterfactualOutcome.closureRiskLevel ?? "—"}`);
    console.log(`  Diff category: ${outcome.diff.category}`);
    console.log(`  Blocked: ${outcome.counterfactualOutcome.blocked ? "yes" : "no"}`);
    console.log(`  Candidate lessons: ${outcome.candidateLessons.length}`);
  }
}

function runReport(args: string[]): void {
  const lifecycleId = args[0];
  if (!lifecycleId) {
    console.error("Usage: alix governance replay report <lifecycle-id> --input <path> --scenario <path> [--json]");
    process.exit(2);
  }

  const inputPath = flag(args, "--input");
  if (!inputPath) {
    console.error("Error: --input is required (path to dataset bundle)");
    process.exit(2);
  }

  const dataset = loadDataset(inputPath);

  let scenario: CounterfactualScenario;
  const scenarioPath = flag(args, "--scenario");

  if (scenarioPath) {
    scenario = loadScenario(scenarioPath);
  } else if (
    hasFlag(args, "--strict-evidence") ||
    hasFlag(args, "--strict-handoff") ||
    hasFlag(args, "--closure-risk-sensitive") ||
    hasFlag(args, "--require-complete-review")
  ) {
    scenario = buildScenarioFromFlags(args);
  } else {
    console.error("Error: --scenario <path> or one of the scenario flags is required");
    process.exit(2);
  }

  const outcome = evaluateCounterfactual(dataset, scenario, {
    now: new Date().toISOString(),
  });

  const format = hasFlag(args, "--json") ? "json" : "text";
  process.stdout.write(formatReplayReport(outcome, format));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Handle `alix governance replay` subcommand.
 *
 * @param args - Remaining CLI arguments after "alix governance replay".
 */
export async function handleGovernanceReplayCommand(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "";

  switch (subcommand) {
    case "assemble":
      runAssemble(args.slice(1));
      return;
    case "evaluate":
      runEvaluate(args.slice(1));
      return;
    case "report":
      runReport(args.slice(1));
      return;
    default:
      console.error(
        "Usage: alix governance replay {assemble|evaluate|report} <lifecycle-id> --input <path> [--scenario <path>] [flags]\n" +
        "\n" +
        "Commands:\n" +
        "  assemble  Assemble a replay dataset for a lifecycle ID\n" +
        "  evaluate  Evaluate a counterfactual scenario against a dataset\n" +
        "  report    Render a replay report (text or --json)\n" +
        "\n" +
        "Scenario flags (use instead of --scenario):\n" +
        "  --strict-evidence            Require full evidence completeness\n" +
        "  --strict-handoff             Require all handoff evidence captured\n" +
        "  --closure-risk-sensitive     Downgrade readiness on high closure risk\n" +
        "  --require-complete-review    Treat needs_follow_up as unresolved\n" +
        "\n" +
        "Global flags:\n" +
        "  --input <path>  Path to dataset JSON bundle\n" +
        "  --scenario <path>  Path to scenario JSON file\n" +
        "  --json          Output in JSON format",
      );
      process.exit(2);
  }
}
