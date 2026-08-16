/**
 * A9 — canonical two-hop bridge target accessor (code-review Std #4).
 *
 * The canonical bridge anchor `proposal.submitted.payload.candidate.target.id`
 * is read in two places (the proposal events adapter and the correlation
 * engine). This single accessor centralizes the read so the `candidate`
 * extraction never drifts between sites.
 *
 * The raw event payload is preserved verbatim by A9 (`ProposalEventRecord.payload`
 * is `Record<string, unknown>`), so the accessor narrows through the
 * `ProposalSubmittedPayload` shape type (governance-types.ts) — the typed read
 * the two sites were previously hand-rolling.
 *
 * Returns `undefined` when the payload is not a `proposal.submitted` shape or
 * the target is not a string (e.g. non-capability targets) — callers decide
 * how to treat absence (adapter: empty capabilityId; engine: no correlation).
 *
 * @module evolution/a9/bridge-target
 */

import type { ProposalSubmittedPayload } from "../../capability/governance/governance-types.js";

/** Read `payload.candidate.target.id` from a raw proposal.submitted payload. */
export function readCandidateTargetId(
  payload: Readonly<Record<string, unknown>>,
): string | undefined {
  const candidate = (payload as Partial<ProposalSubmittedPayload>).candidate;
  const id = candidate?.target?.id;
  return typeof id === "string" ? id : undefined;
}
