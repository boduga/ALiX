// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-9 Task 9 — `alix capability reject <proposalId> <reason>` CLI command.
 *
 * Records a proposal rejection via `service.reject(proposalId, reason)`.
 * This is a store-level write (`proposal.rejected` event) — distinct
 * from `service.apply({ proposalId })` which delegates to CAP-6's mutation
 * executor. Reject does NOT run the executor; the proposal is terminal.
 *
 * Returns `{ proposalId, status: "rejected" }` snapshot. Exits 0 on
 * success, 2 on usage error, 1 on dispatcher contract violation.
 */

import type { CapabilityService } from "../../capability/capability-service.js";

const USAGE = `Usage: alix capability reject <proposalId> <reason...>`;

export interface CapabilityRejectOptions {
  readonly service: CapabilityService | undefined;
}

export async function capabilityRejectCommand(
  args: readonly string[],
  opts: CapabilityRejectOptions,
): Promise<number> {
  const service = opts.service;
  if (!service) {
    console.error("CapabilityService not supplied — CLI dispatcher contract violated.");
    return 1;
  }

  const [proposalId, ...rest] = args;
  if (!proposalId || rest.length === 0) {
    console.error(USAGE);
    return 2;
  }
  const reason = rest.join(" ") || "rejected";

  const result = await service.reject(proposalId, reason);
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

/** USAGE text — exported for help/listing. */
export const CAPABILITY_REJECT_USAGE = USAGE;