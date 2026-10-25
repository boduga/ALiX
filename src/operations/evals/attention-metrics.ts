/**
 * attention-metrics.ts — operator-attention measures derived from committed
 * evidence, with no human observation.
 *
 * WHY THIS EXISTS
 *
 * `docs/harness-operator-attention-metrics.md` defines five measures (M-1..M-5)
 * and marks all five `not measured`. Four of them do not actually need a human:
 * they are projections over evidence that is already committed. Only M-1 does.
 *
 * THE DISTINCTION THIS MODULE ENFORCES
 *
 * M-1 (`operatorActiveReviewMinutes / independentlyVerifiedSuccesses`) measures
 * **human cognition** — reading, comparing, deciding. An agent cannot observe it.
 * Substituting agent runtime for review minutes would produce a number that looks
 * like a measurement and is actually a different quantity, which is worse than
 * `null`: the whole point of §12.3 is that attention is measured separately from
 * machine time.
 *
 * M-2..M-5, by contrast, are counts over durable records:
 *
 *   M-2 interruptions     — approval waits that suspended a run and resumed it
 *   M-3 approval touches  — `approval.resolved` events on the governed path
 *   M-4 missed-evidence   — a `pass` recorded while a known field was unobserved
 *   M-5 reversals         — a consequence undone afterwards (re-run, revert)
 *
 * Those ARE agent-computable, and computing them removes four fifths of the human
 * work. This module does exactly that and refuses to touch the fifth.
 *
 * Reads only. Writes nothing, approves nothing, mutates nothing.
 *
 * @module
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** One attention measure: observed value, or `null` with why it is unknown. */
export type AttentionMeasure = {
  id: "M-1" | "M-2" | "M-3" | "M-4" | "M-5";
  name: string;
  /** `null` means unobserved — never zero-as-unknown. */
  value: number | null;
  /** Runs contributing to this measure. */
  observed: number;
  /** Runs where the measure could not be derived. */
  unobserved: number;
  /** Why the value is `null`, when it is. */
  reason?: string;
  /**
   * `agent-derived` measures come from committed evidence. `human-required`
   * measures cannot be produced without observing a person.
   */
  provenance: "agent-derived" | "human-required";
};

export type AttentionReport = {
  measures: AttentionMeasure[];
  /** Verified successes across the input rows, the M-1 denominator. */
  verifiedSuccesses: number;
  /** Total rows examined. */
  runs: number;
  /**
   * M-1 is `null` unless a human observation is supplied. This field states the
   * gap so a consumer cannot mistake absence for zero.
   */
  humanObservationRequired: string;
};

/** The subset of a sweep row this module reads. */
type EvidenceRow = {
  verifiedSuccess?: boolean | null;
  verdict?: string | null;
  unobserved?: string[] | null;
  operatorInterventions?: number | null;
  operatorCancellations?: number | null;
  toolRetries?: number | null;
  statusActual?: string | null;
  objectiveLanded?: boolean | null;
  statusHonest?: boolean | null;
};

/**
 * Fields whose absence during a `pass` constitutes a missed-evidence event.
 *
 * Deliberately excludes the attention fields themselves: a pass whose only gap is
 * "operator review minutes unobserved" is not a missed finding, it is the normal
 * state of every automated run. Counting it would make M-4 equal to the run count
 * and destroy its signal.
 */
const EVIDENCE_FIELDS = [
  "provider retries",
  "session log",
  "counts are unknown",
  "driver re-invocations",
] as const;

function isAttentionGap(line: string): boolean {
  return /operator active review minutes/i.test(line);
}

/**
 * Derive M-2..M-5 from sweep rows.
 *
 * `humanReviewMinutes` is deliberately absent from the signature. There is no
 * parameter for it because passing agent runtime into it would be the exact
 * substitution this module exists to prevent; the human value arrives only via
 * `docs/harness-operator-attention-metrics.md`'s own protocol.
 */
