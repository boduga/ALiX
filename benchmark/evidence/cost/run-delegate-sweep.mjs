/**
 * run-delegate-sweep.mjs — regenerate `cost/delegate-metered-sweep.json`.
 *
 * Why this exists: that cost record was the largest unattributed gap in the
 * reproducibility table (strata 4, 5, 7, 10). Its numbers were produced by a
 * one-off sweep that was never promoted, so the record could be read but not
 * regenerated — a Gate B blocker. This driver rebuilds the record from the
 * committed `eval-case-sweep.mjs`, which now attributes EVERY behavioral case to
 * its PRD stratum.
 *
 * Contract, inherited from the rest of `benchmark/evidence`:
 *   - never estimate cost; price only what the catalog knows,
 *   - unknown pricing stays `null`, never zero,
 *   - 0 verified successes makes cost-per-success UNDEFINED (null), not infinite
 *     and not zero,
 *   - the provider/model is the operator's current default unless an explicit
 *     `--provider/--model` one-off is deliberately given.
 *
 * Usage:
 *   node benchmark/evidence/cost/run-delegate-sweep.mjs --out <path>
 *   node benchmark/evidence/cost/run-delegate-sweep.mjs --provider openai --model gpt-4o --out <path>
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sweepCases, resolveSweepModel, CASE_STRATUM, priceUsage } from "./eval-case-sweep.mjs";
import { BEHAVIORAL_CASES } from "../../../dist/src/operations/evals/cases/index.js";
import { defaultPricingCatalog } from "../../../dist/src/operations/observability/cost-attribution.js";

const CATALOG = defaultPricingCatalog();

/** Strata this driver is responsible for (the delegate-driven ones). */
export const DELEGATE_STRATA = [
  "multi-file-fix",
  "verification-repair",
  "capability-mix",
  "tool-failure-recovery",
];

/** Behavioral cases the delegate driver owns, derived from the stratum map. */
export function delegateCases() {
  return BEHAVIORAL_CASES
    .filter((c) => c.driver === "delegate")
    .filter((c) => DELEGATE_STRATA.includes(CASE_STRATUM[c.id]))
    // Exclude scripted-contract cases: their expectation is authored for the
    // scripted provider, so a real model that does the task is scored false.
    // Measured 2026-10-22: sweeping them burned 52.7% of the budget for zero
    // usable evidence.
    .filter((c) => !c.scriptedExpectationOnly)
    .map((c) => c.id);
}

function flag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

/**
 * Fold per-case priced results into the per-stratum shape the coverage matrix
 * reads. A stratum with zero verified successes reports `null` cost-per-success
 * with an explicit note — the matrix refuses to treat that as zero.
 */
export function foldPerStratum(results) {
  const perStratum = {};
  for (const r of results) {
    const stratum = CASE_STRATUM[r.caseId];
    if (!stratum) continue;
    const bucket = (perStratum[stratum] ??= {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      cases: 0,
      verifiedSuccesses: 0,
      costPerVerifiedSuccessUsd: null,
      costPerSuccessNote: null,
      pricedCases: 0,
    });
    bucket.cases += 1;
    bucket.inputTokens += r.usage?.inputTokens ?? 0;
    bucket.outputTokens += r.usage?.outputTokens ?? 0;
    // A case whose usage could not be priced makes the stratum's cost unknown.
    if (typeof r.costUsd === "number") {
      bucket.costUsd += r.costUsd;
      bucket.pricedCases += 1;
    }
    if (r.verifiedSuccess) bucket.verifiedSuccesses += 1;
  }
  for (const bucket of Object.values(perStratum)) {
    const priced = bucket.pricedCases === bucket.cases && bucket.cases > 0;
    if (!priced) {
      bucket.costUsd = null;
    } else if (bucket.verifiedSuccesses > 0) {
      bucket.costPerVerifiedSuccessUsd = bucket.costUsd / bucket.verifiedSuccesses;
    } else {
      bucket.costPerVerifiedSuccessUsd = null;
      bucket.costPerSuccessNote =
        "0 verified successes: cost-per-success is undefined, not infinite and not zero";
    }
  }
  return perStratum;
}

export async function runDelegateSweep({ provider, model }) {
  const cases = delegateCases();
  if (cases.length === 0) throw new Error("no delegate cases resolved from CASE_STRATUM");
  const results = await sweepCases(cases, { provider, model });

  const perStratum = foldPerStratum(results);
  const priced = results.filter((r) => typeof r.costUsd === "number");
  const entry = CATALOG.lookup(provider, model);
  const totals = {
    inputTokens: results.reduce((s, r) => s + (r.usage?.inputTokens ?? 0), 0),
    outputTokens: results.reduce((s, r) => s + (r.usage?.outputTokens ?? 0), 0),
    costUsd: priced.length === results.length && results.length > 0
      ? results.reduce((s, r) => s + r.costUsd, 0)
      : null,
  };

  return {
    source: "delegate eval sweep on a real priced model, regenerated from eval-case-sweep.mjs",
    provider,
    model,
    completeness: priced.length === results.length && results.length > 0 ? "complete" : "partial",
    rate: entry
      ? { inputPerMillion: entry.inputPerMillion, outputPerMillion: entry.outputPerMillion, effectiveFrom: entry.effectiveFrom }
      : null,
    perStratum,
    totals,
    runIdAttribution: {
      present: false,
      reason:
        "subagent children have no authoritative caller run identity; field omitted rather than guessed. " +
        "Case id identifies the run for eval purposes.",
    },
    caseOutcomes: results.map((r) => ({
      caseId: r.caseId,
      stratum: CASE_STRATUM[r.caseId] ?? null,
      verdict: r.verdict,
      verifiedSuccess: r.verifiedSuccess,
      objectiveLanded: r.objectiveLanded,
      statusHonest: r.statusHonest,
      // Keep the reported-vs-expected pair: it is the difference between "the
      // guard held and the model was honest about failing" and "the model claimed
      // success it did not achieve". Both collapse to the same booleans above.
      statusActual: r.statusActual ?? null,
      statusExpected: r.statusExpected ?? null,
      objectiveExpected: r.objectiveExpected ?? null,
      costUsd: r.costUsd ?? null,
      completeness: r.completeness ?? null,
    })),
    verifiedBy:
      "usage captured before case-cwd cleanup; arithmetic reproduced against the production pricing catalog",
    recordedAt: new Date().toISOString(),
  };
}

async function main() {
  const explicitProvider = flag("provider");
  const explicitModel = flag("model");
  const selected = resolveSweepModel(explicitProvider, explicitModel);
  const out = flag("out");
  if (!out && !hasFlag("dry-run")) {
    throw new Error("--out <path> is required (refusing to silently overwrite recorded evidence)");
  }
  if (hasFlag("dry-run")) {
    console.log(JSON.stringify({ cases: delegateCases(), provider: selected.provider, model: selected.name }, null, 2));
    return;
  }
  const record = await runDelegateSweep({ provider: selected.provider, model: selected.name });
  writeFileSync(resolve(out), JSON.stringify(record, null, 2) + "\n");
  const failed = record.caseOutcomes.filter((c) => !c.verifiedSuccess).length;
  console.log(
    `delegate sweep: ${record.caseOutcomes.length} cases, ${failed} not verified, ` +
      `cost ${record.totals.costUsd ?? "unknown"} (${record.completeness})`,
  );
}

if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
  await main();
}
