/**
 * P29.3 — Governance Report CLI Handler.
 *
 * `alix governance report` subcommands:
 *   compliance — render a CompliancePackage from a P24 bundle JSON file
 *
 * CLI invariants:
 *   - read-only: no writes to governance stores, no audit emitters
 *   - --output writes to user-specified path only (not to .alix/)
 *   - no policy mutation, no threshold changes, no auto-adoption
 *   - no execution adapters, no approval/handoff/closure writers
 *   - no operator ranking
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";

import {
  renderComplianceJson,
  renderComplianceText,
} from "../../governance/governance-reporting-export.js";
import type { CompliancePackage } from "../../governance/governance-reporting-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flag(args: string[], name: string): string | null {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

// ---------------------------------------------------------------------------
// Bundle loader
// ---------------------------------------------------------------------------

function loadCompliancePackage(path: string): CompliancePackage {
  if (!existsSync(path)) {
    throw new Error(`Compliance package file not found: "${path}"`);
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    throw new Error(
      `Failed to read compliance package file "${path}": ${(err as Error).message}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse compliance package file "${path}": ${(err as Error).message}`,
    );
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("packageId" in (parsed as Record<string, unknown>))
  ) {
    throw new Error(
      `Invalid compliance package in "${path}": missing packageId`,
    );
  }
  return parsed as CompliancePackage;
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

/**
 * Handle `alix governance report compliance --p24-bundle <path> [--json] [--output <path>]`.
 */
function handleCompliance(args: string[], _opts: { cwd: string }): void {
  const bundlePath = flag(args, "--p24-bundle");
  if (!bundlePath) {
    console.error("Error: --p24-bundle <path> is required");
    console.error(
      "Usage: alix governance report compliance --p24-bundle <path> [--json] [--output <path>]",
    );
    process.exit(2);
  }

  const jsonMode = hasFlag(args, "--json");
  const outputPath = flag(args, "--output");

  // Load the CompliancePackage from the bundle file
  let pkg: CompliancePackage;
  try {
    pkg = loadCompliancePackage(bundlePath);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  // Render
  const output = jsonMode ? renderComplianceJson(pkg) : renderComplianceText(pkg);

  // Write to output file or stdout
  if (outputPath) {
    try {
      writeFileSync(outputPath, output, "utf-8");
      console.log(`Compliance report written to: ${outputPath}`);
    } catch (err) {
      console.error(
        `Failed to write compliance report to "${outputPath}": ${(err as Error).message}`,
      );
      process.exit(1);
    }
  } else {
    process.stdout.write(output);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Handle `alix governance report` subcommand.
 *
 * Routes sub-subcommands:
 *   - `compliance` → handleCompliance
 *
 * @param args - Remaining CLI arguments after "alix governance report".
 * @param opts  - Runtime options (cwd).
 */
export async function handleGovernanceReportCommand(
  args: string[],
  opts: { cwd: string },
): Promise<void> {
  const subcommand = args[0] ?? "";

  switch (subcommand) {
    case "compliance":
      handleCompliance(args.slice(1), opts);
      return;
    default:
      console.error(
        "Usage: alix governance report compliance --p24-bundle <path> [--json] [--output <path>]\n" +
        "\n" +
        "Subcommands:\n" +
        "  compliance  Render a compliance report from a P24 bundle\n" +
        "\n" +
        "Options:\n" +
        "  --p24-bundle <path>  Path to P24 compliance bundle JSON file\n" +
        "  --json               Output in JSON format\n" +
        "  --output <path>      Write output to file instead of stdout",
      );
      process.exit(2);
  }
}
