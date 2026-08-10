// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A6 — Staleness detector.
 *
 * Pure function over `KnowledgeArtifact[]` + `CurationConfig`. Emits "stale"
 * findings with three deterministic reason codes:
 * - "age": artifact older than `config.staleAfterDays` with no evidence of
 *   refresh (non-empty `evidenceRefs`), and not itself an A5 evidence
 *   projection (evidence is a governance input, not a curated artifact).
 * - "superseded": a newer artifact exists in the same (store, artifactKind,
 *   subject) cluster. Every non-newest artifact is flagged superseded by the
 *   cluster's NEWEST artifact, so no artifact is simultaneously a superseder
 *   and superseded (no double-flag noise within a chain).
 * - "outcome_contradiction": an artifact's structured claim disagrees with a
 *   NEWER evidence artifact's claim on the same subject/predicate.
 *
 * Pure: no I/O, no store access, no mutation of its input.
 *
 * @module staleness-detector
 */

import type {
  CurationConfig,
  CurationFinding,
  KnowledgeArtifact,
} from "../contracts/curation-contract.js";
import { computeFindingId } from "./finding-id.js";
import {
  claimsConflict,
  clusterKey,
  daysSince,
  isEvidenceArtifact,
} from "./shared.js";

/**
 * Detect stale artifacts.
 *
 * @param artifacts Normalized read-model artifacts (adapters' output).
 * @param config    Detector thresholds — never hard-coded.
 * @returns Stale curation findings, deterministically ordered by findingId.
 */
export function detectStale(
  artifacts: KnowledgeArtifact[],
  config: CurationConfig,
): CurationFinding[] {
  const findings: CurationFinding[] = [];
  const now = Date.now();

  // age — older than staleAfterDays with no evidence of refresh.
  for (const a of artifacts) {
    if (isEvidenceArtifact(a)) continue; // evidence is an input, not a curated artifact
    if (a.evidenceRefs.length > 0) continue; // evidence of refresh
    const ageDays = daysSince(a.createdAt, now);
    if (ageDays <= config.staleAfterDays) continue;

    findings.push({
      findingId: computeFindingId(a.store, "stale", a.artifactId),
      kind: "stale",
      reasonCode: "age",
      store: a.store,
      artifactId: a.artifactId,
      artifactKind: a.artifactKind,
      severity: "medium",
      rationale: `Artifact ${a.artifactId} is ${Math.floor(ageDays)} days old with no evidence of refresh.`,
      evidenceRefs: [],
      confidence: 0.8,
      createdAt: new Date(now).toISOString(),
    });
  }

  // superseded — within each cluster, flag every non-newest artifact as
  // superseded by the cluster's newest artifact (ties broken by largest
  // artifactId for determinism). The newest artifact is never superseded.
  const clusters = new Map<string, KnowledgeArtifact[]>();
  for (const a of artifacts) {
    const key = clusterKey(a);
    const bucket = clusters.get(key);
    if (bucket) bucket.push(a);
    else clusters.set(key, [a]);
  }
  for (const bucket of clusters.values()) {
    if (bucket.length < 2) continue;
    const newest = [...bucket].sort((x, y) => {
      const byDate = y.createdAt.localeCompare(x.createdAt);
      if (byDate !== 0) return byDate;
      return y.artifactId.localeCompare(x.artifactId);
    })[0];
    for (const a of bucket) {
      if (a === newest) continue;
      findings.push({
        findingId: computeFindingId(a.store, "stale", a.artifactId, newest.artifactId),
        kind: "stale",
        reasonCode: "superseded",
        store: a.store,
        artifactId: a.artifactId,
        artifactKind: a.artifactKind,
        targetId: newest.artifactId,
        severity: "medium",
        rationale: `Artifact ${a.artifactId} superseded by newer artifact ${newest.artifactId} in same (store, artifactKind, subject) cluster.`,
        evidenceRefs: [],
        confidence: 0.9,
        createdAt: new Date(now).toISOString(),
      });
    }
  }

  // outcome_contradiction — claim contradicted by a newer evidence artifact.
  for (const a of artifacts) {
    if (isEvidenceArtifact(a) || !a.claim) continue;
    for (const e of artifacts) {
      if (!isEvidenceArtifact(e)) continue;
      if (e === a) continue;
      if (e.createdAt <= a.createdAt) continue;
      if (!claimsConflict(a, e)) continue;
      findings.push({
        findingId: computeFindingId(a.store, "stale", a.artifactId, e.artifactId),
        kind: "stale",
        reasonCode: "outcome_contradiction",
        store: a.store,
        artifactId: a.artifactId,
        artifactKind: a.artifactKind,
        targetId: e.artifactId,
        severity: "high",
        rationale: `Artifact ${a.artifactId}'s claim (${a.claim.subject}/${a.claim.predicate}=${a.claim.value}) contradicted by newer observed evidence ${e.artifactId} (${e.claim?.value}).`,
        evidenceRefs: [e.artifactId],
        confidence: 0.9,
        createdAt: new Date(now).toISOString(),
      });
    }
  }

  return findings.sort((x, y) => x.findingId.localeCompare(y.findingId));
}
