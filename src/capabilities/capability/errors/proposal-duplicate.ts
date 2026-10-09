// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-9 — Stable error thrown by service.propose() when the canonical proposal
 * id already has a matching proposal.submitted event in the ledger (locked
 * ruling #21).
 *
 * Frozen — error instances are immutable so they can safely cross process
 * boundaries (logger, event payloads) without mutation.
 *
 * @module capability/errors/proposal-duplicate
 */

/** Thrown by service.propose() when the canonical proposal id already has a
 *  matching proposal.submitted event in the ledger (ruling #21).
 *  Frozen — error instances are immutable. */
export class CapabilityProposalDuplicateError extends Error {
  readonly code = "CAPABILITY_PROPOSAL_DUPLICATE" as const;
  constructor(readonly proposalId: string) {
    super(`Proposal '${proposalId}' already submitted (deduplication)`);
    this.name = "CapabilityProposalDuplicateError";
    Object.freeze(this);
  }
}
