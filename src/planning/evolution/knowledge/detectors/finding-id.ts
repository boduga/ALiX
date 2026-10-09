// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A6 — Detector shared helpers: deterministic finding identity + content normalization.
 *
 * `computeFindingId` produces the deterministic SHA-256 identity described in
 * the design spec §4.4: a hash of `(store, kind, artifactId, targetId?)`.
 * For pairwise findings (duplicate, contradiction) the two artifact ids are
 * sorted lexicographically before hashing so `duplicate(A,B)` and
 * `duplicate(B,A)` yield the identical finding id — the pair is canonicalized
 * inside this helper so callers never need to pre-sort.
 *
 * `normalizeContent` is the shared text normalizer used by the dedup detector
 * for content similarity (lowercase + collapsed whitespace).
 *
 * @module finding-id
 */

import { createHash } from "node:crypto";

/**
 * Deterministic SHA-256 identity of a curation finding.
 *
 * Non-pairwise findings hash `store|kind|artifactId`. Pairwise findings
 * additionally include `targetId`; the two ids are sorted lexicographically
 * first, so the hash is over `store|kind|lo|hi` regardless of argument order.
 *
 * @param store    The knowledge store the flagged artifact belongs to.
 * @param kind     The curation finding kind ("stale", "duplicate", ...).
 * @param artifactId  The flagged artifact's id.
 * @param targetId For pairwise findings, the related artifact's id.
 * @returns 64-char lowercase SHA-256 hex digest.
 */
export function computeFindingId(
  store: string,
  kind: string,
  artifactId: string,
  targetId?: string,
): string {
  let key = `${store}|${kind}|${artifactId}`;
  if (targetId !== undefined) {
    const [lo, hi] =
      artifactId <= targetId ? [artifactId, targetId] : [targetId, artifactId];
    key = `${store}|${kind}|${lo}|${hi}`;
  }
  return createHash("sha256").update(key, "utf-8").digest("hex");
}

/**
 * Normalize artifact content for similarity + dedup: lowercase and collapse
 * all whitespace runs into single spaces (trimmed).
 */
export function normalizeContent(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}
