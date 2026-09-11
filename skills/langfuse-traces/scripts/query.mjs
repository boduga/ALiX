#!/usr/bin/env node
/**
 * query.mjs — read-only Langfuse observations fetch for the langfuse-traces skill.
 *
 * Speaks the Langfuse public API v2 observations endpoint:
 *   GET {baseUrl}/api/public/observations?traceId={id}&limit={n}
 * with Basic auth (publicKey:secretKey) from a READ-ONLY key.
 *
 * Contract (mirrors SKILL.md):
 * - summary always (counts by type, error strings, token sums)
 * - detail only on failure or --full (truncated I/O, 2000 chars)
 * - one --trace-id per call, --limit default 20 cap 50, 15s timeout
 * - fail-open: transport failure prints an error summary, exits 0
 * - never persists or logs keys
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const IO_TRUNCATE = 2000;
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

function usage() {
  return [
    "usage: query.mjs --trace-id <id> [--limit 20] [--full] [--json]",
    "   or: query.mjs --list [--limit 20] [--json]",
    "       [--base-url URL] [--public-key K] [--secret-key K]",
    "env fallback: LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY",
  ].join("\n");
}

function trunc(s, n = IO_TRUNCATE) {
  if (s === undefined || s === null) return undefined;
  const str = typeof s === "string" ? s : JSON.stringify(s);
  return str.length > n ? str.slice(0, n) + "…[truncated]" : str;
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
      throw new Error(`HTTP ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 300)}` : ""}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function summarize(observations) {
  const byType = {};
  let inputTokens = 0;
  let outputTokens = 0;
  const errors = [];
  for (const o of observations) {
    const t = o.type ?? "UNKNOWN";
    byType[t] = (byType[t] ?? 0) + 1;
    if (o.usage) {
      if (Number.isFinite(o.usage.input)) inputTokens += o.usage.input;
      if (Number.isFinite(o.usage.output)) outputTokens += o.usage.output;
    }
    if (o.level === "ERROR") {
      errors.push({ name: o.name, statusMessage: o.statusMessage });
    }
  }
  return {
    count: observations.length,
    byType,
    errors,
    tokens: { input: inputTokens, output: outputTokens },
  };
}

function detailOf(o) {
  return {
    name: o.name,
    type: o.type,
    level: o.level,
    statusMessage: o.statusMessage,
    startTime: o.startTime,
    endTime: o.endTime,
    usage: o.usage,
    input: trunc(o.input),
    output: trunc(o.output),
  };
}

async function listTraces({ baseUrl, publicKey, secretKey, limit, wantJson }) {
  if (!baseUrl || !publicKey || !secretKey) {
    console.log(JSON.stringify({
      status: "unavailable",
      reason: "missing baseUrl/publicKey/secretKey (flags or LANGFUSE_* env)",
      traces: [],
    }, null, 2));
    return; // fail-open: exit 0
  }
  const url = `${baseUrl}/api/public/traces?limit=${limit}&page=1`;
  let payload;
  try {
    payload = await fetchJson(url, publicKey, secretKey);
  } catch (err) {
    const reason = err?.name === "AbortError" ? `timeout after ${TIMEOUT_MS}ms` : String(err?.message ?? err);
    console.log(JSON.stringify({ status: "unavailable", reason, traces: [] }, null, 2));
    return; // fail-open: exit 0
  }
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const traces = data.map((t) => ({ id: t.id, name: t.name, sessionId: t.sessionId }));
  const result = { status: "ok", count: traces.length, traces };
  if (payload?.meta?.totalItems !== undefined && payload.meta.totalItems > traces.length) {
    result.note = `showing ${traces.length} of ${payload.meta.totalItems} (limit ${limit})`;
  }
  if (wantJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const lines = traces.map((t) => `${t.id}  ${t.name ?? "(no name)"}${t.sessionId ? `  [${t.sessionId}]` : ""}`);
  if (result.note) lines.push(result.note);
  console.log(lines.join("\n") || "(no traces)");
}

async function main() {
  const args = parseArgs(process.argv);
  const traceId = args["trace-id"];
  const listMode = args.list === true || args.list === "true";
  if (!traceId && !listMode) {
    console.error(usage());
    process.exitCode = 0; // fail-open: never fail the calling task
    return;
  }
  let limit = Number.parseInt(args.limit ?? String(DEFAULT_LIMIT), 10);
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
  limit = Math.min(limit, MAX_LIMIT);

  const baseUrl = (args["base-url"] ?? process.env.LANGFUSE_BASE_URL ?? "").replace(/\/+$/, "");
  const publicKey = args["public-key"] ?? process.env.LANGFUSE_PUBLIC_KEY ?? "";
  const secretKey = args["secret-key"] ?? process.env.LANGFUSE_SECRET_KEY ?? "";

  const wantFull = args.full === true || args.full === "true";
  const wantJson = args.json === true || args.json === "true";
  if (listMode) {
    await listTraces({ baseUrl, publicKey, secretKey, limit, wantJson });
    return;
  }
  if (!baseUrl || !publicKey || !secretKey) {
    console.log(JSON.stringify({
      traceId,
      status: "unavailable",
      reason: "missing baseUrl/publicKey/secretKey (flags or LANGFUSE_* env)",
      summary: { count: 0, byType: {}, errors: [], tokens: { input: 0, output: 0 } },
    }, null, 2));
    return;
  }

  const url = `${baseUrl}/api/public/observations?traceId=${encodeURIComponent(traceId)}&limit=${limit}`;

  let payload;
  try {
    payload = await fetchJson(url, publicKey, secretKey);
  } catch (err) {
    const reason = err?.name === "AbortError" ? `timeout after ${TIMEOUT_MS}ms` : String(err?.message ?? err);
    console.log(JSON.stringify({
      traceId,
      status: "unavailable",
      reason,
      summary: { count: 0, byType: {}, errors: [], tokens: { input: 0, output: 0 } },
    }, null, 2));
    return; // fail-open: exit 0
  }

  const observations = Array.isArray(payload?.data) ? payload.data : [];
  const summary = summarize(observations);
  const failed = summary.errors.length > 0;
  const result = {
    traceId,
    status: failed ? "error" : "success",
    summary,
  };
  if (wantFull || failed) {
    result.observations = observations.map(detailOf);
    if (payload?.meta?.totalItems !== undefined && payload.meta.totalItems > observations.length) {
      result.note = `showing ${observations.length} of ${payload.meta.totalItems} (limit ${limit}); refine --trace-id, do not page`;
    }
  }

  if (wantJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const lines = [
    `trace ${traceId}: ${result.status} — ${summary.count} observations`,
    `types: ${Object.entries(summary.byType).map(([k, v]) => `${k}=${v}`).join(" ") || "(none)"}`,
    `tokens: in=${summary.tokens.input} out=${summary.tokens.output}`,
  ];
  for (const e of summary.errors) {
    lines.push(`ERROR ${e.name}: ${e.statusMessage ?? "(no message)"}`);
  }
  if (result.observations) {
    for (const o of result.observations) {
      lines.push(`--- ${o.type} ${o.name} [${o.level ?? "?"}]`);
      if (o.statusMessage) lines.push(`msg: ${o.statusMessage}`);
      if (o.input !== undefined) lines.push(`in: ${o.input}`);
      if (o.output !== undefined) lines.push(`out: ${o.output}`);
    }
  }
  if (result.note) lines.push(result.note);
  console.log(lines.join("\n"));
}

await main();
