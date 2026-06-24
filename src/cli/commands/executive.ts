/**
 * P10.0 — Executive subcommand dispatcher.
 *
 * Top-level entry point for `alix executive ...`. Currently only supports
 * `dashboard`. Future subcommands (P10.1+ priority, P10.2 objectives)
 * will add cases here.
 *
 * @module
 */

// NOTE: Spec P10.0 plan line 873 calls for `export async function runDashboard`
// in the handler, but Task 7's implementation exports `runExecutiveDashboard`.
// We re-export it here under the spec-mandated name so this dispatcher stays
// the single boundary the spec describes and downstream consumers (cli.ts,
// future tests) can import `runDashboard` from this module.
import { runExecutiveDashboard } from "./executive-dashboard-handler.js";

export { runExecutiveDashboard as runDashboard };

export async function handleExecutiveCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case "dashboard":
      return runExecutiveDashboard(rest);
    default:
      console.error(`Unknown executive subcommand: ${subcommand ?? "(none)"}`);
      console.error("Available: dashboard");
      process.exit(1);
  }
}
