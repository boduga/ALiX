/**
 * A0.4 — Evolution Governance Surface CLI.
 *
 * CLI for observing and acting on evolution lifecycle state.
 * Commands:
 *   alix governance evolution list            — list evolutions
 *   alix governance evolution show <id>       — show lifecycle history
 *   alix governance evolution evidence <id>   — show evidence records
 *   alix governance evolution decide <id>     — governance decision (A3)
 *
 * @module evolution-cli
 */

import type { EvolutionStateMachine, EvolutionSummary } from "../evolution/evolution-state-machine.js";
import type { ExecutionEvidenceStore } from "../runtime/execution-evidence-store.js";
import type { VerificationEvidenceLedger } from "../evolution/verification/evidence/evidence-ledger.js";
import type { GovernanceDecisionBridge } from "../evolution/governance/governance-decision-bridge.js";
import type { GovernancePolicyConfig } from "../evolution/governance/contracts/decision-contract.js";
import type { GovernanceDecisionStore } from "../evolution/governance/contracts/decision-store-contract.js";
import { runExecute } from "../evolution/execution/execution-cli.js";
import { runObserve } from "../evolution/observation/observation-cli.js";
import { ObservationEngine } from "../evolution/observation/observation-engine.js";
import { CliObservationProvider } from "../evolution/observation/providers/cli-provider.js";
import { FilesystemObservationProvider } from "../evolution/observation/providers/filesystem-provider.js";
import { GitObservationProvider } from "../evolution/observation/providers/git-provider.js";
import { LedgerObservationProvider } from "../evolution/observation/providers/ledger-provider.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isJsonMode(args: string[]): boolean {
  const idx = args.indexOf("--json");
  if (idx >= 0) {
    args.splice(idx, 1);
    return true;
  }
  return false;
}

function red(msg: string): string {
  return `\x1b[31m${msg}\x1b[0m`;
}

function bold(msg: string): string {
  return `\x1b[1m${msg}\x1b[0m`;
}

// ---------------------------------------------------------------------------
// Observation engine builder
// ---------------------------------------------------------------------------

function buildObservationEngine(deps: EvolutionCLIDeps): ObservationEngine {
  const engine = new ObservationEngine();
  engine.register(new CliObservationProvider());
  engine.register(new FilesystemObservationProvider());
  engine.register(new GitObservationProvider());
  engine.register(new LedgerObservationProvider(deps.evidenceStore));
  return engine;
}

// ---------------------------------------------------------------------------
// CLI Handler
// ---------------------------------------------------------------------------

export interface EvolutionCLIDeps {
  stateMachine: EvolutionStateMachine;
  evidenceStore: ExecutionEvidenceStore;
  decisionStore: GovernanceDecisionStore;
  // A3 Governance Decision deps (optional for backward compat)
  evidenceLedger?: VerificationEvidenceLedger;
  decisionBridge?: GovernanceDecisionBridge;
  policyConfig?: GovernancePolicyConfig;
}

