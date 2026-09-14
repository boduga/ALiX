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
import { GovernanceStore } from "../../../governance/governance-store.js";
import { InvestigationStore } from "../../../governance/investigation-store.js";
import "../../../governance/governance-recommendation-generator.js";
import { generateInvestigations } from "../../../governance/investigation-generator.js";
import { listCompatibleInvestigations } from "../../../governance/investigation-compat.js";
import "../governance-dashboard-handler.js";
// A8 T7 imports — learning CLI surface (4-adapter construction, per A8
// wayfinder map #517 locked ruling). Imports are dynamic-free at module
// scope to keep the seam file's load graph small.
import "../../../evolution/learning/learning-cli.js";
// A9 Slice 5 — pre-execution risk forecast CLI surface.
import "../../../evolution/forecast/forecast-cli.js";
import "../../../events/event-log.js";
import type { InvestigationRecommendation } from "../../../governance/investigation-types.js";
import { BAR } from "./analytics.js";
import { BOLD, CYAN, DIM, GREEN, RED, RESET, YELLOW } from "./shared.js";

// ---------------------------------------------------------------------------
// runInvestigate — `alix governance investigate <subcommand> [args]`
// ---------------------------------------------------------------------------

export async function runInvestigate(args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "list":
      return runInvestigateList(args.slice(1));
    case "show":
      return runInvestigateShow(args.slice(1));
    case "update":
      return runInvestigateUpdate(args.slice(1));
    case "generate":
      return runInvestigateGenerate(args.slice(1));
    default:
      console.error(
        `Usage: alix governance investigate {list|show|update|generate} [options]`,
      );
      process.exit(2);
  }
}


export async function runInvestigateList(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");
  const kindIdx = args.indexOf("--kind");
  let kind: "chain_restoration" | "governance_integrity" | undefined;
  if (kindIdx !== -1 && kindIdx + 1 < args.length) {
    const v = args[kindIdx + 1];
    if (v !== "chain_restoration" && v !== "governance_integrity") {
      console.error("Error: --kind must be 'chain_restoration' or 'governance_integrity'");
      process.exit(1);
    }
    kind = v;
  }

  const store = new GovernanceStore();
  const invStore = new InvestigationStore();

  const investigations = await listCompatibleInvestigations(
    store,
    invStore,
    kind ? { kind } : undefined,
  );

  if (jsonMode) {
    console.log(JSON.stringify(investigations, null, 2));
    return;
  }

  if (investigations.length === 0) {
    console.log(BOLD + "Investigations" + RESET);
    console.log(BAR);
    console.log(DIM + "  No investigations found." + RESET);
    return;
  }

  const resolvedCount = investigations.filter((i) => i.status === "resolved" || i.status === "dismissed").length;
  const openCount = investigations.length - resolvedCount;

  console.log(BOLD + `Investigations (${openCount} open, ${resolvedCount} resolved)` + RESET);
  console.log(BAR);

  for (const inv of investigations) {
    const statusIcon = inv.status === "open" ? "○" : inv.status === "in_progress" ? "◐" : inv.status === "resolved" ? "✓" : "✗";
    const severityColor = inv.severity === "critical" || inv.severity === "high" ? RED : inv.severity === "medium" ? YELLOW : GREEN;

    console.log(
      `  ${statusIcon} ${severityColor}[${inv.severity.toUpperCase()}]${RESET}` +
      ` ${inv.kind.replace("_", " ")}` +
      (inv.legacySource ? DIM + " (legacy)" + RESET : ""),
    );
    console.log(`    ${CYAN}${inv.id}${RESET}`);
    console.log(`    ${inv.title}`);
    console.log(`    ${DIM}Status: ${inv.status} | Source: ${inv.source}${RESET}`);
    if (inv.assignedTo) {
      console.log(`    ${DIM}Assigned: ${inv.assignedTo}${RESET}`);
    }
    console.log("");
  }
}


export async function runInvestigateShow(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    console.error("Usage: alix governance investigate show <investigation-id>");
    process.exit(2);
  }
  const jsonMode = args.includes("--json");

  const invStore = new InvestigationStore();
  const native = await invStore.get(id);

  if (!native) {
    const store = new GovernanceStore();
    const all = await listCompatibleInvestigations(store, invStore);
    const found = all.find((i) => i.id === id);
    if (!found) {
      console.error(`Investigation not found: ${id}`);
      process.exit(1);
    }
    if (jsonMode) {
      console.log(JSON.stringify(found, null, 2));
    } else {
      renderInvestigationDetail(found);
    }
    return;
  }

  if (jsonMode) {
    console.log(JSON.stringify(native, null, 2));
  } else {
    renderInvestigationDetail(native);
  }
}


