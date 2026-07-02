/**
 * P10.10 — `alix baseline` CLI dispatcher.
 *
 * @module
 */

import type { BaselineSubsystem } from "../../baseline/baseline-types.js";
import { createDefaultBaselineRegistry, BaselineRegistry } from "../../baseline/baseline-registry.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HELP_TEXT = `Usage: alix baseline <subcommand>

Subcommands:
  list                    List registered subsystems
  providers               Show provider metadata
  health [--json]         Run all comparisons, show health scores
  show <subsystem> [--json]  Run comparison for one subsystem
`;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function handleBaselineCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help") {
    console.log(HELP_TEXT);
    return;
  }

  // Build registry — factory auto-registers DemoProvider
  const registry = createDefaultBaselineRegistry();

  switch (subcommand) {
    case "list":
      return handleList(registry);
    case "providers":
      return handleProviders(registry);
    case "health":
      return handleHealth(registry, args.includes("--json"));
    case "show":
      return handleShow(registry, args.slice(1), args.includes("--json"));
    default:
      console.error(`Unknown baseline subcommand: "${subcommand}"`);
      console.log(HELP_TEXT);
      process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handleList(registry: BaselineRegistry): void {
  const providers = registry.discover();
  if (providers.length === 0) {
    console.log("No baseline providers registered.");
    return;
  }
  for (const p of providers) {
    console.log(p.subsystem);
  }
}

function handleProviders(registry: BaselineRegistry): void {
  const providers = registry.discover();
  if (providers.length === 0) {
    console.log("No baseline providers registered.");
    return;
  }
  // Header
  const header = "Subsystem      Version   Capabilities   State";
  console.log(header);
  console.log("-".repeat(header.length));
  for (const p of providers) {
    const caps = p.capabilities.join(", ");
    console.log(
      `${p.subsystem.padEnd(14)} ${p.version.padEnd(8)} ${caps.padEnd(13)} ${p.state}`,
    );
  }
}

async function handleHealth(registry: BaselineRegistry, useJson: boolean): Promise<void> {
  const results = await registry.runAll();

  if (useJson) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (results.length === 0) {
    console.log("No baseline providers registered.");
    return;
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  const header = "Subsystem      Score     Status";
  console.log(header);
  console.log("-".repeat(header.length));
  for (const r of results) {
    const label = r.status.toUpperCase();
    console.log(`${r.subsystem.padEnd(14)} ${String(r.score).padEnd(8)}  ${label}`);
  }
}

async function handleShow(
  registry: BaselineRegistry,
  args: string[],
  useJson: boolean,
): Promise<void> {
  const subsystem = args.find((a) => !a.startsWith("--"));
  if (!subsystem) {
    console.error("Usage: alix baseline show <subsystem> [--json]");
    process.exit(1);
  }

  const sub = subsystem as BaselineSubsystem;
  try {
    const result = await registry.runOne(sub);

    if (useJson) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`Subsystem:     ${result.subsystem}`);
    console.log(`Score:         ${result.score}`);
    console.log(`Status:        ${result.status.toUpperCase()}`);
    console.log("");
    if (result.drift.length === 0) {
      console.log("No drift detected.");
    } else {
      console.log("Drift items:");
      console.log("─".repeat(60));
      for (const d of result.drift) {
        console.log(
          `  ${d.id.padEnd(30)} ${d.severity.padEnd(8)} baseline:${d.baselineValue} current:${d.currentValue} delta:${d.delta >= 0 ? "+" : ""}${d.delta}`,
        );
      }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
}
