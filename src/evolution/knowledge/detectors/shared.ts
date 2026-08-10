// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A6 — Detector shared helpers.
 *
 * Pure, non-mutating helpers reused by the four curation detectors:
 * - `canonicalPair` — canonicalize an unordered artifact pair so
 *   `duplicate(A,B)` ≡ `duplicate(B,A)` (and likewise contradiction) — the
 *   pairwise identity rule from the design spec §4.4.
 * - `daysSince` — days elapsed since an ISO timestamp (0 when unparseable).
 * - `clusterKey` / `sameCluster` — the (store, artifactKind, subject)
 *   "subject cluster" an artifact belongs to.
 * - `isEvidenceArtifact` — whether an artifact is an A5 evidence projection
 *   (evidence is a governance input, not a curated knowledge artifact).
 * - `claimsConflict` — whether two artifacts' structured claims assert
 *   different values for the same (subject, predicate).
 *
 * Pure: no I/O, no store access, no mutation of their inputs.
 *
 * @module detector-shared
 */

import type { KnowledgeArtifact } from "../contracts/curation-contract.js";

const DAY_MS = 86_400_000;

/** Days elapsed since `iso` at `now`; 0 when `iso` is unparseable. */
export function daysSince(iso: string, now: number): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return (now - t) / DAY_MS;
}

/**
 * Canonicalize an unordered artifact pair for pairwise findings: `artifactId`
 * is the lexicographically larger id, `targetId` the smaller, so the finding
 * is identical regardless of input order. `primary` matches `artifactId`
 * (the artifact the finding's store/artifactKind come from).
 */
export function canonicalPair<T extends { artifactId: string }>(
  a: T,
  b: T,
): { artifactId: string; targetId: string; primary: T; related: T } {
  if (a.artifactId < b.artifactId) {
    return { artifactId: b.artifactId, targetId: a.artifactId, primary: b, related: a };
  }
  return { artifactId: a.artifactId, targetId: b.artifactId, primary: a, related: b };
}

/** The (store, artifactKind, subject) cluster key — the design spec's "subject cluster". */
export function clusterKey(a: KnowledgeArtifact): string {
  return `${a.store}::${a.artifactKind}::${a.subject ?? ""}`;
}

/** Whether two artifacts belong to the same (store, artifactKind, subject) cluster. */
export function sameCluster(a: KnowledgeArtifact, b: KnowledgeArtifact): boolean {
  return clusterKey(a) === clusterKey(b);
}

/** Whether an artifact is an A5 evidence projection (store === "evidence"). */
export function isEvidenceArtifact(a: KnowledgeArtifact): boolean {
  return a.store === "evidence";
}

/**
 * Whether two artifacts' structured claims assert incompatible values for the
 * same (subject, predicate). Artifacts without a claim never conflict.
 */
export function claimsConflict(a: KnowledgeArtifact, b: KnowledgeArtifact): boolean {
  if (!a.claim || !b.claim) return false;
  return (
    a.claim.subject === b.claim.subject &&
    a.claim.predicate === b.claim.predicate &&
    a.claim.value !== b.claim.value
  );
}
