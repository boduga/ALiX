/**
 * workflow.ts — Workflow CLI commands for ALiX (P4.5c).
 *
 * Provides:
 * - `alix workflow status <issueNumber>`  — Show current state for an issue
 * - `alix workflow list`                   — List all active workflow entries
 * - `alix workflow transition <issueNumber> <state>` — Manually transition an issue
 *
 * @module
 */

import { join } from "node:path";
import { WorkflowCoordinator } from "../../workflow/coordinator.js";
import { WORKFLOW_STATES } from "../../workflow/types.js";
import type { WorkflowState } from "../../workflow/types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WORKFLOW_DIR = join(".alix", "workflow");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createCoordinator(cwd?: string): WorkflowCoordinator {
  const root = cwd ?? process.cwd();
  return new WorkflowCoordinator({ workflowDir: join(root, WORKFLOW_DIR) });
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

async function handleStatus(args: string[]): Promise<void> {
  const issueNumber = parseInt(args[0], 10);
  if (isNaN(issueNumber)) {
    console.error("Usage: alix workflow status <issueNumber>");
    process.exit(1);
  }

  const coordinator = createCoordinator();
  const entry = await coordinator.currentState(issueNumber);

  if (!entry) {
    console.log(`Issue #${issueNumber}: no workflow entry found.`);
    return;
  }

  console.log(`Issue #${entry.issueNumber}`);
  console.log(`State:      ${entry.state}`);
  console.log(`Agent:      ${entry.assignedAgent ?? "(none)"}`);
  console.log(`Started:    ${entry.startedAt}`);
  console.log(`Updated:    ${entry.updatedAt}`);
  console.log(`Evidence:   ${entry.evidenceFingerprints.length} record(s)`);
  if (entry.blockReason) console.log(`Block reason: ${entry.blockReason}`);
  if (entry.blockingItem) console.log(`Blocking:     ${entry.blockingItem}`);
  if (entry.prNumber) console.log(`PR:         #${entry.prNumber}`);
  if (entry.error) console.log(`Error:      ${entry.error}`);
}

async function handleList(): Promise<void> {
  const coordinator = createCoordinator();
  const active = await coordinator.listActive();

  if (active.length === 0) {
    console.log("No active workflow entries.");
    return;
  }

  // Header
  console.log(
    `${"Issue".padEnd(8)} ${"State".padEnd(26)} ${"Agent".padEnd(18)} Updated`,
  );
  console.log("-".repeat(75));

  for (const entry of active) {
    const issueStr = `#${entry.issueNumber}`.padEnd(8);
    const stateStr = entry.state.padEnd(26);
    const agentStr = (entry.assignedAgent ?? "—").padEnd(18);
    const updated = new Date(entry.updatedAt).toLocaleString();
    console.log(`${issueStr} ${stateStr} ${agentStr} ${updated}`);
  }

  console.log(`\n${active.length} active workflow(s)`);
}

async function handleTransition(args: string[]): Promise<void> {
  const issueNumber = parseInt(args[0], 10);
  const targetState = args[1] as WorkflowState;

  if (isNaN(issueNumber) || !targetState) {
    console.error("Usage: alix workflow transition <issueNumber> <state>");
    process.exit(1);
  }

  if (!WORKFLOW_STATES.has(targetState)) {
    console.error(
      `Unknown state: "${targetState}". Valid: ${Array.from(WORKFLOW_STATES).join(", ")}`,
    );
    process.exit(1);
  }

  const coordinator = createCoordinator();
  try {
    const entry = await coordinator.transition(issueNumber, targetState, {
      actor: "human",
      reason: "CLI manual transition",
    });
    console.log(`Issue #${issueNumber} → ${entry.state}`);
    if (entry.evidenceFingerprints.length > 0) {
      console.log(
        `Evidence:   ${entry.evidenceFingerprints[entry.evidenceFingerprints.length - 1]}`,
      );
    }
  } catch (err) {
    console.error(
      `Transition failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Handle all `alix workflow` subcommands.
 */
export async function handleWorkflowCommand(args: string[]): Promise<void> {
  const command = args[0] ?? "";

  switch (command) {
    case "status":
      await handleStatus(args.slice(1));
      break;
    case "list":
      await handleList();
      break;
    case "transition":
      await handleTransition(args.slice(1));
      break;
    default:
      console.error(`Unknown workflow subcommand: "${command}"`);
      console.error("Usage: alix workflow status|list|transition");
      console.error(
        "  status <issueNumber>       Show workflow state for an issue",
      );
      console.error("  list                       List active workflow entries");
      console.error(
        '  transition <issue> <state>  Manually transition an issue',
      );
      process.exit(1);
  }
}