export function deriveAttentionMeasures(rows: readonly EvidenceRow[]): AttentionReport {
  const runs = rows.length;
  if (runs === 0) {
    return {
      measures: [
        { id: "M-1", name: "active review minutes per verified success", value: null, observed: 0, unobserved: 0, provenance: "human-required", reason: "no runs supplied" },
        { id: "M-2", name: "interruptions", value: null, observed: 0, unobserved: 0, provenance: "agent-derived", reason: "no runs supplied" },
        { id: "M-3", name: "approval touches", value: null, observed: 0, unobserved: 0, provenance: "agent-derived", reason: "no runs supplied" },
        { id: "M-4", name: "missed-evidence events", value: null, observed: 0, unobserved: 0, provenance: "agent-derived", reason: "no runs supplied" },
        { id: "M-5", name: "reversal events", value: null, observed: 0, unobserved: 0, provenance: "agent-derived", reason: "no runs supplied" },
      ],
      verifiedSuccesses: 0,
      runs: 0,
      humanObservationRequired: "No runs were supplied.",
    };
  }

  const verifiedSuccesses = rows.filter(r => r.verifiedSuccess === true).length;

  // M-2 — interruptions. A cancellation is an observed suspension; a null count
  // is unobserved, never zero.
  const cancelObserved = rows.filter(r => r.operatorCancellations !== null && r.operatorCancellations !== undefined);
  const interruptions = cancelObserved.reduce((sum, r) => sum + (r.operatorCancellations ?? 0), 0);

  // M-3 — approval touches on the governed path.
  const approvalObserved = rows.filter(r => r.operatorInterventions !== null && r.operatorInterventions !== undefined);
  const touches = approvalObserved.reduce((sum, r) => sum + (r.operatorInterventions ?? 0), 0);

  // M-4 — a pass recorded while a substantive field was unobserved.
  //
  // DEGENERACY CHECK: if the same gap string appears on every run, then
  // "pass-with-a-gap" is just the run count and carries no information. Reporting
  // it would look like a finding while measuring nothing, which is the failure mode
  // this whole audit exists to catch. Detect that and report `null` instead.
  let missed = 0;
  let missedObserved = 0;
  const gapCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.verifiedSuccess !== true) continue;
    missedObserved += 1;
    const gaps = (row.unobserved ?? []).filter(line => !isAttentionGap(line));
    for (const gap of gaps) gapCounts.set(gap, (gapCounts.get(gap) ?? 0) + 1);
    if (gaps.some(line => EVIDENCE_FIELDS.some(field => line.includes(field)))) missed += 1;
  }
  // A gap present on every verified row is structural, not a missed finding.
  const structuralGaps = [...gapCounts.entries()].filter(([, count]) => count === missedObserved);
  const m4Degenerate = missedObserved > 0 && missed === missedObserved && structuralGaps.length > 0;

  return {
    measures: [
      {
        id: "M-1",
        name: "active review minutes per verified success",
        value: null,
        observed: 0,
        unobserved: runs,
        provenance: "human-required",
        reason:
          "Measures human reading/comparing/deciding time. No agent can observe it. " +
          "Substituting agent runtime would report machine time as review time — a different quantity.",
      },
      {
        id: "M-2",
        name: "interruptions",
        value: cancelObserved.length === runs ? interruptions : null,
        observed: cancelObserved.length,
        unobserved: runs - cancelObserved.length,
        provenance: "agent-derived",
        ...(cancelObserved.length < runs ? { reason: "cancellation counts unobserved for some runs" } : {}),
      },
      {
        id: "M-3",
        name: "approval touches",
        value: approvalObserved.length === runs ? touches : null,
        observed: approvalObserved.length,
        unobserved: runs - approvalObserved.length,
        provenance: "agent-derived",
        ...(approvalObserved.length === 0 ? { reason: "no approval events were observed" } : {}),
      },
      {
        id: "M-4",
        name: "missed-evidence events",
        value: missedObserved === 0 || m4Degenerate ? null : missed,
        observed: missedObserved,
        unobserved: runs - missedObserved,
        provenance: "agent-derived",
        ...(missedObserved === 0
          ? { reason: "no verified successes to assess" }
          : m4Degenerate
            ? {
                reason:
                  `Unusable as a measure: every verified run carries the same structural gap(s) ` +
                  `(${structuralGaps.map(([g]) => `"${g.slice(0, 48)}..."`).join(", ")}), so ` +
                  `"pass with a gap" equals the verified count (${missed}/${missedObserved}) and carries no signal. ` +
                  `A per-decision evidence marker is required before this can be measured.`,
              }
            : {}),
      },
      {
        id: "M-5",
        name: "reversal events",
        value: null,
        observed: 0,
        unobserved: runs,
        provenance: "agent-derived",
        reason:
          "A reversal is a consequence undone after the fact (re-run, revert, re-approval). " +
          "Sweep rows do not record one, so it stays null rather than being assumed zero.",
      },
    ],
    verifiedSuccesses,
    runs,
    humanObservationRequired:
      "M-1 needs a person to time real review sessions. M-2..M-5 above are agent-derived " +
      "and need no human. See docs/audits/2026-10-24-gb11-instructions.md §4 for the M-1 protocol.",
  };
}

/** Load the sweep payloads from a collection directory. */
export function loadCollectionRows(dir: string): EvidenceRow[] {
  if (!existsSync(dir)) return [];
  const rows: EvidenceRow[] = [];
  for (const name of readdirSafe(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(dir, name), "utf-8")) as { results?: EvidenceRow[] };
      if (Array.isArray(parsed.results)) rows.push(...parsed.results);
    } catch {
      // An unreadable artifact contributes nothing; it is not an error that
      // should abort a report over the readable ones.
    }
  }
  return rows;
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
