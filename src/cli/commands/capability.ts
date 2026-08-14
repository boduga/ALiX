// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-11 — sole owner of the `alix capability` namespace.
 *
 * Per locked ruling #2: this dispatcher parses subcommand and delegates
 * to existing CAP-9 / CAP-10 handlers. NO measurement / proposal / lifecycle /
 * governance logic in this file.
 */

import type { CapabilityService } from "../../capability/capability-service.js";
import { capabilityProposalsCommand } from "./capability-proposals.js";
import { capabilityMeasureCommand } from "./capability-measure.js";

export interface CapabilityCommandDeps {
  readonly service: CapabilityService;
  readonly cwd: string;
}

export async function handleCapabilityCommand(
  args: readonly string[],
  deps: CapabilityCommandDeps,
): Promise<number | void> {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case "proposals":
      return capabilityProposalsCommand(rest, { service: deps.service });
    case "measure":
      return capabilityMeasureCommand(rest, { service: deps.service });
    default:
      console.error(`Unknown capability subcommand: ${subcommand ?? "(none)"}`);
      console.error("Usage: alix capability <subcommand> [...]");
      console.error("Subcommands: proposals, measure");
      return 2;
  }
}