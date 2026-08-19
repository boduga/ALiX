/**
 * A9 — A2.5 governance bridge (Slice 3, Phase 15).
 *
 * Adapts an `Forecast` into an A2.5 `GovernanceRecommendation` so the
 * forecast can flow through the governance path:
 *
 *   A9 forecast → A2.5 bridge → GovernanceRecommendation → A3 generateDecision
 *
 * Mapping (locked by the A9 plan):
 *
 *   low      → MONITOR
 *   medium   → MONITOR
 *   high     → RISK_GATED_REVIEW
 *   critical → RISK_GATED_REVIEW
 *
 * `RISK_GATED_REVIEW` is the A2.5 sixth kind (Slice 3, Phase 16) — it is not a
 * binding A3 decision kind. A3 maps it 1:1 to `REQUEST_MORE_EVIDENCE`
 * (`RECOMMENDATION_KIND_MAP` in decision-engine.ts), which routes the
 * evolution target state to `UNDER_REVIEW`. This keeps A9 advisory: A3 retains
 * the final, binding decision.
 *
 * ---------------------------------------------------------------------------
 * Field-shape adaptation (mirrors the A8 bridge, src/evolution/learning/governance-bridge.ts)
 * ---------------------------------------------------------------------------
 *
 * The A2.5 verification-framework `GovernanceRecommendation` lives in
 * `src/evolution/verification/contracts/recommendation-contract.ts` and has
 * the shape `{ recommendationId, evidenceId, proposalId, kind, confidence,
 * reasoning, supportingEvidence, risks, createdAt }` — NOT the P9.1 record
 * type in `src/governance/governance-types.ts` (a different, incompatible
 * `GovernanceRecommendation` interface carrying `recommendations: Recommendation[]`).
 *
 * Field adaptations:
 * - `recommendationId`   → REQUIRED non-empty field; derived as
 *                          `a9-rec:${forecast.forecastId}` so the recommendation
 *                          traces to the A9 forecast identity WITHOUT creating a
 *                          second A9 identity (the A9 forecastId is reused).
 * - `proposalId`         → the forecast's `subject` (the proposal the forecast
 *                          is about).
 * - `evidenceId`         → REQUIRED non-empty field; derived as a sha-256-hex
 *                          digest of the sorted evidence refs (deterministic for
 *                          a given forecast — the forecast is content-addressed,
 *                          so identical forecasts yield identical evidenceId).
 * - forecast `confidence` → carried verbatim (validated in [0,1]).
 * - forecast `evidenceRefs` → mapped to `supportingEvidence: string[]` (the
 *                          `validateGovernanceRecommendation` contract field).
 * - `risks`              → REQUIRED field; emitted as `[]`. A9 surfaces
 *                          pre-execution risk via the band → kind mapping, not
 *                          per-forecast risk strings.
 * - forecast `provenance.generatedAt` → `createdAt` (the source artifact
 *                          timestamp).
 *
 * Consumers (decision-engine `computeRecommendationTracking`, etc.) already
 * handle `MONITOR` and — after the Phase 16 kind extension — `RISK_GATED_REVIEW`
 * correctly.
 *
 * @module evolution/forecast/bridge
 */

import { createHash } from "node:crypto";
import type {
  Forecast,
  RiskBand,
} from "./contracts/contract.js";
import type { GovernanceRecommendation } from "../verification/contracts/recommendation-contract.js";

/**
 * Map a locked A6 risk band to the A2.5 recommendation kind.
 *
 * Locked mapping (Slice 3, Phase 15):
 *
 *   low      → MONITOR
 *   medium   → MONITOR
 *   high     → RISK_GATED_REVIEW
 *   critical → RISK_GATED_REVIEW
 *
 * Exhaustive over `RiskBand` — no band falls through.
 */
export function forecastBandToRecommendationKind(
  band: RiskBand,
): GovernanceRecommendation["kind"] {
  switch (band) {
    case "low":
    case "medium":
      return "MONITOR";
    case "high":
    case "critical":
      return "RISK_GATED_REVIEW";
  }
}

/**
 * Build the A2.5 `GovernanceRecommendation` for an A9 forecast.
 *
 * Pure — no side effects, no I/O, no store access. Deterministic: the same
 * forecast always produces the identical recommendation. The recommendation
 * references the A9 forecast identity (`a9-rec:${forecastId}`); no second A9
 * identity is created.
 *
 * The emitted recommendation satisfies `validateGovernanceRecommendation`
 * (recommendation-contract.ts).
 */
export function buildGovernanceRecommendation(
  forecast: Forecast,
): GovernanceRecommendation {
  const band = forecast.prediction.band;

  return {
    recommendationId: `a9-rec:${forecast.forecastId}`,
    evidenceId: hashEvidenceRefs(forecast),
    proposalId: forecast.subject,
    kind: forecastBandToRecommendationKind(band),
    confidence: forecast.confidence,
    reasoning:
      `A9 pre-execution risk forecast ${forecast.forecastId} projected band '${band}' for proposal ${forecast.subject} (subject capability ${forecast.subjectCapability}); producer: a9_pre_execution_risk_forecast`,
    supportingEvidence: [...forecast.provenance.evidenceRefs],
    risks: [],
    createdAt: forecast.provenance.generatedAt,
  };
}

/**
 * Derive a stable `evidenceId` from the forecast's evidence references.
 *
 * The validator requires `evidenceId` to be a non-empty string; it does not
 * prescribe shape. We use a sha-256 hex digest of the joined, sorted evidence
 * refs so two identical forecasts (same content-addressed forecastId) yield
 * identical `evidenceId` values, while forecasts differing in even one ref
 * diverge.
 */
function hashEvidenceRefs(forecast: Forecast): string {
  const refs = [...forecast.provenance.evidenceRefs].sort((a, b) => a.localeCompare(b));
  return createHash("sha256").update(refs.join("|")).digest("hex");
}
