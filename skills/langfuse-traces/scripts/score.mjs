#!/usr/bin/env node
/**
 * score.mjs — P2 quality-ledger writer for the observe→score→learn→act plan.
 *
 * Writes one quality record per run, keyed by traceId:
 *   POST {baseUrl}/api/public/scores { traceId, name, value, comment? }
 * `name` namespaces the signal: quality | task-completion | user-thumb |
 * llm-judge. Value is 0..1; a run is "high-score" at >= 0.8 (plan tunable).
 * Batch mode (--batch file.jsonl, one {traceId,name,value} per line) serves
 * Phase 4 eval feedback.
 *
 * WRITE PATH: run with write creds in a nightly/operator context (digest
 * pattern) — never in the hot loop. The loop stays read-only.
 *
 * Run: score.mjs --trace-id <id> --value <0..1> [--name quality]
 *        [--comment text] [--batch file.jsonl]
 *        [--base-url URL] [--public-key K] [--secret-key K]
 * env fallback: LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY
 * Fail-open: transport failure prints the failed record, exits 0.
 */

const TIMEOUT_MS = 15_000;

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

async function postScore(baseUrl, publicKey, secretKey, rec) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/api/public/scores`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(rec),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
    return { ok: true, id: tryId(text) };
  } catch (err) {
    const reason = err?.name === "AbortError" ? `timeout after ${TIMEOUT_MS}ms` : String(err?.message ?? err);
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

function tryId(text) {
  try {
    return JSON.parse(text)?.id;
  } catch {
    return undefined;
  }
}

function validRec(r) {
  if (!r || typeof r.traceId !== "string" || r.traceId.length === 0) return "missing traceId";
  if (typeof r.name !== "string" || r.name.length === 0) return "missing name";
  if (typeof r.value !== "number" || !(r.value >= 0 && r.value <= 1)) return "value must be 0..1";
  return null;
}

async function main() {
  const args = parseArgs(process.argv);
  const baseUrl = (args["base-url"] ?? process.env.LANGFUSE_BASE_URL ?? "").replace(/\/+$/, "");
  const publicKey = args["public-key"] ?? process.env.LANGFUSE_PUBLIC_KEY ?? "";
  const secretKey = args["secret-key"] ?? process.env.LANGFUSE_SECRET_KEY ?? "";

  let recs = [];
  if (args.batch) {
    const { readFile } = await import("node:fs/promises");
    let text;
    try {
      text = await readFile(String(args.batch), "utf8");
    } catch (err) {
      console.log(JSON.stringify({ status: "unavailable", reason: `cannot read batch: ${err.message}`, written: [] }));
      return;
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        recs.push(JSON.parse(line));
      } catch {
        console.log(JSON.stringify({ status: "unavailable", reason: "bad JSONL line in batch", written: [] }));
        return;
      }
    }
  } else {
    if (!args["trace-id"] || args.value === undefined) {
      console.error("usage: score.mjs --trace-id <id> --value <0..1> [--name quality] [--comment t] [--batch f.jsonl]");
      return;
    }
    recs = [{
      traceId: String(args["trace-id"]),
      name: String(args.name ?? "quality"),
      value: Number(args.value),
      ...(args.comment !== undefined ? { comment: String(args.comment) } : {}),
    }];
  }

  if (!baseUrl || !publicKey || !secretKey) {
    console.log(JSON.stringify({ status: "unavailable", reason: "missing baseUrl/publicKey/secretKey", written: [] }));
    return;
  }

  const written = [];
  const failed = [];
  for (const rec of recs) {
    const problem = validRec(rec);
    if (problem) {
      failed.push({ rec, reason: problem });
      continue;
    }
    const r = await postScore(baseUrl, publicKey, secretKey, rec);
    if (r.ok) written.push({ traceId: rec.traceId, name: rec.name, id: r.id });
    else failed.push({ rec, reason: r.reason });
  }
  console.log(JSON.stringify({
    status: failed.length === 0 ? "ok" : "partial",
    written,
    failed,
    highScore: written.filter((w) => recs.find((r) => r.traceId === w.traceId)?.value >= 0.8).map((w) => w.traceId),
  }, null, 2));
}

await main();
