/**
 * P10.9 — Executive Dashboard CLI handler.
 *
 * Coordinates full dashboard pipeline:
 * 1. Parse CLI flags
 * 2. Load dashboard snapshot (async I/O)
 * 3. Build dashboard report (pure)
 * 4. Render (terminal or JSON)
 *
 * Replaces P10.0/P10.1 dashboard which built health reports and planning
 * engines — moved upstream to respective milestones.
 *
 * @module
 */

import { loadDashboardSnapshot } from "../../executive/executive-dashboard-loader.js";
import { buildDashboardReport } from "../../executive/executive-dashboard.js";
import type { ExecutiveDashboardReport } from "../../executive/executive-dashboard.js";
import { renderTerminalDashboard } from "./executive-dashboard-renderer.js";

const DEFAULT_SINCE_DAYS = 30;

export async function runDashboard(args: string[]): Promise<void> {
  const brief = args.includes("--brief");
  const useJson = args.includes("--json");

  const sinceIndex = args.indexOf("--since");
  const sinceDays = sinceIndex !== -1 && sinceIndex + 1 < args.length
    ? Math.max(1, parseInt(args[sinceIndex + 1], 10) || DEFAULT_SINCE_DAYS)
    : DEFAULT_SINCE_DAYS;

  const subIdx = args.indexOf("--subsystem");
  const subsystemFilter = subIdx !== -1 && subIdx + 1 < args.length
    ? args[subIdx + 1]
    : undefined;

  const cwd = process.cwd();

  const snapshot = await loadDashboardSnapshot(cwd, sinceDays);
  const report = buildDashboardReport(snapshot, { brief, subsystemFilter });

  if (useJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    renderTerminalDashboard(report, brief);
  }
}
