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
import "../../../adaptation/strategic-brief-types.js";
import "../../../adaptation/execution-intent-types.js";
import { runContext, runRecommend, runRisk } from "./context-risk.js";
import { runIntent } from "./intent.js";
import { runOutcome } from "./outcome.js";
import { runBrief, runQueue, runStatus } from "./queue-brief.js";
import { runReview } from "./review.js";

// ---------------------------------------------------------------------------
// Constants — .alix path conventions (matches adaptation.ts pattern)
// ---------------------------------------------------------------------------


export async function handleDecisionCommand(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "";
  const rest = args.slice(1);

  switch (subcommand) {
    case "context":
      await runContext(rest);
      return;
    case "risk":
      await runRisk(rest);
      return;
    case "recommend":
      await runRecommend(rest);
      return;
    case "queue":
      await runQueue(rest);
      return;
    case "brief":
      await runBrief(rest);
      return;
    case "status":
      await runStatus(rest);
      return;
    case "review":
      await runReview(rest);
      return;
    case "outcome":
      await runOutcome(rest);
      return;
    case "intent":
      await runIntent(rest);
      return;
    default:
      console.error(`Unknown decision subcommand: "${subcommand}"`);
      console.error("Usage: alix decision context <proposal-id> [--json] | risk <proposal-id> [--json] | recommend <proposal-id> [--json] | queue [--json] [--limit N] | brief [--window N] [--json] | status [--window N] [--json] | review <proposal-id> [--json] [--lens <name>] | outcome <subcommand> ... | intent <subcommand> ...");
      process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// runContext
// ---------------------------------------------------------------------------
