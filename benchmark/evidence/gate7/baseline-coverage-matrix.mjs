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
 * result or a plain JSON `{ stratum, runId, costUsd, completeness }` record.
 * Cost is only counted for a stratum when a record names it AND reports a
 * numeric cost with `completeness: "complete"`. Anything else stays `null` —
 * an incomplete total is not a measured cost.
 */
const explicitCostPaths = process.argv.slice(4);
/** In-repo defaults, used only when the caller supplies none. */
const DEFAULT_COST_PATHS = [
  join(repoEvidenceDir, "cost", "cost-record.json"),
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
  { id: "coordination-ownership", label: "6. Four-worker coordination with ownership" },
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

// Cost evidence. Only complete, numeric, stratum-attributed records count.
const costByStratum = new Map();
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
  if (!stratum) {
    console.error(`warning: cost evidence ${path} does not name a stratum; ignoring`);
    continue;
  }
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
    console.error(`warning: cost evidence ${path} has no finite numeric cost; ignoring`);
    continue;
  }
  if (record.completeness !== undefined && record.completeness !== "complete") {
    console.error(`warning: cost evidence ${path} completeness is "${record.completeness}", not complete; ignoring`);
    continue;
  }
  costByStratum.set(stratum, { runId: record.runId, costUsd: cost });
}

// Aggregate per stratum.
const byStratum = new Map();
for (const row of rows) {
  const list = byStratum.get(row.stratum) ?? [];
  list.push(row);
  byStratum.set(row.stratum, list);
}

console.log("# Baseline coverage matrix (P0-D3)\n");
console.log("| # | Stratum | Verified runs | Measured cost | Blocking |");
console.log("|---|---|---|---|---|");

const unmeasured = [];
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
    blocking = "verified, but cost unmeasured (no usage↔pricing correlation)";
    unmeasured.push(stratum.id);
  } else {
    blocking = "—";
  }

  const verifyCell = found.length === 0 ? "**none**" : `${verified}/${found.length}`;
  const costCell = costRecord
    ? `$${costRecord.costUsd.toFixed(6)} (complete)`
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
const withEvidence = STRATA.length - unmeasured.length;
console.log(`- strata with independently verified runs AND measured cost: ${withEvidence}/10`);
console.log(`- strata blocked: ${unmeasured.length}/10`);
if (unmeasured.length > 0) {
  console.log(`- blocked strata: ${unmeasured.join(", ")}`);
}
console.log("");
const costStrata = [...costByStratum.keys()].length;
console.log(`**Cost is measured in ${costStrata}/10 strata.**`);
if (costStrata === 0) {
  console.log("Every recorded Gate 7 summary predates usage/pricing correlation, and");
  console.log("scripted-provider evals are not billable, so `observedCostUsd` stays null.");
} else {
  console.log("Only strata with a complete, stratum-attributed cost record are counted.");
  console.log("A scripted-provider eval emits no `model.usage` at all (no billable call),");
  console.log("so its cost is `null` — unmeasured, NOT zero. Do not read this as");
  console.log("\"the remaining strata cost nothing\".");
}

console.log("\n## Readiness verdict\n");
console.log(withEvidence >= 8
  ? "Harness is ready for ablation comparisons."
  : "Harness is NOT ready for ablation comparisons: too few strata have both verified\nruns and a measured cost.");
