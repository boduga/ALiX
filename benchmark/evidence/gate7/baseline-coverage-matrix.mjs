#!/usr/bin/env node
/**
 * baseline-coverage-matrix.mjs — P0-D3 coverage matrix.
 *
 * Answers the operator's question directly: which of the ten PRD strata have
 * (a) independently verified runs, (b) measured cost, and (c) what is blocking
 * the rest.
 *
 * Reads the recorded evidence summary files, never re-runs anything. A stratum
 * with no evidence is reported as BLOCKED, never as zero or pass.
 *
 * Usage: node baseline-coverage-matrix.mjs [<evidence-dir>] [<evaluator-run.json>]
 *
 * `evidence-dir` defaults to this script's own directory, so the recorded Gate 7
 * evidence is reproducible from a clean checkout with no arguments and no
 * dependency on any directory outside the repository (finding C-03).
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const evidenceDir = process.argv[2] ?? scriptDir;
const repoEvidenceDir = join(scriptDir, "..");
/** First existing path wins, so both the in-repo layout and a flat layout work. */
function firstExisting(paths) {
  for (const candidate of paths) if (candidate && existsSync(candidate)) return candidate;
  return paths[0];
}
/**
 * Optional cost-evidence files. Each is a `verify-f1e-cost-proof.mjs`-style
 * result or `{ stratum, runId, costUsd, completeness, verifiedSuccesses }`.
 * Cost is only counted for a stratum when a record names it AND reports a
 * numeric cost, `completeness: "complete"`, and a positive integer success count.
 * Anything else stays `null` —
 * an incomplete total is not a measured cost.
 */
const explicitCostPaths = process.argv.slice(4);
/** In-repo defaults, used only when the caller supplies none. */
const DEFAULT_COST_PATHS = [
  join(repoEvidenceDir, "cost", "cost-record.json"),
  join(repoEvidenceDir, "cost", "eval-mainloop-metered.json"),
  join(repoEvidenceDir, "cost", "readonly-navigation.json"),
  join(repoEvidenceDir, "cost", "positive-strata-4-7.json"),
  // Retained so the stale single run stays visible rather than deleted. It is
  // read FIRST because a single run must never outrank its own repetitions —
  // this record predates the owned-scope authorization fix (bf29449b), and its
  // outcomes no longer reproduce (multi-file-fix 0/2 recorded, 2/2 and 1/2 on
  // repetition). Later entries overwrite earlier ones, so precedence is the
  // array order.
  join(repoEvidenceDir, "cost", "delegate-metered-sweep.json"),
  join(repoEvidenceDir, "cost", "coordination-metered.json"),
  join(repoEvidenceDir, "cost", "stratum8-restart.json"),
  // Repetition record (n>=2) LAST so it SUPERSEDES the single 2026-10-20 sweep.
  // Preferring repetitions is the point of Gate B (benchmark-spec §3 rule 5).
  join(repoEvidenceDir, "cost", "delegate-repetitions-2026-10-22.json"),
].filter(existsSync);
const costEvidencePaths = explicitCostPaths.length > 0 ? explicitCostPaths : DEFAULT_COST_PATHS;
/** Default to the recorded deterministic eval run, so no args reproduces all ten strata. */
const evalRunPath = process.argv[3] ?? firstExisting([
  join(repoEvidenceDir, "eval-runs", "deterministic-14of14.json"),
]);

if (!evidenceDir) {
  console.error("usage: node baseline-coverage-matrix.mjs <evidence-dir> [<evaluator-run.json>]");
  process.exit(2);
}

/** The ten PRD strata, in PRD order. */
const STRATA = [
  { id: "readonly-inspection", label: "1. Read-only factual inspection" },
  { id: "code-navigation", label: "2. Unfamiliar-code navigation" },
  { id: "single-file-edit", label: "3. Single-file edit" },
  { id: "multi-file-fix", label: "4. Multi-file bug fix" },
  { id: "verification-repair", label: "5. Verification / repair" },
  // Label states what the evidence actually exercises. The PRD stratum text says
  // "four-worker"; every recorded run here tops out at 3 workers (run-fanout 3,
  // run-deps 3, f8b-final 2, the metered run concurrency=3). Labelling it "four"
  // overstated the coverage.
  { id: "coordination-ownership", label: "6. Coordination with ownership (3 workers exercised)" },
  { id: "capability-mix", label: "7. Allow/ask/deny capability mixes" },
  { id: "crash-outcome-unknown", label: "8. Crash / restart, outcome unknown" },
  { id: "local-cpu-only", label: "9. Local CPU-only execution" },
  { id: "tool-failure-recovery", label: "10. Tool failure / malformed tool calls" },
];

