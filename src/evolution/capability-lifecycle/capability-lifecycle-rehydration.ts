// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import type { CapabilityLifecycleLedger } from "./capability-lifecycle-ledger.js";
import type { CapabilityRegistry } from "../../capability/registry.js";

/**
 * A7.1 — rebuild the registry's lifecycle overlay from the ledger (spec §8).
 *
 * Authority model: the A7 ledger is the source of lifecycle history and
 * governed transition state; the M-series registry's lifecycle overlay is a
 * runtime projection. After a restart the overlay is empty, so it must be
 * rehydrated from the persisted `applied` records before the projection is
 * trusted.
 *
 * Iterates records in ledger order and re-applies every `applied` transition,
 * so the LAST applied state per capability wins (the overlay is idempotent:
 * re-applying overwrites). Capabilities the registry does not know are skipped —
 * the registry remains the authority for which capabilities exist (spec §8).
 *
 * @returns the number of `applied` records replayed onto the overlay.
 */
export async function rehydrateLifecycleOverlay(
  registry: CapabilityRegistry,
  ledger: CapabilityLifecycleLedger,
): Promise<number> {
  const records = await ledger.list();
  let replayed = 0;
  for (const r of records) {
    if (r.eventType !== "applied" || r.proposedLifecycleState === undefined) continue;
    if (!registry.find(r.target.capabilityId)) continue;
    registry.applyLifecycleTransition(r.target.capabilityId, r.proposedLifecycleState);
    replayed++;
  }
  return replayed;
}
