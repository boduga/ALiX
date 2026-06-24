/**
 * P9.5 — Governance Dashboard CLI handler.
 *
 * Extracted to its own file so the dashboard sentinel can scan a precise
 * target. See tests/governance/governance-dashboard-sentinels.vitest.ts.
 *
 * @module
 */

import { buildGovernanceDashboardReport } from "../../governance/governance-dashboard.js";
import { renderGovernanceDashboard } from "./governance-dashboard-renderer.js";

export async function runDashboard(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");

  let windowDays = 90;
  const windowIdx = args.indexOf("--window");
  if (windowIdx !== -1 && windowIdx + 1 < args.length) {
    const parsed = parseInt(args[windowIdx + 1], 10);
    if (isNaN(parsed) || parsed <= 0) {
      console.error("Error: --window requires a positive integer");
      process.exit(1);
    }
    windowDays = parsed;
  }

  const report = await buildGovernanceDashboardReport({
    cwd: process.cwd(),
    windowDays,
  });

  renderGovernanceDashboard(report, { jsonMode });
}
