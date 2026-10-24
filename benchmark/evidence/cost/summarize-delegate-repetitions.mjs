/**
 * summarize-delegate-repetitions.mjs — quantify variance across delegate sweeps.
 *
 * Gate B requires repetitions, not a single run (harness-benchmark-spec §3 rule
 * 5: "no single-run claims"). This folds N `run-delegate-sweep.mjs` outputs into
 * a per-stratum stability verdict plus a pooled cost-per-verified-success, which
 * is the PRD's primary measure.
 *
 * Reporting rules (inherited from the rest of `benchmark/evidence`):
 *   - a stratum that disagrees across repetitions is reported UNSTABLE, and its
 *     pooled figure carries that caveat rather than a false point estimate;
 *   - cost-per-success is `null` when verified successes are 0 (undefined, never
 *     infinite and never zero);
 *   - cost is `null` when any contributing run could not be priced.
 *
 * Usage:
 *   node benchmark/evidence/cost/summarize-delegate-repetitions.mjs out.json <run1.json> <run2.json> ...
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const STRATA = ["multi-file-fix", "verification-repair", "capability-mix", "tool-failure-recovery"];

export function summarize(runs) {
  const perStratum = {};
  for (const s of STRATA) {
    const points = runs
      .map((r) => r.perStratum?.[s])
      .filter(Boolean)
      .map((b) => ({ verifiedSuccesses: b.verifiedSuccesses, cases: b.cases, costUsd: b.costUsd }));

    const verified = points.reduce((t, p) => t + p.verifiedSuccesses, 0);
    const cases = points.reduce((t, p) => t + p.cases, 0);
    const costsKnown = points.every((p) => typeof p.costUsd === "number");
    const cost = costsKnown ? points.reduce((t, p) => t + p.costUsd, 0) : null;
    const outcomes = points.map((p) => `${p.verifiedSuccesses}/${p.cases}`);
    const stable = new Set(outcomes).size === 1;

    perStratum[s] = {
      repetitions: points.length,
      verifiedSuccesses: verified,
      cases,
      // Rate is the honest per-repetition view; the pooled count alone hides drift.
      perRepetition: outcomes,
      stable,
      costUsd: cost,
      costPerVerifiedSuccessUsd: cost !== null && verified > 0 ? cost / verified : null,
      note: !stable
        ? `UNSTABLE across repetitions (${outcomes.join(" vs ")}) — a single run is not a point estimate for this stratum`
        : verified === 0
          ? "0 verified successes: cost-per-success is undefined, not infinite and not zero"
          : null,
    };
  }

  const totalsCost = runs.every((r) => typeof r.totals?.costUsd === "number")
    ? runs.reduce((t, r) => t + r.totals.costUsd, 0)
    : null;
  const totalsVerified = perStratum ? STRATA.reduce((t, s) => t + perStratum[s].verifiedSuccesses, 0) : 0;
  const totalsCases = STRATA.reduce((t, s) => t + perStratum[s].cases, 0);

  return {
    source: "delegate sweep repetitions",
    provider: runs[0]?.provider ?? null,
    model: runs[0]?.model ?? null,
    repetitions: runs.length,
    completeness: runs.every((r) => r.completeness === "complete") ? "complete" : "partial",
    perStratum,
    totals: {
      inputTokens: runs.reduce((t, r) => t + (r.totals?.inputTokens ?? 0), 0),
      outputTokens: runs.reduce((t, r) => t + (r.totals?.outputTokens ?? 0), 0),
      costUsd: totalsCost,
    },
    pooledCostPerVerifiedSuccessUsd:
      totalsCost !== null && totalsVerified > 0 ? totalsCost / totalsVerified : null,
    pooledNote:
      totalsVerified === 0
        ? "0 verified successes across all repetitions: undefined, not infinite and not zero"
        : "pooled over repetitions; strata marked unstable do not carry a single-run point estimate",
    verifiedSuccesses: totalsVerified,
    cases: totalsCases,
    recordedAt: new Date().toISOString(),
  };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === `file://${resolve(process.argv[1])}`;

if (invokedDirectly) {
  const [out, ...inputs] = process.argv.slice(2);
  if (!out || inputs.length === 0) {
    console.error("usage: summarize-delegate-repetitions.mjs <out.json> <run1.json> [run2.json ...]");
    process.exit(2);
  }
  const runs = inputs.map((p) => JSON.parse(readFileSync(p, "utf8")));
  const summary = summarize(runs);
  writeFileSync(resolve(out), JSON.stringify(summary, null, 2) + "\n");
  console.log(
    `repetitions=${summary.repetitions} verified=${summary.verifiedSuccesses}/${summary.cases} ` +
      `pooled cost/success=${summary.pooledCostPerVerifiedSuccessUsd}`,
  );
  for (const s of STRATA) {
    const b = summary.perStratum[s];
    console.log(`  ${s.padEnd(24)} ${b.stable ? "stable  " : "UNSTABLE"} ${b.perRepetition.join(" vs ")}`);
  }
}
