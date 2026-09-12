#!/usr/bin/env node
/**
 * eval-gate.mjs — P4 eval verdict for the observe→score→learn→act plan.
 *
 * Pure gate math over paired score ledgers (score.mjs batch shape,
 * {traceId, name, value}): win = value >= --win-at (default 0.8, the plan's
 * high-score line). Compares candidate vs baseline win rates over matched
 * traceIds and returns promote | block | insufficient.
 *
 * Thresholds (plan tunables): --min-runs 20 matched traces minimum,
 * --min-delta 0.10 win-rate improvement minimum. Regressions AND
 * below-bar non-improvements block; only deltas at/above bar promote.
 * Verdicts are exactly promote | block | insufficient (no middle state).
 *
 * The model-running eval loop (executing candidate prompts over dataset
 * items via a provider) is future work — this gate consumes its score
 * output. No network, no creds, pure compute.
 *
 * Run: eval-gate.mjs --baseline base.jsonl --candidate cand.jsonl
 *        [--min-runs 20] [--min-delta 0.10] [--win-at 0.8] [--json]
 */

import { readFile } from "node:fs/promises";

import { parseArgs, isOn } from "./lib/args.mjs";

const DEFAULT_MIN_RUNS = 20;
const DEFAULT_MIN_DELTA = 0.1;
const DEFAULT_WIN_AT = 0.8;

async function loadLedger(path) {
  const text = await readFile(String(path), "utf8");
  const best = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (typeof r.traceId === "string" && typeof r.value === "number") {
      if (!best.has(r.traceId) || r.value > best.get(r.traceId)) best.set(r.traceId, r.value);
    }
  }
  return best;
}

async function main() {
  const args = parseArgs(process.argv);
  const wantJson = isOn(args.json);
  if (!args.baseline || !args.candidate) {
    console.error("usage: eval-gate.mjs --baseline base.jsonl --candidate cand.jsonl [--min-runs 20] [--min-delta 0.10] [--win-at 0.8]");
    return;
  }
  const minRuns = Math.max(1, Number.parseInt(args["min-runs"] ?? String(DEFAULT_MIN_RUNS), 10) || DEFAULT_MIN_RUNS);
  const minDelta = Number(args["min-delta"] ?? DEFAULT_MIN_DELTA);
  const winAt = Number(args["win-at"] ?? DEFAULT_WIN_AT);

  let base, cand;
  try {
    base = await loadLedger(args.baseline);
    cand = await loadLedger(args.candidate);
  } catch (err) {
    console.log(JSON.stringify({ verdict: "insufficient", reason: `cannot read ledger: ${err.message}` }));
    return;
  }
  const matched = [...base.keys()].filter((id) => cand.has(id));
  if (matched.length < minRuns) {
    const result = { verdict: "insufficient", reason: `matched ${matched.length} < ${minRuns}`, runs: matched.length };
    console.log(wantJson ? JSON.stringify(result, null, 2) : `# eval-gate — insufficient (${matched.length}/${minRuns} matched)`);
    return;
  }
  const rate = (m) => matched.filter((id) => m.get(id) >= winAt).length / matched.length;
  const baseRate = rate(base);
  const candRate = rate(cand);
  const delta = candRate - baseRate;
  // No middle verdict: at/above bar promotes, anything below blocks.
  const verdict = delta >= minDelta ? "promote" : "block";
  const result = {
    verdict, runs: matched.length,
    baselineWinRate: Number(baseRate.toFixed(3)),
    candidateWinRate: Number(candRate.toFixed(3)),
    delta: Number(delta.toFixed(3)),
  };
  console.log(wantJson ? JSON.stringify(result, null, 2)
    : `# eval-gate — ${verdict} (candidate ${candRate.toFixed(2)} vs baseline ${baseRate.toFixed(2)}, Δ ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}, n=${matched.length})`);
}

await main();
