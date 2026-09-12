#!/usr/bin/env node
/**
 * query.mjs — read-only Langfuse observations fetch for the langfuse-traces skill.
 *
 * Targets Langfuse v4 `events_only` gateways, where the v3 REST reads are
 * disabled. The gateway's replacement read path is the v2 observations API:
 *   GET {baseUrl}/api/public/v2/observations?fromStartTime=<from>&toStartTime=<to>
 * with Basic auth (publicKey:secretKey) from a READ-ONLY key.
 * Time window is mandatory; --trace-id narrows to one trace, --list groups
 * a window's rows by traceId client-side (no trace-list endpoint exists).
 *
 * Contract (mirrors SKILL.md):
 * - summary always (counts by type, error strings, token sums)
 * - detail only on failure or --full (truncated I/O, 2000 chars)
 * - one --trace-id per call, --limit default 20 cap 50 (trace) / 500 (list rows)
 * - 15s timeout, fail-open: transport failure prints an error summary, exits 0
 * - never persists or logs keys
 */

import { parseArgs, isOn } from "./lib/args.mjs";
import { makeClient } from "./lib/client.mjs";
import { pickRootName } from "./lib/spans.mjs";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const LIST_MAX_ROWS = 500;
const DEFAULT_HOURS = 24;
const IO_TRUNCATE = 2000;

function usage() {
  return [
    "usage: query.mjs --trace-id <id> [--limit 20] [--hours 24] [--full] [--json]",
    "   or: query.mjs --list [--session <id>] [--limit 200] [--hours 24] [--json]",
    "       [--base-url URL] [--public-key K] [--secret-key K]",
    "env fallback: LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY",
  ].join("\n");
}

function trunc(s, n = IO_TRUNCATE) {
  if (s === undefined || s === null) return undefined;
  const str = typeof s === "string" ? s : JSON.stringify(s);
  return str.length > n ? str.slice(0, n) + "…[truncated]" : str;
}

async function fetchPayload(client, params) {
  const text = await client.apiGet("/api/public/v2/observations", params);
  const payload = JSON.parse(text);
  return payload;
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

async function listTraces(client, { limit, window, wantJson, session }) {
  if (client.missing) {
    console.log(JSON.stringify({
      status: "unavailable",
      reason: "missing baseUrl/publicKey/secretKey (flags or LANGFUSE_* env)",
      traces: [],
    }, null, 2));
    return; // fail-open: exit 0
  }
  let payload;
  try {
    payload = await fetchPayload(client, {
      limit: String(limit),
      fromStartTime: window.from,
      toStartTime: window.to,
    });
  } catch (err) {
    console.log(JSON.stringify({ status: "unavailable", reason: String(err?.message ?? err), traces: [] }, null, 2));
    return; // fail-open: exit 0
  }
  const data = Array.isArray(payload?.data) ? payload.data : [];
  // --session narrows client-side: every observation self-describes its
  // session, and $ALIX_SESSION_ID is the hook-safe run correlator
  // (the OTel trace id is opaque by design and never exposed to hooks).
  const rows = session ? data.filter((o) => o.sessionId === session) : data;
  // No trace-list endpoint in events_only mode: group the window's rows.
  // v2 rows carry no traceName — the run ROOT span lends its name
  // (pickRootName: enclosing span outranks longest duration; a parallel
  // child can outlast the root on duration but never enclose it).
  const byTrace = new Map();
  for (const o of rows) {
    const id = o.traceId ?? "(unknown)";
    if (!byTrace.has(id)) {
      byTrace.set(id, { id, sessionId: o.sessionId, count: 0, errors: 0, spans: [] });
    }
    const t = byTrace.get(id);
    if (t.sessionId === undefined && o.sessionId !== undefined) t.sessionId = o.sessionId;
    t.count++;
    if (o.level === "ERROR") t.errors++;
    if (o.type === "SPAN" && o.name && o.startTime && o.endTime) {
      t.spans.push(o);
    }
  }
  const traces = [...byTrace.values()].map((t) => {
    const name = pickRootName(t.spans);
    const { spans, ...rest } = t;
    return { ...rest, name };
  });
  const result = { status: "ok", count: traces.length, traces };
  if (payload?.meta?.totalItems !== undefined && payload.meta.totalItems > data.length) {
    result.note = `grouped ${data.length} of ${payload.meta.totalItems} rows (limit ${limit}); narrow --hours, do not page`;
  }
  if (wantJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const lines = traces.map((t) => `${t.id}  ${t.name ?? "(no name)"}${t.sessionId ? `  [${t.sessionId}]` : ""}  obs=${t.count}${t.errors ? ` ERR=${t.errors}` : ""}`);
  if (result.note) lines.push(result.note);
  console.log(lines.join("\n") || "(no traces)");
}

async function main() {
  const args = parseArgs(process.argv);
  const traceId = args["trace-id"];
  const listMode = isOn(args.list);
  if (!traceId && !listMode) {
    console.error(usage());
    process.exitCode = 0; // fail-open: never fail the calling task
    return;
  }
  let limit = Number.parseInt(args.limit ?? String(DEFAULT_LIMIT), 10);
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
  let hours = Number.parseFloat(args.hours ?? String(DEFAULT_HOURS));
  if (!Number.isFinite(hours) || hours <= 0) hours = DEFAULT_HOURS;

  const client = makeClient({
    baseUrl: args["base-url"] ?? process.env.LANGFUSE_BASE_URL ?? "",
    publicKey: args["public-key"] ?? process.env.LANGFUSE_PUBLIC_KEY ?? "",
    secretKey: args["secret-key"] ?? process.env.LANGFUSE_SECRET_KEY ?? "",
  });

  const wantFull = isOn(args.full);
  const wantJson = isOn(args.json);
  const to = new Date();
  const from = new Date(to.getTime() - hours * 3600_000);
  const window = { from: from.toISOString(), to: to.toISOString() };
  if (listMode) {
    limit = args.limit === undefined ? 200 : limit;
    limit = Math.min(limit, LIST_MAX_ROWS);
    await listTraces(client, { limit, window, wantJson, session: args.session });
    return;
  }
  limit = Math.min(limit, MAX_LIMIT);
  if (client.missing) {
    console.log(JSON.stringify({
      traceId,
      status: "unavailable",
      reason: "missing baseUrl/publicKey/secretKey (flags or LANGFUSE_* env)",
      summary: { count: 0, byType: {}, errors: [], tokens: { input: 0, output: 0 } },
    }, null, 2));
    return;
  }

  let payload;
  try {
    payload = await fetchPayload(client, {
      traceId,
      limit: String(limit),
      fromStartTime: window.from,
      toStartTime: window.to,
    });
  } catch (err) {
    console.log(JSON.stringify({
      traceId,
      status: "unavailable",
      reason: String(err?.message ?? err),
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
