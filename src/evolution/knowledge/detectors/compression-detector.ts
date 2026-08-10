// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A6 — Compression detector.
 *
 * Pure function over `KnowledgeArtifact[]` + `CurationConfig`. Emits
 * "compressible" findings (reasonCode "low_value_long_lived") for artifacts
 * that are older than `config.compressionAfterDays` AND have no evidence
 * references AND no downstream references — i.e. low-value and long-lived
 * eviction/compression candidates.
 *
 * Pure: no I/O, no store access, no mutation of its input.
 *
 * @module compression-detector
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

/**
 * Detect compressible (low-value, long-lived) artifacts.
 *
 * @param artifacts Normalized read-model artifacts (adapters' output).
 * @param config    Detector thresholds — never hard-coded.
 * @returns Compressible curation findings, deterministically ordered by findingId.
 */
export function detectCompressible(
  artifacts: KnowledgeArtifact[],
  config: CurationConfig,
): CurationFinding[] {
  const now = Date.now();
  const findings: CurationFinding[] = [];

  for (const a of artifacts) {
    if (a.evidenceRefs.length > 0 || a.downstreamRefs.length > 0) continue;
    const ageDays = daysSince(a.createdAt, now);
    if (ageDays <= config.compressionAfterDays) continue;

    findings.push({
      findingId: computeFindingId(a.store, "compressible", a.artifactId),
      kind: "compressible",
      reasonCode: "low_value_long_lived",
      store: a.store,
      artifactId: a.artifactId,
      artifactKind: a.artifactKind,
      severity: "low",
      rationale: `Artifact ${a.artifactId} is ${Math.floor(ageDays)} days old with no evidence or downstream references; low-value and long-lived.`,
      evidenceRefs: [],
      confidence: 0.7,
      createdAt: new Date(now).toISOString(),
    });
  }

  return findings.sort((x, y) => x.findingId.localeCompare(y.findingId));
}
