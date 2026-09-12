#!/usr/bin/env node
/**
 * digest.mjs — nightly platform digest for the langfuse-traces loop.
 *
 * Aggregates one v2 observations window into a single markdown digest:
 * trace counts, error-trace rate, top failing spans, per-session activity.
 * Aggregates only — no I/O payloads ever leave the gateway, so the digest
 * is safe to store and post. Error strings truncate at 300 chars.
 *
 * Scheduling: the ALiX daemon is an on-demand task queue (no cron
 * primitive), so run this from system cron / systemd timer, or as a
 * daemon one-shot (`alix submit`). Example crontab:
 *   30 6 * * * LANGFUSE_BASE_URL=... LANGFUSE_PUBLIC_KEY=... \
 *     LANGFUSE_SECRET_KEY=... node ~/.alix/skills/langfuse-traces/scripts/digest.mjs \
 *     --hours 24 >> ~/.alix/trace-digests.log 2>&1
 *
 * Fail-open: transport failure prints an `unavailable` digest, exits 0.
 */

import { parseArgs } from "./lib/args.mjs";
import { makeClient } from "./lib/client.mjs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const LIST_MAX_ROWS = 500;
const DEFAULT_HOURS = 24;
const ERR_TRUNCATE = 300;

function short(s) {
  if (s === undefined || s === null) return "(no message)";
  const str = String(s);
  return str.length > ERR_TRUNCATE ? str.slice(0, ERR_TRUNCATE) + "…" : str;
}

async function main() {
  const args = parseArgs(process.argv);
  let hours = Number.parseFloat(args.hours ?? String(DEFAULT_HOURS));
  if (!Number.isFinite(hours) || hours <= 0) hours = DEFAULT_HOURS;
  const client = makeClient({
    baseUrl: args["base-url"] ?? process.env.LANGFUSE_BASE_URL ?? "",
    publicKey: args["public-key"] ?? process.env.LANGFUSE_PUBLIC_KEY ?? "",
    secretKey: args["secret-key"] ?? process.env.LANGFUSE_SECRET_KEY ?? "",
  });
  const to = new Date();
  const from = new Date(to.getTime() - hours * 3600_000);

  const header = `# trace digest — last ${hours}h (${from.toISOString()} → ${to.toISOString()})`;
  if (client.missing) {
    console.log(`${header}\n\nstatus: unavailable (missing baseUrl/publicKey/secretKey)`);
    return;
  }

  let payload;
  try {
    const text = await client.apiGet("/api/public/v2/observations", {
      limit: String(LIST_MAX_ROWS),
      fromStartTime: from.toISOString(),
      toStartTime: to.toISOString(),
    });
    payload = JSON.parse(text);
  } catch (err) {
    console.log(`${header}\n\nstatus: unavailable (${String(err?.message ?? err)})`);
    return;
  }

  const data = Array.isArray(payload?.data) ? payload.data : [];
  const byTrace = new Map();
  const errNames = new Map();
  const bySession = new Map();
  let generations = 0;
  for (const o of data) {
    const id = o.traceId ?? "(unknown)";
    if (!byTrace.has(id)) byTrace.set(id, { errors: 0, name: undefined, spans: [] });
    const t = byTrace.get(id);
    if (o.level === "ERROR") {
      t.errors++;
      errNames.set(o.name ?? "(unnamed)", (errNames.get(o.name ?? "(unnamed)") ?? 0) + 1);
    }
    if (o.type === "GENERATION") generations++;
    if (o.type === "SPAN" && o.name && o.startTime && o.endTime) t.spans.push(o);
    if (o.sessionId) bySession.set(o.sessionId, (bySession.get(o.sessionId) ?? 0) + 1);
  }
  for (const t of byTrace.values()) {
    let best = -1;
    for (const s of t.spans) {
      const dur = Date.parse(s.endTime) - Date.parse(s.startTime);
      if (Number.isFinite(dur) && dur > best) { best = dur; t.name = s.name; }
    }
    delete t.spans;
  }

  const traces = [...byTrace.entries()];
  const errTraces = traces.filter(([, t]) => t.errors > 0);
  const topErrs = [...errNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const sessions = [...bySession.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  const lines = [header, "",
    `traces: ${traces.length} (${errTraces.length} with errors), observations: ${data.length}, generations: ${generations}`,
    "",
    "## error traces",
  ];
  if (errTraces.length === 0) {
    lines.push("(none)");
  } else {
    // Per-trace error detail needs full rows; digest keeps aggregates.
    // Names truncated — full strings live in the gateway, not here.
    for (const [id, t] of errTraces.slice(0, 20)) {
      lines.push(`- ${id}  ${t.name ?? "(no name)"}  ERR=${t.errors}`);
    }
    if (errTraces.length > 20) lines.push(`- …and ${errTraces.length - 20} more`);
  }
  lines.push("", "## top failing spans");
  lines.push(...(topErrs.length > 0 ? topErrs.map(([n, c]) => `- ${short(n)} × ${c}`) : ["(none)"]));
  lines.push("", "## sessions by activity");
  lines.push(...(sessions.length > 0 ? sessions.map(([s, c]) => `- ${s}: ${c} obs`) : ["(none)"]));
  if (payload?.meta?.totalItems !== undefined && payload.meta.totalItems > data.length) {
    lines.push("", `_window truncated: ${data.length} of ${payload.meta.totalItems} rows; narrow --hours for precision_`);
  }
  // P1 cost section (optional): ALiX-side rollup over session model.usage
  // events. Spawned, not imported — one tool, one owner (cost-rollup.mjs).
  if (args["sessions-dir"]) {
    lines.push("", "## cost rollup (ALiX-side session events)");
    try {
      const here = dirname(fileURLToPath(import.meta.url));
      const out = execFileSync(process.execPath,
        [join(here, "cost-rollup.mjs"), "--sessions-dir", String(args["sessions-dir"])],
        { encoding: "utf8", timeout: 60_000 });
      lines.push(out.trim() || "(no cost data)");
    } catch (err) {
      lines.push(`(cost rollup unavailable: ${String(err?.message ?? err).slice(0, 200)})`);
    }
  }
  console.log(lines.join("\n"));
}

await main();