export async function handleEvolutionCommand(
  args: string[],
  deps: EvolutionCLIDeps,
): Promise<void> {
  const sub = args[0];

  if (!sub || sub === "--help") {
    printHelp();
    return;
  }

  const jsonMode = isJsonMode(args);
  const id = args[1];

  switch (sub) {
    case "list":
      return runList(deps, jsonMode);
    case "show":
      if (!id) {
        console.log(red("Usage: alix governance evolution show <id>"));
        process.exitCode = 1;
        return;
      }
      return runShow(deps, id, jsonMode);
    case "evidence":
      if (!id) {
        console.log(red("Usage: alix governance evolution evidence <id>"));
        process.exitCode = 1;
        return;
      }
      return runEvidence(deps, id, jsonMode);
    case "decide":
      if (!id) {
        console.log(red("Usage: alix governance evolution decide <evolution-id> [--policy <name>] [--json]"));
        process.exitCode = 1;
        return;
      }
      if (!deps.evidenceLedger || !deps.decisionBridge) {
        console.log(red("Governance decision dependencies not configured (evidenceLedger and decisionBridge required)"));
        process.exitCode = 1;
        return;
      }
      {
        const { runDecide } = await import("../evolution/governance/governance-decision-cli.js");
        return runDecide({
          stateMachine: deps.stateMachine,
          evidenceLedger: deps.evidenceLedger,
          decisionBridge: deps.decisionBridge,
          policyConfig: deps.policyConfig,
        }, id, jsonMode, args.slice(1));
      }
    case "execute":
      if (!id) {
        console.log(red("Usage: alix governance evolution execute <evolution-id> [--dry-run] [--json]"));
        process.exitCode = 1;
        return;
      }
      return runExecute(id, { dryRun: args.includes("--dry-run"), jsonMode }, {
        stateMachine: deps.stateMachine,
        evidenceLedger: deps.evidenceLedger,
        decisionStore: deps.decisionStore,
      });
    case "observe":
      if (!id) {
        console.log(red("Usage: alix governance evolution observe <evolution-id> [--json] [--reevaluate]"));
        process.exitCode = 1;
        return;
      }
      await runObserve(id, {
        engine: buildObservationEngine(deps),
        evidenceStore: deps.evidenceStore,
      }, { jsonMode, reevaluate: args.includes("--reevaluate") });
      return;
    default:
      console.log(red(`Unknown evolution command: ${sub}`));
      printHelp();
      process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

async function runList(deps: EvolutionCLIDeps, jsonMode: boolean): Promise<void> {
  const summaries = deps.stateMachine.listEvolutions();

  if (jsonMode) {
    console.log(JSON.stringify(summaries, null, 2));
    return;
  }

  if (summaries.length === 0) {
    console.log("No evolutions found.");
    return;
  }

  console.log(bold(`Evolutions (${summaries.length}):`));
  console.log("");

  for (const s of summaries) {
    const target = s.targetKind ?? "-";
    const time = s.createdAt ?? "-";
    console.log(`  ${s.evolutionId.padEnd(20)} ${s.state.padEnd(14)} ${target.padEnd(16)} ${time}`);
  }

  console.log("");

  // Count by state
  const counts = new Map<string, number>();
  for (const s of summaries) {
    counts.set(s.state, (counts.get(s.state) ?? 0) + 1);
  }
  const parts = Array.from(counts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}: ${v}`);
  console.log(parts.join(" | "));
}

// ---------------------------------------------------------------------------
// Show
// ---------------------------------------------------------------------------

async function runShow(deps: EvolutionCLIDeps, id: string, jsonMode: boolean): Promise<void> {
  let state: string;
  try {
    state = deps.stateMachine.getStatus(id);
  } catch {
    console.log(red(`Evolution not found: ${id}`));
    process.exitCode = 1;
    return;
  }

  const history = deps.stateMachine.getHistory(id);
  const meta = deps.stateMachine.getMetadata(id);

  if (jsonMode) {
    console.log(JSON.stringify({
      evolutionId: id,
      state,
      target: meta ? { kind: meta.targetKind, id: meta.targetId } : {},
      origin: meta?.origin,
      riskClass: meta?.riskClass,
      expectedEffect: meta?.expectedEffect,
      history: history.map((h) => ({
        from: h.from,
        to: h.to,
        eventType: h.eventType,
        timestamp: h.timestamp,
      })),
      historyLength: history.length,
    }, null, 2));
    return;
  }

  console.log(bold(`Evolution: ${id}`));
  console.log("");
  if (meta?.targetKind) {
    const targetText = meta.targetId ? `${meta.targetKind} (${meta.targetId})` : meta.targetKind;
    console.log(`  Target:   ${targetText}`);
  }
  if (meta?.origin) console.log(`  Origin:   ${meta.origin}`);
  if (meta?.riskClass) console.log(`  Risk:     ${meta.riskClass}`);
  console.log(`  State:    ${state}`);
  console.log("");

  if (history.length === 0) {
    console.log("  No history.");
    return;
  }

  console.log(`  History (${history.length} events, chronological):`);
  console.log("");
  for (const h of history) {
    console.log(`    ${h.from} → ${h.to}`);
    console.log(`      ${h.timestamp}  —  ${h.eventType}`);
  }
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

async function runEvidence(deps: EvolutionCLIDeps, id: string, jsonMode: boolean): Promise<void> {
  // Verify the evolution exists in the state machine
  try {
    deps.stateMachine.getStatus(id);
  } catch {
    console.log(red(`Evolution not found: ${id}`));
    process.exitCode = 1;
    return;
  }

  const evidence = await deps.evidenceStore.getByIntentId(id);

  if (jsonMode) {
    console.log(JSON.stringify({
      evolutionId: id,
      evidence: evidence.map((e) => ({
        evidenceId: e.evidenceId,
        eventType: extractEventType(e.summary),
        outcome: e.outcome,
        timestamp: e.startedAt,
      })),
      totalEvidence: evidence.length,
    }, null, 2));
    return;
  }

  if (evidence.length === 0) {
    console.log(`No evidence found for evolution: ${id}`);
    return;
  }

  console.log(bold(`Evidence for ${id} (${evidence.length} records):`));
  console.log("");
  for (const e of evidence) {
    const eventType = extractEventType(e.summary);
    console.log(`  ${e.evidenceId.padEnd(14)} ${eventType.padEnd(30)} ${e.startedAt}  ${e.outcome}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the event type from an evidence summary string.
 * Summaries follow the format: "Execution <eventType>: <from> → <to>"
 * For evolution events: "Evolution <eventType>: <from> → <to>"
 */
function extractEventType(summary: string): string {
  const colonIdx = summary.indexOf(":");
  if (colonIdx === -1) return summary;
  const beforeColon = summary.slice(0, colonIdx);
  const spaceIdx = beforeColon.lastIndexOf(" ");
  if (spaceIdx === -1) return beforeColon;
  return beforeColon.slice(spaceIdx + 1);
}

function printHelp(): void {
  console.log("Usage: alix governance evolution <command> [options]");
  console.log("");
  console.log("Commands:");
  console.log("  list              List all tracked evolutions");
  console.log("  show <id>         Show lifecycle history for an evolution");
  console.log("  evidence <id>     Show evidence records for an evolution");
  console.log("  decide <id>       Run governance decision on an evolution (A3)");
  console.log("  execute <id>      Execute an approved evolution (A4)");
  console.log("  observe <id>      Run outcome observations on an executed evolution (A5)");
  console.log("");
  console.log("Options:");
  console.log("  --json            Machine-readable JSON output");
  console.log("");
  console.log("Decide options:");
  console.log("  --policy <name>   Named policy config (default: default)");
}