/**
 * Recorded Gate 7 evidence → stratum. Determined from what each scenario
 * actually exercised, not from its directory name.
 */
const GATE7_SCENARIOS = [
  { dir: "run-fanout", stratum: "coordination-ownership", label: "3-worker fan-out, disjoint scopes" },
  { dir: "run-deps", stratum: "coordination-ownership", label: "dependency ordering" },
  { dir: "run-conflict", stratum: "coordination-ownership", label: "ownership serialization" },
  { dir: "run-failure", stratum: "coordination-ownership", label: "failure propagation" },
  { dir: "q7-deny5", stratum: "capability-mix", label: "operator denial → approval_denied" },
  { dir: "f8b-final", stratum: "capability-mix", label: "cross-process worker approvals, 0 warnings" },
  { dir: "restart-final", stratum: "crash-outcome-unknown", label: "process restart, durable state reload" },
];

/** Behavioral eval case → stratum. Derived from what each case exercises. */
const EVAL_CASE_STRATUM = {
  "behavioral.write-file": "single-file-edit",
  "behavioral.patch-application": "single-file-edit",
  "behavioral.block-replacement": "single-file-edit",
  "behavioral.read-only": "readonly-inspection",
  "behavioral.unmet-write-zero-attempts": "capability-mix",
  "behavioral.forbidden-path-write": "capability-mix",
  "behavioral.partial-objective": "capability-mix",
  // Strata 2, 4, 5, 10 — deterministic coverage added after the first baseline.
  "behavioral.code-navigation": "code-navigation",
  "behavioral.multi-file-fix": "multi-file-fix",
  "behavioral.multi-file-fix-partial": "multi-file-fix",
  "behavioral.verification-repair": "verification-repair",
  "behavioral.verification-repair-not-applied": "verification-repair",
  "behavioral.tool-failure-recovery": "tool-failure-recovery",
  "behavioral.malformed-tool-call": "tool-failure-recovery",
};

