/**
 * recover.ts — CLI commands for crash recovery.
 *
 * Usage:
 *   alix recovery scan     — Read-only scan of all durable stores
 *   alix recovery inspect  — Show details for a specific finding or resource
 *   alix recovery repair   — Repair repairable findings (requires confirmation)
 *   alix recovery verify   — Run scan and confirm findings are healthy
 */

import { createInterface } from "node:readline";
import type { RecoveryFinding, RecoveryReport, RecoverySeverity } from "../../recovery/recovery-types.js";
import { DEFAULT_REPAIR_OPTIONS } from "../../recovery/recovery-types.js";
import { scan, reportSummary } from "../../recovery/recovery-scanner.js";
import { repair } from "../../recovery/recovery-repair.js";

function severityColor(s: RecoverySeverity): string {
  if (s === "critical") return "\x1b[31mCRITICAL\x1b[0m";
  if (s === "warning") return "\x1b[33mWARNING\x1b[0m";
  return "\x1b[36mINFO\x1b[0m";
}

function formatFindings(findings: RecoveryFinding[]): string {
  if (findings.length === 0) return "  No findings.\n";
  return findings.map(f => {
    const color = severityColor(f.severity);
    return `  [${f.id}] ${color} | ${f.subsystem} | ${f.kind}
         ${f.message}
         ${f.filePath ? `File: ${f.filePath}\n` : ""}
         ${f.repairable ? `  Repair: ${f.proposedAction ?? "auto"}` : "  Not repairable"}
         ${f.resourceId ? `Resource: ${f.resourceId}` : ""}`;
  }).join("\n\n") + "\n";
}

function formatReport(report: RecoveryReport, verbose: boolean): string {
  const lines: string[] = [];
  lines.push(`Recovery Report`);
  lines.push(`  Started: ${report.startedAt}`);
  lines.push(`  Completed: ${report.completedAt}`);
  lines.push(`  Total findings: ${report.totalFindings}`);
  lines.push(`  Critical: ${report.bySeverity.critical}`);
  lines.push(`  Warning: ${report.bySeverity.warning}`);
  lines.push(`  Info: ${report.bySeverity.info}`);
  if (report.repairAttempted) {
    lines.push(`  Repaired: ${report.repairedCount}/${report.totalFindings}`);
  }
  lines.push(`  Summary: ${report.summary}`);
  if (verbose && report.findings.length > 0) {
    lines.push("");
    lines.push("--- Findings ---");
    lines.push(formatFindings(report.findings));
  }
  return lines.join("\n");
}

// =========================================================================
// CLI command handlers
// =========================================================================

export async function cmdScan(args: string[]): Promise<void> {
  const root = process.cwd();
  const json = args.includes("--json");
  const verbose = args.includes("--verbose") || args.includes("-v");
  const minSeverity = args.includes("--critical") ? "critical" as const
    : args.includes("--warnings") ? "warning" as const
    : undefined;

  const report = await scan(root, { minSeverity });

  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return;
  }

  process.stdout.write(formatReport(report, verbose) + "\n");

  if (report.totalFindings > 0) {
    process.exitCode = 1;
  }
}

export async function cmdInspect(args: string[]): Promise<void> {
  const root = process.cwd();
  const json = args.includes("--json");
  const findingId = args.find(a => !a.startsWith("-"));

  const report = await scan(root);

  if (findingId) {
    const finding = report.findings.find(f => f.id === findingId);
    if (!finding) {
      process.stdout.write(`Finding "${findingId}" not found.\n`);
      process.exitCode = 1;
      return;
    }
    if (json) {
      process.stdout.write(JSON.stringify(finding, null, 2) + "\n");
    } else {
      process.stdout.write(`Finding: ${finding.id}\n`);
      process.stdout.write(`  Severity: ${finding.severity}\n`);
      process.stdout.write(`  Subsystem: ${finding.subsystem}\n`);
      process.stdout.write(`  Kind: ${finding.kind}\n`);
      process.stdout.write(`  Message: ${finding.message}\n`);
      if (finding.filePath) process.stdout.write(`  File: ${finding.filePath}\n`);
      if (finding.resourceId) process.stdout.write(`  Resource: ${finding.resourceId}\n`);
      process.stdout.write(`  Repairable: ${finding.repairable}\n`);
      if (finding.proposedAction) process.stdout.write(`  Proposed action: ${finding.proposedAction}\n`);
    }
    return;
  }

  // No ID: show summary
  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(formatReport(report, true) + "\n");
  }
}

export async function cmdRepair(args: string[]): Promise<void> {
  const root = process.cwd();
  const json = args.includes("--json");
  const dryRun = args.includes("--dry-run");
  const yes = args.includes("--yes") || args.includes("-y");

  if (dryRun) {
    const report = await repair(root, { execute: false, yes: true, json });
    if (json) {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    } else {
      process.stdout.write("[DRY RUN] " + formatReport(report, true) + "\n");
    }
    return;
  }

  // Show preview first
  const dryReport = await repair(root, { execute: false, yes: false, json: false });
  if (dryReport.totalFindings === 0) {
    process.stdout.write("No repairable findings. All stores healthy.\n");
    return;
  }

  if (!yes) {
    process.stdout.write(formatReport(dryReport, false) + "\n");
    process.stdout.write(`\nProceed with repair for ${dryReport.findings.filter(f => f.repairable).length} finding(s)? [y/N] `);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => rl.question("", resolve));
    rl.close();
    if (answer.toLowerCase() !== "y") {
      process.stdout.write("Cancelled.\n");
      return;
    }
    process.stdout.write("\n");
  }

  const report = await repair(root, { execute: true, yes: true, json: false });

  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(formatReport(report, true) + "\n");
  }
}

export async function cmdVerify(args: string[]): Promise<void> {
  const root = process.cwd();
  const json = args.includes("--json");

  // Run scan, then verify it found nothing critical or warning
  const report = await scan(root, { minSeverity: "warning" });

  if (json) {
    process.stdout.write(JSON.stringify({
      healthy: report.totalFindings === 0,
      ...report,
    }, null, 2) + "\n");
    return;
  }

  if (report.totalFindings === 0) {
    process.stdout.write("✅ All stores healthy. No findings.\n");
  } else {
    process.stdout.write(`❌ ${report.totalFindings} issue(s) found:\n`);
    process.stdout.write(formatFindings(report.findings));
    process.exitCode = 1;
  }
}
