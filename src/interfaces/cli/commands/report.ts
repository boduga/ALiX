/**
 * report.ts — Report artifact commands for M0.10-E.
 *
 * Provides list/show/open/path subcommands for alix report.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export async function runReportCommand(args: string[]): Promise<void> {
  const cmd = args[0];
  const cwd = process.cwd();
  const reportsDir = join(cwd, ".alix", "reports");

  switch (cmd) {

    case "list": {
      if (!existsSync(reportsDir)) { console.log("No reports found."); process.exit(0); }
      const dirs = (await readdir(reportsDir, { withFileTypes: true })).filter(d => d.isDirectory());
      if (dirs.length === 0) { console.log("No reports found."); process.exit(0); }
      console.log("Reports:\n");
      for (const d of dirs.sort((a, b) => b.name.localeCompare(a.name))) {
        const manifestPath = join(reportsDir, d.name, "run_manifest.json");
        if (!existsSync(manifestPath)) continue;
        try {
          const m = JSON.parse(await readFile(manifestPath, "utf-8"));
          const date = m.createdAt ? new Date(m.createdAt).toLocaleDateString() : "?";
          console.log(`  ${d.name.padEnd(30)} ${date.padEnd(12)} ${String(m.status || "?").padEnd(10)} ${(m.topic || "").slice(0, 60)}`);
        } catch { /* skip unreadable */ }
      }
      process.exit(0);
    }

    case "show": {
      const reportId = args[1];
      if (!reportId) { console.error("Usage: alix report show <reportId>"); process.exit(1); }
      const manifestPath = join(reportsDir, reportId, "run_manifest.json");
      if (!existsSync(manifestPath)) { console.error(`Report not found: ${reportId}`); process.exit(1); }
      const m = JSON.parse(await readFile(manifestPath, "utf-8"));
      console.log(`Report:    ${m.reportId || reportId}`);
      console.log(`SOP:       ${m.sopId || "?"}`);
      console.log(`Topic:     ${m.topic || "?"}`);
      console.log(`Graph:     ${m.graphId || "?"}`);
      console.log(`Status:    ${m.status || "?"}`);
      console.log(`Created:   ${m.createdAt || "?"}`);
      console.log(`Path:      .alix/reports/${reportId}/\n`);
      if (m.nodeResults?.length > 0) {
        console.log("Nodes:");
        for (const n of m.nodeResults) {
          console.log(`  ${n.status === "done" ? "✓" : "✗"} ${n.title}`);
        }
        console.log();
      }
      console.log("Artifacts:");
      const files = await readdir(join(reportsDir, reportId));
      for (const f of files.sort()) {
        if (f === "run_manifest.json") continue;
        console.log(`  ${f}`);
      }
      process.exit(0);
    }

    case "open": {
      const reportId = args[1];
      if (!reportId) { console.error("Usage: alix report open <reportId>"); process.exit(1); }
      const reportPath = join(reportsDir, reportId, "final_report.md");
      if (!existsSync(reportPath)) { console.error(`Report not found: ${reportId} (no final_report.md)`); process.exit(1); }
      const content = await readFile(reportPath, "utf-8");
      console.log(content);
      process.exit(0);
    }

    case "path": {
      const reportId = args[1];
      if (!reportId) { console.error("Usage: alix report path <reportId>"); process.exit(1); }
      const reportDir = join(cwd, ".alix", "reports", reportId);
      if (!existsSync(reportDir)) { console.error(`Report not found: ${reportId}`); process.exit(1); }
      console.log(reportDir);
      process.exit(0);
    }

    default:
      console.log("Usage: alix report list | alix report show <id> | alix report open <id> | alix report path <id>");
      process.exit(0);
  }
}
