#!/usr/bin/env node
/**
 * mine.mjs — P3 candidate miner for the observe→score→learn→act plan.
 *
 * Reads a score ledger (JSONL of {traceId, name, value} — score.mjs batch
 * shape), takes traces at >= --min-score, pulls their v2 observations, and
 * groups identical ordered tool sequences (SPAN names by startTime).
 * Groups at >= --min-runs runs become skill candidates: real prompts are
 * NOT reconstructed here — the candidate carries tool sequence + example
 * traceIds for runSkillFactory's trace-evidence adapter (TS side, future).
 *
 * Read-only: no writes anywhere. Fail-open exit 0.
 *
 * Run: mine.mjs --scores ledger.jsonl [--min-score 0.8] [--min-runs 5]
 *        [--hours 24] [--json] [--base-url URL] [--public-key K] [--secret-key K]
 * env fallback: LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY
 */

const TIMEOUT_MS = 15_000;
const DEFAULT_MIN_SCORE = 0.8;
const DEFAULT_MIN_RUNS = 5;
const DEFAULT_HOURS = 24;
const DEFAULT_LIMIT = 50;

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

async function fetchJson(url, publicKey, secretKey) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const wantJson = args.json === true || args.json === "true";
  if (!args.scores) {
    console.error("usage: mine.mjs --scores ledger.jsonl [--min-score 0.8] [--min-runs 5] [--hours 24] [--json]");
    return;
  }
  const minScore = Number(args["min-score"] ?? DEFAULT_MIN_SCORE);
  const minRuns = Math.max(2, Number.parseInt(args["min-runs"] ?? String(DEFAULT_MIN_RUNS), 10) || DEFAULT_MIN_RUNS);
  const hours = Number(args.hours ?? DEFAULT_HOURS);
  const baseUrl = (args["base-url"] ?? process.env.LANGFUSE_BASE_URL ?? "").replace(/\/+$/, "");
  const publicKey = args["public-key"] ?? process.env.LANGFUSE_PUBLIC_KEY ?? "";
  const secretKey = args["secret-key"] ?? process.env.LANGFUSE_SECRET_KEY ?? "";
  if (!baseUrl || !publicKey || !secretKey) {
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
    const params = new URLSearchParams({
      traceId, limit: String(DEFAULT_LIMIT),
      fromStartTime: from.toISOString(), toStartTime: to.toISOString(),
    });
    let payload;
    try {
      payload = await fetchJson(`${baseUrl}/api/public/v2/observations?${params}`, publicKey, secretKey);
    } catch (err) {
      failed.push({ traceId, reason: String(err?.message ?? err) });
      continue;
    }
    const data = Array.isArray(payload?.data) ? payload.data : [];
    const tools = data
      .filter((o) => o.type === "SPAN" && o.name)
      .sort((a, b) => (a.startTime < b.startTime ? -1 : 1))
      .map((o) => o.name);
    // Skip the run-root span (longest duration) — it names the task, it is
    // not a tool step. Heuristic mirrors query.mjs list naming.
    let seq = tools;
    if (tools.length > 1) {
      const spans = data.filter((o) => o.type === "SPAN" && o.name && o.startTime && o.endTime);
      let root = null;
      let bestDur = -1;
      for (const s of spans) {
        const dur = Date.parse(s.endTime) - Date.parse(s.startTime);
        if (Number.isFinite(dur) && dur > bestDur) { bestDur = dur; root = s.name; }
      }
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
    }));

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
