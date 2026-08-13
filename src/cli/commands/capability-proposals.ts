// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-9 Task 9 — `alix capability proposals` CLI command.
 *
 * Lists pending + recent proposals via `service.governance(capabilityId?)`.
 * Routes through the canonical capability service exclusively
 * (locked rulings #7, #12, #16) — no direct catalog/registry access,
 * no platform instantiation.
 *
 * Output:
 * - tabular plain-text view (default)
 * - JSON snapshot when `--json` is set
 *
 * Exits 0 on success. Exits 2 on usage error. Exits 1 if the service
 * is absent (dispatch contract violation).
 */

import type { CapabilityService } from "../../capability/capability-service.js";
import type {
  CapabilityGovernanceEventProjection,
} from "../../capability/governance/governance-types.js";

const USAGE = `Usage: alix capability proposals [--capability=<id>] [--json]`;

export interface CapabilityProposalsOptions {
  readonly service: CapabilityService | undefined;
}

export async function capabilityProposalsCommand(
  args: readonly string[],
  opts: CapabilityProposalsOptions,
): Promise<number> {
  const service = opts.service;
  if (!service) {
    console.error("CapabilityService not supplied — CLI dispatcher contract violated.");
    return 1;
  }

  const rest = [...args];
  const jsonMode = rest.includes("--json");
  const capabilityFlag = rest.find((a) => a.startsWith("--capability="));
  const capabilityId = capabilityFlag?.split("=")[1];

  const result = await service.governance(capabilityId);

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  const events = result.events;
  if (events.length === 0) {
    if (capabilityId) {
      console.log(`No governance events for capability: ${capabilityId}`);
    } else {
      console.log("No governance events recorded.");
    }
    return 0;
  }

  // CAP-10 ruling #6 — the governance projection widens to include both
  // `proposal.*` (CAP-9) and `measurement.*` (CAP-10) events. This CLI
  // command is proposal-focused (CAP-9 lock); we filter out
  // `measurement.*` events at the type boundary so proposalId formatting
  // stays well-defined.
  const proposalEvents = events.filter(
    (e): e is CapabilityGovernanceEventProjection =>
      e.type.startsWith("capability.governance.proposal."),
  );

  if (proposalEvents.length === 0) {
    console.log("No governance proposal events recorded.");
    return 0;
  }

  console.log(`Capability governance proposals (${proposalEvents.length}):`);
  console.log(`${"seq".padStart(4)}  ${"proposalId".padEnd(20)}  ${"type".padEnd(50)}  timestamp`);
  console.log("-".repeat(100));
  for (const e of proposalEvents) {
    const shortType = e.type.replace(/^capability\.governance\.proposal\./, "");
    const shortId = e.proposalId.length > 18 ? `${e.proposalId.slice(0, 16)}…` : e.proposalId;
    console.log(
      `${String(e.seq).padStart(4)}  ${shortId.padEnd(20)}  ${shortType.padEnd(50)}  ${e.timestamp}`,
    );
  }

  return 0;
}

/** USAGE text — exported for help/listing. */
export const CAPABILITY_PROPOSALS_USAGE = USAGE;