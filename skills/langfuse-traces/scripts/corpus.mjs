#!/usr/bin/env node
/**
 * corpus.mjs — P3 regression-corpus writer for the observe→score→learn→act plan.
 *
 * Scans one v2 observations window for traces carrying ERROR observations
 * and appends one incident per trace to a Langfuse dataset:
 *   POST {baseUrl}/api/public/dataset-items { datasetId, input, metadata }
 * input = { traceId, sessionId }; metadata = { errorNames, errorCount,
 * obsCount }. No I/O payloads cross — aggregates only (digest discipline).
 *
 * WRITE PATH: run with write creds in a nightly/operator context — never in
 * the hot loop. Requires --dataset-id (create once via UI or API probe).
 *
 * Run: corpus.mjs --dataset-id <id> [--hours 24] [--limit-rows 200] [--json]
 *        [--base-url URL] [--public-key K] [--secret-key K]
 * env fallback: LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY
 * Fail-open: per-item PASS/FAIL report, exits 0.
 */

import { parseArgs, isOn } from "./lib/args.mjs";
import { makeClient } from "./lib/client.mjs";

const DEFAULT_HOURS = 24;
const DEFAULT_ROWS = 200;

async function main() {
  const args = parseArgs(process.argv);
  const wantJson = isOn(args.json);
  const datasetId = args["dataset-id"];
  if (!datasetId) {
    console.error("usage: corpus.mjs --dataset-id <id> [--hours 24] [--limit-rows 200] [--json]");
    return;
  }
  const hours = Number(args.hours ?? DEFAULT_HOURS) || DEFAULT_HOURS;
  const limitRows = Math.min(2000, Math.max(1, Number.parseInt(args["limit-rows"] ?? String(DEFAULT_ROWS), 10) || DEFAULT_ROWS));
  const client = makeClient({
    baseUrl: args["base-url"] ?? process.env.LANGFUSE_BASE_URL ?? "",
    publicKey: args["public-key"] ?? process.env.LANGFUSE_PUBLIC_KEY ?? "",
    secretKey: args["secret-key"] ?? process.env.LANGFUSE_SECRET_KEY ?? "",
  });
  if (client.missing) {
    console.log(JSON.stringify({ status: "unavailable", reason: "missing baseUrl/publicKey/secretKey", appended: [] }));
    return;
  }

  const to = new Date();
  const from = new Date(to.getTime() - hours * 3600_000);
  const got = await client.apiRaw("GET", "/api/public/v2/observations", {
    limit: String(limitRows),
    fromStartTime: from.toISOString(), toStartTime: to.toISOString(),
  });
  if (got.status !== 200) {
    console.log(JSON.stringify({ status: "unavailable", reason: `window fetch: HTTP ${got.status} ${got.body}`, appended: [] }));
    return;
  }
  let data = [];
  try {
    data = JSON.parse(got.body)?.data ?? [];
    if (!Array.isArray(data)) data = [];
  } catch {
    data = [];
  }

  const byTrace = new Map();
  for (const o of data) {
    const id = o.traceId ?? "(unknown)";
    if (!byTrace.has(id)) byTrace.set(id, { errors: [], sessionId: o.sessionId });
    const t = byTrace.get(id);
    if (t.sessionId === undefined && o.sessionId !== undefined) t.sessionId = o.sessionId;
    if (o.level === "ERROR") t.errors.push(o.name ?? "(unnamed)");
  }

  const appended = [];
  const failed = [];
  for (const [traceId, t] of byTrace) {
    if (t.errors.length === 0 || traceId === "(unknown)") continue;
    const item = {
      datasetId,
      input: { traceId, sessionId: t.sessionId ?? null },
      metadata: { errorNames: [...new Set(t.errors)], errorCount: t.errors.length, source: "alix-corpus" },
    };
    const r = await client.apiRaw("POST", "/api/public/dataset-items", undefined, item);
    if (r.status === 200 || r.status === 201) appended.push(traceId);
    else failed.push({ traceId, reason: `HTTP ${r.status} ${r.body}` });
  }

  const result = { status: failed.length === 0 ? "ok" : "partial", datasetId, appended, failed };
  if (wantJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`# corpus — ${appended.length} incidents appended to ${datasetId} (${failed.length} failed)`);
  for (const id of appended) console.log(`- ${id}`);
  for (const f of failed) console.log(`FAIL ${f.traceId}: ${f.reason}`);
}

await main();
