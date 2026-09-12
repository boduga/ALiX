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

const TIMEOUT_MS = 15_000;
const DEFAULT_HOURS = 24;
const DEFAULT_ROWS = 200;

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

async function callJson(method, url, publicKey, secretKey, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      signal: ctrl.signal,
      headers: {
        Authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text().catch(() => "");
    // Truncate only failures: success bodies must parse whole.
    return { ok: res.ok, status: res.status, body: res.ok ? text : text.slice(0, 300) };
  } catch (err) {
    return { ok: false, status: "TRANSPORT", body: err?.name === "AbortError" ? "timeout" : String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const wantJson = args.json === true || args.json === "true";
  const datasetId = args["dataset-id"];
  if (!datasetId) {
    console.error("usage: corpus.mjs --dataset-id <id> [--hours 24] [--limit-rows 200] [--json]");
    return;
  }
  const hours = Number(args.hours ?? DEFAULT_HOURS) || DEFAULT_HOURS;
  const limitRows = Math.min(2000, Math.max(1, Number.parseInt(args["limit-rows"] ?? String(DEFAULT_ROWS), 10) || DEFAULT_ROWS));
  const baseUrl = (args["base-url"] ?? process.env.LANGFUSE_BASE_URL ?? "").replace(/\/+$/, "");
  const publicKey = args["public-key"] ?? process.env.LANGFUSE_PUBLIC_KEY ?? "";
  const secretKey = args["secret-key"] ?? process.env.LANGFUSE_SECRET_KEY ?? "";
  if (!baseUrl || !publicKey || !secretKey) {
    console.log(JSON.stringify({ status: "unavailable", reason: "missing baseUrl/publicKey/secretKey", appended: [] }));
    return;
  }

  const to = new Date();
  const from = new Date(to.getTime() - hours * 3600_000);
  const params = new URLSearchParams({
    limit: String(limitRows),
    fromStartTime: from.toISOString(), toStartTime: to.toISOString(),
  });
  const got = await callJson("GET", `${baseUrl}/api/public/v2/observations?${params}`, publicKey, secretKey);
  if (!got.ok) {
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
    const r = await callJson("POST", `${baseUrl}/api/public/dataset-items`, publicKey, secretKey, item);
    if (r.ok) appended.push(traceId);
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
