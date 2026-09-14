// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A1 — CLI handler for `alix governance evolution discover [--json]`.
 *
 * Production entry point for the pattern-discovery subsystem (#709):
 * runs the PatternDiscoveryEngine over execution evidence + governance
 * audit events, then intakes candidates into the EvolutionStateMachine
 * as PROPOSED evolutions (proposal-only — intake never transitions).
 *
 * Engine + strategy construction lives here, co-located with the engine
 * contract (mirrors the A8 `learn` / A9 `forecast` seams). The caller
 * (governance.ts composer) owns store/state-machine construction from cwd.
 *
 * NOTE: the state machine is in-memory per invocation (same caveat as the
 * `evolution` read-only CLI) — registered proposals are reported, not
 * persisted. A persistent ledger is a separate increment.
 *
 * @module discovery-cli
 */

import type { ExecutionEvidenceStore } from "../../runtime/execution-evidence-store.js";
import type { AuditStore } from "../../governance/audit-store.js";
import type { EvolutionStateMachine } from "../evolution-state-machine.js";
import { PatternDiscoveryEngine } from "./pattern-discovery-engine.js";
import {
  DefaultEvolutionProposalGenerator,
} from "./evolution-proposal-generator.js";
import { ExecutionFailureStrategy } from "./strategies/execution-failure-strategy.js";
import { ApprovalFrictionStrategy } from "./strategies/approval-friction-strategy.js";
import { PerformanceDegradationStrategy } from "./strategies/performance-degradation-strategy.js";
import { GovernanceGapStrategy } from "./strategies/governance-gap-strategy.js";
import { DefaultGovernanceIntakeAdapter } from "./governance-intake-adapter.js";

export interface RunDiscoverCliOpts {
  readonly evidenceStore: ExecutionEvidenceStore;
  readonly auditStore: AuditStore;
  readonly stateMachine: EvolutionStateMachine;
  readonly json: boolean;
}

/**
 * CLI handler for `alix governance evolution discover [--json]`.
 *
 * Returns a structured `{ output, exitCode }` pair. Caller prints
 * `output` and exits with `exitCode`.
 */
export async function runDiscoverCli(
  opts: RunDiscoverCliOpts,
): Promise<{ readonly output: string; readonly exitCode: 0 | 1 }> {
  const generator = new DefaultEvolutionProposalGenerator();
  const engine = new PatternDiscoveryEngine({
    evidenceStore: opts.evidenceStore,
    auditStore: opts.auditStore,
    strategies: [
      new ExecutionFailureStrategy(),
      new ApprovalFrictionStrategy(),
      new PerformanceDegradationStrategy(),
      new GovernanceGapStrategy(),
    ],
    generator,
  });

  const result = await engine.run();

  const adapter = new DefaultGovernanceIntakeAdapter(generator);
  const intake = await adapter.intake(result.candidates, opts.stateMachine);

  if (opts.json) {
    return {
      output: JSON.stringify(
        {
          patterns: result.patterns,
          candidates: result.candidates,
          intake: {
            registered: intake.registered.map((p) => p.evolutionId),
            failed: intake.failed,
          },
          metadata: result.metadata,
        },
        null,
        2,
      ),
      exitCode: 0,
    };
  }

  const lines: string[] = [];
  lines.push(
    `Discovery run: ${result.patterns.length} pattern(s) from ` +
      `${result.metadata.evidenceScanned} evidence + ${result.metadata.governanceEventsScanned} governance events ` +
      `(${result.metadata.strategiesRun} strategies, ${result.metadata.detectionDurationMs}ms).`,
  );
  for (const p of result.patterns) {
    lines.push(`  - [${p.category}] ${p.patternId}: ${p.description} (x${p.frequency}, conf ${p.confidence})`);
  }
  lines.push(`Candidates: ${result.candidates.length}`);
  lines.push(
    `Intake: ${intake.registered.length} registered as PROPOSED, ${intake.failed.length} failed.`,
  );
  for (const proposal of intake.registered) {
    lines.push(`  - ${proposal.evolutionId}`);
  }
  for (const failure of intake.failed) {
    lines.push(`  ! ${failure.candidateId}: ${failure.reason}`);
  }
  if (result.metadata.strategiesFailed?.length) {
    lines.push(`Strategies failed (isolated): ${result.metadata.strategiesFailed.join(", ")}`);
  }

  return { output: lines.join("\n"), exitCode: 0 };
}
