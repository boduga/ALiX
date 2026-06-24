/**
 * P10.0 — Executive Dashboard CLI handler.
 *
 * Extracted to its own file so the executive sentinel can scan a precise
 * target. Mirrors P9.5's governance-dashboard-handler pattern.
 *
 * @module
 */

import { buildExecutiveHealthReport } from "../../executive/executive-health.js";
import { renderExecutiveDashboard } from "./executive-dashboard-renderer.js";

export async function runExecutiveDashboard(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");

  let windowDays = 90;
  const windowIdx = args.indexOf("--window");
  if (windowIdx !== -1) {
    if (windowIdx + 1 >= args.length) {
      console.error("Error: --window requires a positive integer");
      process.exit(1);
    }
    const parsed = parseInt(args[windowIdx + 1], 10);
    if (isNaN(parsed) || parsed <= 0) {
      console.error("Error: --window requires a positive integer");
      process.exit(1);
    }
    windowDays = parsed;
  }

  const report = await buildExecutiveHealthReport({
    cwd: process.cwd(),
    windowDays,
  });

  renderExecutiveDashboard(report, { jsonMode });
}