/**
 * P5.0g — Reflection CLI command.
 *
 * Provides:
 * - `alix reflection report` — Generate a reflection report with
 *   observability metrics, observations, and recommendations from all
 *   four analyzers (Evidence, Workflow, Capability, Quality).
 *
 * @module
 */

import { join } from "node:path";
import { EvidenceStore } from "../../../governance/security/evidence/evidence-store.js";
import { WorkflowCoordinator } from "../../../coordination/workflow/coordinator.js";
import { EvidenceAnalyzer } from "../../../planning/reflection/evidence-analyzer.js";
import { WorkflowAnalyzer } from "../../../planning/reflection/workflow-analyzer.js";
import { CapabilityAnalyzer } from "../../../planning/reflection/capability-analyzer.js";
import { QualityAnalyzer } from "../../../planning/reflection/quality-analyzer.js";
import { ReflectionAgent } from "../../../planning/reflection/reflection-agent.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Evidence store directory relative to cwd (P4.4 convention). */
const EVIDENCE_DIR = join(".alix", "security");

/** Workflow state directory relative to cwd (P4.5 convention). */
const WORKFLOW_DIR = join(".alix", "workflow");

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

/**
 * Handle `alix reflection report`.
 *
 * Wires up EvidenceStore, WorkflowCoordinator, all four analyzers, and
 * the ReflectionAgent. Runs the report generation and outputs the
 * resulting JSON to stdout.
 */
export async function handleReflectionCommand(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "";

  if (subcommand === "report") {
    await runReport();
  } else {
    console.error(`Unknown reflection subcommand: "${subcommand}"`);
    console.error("Usage: alix reflection report");
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function runReport(): Promise<void> {
  const cwd = process.cwd();

  // Phase 1: Create infrastructure
  const store = new EvidenceStore({ storeDir: join(cwd, EVIDENCE_DIR) });
  const coordinator = new WorkflowCoordinator({ workflowDir: join(cwd, WORKFLOW_DIR) });

  // Phase 2: Create all four analyzers
  const evidenceAnalyzer = new EvidenceAnalyzer(store);
  const workflowAnalyzer = new WorkflowAnalyzer(coordinator);
  const capabilityAnalyzer = new CapabilityAnalyzer(store);
  const qualityAnalyzer = new QualityAnalyzer(store);

  // Phase 3: Compose ReflectionAgent with constructor-injected analyzers
  const agent = new ReflectionAgent(
    [evidenceAnalyzer, workflowAnalyzer, capabilityAnalyzer, qualityAnalyzer],
    store,
  );

  // Phase 4: Generate and output the report
  const report = await agent.generateReport();

  console.log(JSON.stringify(report, null, 2));
}