export function renderInvestigationDetail(inv: InvestigationRecommendation): void {
  console.log(BOLD + `Investigation: ${inv.id}` + RESET);
  console.log(BAR);
  console.log(`  Kind:       ${inv.kind}`);
  console.log(`  Status:     ${inv.status}`);
  console.log(`  Severity:   ${inv.severity}`);
  console.log(`  Source:     ${inv.source}`);
  console.log(`  Created:    ${inv.createdAt}`);
  if (inv.updatedAt) console.log(`  Updated:    ${inv.updatedAt}`);
  if (inv.assignedTo) console.log(`  Assigned:   ${inv.assignedTo}`);
  if (inv.resolvedAt) console.log(`  Resolved:   ${inv.resolvedAt}`);
  if (inv.resolution) console.log(`  Resolution: ${inv.resolution}`);
  console.log("");
  console.log(BOLD + "  Description" + RESET);
  console.log(`  ${inv.description}`);
  console.log("");
  console.log(BOLD + "  Operator Guidance" + RESET);
  console.log(`  ${inv.operatorGuidance}`);
  if (inv.legacySource) {
    console.log("");
    console.log(DIM + "  Legacy Source" + RESET);
    console.log(`  Store:              ${inv.legacySource.store}`);
    console.log(`  Recommendation:     ${inv.legacySource.recommendationId}`);
    console.log(`  Parent Report:      ${inv.legacySource.parentReportId}`);
  }
}


export async function runInvestigateUpdate(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    console.error("Usage: alix governance investigate update <id> [--status <status>] [--assign <user>] [--resolution <text>]");
    process.exit(2);
  }
  const jsonMode = args.includes("--json");

  const statusIdx = args.indexOf("--status");
  let status: "open" | "in_progress" | "resolved" | "dismissed" | undefined;
  if (statusIdx !== -1 && statusIdx + 1 < args.length) {
    const v = args[statusIdx + 1];
    if (!["open", "in_progress", "resolved", "dismissed"].includes(v)) {
      console.error("Error: --status must be one of: open, in_progress, resolved, dismissed");
      process.exit(1);
    }
    status = v as typeof status;
  }

  const assignIdx = args.indexOf("--assign");
  let assignedTo: string | undefined;
  if (assignIdx !== -1 && assignIdx + 1 < args.length) {
    assignedTo = args[assignIdx + 1];
  }

  const resolutionIdx = args.indexOf("--resolution");
  let resolution: string | undefined;
  if (resolutionIdx !== -1 && resolutionIdx + 1 < args.length) {
    resolution = args[resolutionIdx + 1];
  }

  const invStore = new InvestigationStore();

  if (!status && !assignedTo) {
    console.error("Error: provide at least --status or --assign");
    process.exit(1);
  }

  if (status) {
    await invStore.updateStatus(id, status, { resolution, assignedTo });
  } else if (assignedTo) {
    const existing = await invStore.get(id);
    if (!existing) {
      console.error(`Investigation not found: ${id}`);
      process.exit(1);
    }
    await invStore.updateStatus(id, existing.status, { assignedTo });
  }

  if (jsonMode) {
    const updated = await invStore.get(id);
    console.log(JSON.stringify({ ok: true, investigation: updated }));
  } else {
    console.log(`Investigation updated: ${id}`);
    if (status) console.log(`  Status:     ${status}`);
    if (assignedTo) console.log(`  Assigned:   ${assignedTo}`);
    if (resolution) console.log(`  Resolution: ${resolution}`);
  }
}


export async function runInvestigateGenerate(args: string[]): Promise<void> {
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

  const store = new GovernanceStore();
  const invStore = new InvestigationStore();
  const generatedAt = new Date().toISOString();

  const investigations = await generateInvestigations({
    store,
    investigationStore: invStore,
    windowDays,
    generatedAt,
  });

  if (jsonMode) {
    console.log(JSON.stringify(investigations, null, 2));
  } else {
    console.log(`Generated ${investigations.length} investigation(s).`);
    for (const inv of investigations) {
      const severityColor = inv.severity === "critical" || inv.severity === "high" ? RED : YELLOW;
      console.log(
        `  ${severityColor}[${inv.severity.toUpperCase()}]${RESET}` +
        ` ${inv.kind.replace("_", " ")} — ${inv.title}`,
      );
    }
  }
}
