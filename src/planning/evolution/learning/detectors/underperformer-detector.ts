import type { LearningFinding, MeasurementOutcomeRecord, LearningEngineOptions, LearningFindingKind } from "../contracts/learning-contract.js";

/**
 * underperformer-detector.
 *
 * Pure function over normalized measurement outcomes.
 * Groups by capabilityId within the evidence window; emits one finding
 * per capability whose count of "ineffective" outcomes >= minCardinality.
 *
 * Deterministic: same input + same options → same findings (sorted by
 * identityKey for stability).
 */
export function detectUnderperformer(
  records: ReadonlyArray<MeasurementOutcomeRecord>,
  options: LearningEngineOptions,
  now: string,
): ReadonlyArray<LearningFinding> {
  const windowStart = subtractDays(now, options.evidenceWindowDays);
  const grouped = new Map<string, MeasurementOutcomeRecord[]>();
  for (const r of records) {
    if (r.recordedAt < windowStart || r.recordedAt > now) continue;
    if (r.outcome !== "ineffective") continue;
    const list = grouped.get(r.capabilityId) ?? [];
    list.push(r);
    grouped.set(r.capabilityId, list);
  }

  const findings: LearningFinding[] = [];
  for (const [capabilityId, list] of grouped) {
    if (list.length < options.minCardinality) continue;
    findings.push({
      findingId: `underperformer:${capabilityId}`,
      kind: "underperformer",
      identityKey: capabilityId,
      evidenceWindow: { from: windowStart, to: now },
      occurrences: list.length,
      evidenceRefs: list.map((r) => r.eventId),
      summary: `${list.length} ineffective outcomes for capability ${capabilityId} within ${options.evidenceWindowDays} days`,
    });
  }
  return findings.sort((a, b) => a.identityKey.localeCompare(b.identityKey));
}

function subtractDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

export const UNDERPERFORMER_DETECTOR_KIND: LearningFindingKind = "underperformer";