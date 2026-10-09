// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A6 — Duplicate detector.
 *
 * Pure function over `KnowledgeArtifact[]` + `CurationConfig`. Emits
 * "duplicate" findings:
 * - "exact": two artifacts share the same (store, artifactKind, subject).
 * - "near": normalized-content similarity at/above
 *   `config.duplicateSimilarityThreshold`.
 *
 * Pairwise findings are canonicalized: `artifactId` is the lexicographically
 * larger id and `targetId` the smaller, so `duplicate(A,B)` and
 * `duplicate(B,A)` produce the identical finding (see finding-id.ts).
 *
 * Pure: no I/O, no store access, no mutation of its input.
 *
 * @module dedup-detector
 */

import type {
  CurationConfig,
  CurationFinding,
  KnowledgeArtifact,
} from "../contracts/curation-contract.js";
import { computeFindingId, normalizeContent } from "./finding-id.js";
import { canonicalPair, clusterKey } from "./shared.js";

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i <= s.length - 2; i += 1) out.add(s.slice(i, i + 2));
  return out;
}

/**
 * Sørensen–Dice coefficient over character bigrams of normalized content.
 * Returns 1 for identical normalized content, 0 for no shared bigrams.
 */
function contentSimilarity(a: string, b: string): number {
  const na = normalizeContent(a);
  const nb = normalizeContent(b);
  if (na === nb) return 1;
  const setA = bigrams(na);
  const setB = bigrams(nb);
  if (setA.size === 0 && setB.size === 0) return 1;
  let inter = 0;
  for (const g of setA) if (setB.has(g)) inter += 1;
  return (2 * inter) / (setA.size + setB.size);
}

/**
 * Detect duplicate artifacts.
 *
 * @param artifacts Normalized read-model artifacts (adapters' output).
 * @param config    Detector thresholds — never hard-coded.
 * @returns Duplicate curation findings, deterministically ordered by findingId.
 */
export function detectDuplicates(
  artifacts: KnowledgeArtifact[],
  config: CurationConfig,
): CurationFinding[] {
  const findings: CurationFinding[] = [];
  const now = Date.now();

  // exact — same (store, artifactKind, subject).
  const groups = new Map<string, KnowledgeArtifact[]>();
  // Canonical pair keys (lo|hi artifact ids) already flagged exact. The near
  // pass must skip these so a same-cluster AND content-similar pair emits ONE
  // finding (exact wins) rather than two findings sharing one findingId.
  const exactPairs = new Set<string>();
  for (const a of artifacts) {
    const key = clusterKey(a);
    const bucket = groups.get(key);
    if (bucket) bucket.push(a);
    else groups.set(key, [a]);
  }
  for (const bucket of groups.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const { artifactId, targetId, primary } = canonicalPair(bucket[i], bucket[j]);
        exactPairs.add(`${artifactId}\0${targetId}`);
        findings.push({
          findingId: computeFindingId(primary.store, "duplicate", artifactId, targetId),
          kind: "duplicate",
          reasonCode: "exact",
          store: primary.store,
          artifactId,
          artifactKind: primary.artifactKind,
          targetId,
          severity: "medium",
          rationale: `Artifacts ${artifactId} and ${targetId} share the same (store, artifactKind, subject); propose consolidation.`,
          evidenceRefs: [],
          confidence: 1,
          createdAt: new Date(now).toISOString(),
        });
      }
    }
  }

  // near — normalized-content similarity above the configured threshold.
  for (let i = 0; i < artifacts.length; i += 1) {
    for (let j = i + 1; j < artifacts.length; j += 1) {
      const a = artifacts[i];
      const b = artifacts[j];
      if (a.artifactId === b.artifactId) continue;
      const { artifactId, targetId, primary } = canonicalPair(a, b);
      // Already flagged exact above — a near finding would share the same
      // deterministic findingId (computeFindingId hashes store|kind|lo|hi
      // without reasonCode), so it must be skipped.
      if (exactPairs.has(`${artifactId}\0${targetId}`)) continue;
      const similarity = contentSimilarity(a.content, b.content);
      if (similarity < config.duplicateSimilarityThreshold) continue;
      findings.push({
        findingId: computeFindingId(primary.store, "duplicate", artifactId, targetId),
        kind: "duplicate",
        reasonCode: "near",
        store: primary.store,
        artifactId,
        artifactKind: primary.artifactKind,
        targetId,
        severity: "low",
        rationale: `Artifacts ${artifactId} and ${targetId} have normalized-content similarity ${similarity.toFixed(3)} at/above threshold ${config.duplicateSimilarityThreshold}.`,
        evidenceRefs: [],
        confidence: similarity,
        createdAt: new Date(now).toISOString(),
      });
    }
  }

  return findings.sort((x, y) => x.findingId.localeCompare(y.findingId));
}
