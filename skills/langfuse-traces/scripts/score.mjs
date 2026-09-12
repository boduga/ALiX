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
 *        [--comment text] [--session-id sid] [--batch file.jsonl]
 *        [--base-url URL] [--public-key K] [--secret-key K]
 * env fallback: LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY
 * Fail-open: transport failure prints the failed record, exits 0.
 */

import { parseArgs } from "./lib/args.mjs";
import { makeClient } from "./lib/client.mjs";

async function postScore(client, rec) {
  try {
    const text = await client.apiPost("/api/public/scores", rec);
    return { ok: true, id: tryId(text) };
  } catch (err) {
    return { ok: false, reason: String(err?.message ?? err) };
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
  // P2 input wiring: --session-id stamps the originating session into the
  // record comment (successCount/completion signals live agent-side without
  // trace keys, so the ledger carries the join key instead).
  const sessionTag = args["session-id"] !== undefined ? ` [session:${String(args["session-id"])}]` : "";
  const client = makeClient({
    baseUrl: args["base-url"] ?? process.env.LANGFUSE_BASE_URL ?? "",
    publicKey: args["public-key"] ?? process.env.LANGFUSE_PUBLIC_KEY ?? "",
    secretKey: args["secret-key"] ?? process.env.LANGFUSE_SECRET_KEY ?? "",
  });

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
      ...((args.comment !== undefined || sessionTag)
        ? { comment: `${args.comment !== undefined ? String(args.comment) : ""}${sessionTag}` }
        : {}),
    }];
  }

  if (client.missing) {
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
    const r = await postScore(client, rec);
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
