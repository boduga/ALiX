// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-9 — Stable error thrown by service.apply({ proposalId }) when the
 * proposal's pinned source id@version no longer matches the current catalog
 * (locked ruling #17).
 *
 * Frozen — error instances are immutable so they can safely cross process
 * boundaries (logger, event payloads) without mutation.
 *
 * @module capability/errors/proposal-stale
 */

/** Thrown by service.apply({ proposalId }) when the proposal's pinned source
 *  id@version no longer matches the current catalog (ruling #17).
 *  Frozen — error instances are immutable so they can safely cross process
 *  boundaries (logger, event payloads) without mutation. */
export class CapabilityProposalStaleError extends Error {
  readonly code = "CAPABILITY_PROPOSAL_STALE" as const;
  constructor(
    readonly proposalId: string,
    readonly sourceId: string,
    readonly sourceVersion: string,
    readonly currentVersion: string | undefined,
  ) {
    super(
      `Proposal '${proposalId}' stale: source '${sourceId}@${sourceVersion}' no longer matches current catalog (got '${currentVersion ?? "undefined"}')`,
    );
    this.name = "CapabilityProposalStaleError";
    Object.freeze(this);
  }
}
