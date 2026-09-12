#!/usr/bin/env node
/**
 * corpus.mjs — P3 regression-corpus writer for the observe→score→learn→act plan.
 *
 * Scans one v2 observations window for traces carrying ERROR observations
 * and appends one incident per trace to a Langfuse dataset:
 *   POST {baseUrl}/api/public/dataset-items { datasetName, input, metadata }
 * (verified live 2026-09-12: the key is dataset NAME, not id).
 * input = { traceId, sessionId }; metadata = { errorNames, errorCount,
 * obsCount }. No I/O payloads cross — aggregates only (digest discipline).
 *
 * WRITE PATH: run with write creds in a nightly/operator context — never in
 * the hot loop. Requires --dataset (name; create once via UI or API probe).
 *
 * Run: corpus.mjs --dataset <name> [--hours 24] [--limit-rows 200] [--json]
 *        [--base-url URL] [--public-key K] [--secret-key K]
 * env fallback: LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY
 * Fail-open: per-item PASS/FAIL report, exits 0.
 */

import { parseArgs, isOn } from "./lib/args.mjs";
import { makeClient } from "./lib/client.mjs";
import { join } from "node:path";

const DEFAULT_HOURS = 24;
const DEFAULT_ROWS = 200;

async function main() {
  const args = parseArgs(process.argv);
  const wantJson = isOn(args.json);
  const datasetName = args.dataset ?? args["dataset-id"];
  if (!datasetName) {
    console.error("usage: corpus.mjs --dataset <name> [--hours 24] [--limit-rows 200] [--json]");
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
    if (!byTrace.has(id)) byTrace.set(id, { errors: [], sessionId: o.sessionId, spans: [] });
    const t = byTrace.get(id);
    if (t.sessionId === undefined && o.sessionId !== undefined) t.sessionId = o.sessionId;
    if (o.level === "ERROR") t.errors.push(o.name ?? "(unnamed)");
    if (o.type === "SPAN" && o.name && o.startTime && o.endTime) t.spans.push(o);
  }
  // Root-span name = the run's task (same heuristic as query.mjs list).
  // Stored on the item so the eval loop can re-run the task without
  // re-fetching the gateway.
  for (const t of byTrace.values()) {
    let best = -1;
    for (const s of t.spans) {
      const dur = Date.parse(s.endTime) - Date.parse(s.startTime);
      if (Number.isFinite(dur) && dur > best) { best = dur; t.task = s.name; }
    }
    delete t.spans;
  }

  const appended = [];
  const failed = [];
  // Local mirror: the eval loop reads incidents without a dataset-list
  // endpoint (no such read path verified on events_only gateways).
  // Append-only JSONL, one incident per line; mirror failures never fail.
  let mirrorPath = null;
  const { appendFile, mkdir } = await import("node:fs/promises");
  const { homedir } = await import("node:os");
  for (const [traceId, t] of byTrace) {
    if (t.errors.length === 0 || traceId === "(unknown)") continue;
    const item = {
      datasetName,
      // taskSource labels the heuristic: longest-duration SPAN names the run
      // in the common single-root case but misattributes on parallel or
      // child-heavy traces — consumers must treat task as a hint, traceId
      // as the key.
      input: { traceId, sessionId: t.sessionId ?? null, task: t.task ?? null, taskSource: t.task ? "root-span-heuristic" : "absent" },
      metadata: { errorNames: [...new Set(t.errors)], errorCount: t.errors.length, source: "alix-corpus" },
    };
    const r = await client.apiRaw("POST", "/api/public/dataset-items", undefined, item);
    if (r.status === 200 || r.status === 201) appended.push(traceId);
    else failed.push({ traceId, reason: `HTTP ${r.status} ${r.body}` });
    try {
      const dir = join(homedir(), ".alix", "corpus");
      await mkdir(dir, { recursive: true });
      mirrorPath = join(dir, `${datasetName}.jsonl`);
      await appendFile(mirrorPath, JSON.stringify({ ...item, mirroredAt: new Date().toISOString() }) + "\n");
    } catch (err) {
      // Mirror is best-effort, but silence hides disk-full/permission rot —
      // warn loudly, still fail open.
      console.warn(`[corpus] mirror append failed: ${String(err?.message ?? err)}`);
    }
  }

  const result = { status: failed.length === 0 ? "ok" : "partial", dataset: datasetName, appended, failed, mirror: mirrorPath };
  if (wantJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`# corpus — ${appended.length} incidents appended to ${datasetName} (${failed.length} failed)`);
  for (const id of appended) console.log(`- ${id}`);
  for (const f of failed) console.log(`FAIL ${f.traceId}: ${f.reason}`);
}

await main();
