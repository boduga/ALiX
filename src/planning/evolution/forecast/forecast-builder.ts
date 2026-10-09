/**
 * A9 — forecast builder (Slice 1, Phase 7).
 *
 * Pure function that aggregates detector findings for a single subject into
 * one `Forecast` artifact.
 *
 * Aggregation rules (locked):
 *   - `max(internalScore)` over the subject's findings determines the band; the
 *     kind of the max-scoring finding is the forecast's prediction kind
 *     (deterministic tie-break by kind).
 *   - Confidence = weighted average of detector confidences, weighted by
 *     internalScore (deterministic).
 *   - Evidence references are preserved (deduplicated, encounter order).
 *
 * Identity: `forecastId` is calculated AFTER canonical content construction, so
 * no persistence/JSONL metadata can affect it. `generatedAt` (from `timestamp`)
 * is identity-bearing content — documented in identity.ts.
 *
 * Validation: throws when the finding set is empty (the engine's no-trigger
 * rule prevents empty artifact construction) or when any finding is malformed
 * (mismatched subject / out-of-range score / confidence).
 *
 * @module evolution/forecast/forecast-builder
 */

import type {
  Forecast,
  ForecastContent,
  DetectorFinding,
} from "./contracts/contract.js";
import {
  FORECAST_VERSION,
  GENERATOR_VERSION,
  FORECAST_HORIZON_DAYS,
} from "./contracts/contract.js";
import { forecastIdFor } from "./identity.js";
import { internalScoreToBand } from "./risk-band.js";
import { assertUnitInterval } from "./scale.js";

/**
 * Build a single forecast artifact from the findings of one subject.
 *
 * @param findings detector findings for ONE subject (non-empty)
 * @param subject the forecast subject (proposal id)
 * @param subjectCapability the capability the subject proposal targets
 * @param timestamp ISO 8601 generation time (identity-bearing)
 * @throws {Error} when findings is empty or contains a mismatched subject
 * @throws {RangeError} when any finding has an out-of-range score/confidence
 */
export function buildForecast(
  findings: ReadonlyArray<DetectorFinding>,
  subject: string,
  subjectCapability: string,
  timestamp: string,
): Forecast {
  // 1. validate
  if (findings.length === 0) {
    throw new Error(
      `buildForecast: no findings for subject '${subject}' — cannot construct a forecast artifact from zero findings`,
    );
  }
  for (const f of findings) {
    if (f.subject !== subject) {
      throw new Error(
        `buildForecast: finding subject '${f.subject}' does not match requested subject '${subject}'`,
      );
    }
    assertUnitInterval(f.internalScore, "finding.internalScore");
    assertUnitInterval(f.confidence, "finding.confidence");
  }

  // 2-4. aggregate: max internalScore; the kind that determined the band is the
  // prediction kind (deterministic tie-break by kind ascending).
  const byScoreDesc = [...findings].sort(
    (a, b) => b.internalScore - a.internalScore || a.kind.localeCompare(b.kind),
  );
  const maxFinding = byScoreDesc[0]!;
  const band = internalScoreToBand(maxFinding.internalScore);

  // 5. weighted confidence: mean of detector confidences weighted by internalScore.
  const totalWeight = findings.reduce((s, f) => s + f.internalScore, 0);
  const confidence =
    totalWeight > 0
      ? findings.reduce((s, f) => s + f.internalScore * f.confidence, 0) / totalWeight
      : maxFinding.confidence;

  // 6. preserve evidence references (deduplicated, encounter order).
  const evidenceRefs = dedupe(findings.flatMap((f) => f.evidenceRefs));

  // 7. construct canonical content (forecastId excluded by the content type).
  const content: ForecastContent = {
    forecastVersion: FORECAST_VERSION,
    subject,
    subjectCapability,
    prediction: {
      kind: maxFinding.kind,
      band,
      internalScore: maxFinding.internalScore,
    },
    horizon: {
      from: timestamp,
      to: addDaysIso(timestamp, FORECAST_HORIZON_DAYS),
    },
    confidence,
    provenance: {
      generatedAt: timestamp,
      generatorVersion: GENERATOR_VERSION,
      evidenceRefs,
    },
  };

  // 8. content-addressed forecastId.
  return { forecastId: forecastIdFor(content), ...content };
}

/** Deduplicate preserving first-occurrence order. */
function dedupe(values: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/** Add whole days to an ISO timestamp (deterministic UTC arithmetic). */
function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}
