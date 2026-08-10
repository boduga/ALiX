// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A6 — Staleness detector.
 *
 * Pure function over `KnowledgeArtifact[]` + `CurationConfig`. Emits "stale"
 * findings with three deterministic reason codes:
 * - "age": artifact older than `config.staleAfterDays`.
 * - "superseded": a newer artifact exists in the same (store, artifactKind,
 *   subject) cluster; the older artifact is flagged with `targetId` = newer.
 * - "outcome_contradiction": the artifact's structured claim disagrees with a
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

const DAY_MS = 86_400_000;

function daysSince(iso: string, now: number): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return (now - t) / DAY_MS;
}

function isEvidence(a: KnowledgeArtifact): boolean {
  return a.store === "evidence";
}

function sameCluster(a: KnowledgeArtifact, b: KnowledgeArtifact): boolean {
  return (
    a.store === b.store &&
    a.artifactKind === b.artifactKind &&
    a.subject === b.subject
  );
}

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
  const now = Date.now();
  const findings: CurationFinding[] = [];

  // age — artifact older than staleAfterDays with no evidence refresh.
  for (const a of artifacts) {
    const ageDays = daysSince(a.createdAt, now);
    if (ageDays > config.staleAfterDays) {
      findings.push({
        findingId: computeFindingId(a.store, "stale", a.artifactId),
        kind: "stale",
        reasonCode: "age",
        store: a.store,
        artifactId: a.artifactId,
        artifactKind: a.artifactKind,
        severity: "medium",
        rationale: `Artifact ${a.artifactId} is ${Math.floor(ageDays)} days old, beyond staleAfterDays (${config.staleAfterDays}) with no evidence of refresh.`,
        evidenceRefs: [],
        confidence: 0.8,
        createdAt: new Date(now).toISOString(),
      });
    }
  }

  // superseded — newer artifact in the same (store, artifactKind, subject) cluster.
  for (const a of artifacts) {
    for (const b of artifacts) {
      if (a === b) continue;
      if (!sameCluster(a, b)) continue;
      if (b.createdAt > a.createdAt) {
        findings.push({
          findingId: computeFindingId(a.store, "stale", a.artifactId, b.artifactId),
          kind: "stale",
          reasonCode: "superseded",
          store: a.store,
          artifactId: a.artifactId,
          artifactKind: a.artifactKind,
          targetId: b.artifactId,
          severity: "medium",
          rationale: `Artifact ${a.artifactId} is superseded by newer artifact ${b.artifactId} in the same (store, artifactKind, subject) cluster.`,
          evidenceRefs: [],
          confidence: 0.9,
          createdAt: new Date(now).toISOString(),
        });
      }
    }
  }

  // outcome_contradiction — claim contradicted by a newer evidence artifact.
  for (const a of artifacts) {
    if (isEvidence(a) || !a.claim) continue;
    for (const e of artifacts) {
      if (!isEvidence(e) || !e.claim) continue;
      if (e === a) continue;
      if (e.createdAt <= a.createdAt) continue;
      if (
        e.claim.subject === a.claim.subject &&
        e.claim.predicate === a.claim.predicate &&
        e.claim.value !== a.claim.value
      ) {
        findings.push({
          findingId: computeFindingId(a.store, "stale", a.artifactId, e.artifactId),
          kind: "stale",
          reasonCode: "outcome_contradiction",
          store: a.store,
          artifactId: a.artifactId,
          artifactKind: a.artifactKind,
          targetId: e.artifactId,
          severity: "high",
          rationale: `Artifact ${a.artifactId}'s claim (${a.claim.subject}/${a.claim.predicate}=${a.claim.value}) is contradicted by newer evidence artifact ${e.artifactId} (${e.claim.value}).`,
          evidenceRefs: [...e.evidenceRefs],
          confidence: 0.9,
          createdAt: new Date(now).toISOString(),
        });
      }
    }
  }

  // Deterministic ordering.
  return findings.sort((x, y) => x.findingId.localeCompare(y.findingId));
}
