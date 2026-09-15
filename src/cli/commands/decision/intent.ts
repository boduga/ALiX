/**
 * P6.0a — decision CLI command.
 *
 * Provides:
 * - `alix decision context <proposal-id>` — render DecisionContext as formatted terminal output
 * - `alix decision context <proposal-id> --json` — output DecisionContext as JSON
 * - `alix decision risk <proposal-id>` — render RiskScore (P6.0b)
 * - `alix decision recommend <proposal-id>` — render ApprovalRecommendation (P6.1)
 * - `alix decision queue` — render prioritized operator queue (P6.2)
 * - `alix decision brief` — render strategic brief (P6.3)
 * - `alix decision status` — render pipeline health report (P6.6a)
 * - `alix decision review <proposal-id>` — live governance lens review (P6.5b)
 * - `alix decision outcome record <subject-id>` — record a decision outcome (P7a)
 * - `alix decision outcome show <subject-id>` — show recorded outcomes (P7a)
 * - `alix decision outcome report [--window N] [--json]` — accuracy report (P7b)
 *
 * @module
 */
import { join } from "node:path";
import { AdaptationProposalStore } from "../../../adaptation/adaptation-proposal-store.js";
import "../../../adaptation/strategic-brief-types.js";
import { IntentStore } from "../../../adaptation/intent-store.js";
import "../../../adaptation/execution-intent-types.js";
import { INTENTS_DIR } from "./shared.js";

// ---------------------------------------------------------------------------
// Constants — .alix path conventions (matches adaptation.ts pattern)
// ---------------------------------------------------------------------------

export async function runIntent(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === "list") {
    await runIntentList();
    return;
  }

  if (subcommand === "show") {
    const id = args[1];
    if (!id) {
      console.error("Usage: alix decision intent show <id>");
      process.exit(1);
    }
    await runIntentShow(id);
    return;
  }

  if (subcommand === "propose") {
    const id = args[1];
    if (!id) {
      console.error("Usage: alix decision intent propose <intent-id>");
      process.exit(1);
    }
    await runIntentPropose(id);
    return;
  }

  console.error(`Unknown intent subcommand: "${subcommand}"`);
  console.error("Usage: alix decision intent list | intent show <id> | intent propose <intent-id>");
  process.exit(1);
}

export async function runIntentList(): Promise<void> {
  const store = new IntentStore(INTENTS_DIR);
  const intents = await store.list();

  if (intents.length === 0) {
    console.log("No execution intents captured.");
    return;
  }

  console.log(`Execution intents (${intents.length}):\n`);
  for (const intent of intents) {
    const icon = statusIcon(intent.status);
    const shortId = intent.id.length > 30 ? intent.id.slice(0, 27) + "..." : intent.id;
    console.log(`${icon} ${shortId}`);
    console.log(`   Source:  ${intent.source}${intent.skillId ? ` (${intent.skillId})` : ""}`);
    console.log(`   Status:  ${intent.status}`);
    console.log(`   Summary: ${intent.outputSummary.slice(0, 80)}${intent.outputSummary.length > 80 ? "..." : ""}`);
    console.log();
  }
}

export async function runIntentShow(id: string): Promise<void> {
  const store = new IntentStore(INTENTS_DIR);
  const intent = await store.get(id);

  if (!intent) {
    console.error(`Intent not found: ${id}`);
    process.exit(1);
  }

  console.log(JSON.stringify(intent, null, 2));
}

export function statusIcon(status: string): string {
  switch (status) {
    case "captured":   return "\u{1F4E5}";  // inbox tray
    case "proposed":   return "\u{1F4DD}";  // memo
    case "discarded":  return "\u{1F5D1}️";  // wastebasket
    default:           return "⚪";  // white circle
  }
}

export async function runIntentPropose(id: string): Promise<void> {
  const intentStore = new IntentStore(INTENTS_DIR);
  const intent = await intentStore.get(id);

  if (!intent) {
    console.error(`Intent not found: ${id}`);
    process.exit(1);
  }

  // Validate: only "captured" intents can be proposed
  if (intent.status !== "captured") {
    console.error(
      `Intent ${id} status is "${intent.status}" — only "captured" intents can be proposed`,
    );
    process.exit(1);
  }

  // Validate: must have proposedAction + proposedTarget
  if (!intent.proposedAction || !intent.proposedTarget) {
    console.error(
      `Intent ${id} has no proposedAction or proposedTarget — cannot map to proposal`,
    );
    process.exit(1);
  }

  const { IntentProposalMapper } = await import(
    "../../../adaptation/intent-proposal-mapper.js"
  );

  const proposalsDir = join(process.cwd(), ".alix", "adaptation", "proposals");
  const proposalStore = new AdaptationProposalStore(proposalsDir);
  const mapper = new IntentProposalMapper(proposalStore);

  const result = await mapper.mapToProposal(intent, intentStore);

  if (!result.success) {
    console.error(`Proposal mapping failed: ${result.errors.join("; ")}`);
    process.exit(1);
  }

  console.log(`✅ Proposal created: ${result.proposal!.id}`);
  console.log(`  Intent:   ${id}`);
  console.log(`  Action:   ${result.proposal!.action}`);
  console.log(`  Target:   ${JSON.stringify(result.proposal!.target)}`);
  console.log(`  Status:   ${result.proposal!.status}`);
  console.log();
  console.log(`═══ NEXT STEPS ═══`);
  console.log(
    `Proposal created. Use \`alix decision approve ${result.proposal!.id}\``,
  );
  console.log(
    `and \`alix decision apply ${result.proposal!.id}\` to execute.`,
  );
  console.log();
}
