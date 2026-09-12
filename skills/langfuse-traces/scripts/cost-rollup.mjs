#!/usr/bin/env node
/**
 * cost-rollup.mjs — P1 cost governance for the observe→score→learn→act plan.
 *
 * Reads ALiX-side session event logs (<dir>/<session>/events.jsonl),
 * `model.usage` events with input/output tokens + durationMs, and produces
 * per-run totals, trailing median per model, budget alerts for runs above
 * --alert-mult × median, and routing-evidence tables once a model reaches
 * --min-runs runs.
 *
 * Why ALiX-side: v4 events_only gateway rows carry no `usage` (proven live),
 * so token governance cannot come from Langfuse. Grouping is per model —
 * `model.usage` events carry no task-class label (recorded limitation).
 * Cost in currency reuses PricingCatalog via `alix observability`; this
 * script reports tokens/calls/latency only and never fabricates cost.
 *
 * Run: cost-rollup.mjs [--sessions-dir ./.alix/sessions] [--median-window 20]
 *        [--alert-mult 3] [--min-runs 20] [--json]
 * Fail-open: missing dir or no events prints an empty rollup, exits 0.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

const DEFAULT_WINDOW = 20;
const DEFAULT_MULT = 3;
const DEFAULT_MIN_RUNS = 20;

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

function median(sorted) {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function main() {
  const args = parseArgs(process.argv);
  const dir = args["sessions-dir"] ?? join(process.cwd(), ".alix", "sessions");
  const window = Math.max(1, Number.parseInt(args["median-window"] ?? String(DEFAULT_WINDOW), 10) || DEFAULT_WINDOW);
  const mult = Number.parseFloat(args["alert-mult"] ?? String(DEFAULT_MULT));
  const minRuns = Math.max(1, Number.parseInt(args["min-runs"] ?? String(DEFAULT_MIN_RUNS), 10) || DEFAULT_MIN_RUNS);
  const wantJson = args.json === true || args.json === "true";

  /** runId -> { tokens, calls, latencyMs, model, sessionId, ts } */
  const runs = new Map();
  let files = 0;
  let sessions = [];
  try {
    sessions = await readdir(dir);
  } catch {
    sessions = [];
  }
  for (const s of sessions) {
    const fp = join(dir, s, "events.jsonl");
    if (!existsSync(fp)) continue;
    files++;
    let text;
    try {
      text = await readFile(fp, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue; // skip malformed lines, like the TS reader
      }
      if (ev.type !== "model.usage") continue;
      const p = ev.payload ?? {};
      const runId = ev.runId ?? ev.sessionId ?? "unknown";
      if (!runs.has(runId)) {
        runs.set(runId, { tokens: 0, calls: 0, latencyMs: 0, model: "unknown", sessionId: s, ts: ev.timestamp ?? "" });
      }
      const r = runs.get(runId);
      r.tokens += Number(p.inputTokens ?? 0) + Number(p.outputTokens ?? 0);
      r.calls++;
      r.latencyMs += Number(p.durationMs ?? 0);
      if (r.model === "unknown" && p.model) r.model = String(p.model);
      if (ev.timestamp && (!r.ts || ev.timestamp > r.ts)) r.ts = ev.timestamp;
    }
  }

  const byModel = new Map();
  for (const [runId, r] of runs) {
    if (!byModel.has(r.model)) byModel.set(r.model, []);
    byModel.get(r.model).push({ runId, ...r });
  }
  for (const list of byModel.values()) {
    list.sort((a, b) => (a.ts < b.ts ? -1 : 1));
  }

  const alerts = [];
  const evidence = [];
  for (const [model, list] of byModel) {
    const trailing = list.slice(-window).map((r) => r.tokens).sort((a, b) => a - b);
    const med = median(trailing);
    for (const r of list.slice(-window)) {
      if (med > 0 && r.tokens > mult * med) {
        alerts.push({ runId: r.runId, model, tokens: r.tokens, median: med, mult });
      }
    }
    if (list.length >= minRuns) {
      const total = list.reduce((s, r) => s + r.tokens, 0);
      evidence.push({ model, runs: list.length, medianTokens: med, totalTokens: total });
    }
  }
  evidence.sort((a, b) => b.runs - a.runs);

  const result = {
    status: "ok",
    sessionsScanned: files,
    runs: runs.size,
    alerts,
    routingEvidence: evidence,
    note: "grouped per model — model.usage events carry no task-class label",
  };
  if (wantJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const lines = [
    `# cost rollup — ${runs.size} runs across ${files} sessions`,
    "",
    "## budget alerts (run > " + mult + "× trailing median, window " + window + ")",
    ...(alerts.length > 0
      ? alerts.map((a) => `- ${a.runId} [${a.model}]: ${a.tokens} tokens vs median ${a.median.toFixed(0)}`)
      : ["(none)"]),
    "",
    `## routing evidence (≥ ${minRuns} runs per model)`,
    ...(evidence.length > 0
      ? evidence.map((e) => `- ${e.model}: ${e.runs} runs, median ${e.medianTokens.toFixed(0)} tokens, total ${e.totalTokens}`)
      : ["(insufficient runs)"]),
    "",
    "_tokens/calls/latency only — currency cost via `alix observability` (PricingCatalog); never fabricated here_",
  ];
  console.log(lines.join("\n"));
}

await main();
