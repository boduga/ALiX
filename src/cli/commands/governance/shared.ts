/**
 * P9.0f — `alix governance` CLI dispatcher + terminal renderers.
 *
 * Five subcommands, each consuming one or more P9 builders:
 *   - health  — buildGovernanceHealth + buildGovernanceAssessment
 *   - drift   — detectGovernanceDrift
 *   - lens-review — reviewLenses
 *   - integrity — buildGovernanceIntegrity
 *   - recommend — generateRecommendations (P9.1)
 *
 * Each subcommand stores its artifact via GovernanceStore.append() and renders
 * either ANSI-colored terminal output or raw JSON.
 *
 * CORE INVARIANT: this module NEVER writes any P8 store. It only calls P9
 * builders (which are read-only analysers) and GovernanceStore (the single
 * permitted P9 write target). Sentinel-enforced.
 *
 * @module
 */

import "node:path";
import "node:crypto";
import "../../../governance/governance-store.js";
import "../../../governance/investigation-store.js";
import "../../../governance/governance-recommendation-generator.js";
import "../../../governance/investigation-generator.js";
import "../../../governance/investigation-compat.js";
import "../governance-dashboard-handler.js";
// A8 T7 imports — learning CLI surface (4-adapter construction, per A8
// wayfinder map #517 locked ruling). Imports are dynamic-free at module
// scope to keep the seam file's load graph small.
import "../../../evolution/learning/learning-cli.js";
// A9 Slice 5 — pre-execution risk forecast CLI surface.
import "../../../evolution/forecast/forecast-cli.js";
import "../../../events/event-log.js";

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

export const RESET = "\x1b[0m";

export const BOLD = "\x1b[1m";

export const DIM = "\x1b[2m";

export const GREEN = "\x1b[32m";

export const YELLOW = "\x1b[33m";

export const RED = "\x1b[31m";

export const CYAN = "\x1b[36m";

export const MAGENTA = "\x1b[35m";


export function colorForSeverity(severity: string): string {
  switch (severity) {
    case "critical":
    case "high":
      return RED;
    case "medium":
      return YELLOW;
    case "low":
      return GREEN;
    default:
      return RESET;
  }
}


export function colorForRecommendation(rec: string): string {
  switch (rec) {
    case "retire":
      return RED;
    case "demote":
      return YELLOW;
    case "promote":
      return GREEN;
    case "keep":
      return CYAN;
    default:
      return RESET;
  }
}


export function colorForRate(rate: number): string {
  if (rate >= 80) return GREEN;
  if (rate >= 50) return YELLOW;
  return RED;
}


// ---------------------------------------------------------------------------
// Flag parsing
// ---------------------------------------------------------------------------

export interface ParsedOpts {
  windowDays: number;
  jsonMode: boolean;
}


export function parseFlags(args: string[]): ParsedOpts {
  const jsonMode = args.includes("--json");
  const windowIdx = args.indexOf("--window");
  let windowDays = 90;

  if (windowIdx !== -1) {
    if (windowIdx + 1 >= args.length) {
      console.error("Error: --window requires a value (positive integer)");
      process.exit(1);
    }
    const parsed = parseInt(args[windowIdx + 1], 10);
    if (isNaN(parsed) || parsed <= 0) {
      console.error("Error: --window requires a positive integer");
      process.exit(1);
    }
    windowDays = parsed;
  }

  return { windowDays, jsonMode };
}


export const VALID_PRIORITIES = ["low", "medium", "high", "critical"] as const;

export const VALID_SOURCES = ["health", "drift", "lens-review", "integrity"] as const;


export interface ParsedRecommendOpts {
  windowDays: number;
  jsonMode: boolean;
  priority: (typeof VALID_PRIORITIES)[number] | null;
  source: (typeof VALID_SOURCES)[number] | null;
}


export function parseRecommendFlags(args: string[]): ParsedRecommendOpts {
  const jsonMode = args.includes("--json");

  const windowIdx = args.indexOf("--window");
  let windowDays = 30;
  if (windowIdx !== -1) {
    if (windowIdx + 1 >= args.length) {
      console.error("Error: --window requires a value (positive integer)");
      process.exit(1);
    }
    const parsed = parseInt(args[windowIdx + 1], 10);
    if (isNaN(parsed) || parsed <= 0) {
      console.error("Error: --window requires a positive integer");
      process.exit(1);
    }
    windowDays = parsed;
  }

  let priority: ParsedRecommendOpts["priority"] = null;
  const priorityIdx = args.indexOf("--priority");
  if (priorityIdx !== -1) {
    if (priorityIdx + 1 >= args.length) {
      console.error("Error: --priority requires a value (low|medium|high|critical)");
      process.exit(1);
    }
    const v = args[priorityIdx + 1];
    if (!(VALID_PRIORITIES as readonly string[]).includes(v)) {
      console.error(
        `Error: --priority must be one of: ${VALID_PRIORITIES.join(", ")}`,
      );
      process.exit(1);
    }
    priority = v as ParsedRecommendOpts["priority"];
  }

  let source: ParsedRecommendOpts["source"] = null;
  const sourceIdx = args.indexOf("--source");
  if (sourceIdx !== -1) {
    if (sourceIdx + 1 >= args.length) {
      console.error("Error: --source requires a value (health|drift|lens-review|integrity)");
      process.exit(1);
    }
    const v = args[sourceIdx + 1];
    if (!(VALID_SOURCES as readonly string[]).includes(v)) {
      console.error(
        `Error: --source must be one of: ${VALID_SOURCES.join(", ")}`,
      );
      process.exit(1);
    }
    source = v as ParsedRecommendOpts["source"];
  }

  return { windowDays, jsonMode, priority, source };
}


export const VALID_SECTIONS = ["analytics", "failures", "policies", "friction"] as const;


export function parseSectionFlag(args: string[]): string | null {
  const idx = args.indexOf("--section");
  if (idx === -1) return null;
  if (idx + 1 >= args.length) {
    console.error("Error: --section requires a value (analytics|failures|policies|friction)");
    process.exit(2);
  }
  const val = args[idx + 1];
  if (!(VALID_SECTIONS as readonly string[]).includes(val)) {
    console.error(`Error: Unknown section "${val}". Valid: ${VALID_SECTIONS.join(", ")}`);
    process.exit(2);
  }
  return val;
}
