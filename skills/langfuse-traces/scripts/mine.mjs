#!/usr/bin/env node
/**
 * mine.mjs — P3 candidate miner for the observe→score→learn→act plan.
 *
 * Reads a score ledger (JSONL of {traceId, name, value} — score.mjs batch
 * shape), takes traces at >= --min-score, pulls their v2 observations, and
 * groups identical ordered tool sequences (SPAN names by startTime).
 * Groups at >= --min-runs runs become skill candidates: real prompts are
 * NOT reconstructed here — the candidate carries tool sequence + example
 * traceIds + per-trace outcome scores for runSkillFactory's trace-evidence
 * adapter, distilled via `alix skills distill-from-traces`.
 * --factory-out writes that adapter-ready JSON (config/provider are
 * supplied caller-side by the distill command).
 *
 * Read-only: no writes anywhere except --factory-out (a local file).
 * Fail-open exit 0.
 *
 * Run: mine.mjs --scores ledger.jsonl [--min-score 0.8] [--min-runs 5]
 *        [--hours 24] [--json] [--factory-out candidates.json]
 *        [--base-url URL] [--public-key K] [--secret-key K]
 * env fallback: LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY
 */

import { parseArgs, isOn } from "./lib/args.mjs";
import { makeClient } from "./lib/client.mjs";
import { pickRootName } from "./lib/spans.mjs";

const DEFAULT_MIN_SCORE = 0.8;
const DEFAULT_MIN_RUNS = 5;
const DEFAULT_HOURS = 24;
const DEFAULT_LIMIT = 50;

async function fetchPayload(client, params) {
  const text = await client.apiGet("/api/public/v2/observations", params);
  return JSON.parse(text);
}

async function main() {
  const args = parseArgs(process.argv);
  const wantJson = isOn(args.json);
  if (!args.scores) {
    console.error("usage: mine.mjs --scores ledger.jsonl [--min-score 0.8] [--min-runs 5] [--hours 24] [--json] [--factory-out candidates.json]");
    return;
  }
  const minScore = Number(args["min-score"] ?? DEFAULT_MIN_SCORE);
  const minRuns = Math.max(2, Number.parseInt(args["min-runs"] ?? String(DEFAULT_MIN_RUNS), 10) || DEFAULT_MIN_RUNS);
  const hours = Number(args.hours ?? DEFAULT_HOURS);
  const client = makeClient({
    baseUrl: args["base-url"] ?? process.env.LANGFUSE_BASE_URL ?? "",
    publicKey: args["public-key"] ?? process.env.LANGFUSE_PUBLIC_KEY ?? "",
    secretKey: args["secret-key"] ?? process.env.LANGFUSE_SECRET_KEY ?? "",
  });
  if (client.missing) {
    console.log(JSON.stringify({ status: "unavailable", reason: "missing baseUrl/publicKey/secretKey", candidates: [] }));
    return;
  }

  const { readFile } = await import("node:fs/promises");
  let text;
  try {
    text = await readFile(String(args.scores), "utf8");
  } catch (err) {
    console.log(JSON.stringify({ status: "unavailable", reason: `cannot read scores: ${err.message}`, candidates: [] }));
    return;
  }
  const best = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (typeof r.traceId === "string" && typeof r.value === "number") {
        if (!best.has(r.traceId) || r.value > best.get(r.traceId)) best.set(r.traceId, r.value);
      }
    } catch {
      continue;
    }
  }
  const high = [...best.entries()].filter(([, v]) => v >= minScore).map(([id]) => id);

  const to = new Date();
  const from = new Date(to.getTime() - hours * 3600_000);
  const groups = new Map();
  const failed = [];
  for (const traceId of high) {
    let payload;
    try {
      payload = await fetchPayload(client, {
        traceId, limit: String(DEFAULT_LIMIT),
        fromStartTime: from.toISOString(), toStartTime: to.toISOString(),
      });
    } catch (err) {
      failed.push({ traceId, reason: String(err?.message ?? err) });
      continue;
    }
    const data = Array.isArray(payload?.data) ? payload.data : [];
    const tools = data
      .filter((o) => o.type === "SPAN" && o.name)
      .sort((a, b) => (a.startTime < b.startTime ? -1 : 1))
      .map((o) => o.name);
    // Skip the run-root span (pickRootName, shared with query.mjs) — it
    // names the task, it is not a tool step.
    let seq = tools;
    if (tools.length > 1) {
      const spans = data.filter((o) => o.type === "SPAN" && o.name && o.startTime && o.endTime);
      const root = pickRootName(spans);
      if (root) seq = tools.filter((n) => n !== root);
    }
    const key = JSON.stringify(seq);
    if (!groups.has(key)) groups.set(key, { toolSequence: seq, traceIds: [] });
    groups.get(key).traceIds.push(traceId);
  }

  const candidates = [...groups.values()]
    .filter((g) => g.traceIds.length >= minRuns)
    .map((g, i) => ({
      suggestedName: `mined-${i + 1}-${g.toolSequence[0] ?? "empty"}`.slice(0, 60),
      toolSequence: g.toolSequence,
      traceIds: g.traceIds,
      runs: g.traceIds.length,
      scores: Object.fromEntries(g.traceIds.map((id) => [id, best.get(id)])),
    }));

  // Adapter-ready evidence for `alix skills distill-from-traces`: the same
  // candidates plus the caller-supplied session slot (config/provider live
  // TS-side). Local file write only.
  if (args["factory-out"]) {
    const { writeFile } = await import("node:fs/promises");
    const evidence = candidates.map((c) => ({ sessionId: "mined", ...c }));
    try {
      await writeFile(String(args["factory-out"]), evidence.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
    } catch (err) {
      console.warn(`[mine] factory-out write failed: ${String(err?.message ?? err)}`);
    }
  }

  const result = { status: "ok", highScoreTraces: high.length, candidates, failed };
  if (wantJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const lines = [`# mine — ${high.length} high-score traces (≥ ${minScore}), ${candidates.length} candidates (≥ ${minRuns} runs)`];
  for (const c of candidates) {
    lines.push(`- ${c.suggestedName}: [${c.toolSequence.join(" → ") || "(no tools)"}] × ${c.runs} (${c.traceIds.join(", ")})`);
  }
  if (failed.length > 0) lines.push(`fetch failures: ${failed.length}`);
  console.log(lines.join("\n"));
}

await main();
