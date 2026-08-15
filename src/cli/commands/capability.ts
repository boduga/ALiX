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
import {
  capabilityConsolidateCommand,
  type CapabilityDefinitionLookup,
} from "./capability-consolidate.js";

export interface CapabilityCommandDeps {
  readonly service: CapabilityService;
  readonly cwd: string;
  /**
   * Read-only definition lookup, required by the `consolidate` subcommand to
   * resolve the operator-named `--definition=<id@version>` (ruling #544).
   * Optional so existing CAP-9/CAP-10 callers are unaffected; `consolidate`
   * reports a dispatcher-contract error (exit 5) when it is absent.
   */
  readonly definitions?: CapabilityDefinitionLookup;
  /**
   * Optional P5.5 pair-layer evidence, rendered as CONTEXT by
   * `consolidate --show-evidence`. Never an input to any identity.
   */
  readonly pairEvidence?: readonly string[];
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
    case "consolidate":
      // P5.5/P5.6 ruling #544 — the authorized caller for
      // `consolidation_opportunity`. Thin delegation only.
      return capabilityConsolidateCommand(rest, {
        service: deps.service,
        catalog: deps.definitions,
        ...(deps.pairEvidence !== undefined ? { pairEvidence: deps.pairEvidence } : {}),
      });
    default:
      console.error(`Unknown capability subcommand: ${subcommand ?? "(none)"}`);
      console.error("Usage: alix capability <subcommand> [...]");
      console.error("Subcommands: proposals, measure, consolidate");
      return 2;
  }
}