function readSummary(dir) {
  const path = join(evidenceDir, dir, "summary.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

const rows = [];

// Gate 7 recorded scenarios.
for (const scenario of GATE7_SCENARIOS) {
  const summary = readSummary(scenario.dir);
  if (!summary) continue;
  const status = String(summary.run?.status ?? "unknown");
  const workers = Array.isArray(summary.run?.workers) ? summary.run.workers.length : 0;
  rows.push({
    stratum: scenario.stratum,
    source: `Gate 7 ${scenario.dir}`,
    label: scenario.label,
    verified: status === "completed" || status === "failed" ? "yes" : "no",
    status,
    workers,
    costMeasured: "no — recorded summaries carry no usage/pricing",
    kind: "real-model (provider-backed, previously recorded)",
  });
}

// Behavioral eval results, when a run file is supplied.
if (evalRunPath && existsSync(evalRunPath)) {
  try {
    const run = JSON.parse(readFileSync(evalRunPath, "utf8"));
    for (const result of run.results ?? []) {
      const stratum = EVAL_CASE_STRATUM[result.caseId];
      if (!stratum) {
        console.error(`warning: no stratum mapping for eval case ${result.caseId}; excluded`);
        continue;
      }
      rows.push({
        stratum,
        source: `eval ${result.caseId}`,
        label: result.caseId,
        verified: result.verdict === "pass" ? "yes" : "no",
        status: result.execution?.status ?? result.execution?.reason ?? "unknown",
        workers: 0,
        costMeasured: "no — scripted provider, no billable usage",
        kind: "deterministic (scripted provider)",
      });
    }
  } catch (err) {
    console.error(`could not read evaluator run at ${evalRunPath}: ${err.message}`);
  }
}

/**
 * Local CPU-only observations (stratum 9).
 *
 * Read from `<evidence>/s9-local-cpu/stratum9-observation.json`. A row counts as
 * verified only when it names a runId, a local provider, and exit code 0 — the
 * same fail-closed posture as the CPU-only guard. Cost stays null: local
 * inference is non-billable, and null is not zero.
 */
const S9_PATH = firstExisting([
  join(evidenceDir, "s9-local-cpu", "stratum9-observation.json"),
  join(repoEvidenceDir, "cost", "stratum9-observation.json"),
]);
if (existsSync(S9_PATH)) {
  try {
    const o = JSON.parse(readFileSync(S9_PATH, "utf8"));
    const localProvider = ["ollama", "local-llama"].includes(String(o.provider).toLowerCase());
    const ok = Boolean(o.runId) && localProvider && Number(o.exitCode) === 0;
    rows.push({
      stratum: "local-cpu-only",
      source: `run ${o.runId}`,
      label: `${o.provider}/${o.model} — "${o.objective}"`,
      verified: ok ? "yes" : "no",
      status: String(o.outcome ?? "unknown"),
      workers: 0,
      costMeasured: "no — local CPU inference is non-billable (cost is null, not zero)",
      kind: `local CPU-only (${o.processor ?? "CPU"}), ${o.network ?? "no network"}`,
    });
    if (!ok) {
      console.error(`warning: stratum-9 observation at ${S9_PATH} did not qualify (runId/provider/exit)`);
    }
  } catch (err) {
    console.error(`warning: could not read stratum-9 observation: ${err.message}`);
  }
}

/**
 * The crash/restart stratum measured on a real model (stratum 8).
 *
 * Read from `<evidence>/coordination/stratum8-gpt4o.json`. The run is killed on
 * a persisted running worker and resumed, so the row reports the FINAL run
 * state and the crash integrity fields. A row counts as verified only when the
 * final run completed with a success outcome and every worker completed.
 */
const S8_PATH = firstExisting([
  join(repoEvidenceDir, "coordination", "stratum8-gpt4o.json"),
]);
if (existsSync(S8_PATH)) {
  try {
    const o = JSON.parse(readFileSync(S8_PATH, "utf8"));
    const final = o.finalRun ?? {};
    const workerStates = Array.isArray(final.workers) ? final.workers : [];
    const ok = final.status === "completed"
      && final.outcome === "success"
      && workerStates.length > 0
      && workerStates.every(w => w === "completed");
    rows.push({
      stratum: "crash-outcome-unknown",
      source: `coordination restart/crash (${o.provider}/${o.model})`,
      label: o.objective ?? "restart/crash scenario",
      verified: ok ? "yes" : "no",
      status: String(final.status ?? "unknown"),
      workers: workerStates.length,
      costMeasured: o.usage?.observed
        ? "yes — usage observed, priced from the catalog"
        : "no — no usage observed",
      kind: "real-model (provider-backed, crash-injected)",
    });
    if (!ok) {
      console.error(`warning: stratum-8 evidence at ${S8_PATH} did not qualify (final run/workers)`);
    }
  } catch (err) {
    console.error(`warning: could not read stratum-8 evidence: ${err.message}`);
  }
}

// Cost evidence. Only complete, numeric, stratum-attributed records count.
const costByStratum = new Map();
/** Recorded cost without an explicit positive success count is not a baseline. */
const zeroSuccessCost = new Map();
for (const path of costEvidencePaths) {
  if (!existsSync(path)) {
    console.error(`warning: cost evidence not found at ${path}; ignoring`);
    continue;
  }
  let record;
  try {
    record = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.error(`warning: could not parse cost evidence ${path}: ${err.message}; ignoring`);
    continue;
  }
  const stratum = record.stratum;
  const cost = record.costUsd ?? record.observedCostUsd;

  // Completeness is checked first: an incomplete total is not a measured cost,
  // whatever shape the record has.
  if (record.completeness !== "complete") {
    console.error(`warning: cost evidence ${path} completeness is "${record.completeness}", not complete; ignoring`);
    continue;
  }

  // A record may attribute several strata at once (a multi-case eval run). It
  // carries no top-level `stratum`, so this branch must be evaluated BEFORE the
  // single-stratum guard below would reject it for lacking one.
  if (record.perStratum && typeof record.perStratum === "object") {
    for (const [id, entry] of Object.entries(record.perStratum)) {
      if (entry?.completeness !== undefined && entry.completeness !== "complete") continue;
      const perCost = entry?.costUsd;
      if (typeof perCost !== "number" || !Number.isFinite(perCost) || perCost < 0) {
        console.error(`warning: ${path} perStratum["${id}"] has no finite cost; ignored`);
        continue;
      }
      // The PRD's primary measure is cost per INDEPENDENTLY VERIFIED SUCCESS.
      // Cost recorded on a stratum with zero verified successes is a real
      // observation but it is NOT a usable cost-per-success baseline, so it must
      // not be counted as "measured". Missing counts remain unknown.
      if (!Number.isInteger(entry.verifiedSuccesses) || entry.verifiedSuccesses <= 0) {
        zeroSuccessCost.set(id, { costUsd: perCost, note: entry.verifiedSuccesses === 0
          ? "ZERO verified successes" : "no explicit positive verified-success count" });
        continue;
      }
      costByStratum.set(id, {
        runId: entry.runId ?? record.runId,
        costUsd: perCost,
        // A repetition summary reports whether outcomes AGREED across runs. That
        // is a property of the MEASUREMENT, not the cost, so it rides alongside:
        // a drifting success count does not support a single-run point estimate
        // even when the cost total is complete (benchmark-spec §3 rule 5).
        unstable: entry.stable === false ? entry.perRepetition ?? null : null,
        repetitions: typeof record.repetitions === "number" ? record.repetitions : null,
      });
    }
    continue;
  }

  if (!stratum) {
    console.error(`warning: cost evidence ${path} does not name a stratum; ignoring`);
    continue;
  }
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
    console.error(`warning: cost evidence ${path} has no finite numeric cost; ignoring`);
    continue;
  }
  if (!Number.isInteger(record.verifiedSuccesses) || record.verifiedSuccesses <= 0) {
    zeroSuccessCost.set(stratum, { costUsd: cost, note: record.verifiedSuccesses === 0
      ? "ZERO verified successes" : "no explicit positive verified-success count" });
    continue;
  }
  if (record.completeness !== "complete") {
    console.error(`warning: cost evidence ${path} completeness is "${record.completeness}", not complete; ignoring`);
    continue;
  }
  // A record may attribute several strata at once (a multi-case eval run).
  // Each per-stratum figure is validated by the same rules as the total.
  //
  // A repetition summary also reports whether outcomes AGREED across runs. That
  // is a property of the measurement, not of the cost, so it is carried
  // alongside: a stratum whose success count drifts between repetitions does not
  // support a single-run point estimate even when its cost total is complete
  // (harness-benchmark-spec §3 rule 5).
  costByStratum.set(stratum, {
    runId: record.runId,
    costUsd: cost,
    unstable: record.stable === false ? record.perRepetition ?? null : null,
    repetitions: typeof record.repetitions === "number" ? record.repetitions : null,
  });
}

// Aggregate per stratum.
const byStratum = new Map();
for (const row of rows) {
  const list = byStratum.get(row.stratum) ?? [];
  list.push(row);
  byStratum.set(row.stratum, list);
}

console.log("# Baseline coverage matrix (P0-D3)\n");
console.log("Recorded artifact coverage only — not Gate B qualification. Scripted and historical rows are not repeated real-model baseline evidence.\n");
console.log("| # | Stratum | Verified runs | Measured cost | Blocking |");
console.log("|---|---|---|---|---|");

const unmeasured = [];
/**
 * Strata whose cost is structurally unmeasurable rather than outstanding work:
 * local CPU-only inference is not billable, so no usage↔pricing record can
 * exist. They are still verified evidence; reporting them as "blocked" would
 * imply convertible work that does not exist. Kept separate from `unmeasured`.
 */
const nonBillable = [];
for (const stratum of STRATA) {
  const found = byStratum.get(stratum.id) ?? [];
  const verified = found.filter(r => r.verified === "yes").length;
  const costRecord = costByStratum.get(stratum.id);
  const costAny = costRecord !== undefined || found.some(r => !r.costMeasured.startsWith("no"));

  let blocking;
  if (found.length === 0) {
    blocking = "**no evidence at all** — case coverage missing";
    unmeasured.push(stratum.id);
  } else if (verified === 0) {
    blocking = "evidence exists but no verified run";
    unmeasured.push(stratum.id);
  } else if (!costAny) {
    if (stratum.id === "local-cpu-only") {
      blocking = "verified; cost structurally unavailable (local CPU inference is non-billable — `null`, never zero)";
      nonBillable.push(stratum.id);
    } else {
      blocking = zeroSuccessCost.has(stratum.id)
        ? `cost recorded ($${zeroSuccessCost.get(stratum.id).costUsd.toFixed(6)}) but ${zeroSuccessCost.get(stratum.id).note} — cost-per-success undefined`
        : "verified, but cost unmeasured (no usage↔pricing correlation)";
      unmeasured.push(stratum.id);
    }
  } else {
    blocking = "—";
  }

  const verifyCell = found.length === 0 ? "**none**" : `${verified}/${found.length}`;
  // An unstable stratum must not read as a confident measurement. The cell keeps
  // the cost (which IS complete) but names the drift, so a reader cannot mistake
  // one repetition's verdict for a point estimate.
  const costCell = costRecord
    ? costRecord.unstable
      ? `$${costRecord.costUsd.toFixed(6)} (complete; **unstable across ${costRecord.repetitions ?? "N"} reps** — ${costRecord.unstable.join(" vs ")})`
      : `$${costRecord.costUsd.toFixed(6)} (complete${costRecord.repetitions ? `; ${costRecord.repetitions} reps` : ""})`
    : costAny ? "measured" : "**not measured**";
  console.log(`| ${stratum.label.split(".")[0]} | ${stratum.label.split(". ")[1]} | ${verifyCell} | ${costCell} | ${blocking} |`);
}

// Evidence detail.
console.log("\n## Evidence behind each verified stratum\n");
for (const stratum of STRATA) {
  const found = byStratum.get(stratum.id) ?? [];
  if (found.length === 0) continue;
  console.log(`**${stratum.label}**`);
  for (const row of found) {
    console.log(`- \`${row.source}\` — ${row.status}, ${row.workers} worker(s), ` +
      `${row.verified === "yes" ? "verified" : "UNVERIFIED"}; ${row.kind}; ${row.costMeasured}`);
  }
  console.log("");
}

console.log("## Summary\n");
const unstableStrata = STRATA.filter(st => costByStratum.get(st.id)?.unstable).map(st => st.id);
const withEvidence = STRATA.length - unmeasured.length;
if (unstableStrata.length > 0) {
  console.log(`- strata whose success count DRIFTED across repetitions (no single-run point estimate): ${unstableStrata.join(", ")}`);
}
console.log(`- strata with independently verified runs AND measured cost: ${STRATA.length - unmeasured.length - nonBillable.length}/10`);
console.log(`- strata blocked (actionable work outstanding): ${unmeasured.length}/10`);
if (unmeasured.length > 0) {
  console.log(`- blocked strata: ${unmeasured.join(", ")}`);
}
if (nonBillable.length > 0) {
  console.log(`- strata verified but structurally non-billable (not blocked, not $(0)): ${nonBillable.join(", ")}`);
}
console.log("");
const costStrata = [...costByStratum.keys()].length;
console.log(`**Cost is measured in ${costStrata}/10 strata.**`);
console.log(`**Verified coverage is ${withEvidence}/10 strata; ${nonBillable.length} of those cannot carry a billable cost by construction.**`);
if (costStrata === 0) {
  console.log("Every recorded Gate 7 summary predates usage/pricing correlation, and");
  console.log("scripted-provider evals are not billable, so `observedCostUsd` stays null.");
} else {
  console.log("Only strata with a complete, stratum-attributed cost record are counted.");
  console.log("A scripted-provider eval emits no `model.usage` at all (no billable call),");
  console.log("so its cost is `null` — unmeasured, NOT zero. Do not read this as");
  console.log("\"the remaining strata cost nothing\".");
}

console.log("\n## Qualification boundary\n");
console.log("This table does not determine baseline acceptance or ablation readiness. " +
  "Recorded cost admission does not assess corpus validity, raw provenance, repetitions, " +
  "uncertainty, independent security qualification, or operator approval. " +
  "Gate B remains HOLD; P0-E ablations require separate authorization.");
