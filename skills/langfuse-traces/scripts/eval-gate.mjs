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
 * --min-delta 0.10 win-rate improvement minimum. Regressions (delta < 0
 * at sufficient runs) block; improvements at bar auto-promote upstream.
 *
 * The model-running eval loop (executing candidate prompts over dataset
 * items via a provider) is future work — this gate consumes its score
 * output. No network, no creds, pure compute.
 *
 * Run: eval-gate.mjs --baseline base.jsonl --candidate cand.jsonl
 *        [--min-runs 20] [--min-delta 0.10] [--win-at 0.8] [--json]
 */

import { readFile } from "node:fs/promises";

const DEFAULT_MIN_RUNS = 20;
const DEFAULT_MIN_DELTA = 0.1;
const DEFAULT_WIN_AT = 0.8;

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

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
  const wantJson = args.json === true || args.json === "true";
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
  const verdict = delta >= minDelta ? "promote" : delta < 0 ? "block" : "hold";
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
