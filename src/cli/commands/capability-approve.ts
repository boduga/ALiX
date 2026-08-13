// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-9 Task 9 — `alix capability approve <proposalId>` CLI command.
 *
 * Approves a pending proposal by delegating to `service.apply({ proposalId })`
 * which routes through the CAP-6 capability-mutation executor. The CLI is
 * the operator-facing seam; mutation execution itself is the executor's
 * responsibility (CAP-6). No second mutation path is introduced here.
 *
 * Returns `CapabilityApplyProposalResult` snapshot. Exits 0 on success,
 * 3 on `CapabilityProposalStaleError`, 2 on usage error, 1 on dispatcher
 * contract violation.
 */

import type { CapabilityService } from "../../capability/capability-service.js";
import type { CapabilityApplyProposalResult } from "../../capability/types/service-results.js";
import { CapabilityProposalStaleError } from "../../capability/errors/proposal-stale.js";

const USAGE = `Usage: alix capability approve <proposalId> [--json]`;

export interface CapabilityApproveOptions {
  readonly service: CapabilityService | undefined;
}

export async function capabilityApproveCommand(
  args: readonly string[],
  opts: CapabilityApproveOptions,
): Promise<number> {
  const service = opts.service;
  if (!service) {
    console.error("CapabilityService not supplied — CLI dispatcher contract violated.");
    return 1;
  }

  const [proposalId, ...rest] = args;
  if (!proposalId) {
    console.error(USAGE);
    return 2;
  }
  const jsonMode = rest.includes("--json");

  try {
    const result = (await service.apply({ proposalId })) as unknown as CapabilityApplyProposalResult;
    console.log(JSON.stringify(result, null, 2));
    return result.status === "executed" ? 0 : 1;
  } catch (err) {
    if (err instanceof CapabilityProposalStaleError) {
      console.error(`Stale proposal: ${err.message}`);
      return 3;
    }
    if (err instanceof Error) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }
}

/** USAGE text — exported for help/listing. */
export const CAPABILITY_APPROVE_USAGE = USAGE;