// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A5.1 — Observation Evidence Bridge.
 *
 * Aggregates ObservationResult[] into VerificationEvidence with
 * evidenceClass: "observed". Faithfully projects observation outcomes
 * into behavioralChanges — does not infer governance conclusions.
 *
 * @module observation-evidence-bridge
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../security/audit/canonical-json.js";
import type { VerificationEvidence } from "../verification/contracts/verification-contract.js";
import type { ObservationResult } from "./contracts/observation-contract.js";

/**
 * Extended observation result type that may carry an optional
 * description projected from the original Observation definition.
 */
type ObservationResultWithMeta = ObservationResult & { description?: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVIDENCE_INTEGRITY_PREFIX = "alix-evolution-observed-v1:";
const DEFAULT_EVIDENCE_TTL_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// ObservationBuildInput
// ---------------------------------------------------------------------------

export interface ObservationBuildInput {
  /** The evolution proposal ID. */
  readonly proposalId: string;
  /** The evolution ID. */
  readonly evolutionId: string;
  /** Snapshot hash of the environment at observation time. */
  readonly environmentHash: string;
  /** Observation results to aggregate into evidence. */
  readonly observations: readonly ObservationResult[];
  /** Optional observation timestamp (for deterministic contexts). Defaults to now. */
  readonly observedAt?: string;
}

// ---------------------------------------------------------------------------
// buildObservationEvidence
// ---------------------------------------------------------------------------

export function buildObservationEvidence(input: ObservationBuildInput): VerificationEvidence {
  const { proposalId, evolutionId, environmentHash, observations } = input;
  const now = input.observedAt ?? new Date().toISOString();

  // Aggregate metrics
  const passCount = observations.filter((o) => o.status === "pass").length;
  const failCount = observations.filter((o) => o.status === "fail").length;
  const errorCount = observations.filter((o) => o.status === "error").length;
  const inconclusiveCount = observations.filter((o) => o.status === "inconclusive").length;
  const totalCount = observations.length;

  const confidences = observations.map((o) => o.confidence);
  const meanConfidence = confidences.length > 0
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : 0;

  // Faithful behavioral change projections (NOT governance interpretations)
  const behavioralChanges: string[] = [];
  for (const obsRaw of observations) {
    const obs = obsRaw as ObservationResultWithMeta;
    const desc = obs.description ?? obs.observationId;
    if (obs.status === "pass") {
      behavioralChanges.push(`Observation "${obs.observationId}" passed: ${desc}`);
    } else if (obs.status === "fail") {
      const expected = obs.expected !== undefined ? ` (expected: ${JSON.stringify(obs.expected)}, observed: ${JSON.stringify(obs.observed)})` : "";
      behavioralChanges.push(`Observation "${obs.observationId}" FAILED: ${desc}${expected}`);
    } else if (obs.status === "error") {
      behavioralChanges.push(`Observation "${obs.observationId}" ERROR: ${desc}`);
    } else {
      behavioralChanges.push(`Observation "${obs.observationId}" inconclusive: ${desc}`);
    }
  }

  // Build lineage
  const lineage = [
    {
      step: "observation",
      sourceId: input.evolutionId,
      sourceType: "evaluation" as const,
      timestamp: now,
    },
    ...observations.map((o) => ({
      step: "observation_result" as const,
      sourceId: o.observationId,
      sourceType: "evaluation" as const,
      timestamp: o.observedAt,
    })),
  ];

  // Compute deterministic evidence ID from input content
  const idPayload = canonicalStringify({
    proposalId,
    evolutionId,
    environmentHash,
    observationCount: observations.length,
    observationIds: observations.map((o) => o.observationId),
  });
  const idHash = createHash("sha256").update(idPayload).digest("hex");
  const evidenceId = `obs-ev-${idHash.slice(0, 8)}`;

  // Build evidence without integrity hash
  const expiresAt = new Date(new Date(now).getTime() + DEFAULT_EVIDENCE_TTL_DAYS * MS_PER_DAY).toISOString();

  const evidence = {
    evidenceId,
    verificationId: `obs-${input.evolutionId}`,
    proposalId,
    replayDatasetId: "",
    evidenceClass: "observed" as const,
    proposalSnapshotHash: "",
    environmentHash,
    baselineMetrics: {
      totalCount,
      passCount,
      failCount,
      errorCount,
      inconclusiveCount,
      meanConfidence,
    } as Record<string, number>,
    candidateMetrics: {} as Record<string, number>,
    metricDeltas: {
      passRate: totalCount > 0 ? passCount / totalCount : 0,
      failRate: totalCount > 0 ? failCount / totalCount : 0,
      errorRate: totalCount > 0 ? errorCount / totalCount : 0,
    } as Record<string, number>,
    behavioralChanges,
    confidenceProfile: {
      overallConfidence: meanConfidence,
      minConfidence: confidences.length > 0 ? Math.min(...confidences) : 0,
      maxConfidence: confidences.length > 0 ? Math.max(...confidences) : 0,
      decayFactor: 0,
      confidenceSources: ["observation"] as readonly string[],
      contributorCount: observations.length,
    },
    reproducibilityLevel: 0 as const,
    lineage,
    verifiedAt: now,
    expiresAt,
    reverificationRequired: false,
    integrityHash: "",
  };

  // Compute integrity hash
  const { integrityHash: _h, ...withoutHash } = evidence;
  void _h;
  const clean = Object.fromEntries(
    Object.entries(withoutHash).filter(([_, v]) => v !== undefined),
  );
  const payload = canonicalStringify(clean);
  const hash = createHash("sha256");
  hash.update(EVIDENCE_INTEGRITY_PREFIX);
  hash.update(payload, "utf8");
  evidence.integrityHash = hash.digest("hex");

  return evidence as unknown as VerificationEvidence;
}
