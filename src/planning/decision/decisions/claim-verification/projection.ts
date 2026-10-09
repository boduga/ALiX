/**
 * projection.ts — ClaimVerificationProjection (J1).
 *
 * Minimal purpose-specific projection (JEV-2): one claim plus the minimum
 * evidence needed to judge it. Raw tool output and source files never enter
 * this shape — the caller extracts excerpts. Projection failure blocks the
 * remote call (nothing seals).
 */

import { projectForRemote, type Projector } from "../../projector.js";
import type { RemoteSealedProjection } from "../../boundary.js";
import type { DecisionType } from "../../contracts.js";

export const CLAIM_VERIFICATION_DECISION: DecisionType = "claim-verification";
export const CLAIM_VERIFICATION_PROJECTOR_VERSION = "claim-verification/v1";

/** Bounded so the projection stays minimum-necessary (JEV-6). */
export const MAX_CLAIM_CHARS = 2_000;
export const MAX_EVIDENCE_ITEMS = 8;
export const MAX_EXCERPT_CHARS = 1_200;

export type ClaimEvidenceExcerpt = {
  /** Optional provenance label; never a filesystem path or tool payload. */
  source?: string;
  excerpt: string;
};

export type ClaimVerificationInput = {
  claim: string;
  evidence?: ClaimEvidenceExcerpt[];
};

/** Minimal typed projection: claim + bounded evidence excerpts. */
export type ClaimVerificationProjection = {
  claim: string;
  evidence: string[];
};

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

export function createClaimVerificationProjector(): Projector<
  ClaimVerificationInput,
  ClaimVerificationProjection
> {
  return {
    decision: CLAIM_VERIFICATION_DECISION,
    version: CLAIM_VERIFICATION_PROJECTOR_VERSION,
    project(input: ClaimVerificationInput): ClaimVerificationProjection {
      const claim = clip(typeof input?.claim === "string" ? input.claim : "", MAX_CLAIM_CHARS);
      if (claim.length === 0) {
        throw new Error("claim-verification projection requires a non-empty claim");
      }
      const evidence = (input.evidence ?? [])
        .slice(0, MAX_EVIDENCE_ITEMS)
        .map((item) => clip(typeof item?.excerpt === "string" ? item.excerpt : "", MAX_EXCERPT_CHARS))
        .filter((excerpt) => excerpt.length > 0);
      return { claim, evidence };
    },
  };
}

export function projectClaimVerification(
  input: ClaimVerificationInput,
  opts?: { now?: number },
): RemoteSealedProjection<ClaimVerificationProjection> {
  return projectForRemote(createClaimVerificationProjector(), input, opts);
}

/**
 * Lenient read of a sealed payload. Local engines degrade to "insufficient"
 * on a missing claim; remote mappers reject instead (a remote call without a
 * claim is pointless).
 */
export function readClaimProjection(payload: unknown): ClaimVerificationProjection {
  const record = (payload ?? {}) as Record<string, unknown>;
  const claim = typeof record.claim === "string" ? record.claim : "";
  const evidence = Array.isArray(record.evidence)
    ? record.evidence.filter((item): item is string => typeof item === "string")
    : [];
  return { claim, evidence };
}
