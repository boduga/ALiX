/**
 * P10.0 — Executive subcommand dispatcher.
 *
 * Top-level entry point for `alix executive ...`. Currently only supports
 * `dashboard`. Future subcommands (P10.1+ priority, P10.2 objectives)
 * will add cases here.
 *
 * @module
 */

import { runDashboard } from "./executive-dashboard-handler.js";

export { runDashboard };

export async function handleExecutiveCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case "dashboard":
      return runDashboard(rest);
    default:
      console.error(`Unknown executive subcommand: ${subcommand ?? "(none)"}`);
      console.error("Available: dashboard");
      process.exit(1);
  }
}