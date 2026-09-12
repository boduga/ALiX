#!/usr/bin/env node
/**
 * probe-writes.mjs — P0 gate for the observe→score→learn→act plan.
 *
 * Tries the three write surfaces the loop needs on YOUR gateway and reports
 * what answers: scores write, dataset create+item, prompt create. Prints
 * HTTP status + gateway message per probe. Artifacts are clearly namespaced
 * (alix-probe-*) — delete them from the Langfuse UI afterwards if unwanted.
 *
 * Run: probe-writes.mjs --trace-id <real-id> [--base-url URL]
 *        [--public-key K] [--secret-key K]
 * env fallback: LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY
 * Exit 0 always (report, not a gate in code — the plan gates on the report).
 */

const TIMEOUT_MS = 15_000;
const TAG = `alix-probe-${new Date().toISOString().slice(0, 10)}`;

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

async function call(method, url, publicKey, secretKey, body) {
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
    return { status: res.status, body: text.slice(0, 500) };
  } catch (err) {
    return { status: "TRANSPORT", body: err?.name === "AbortError" ? "timeout" : String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const baseUrl = (args["base-url"] ?? process.env.LANGFUSE_BASE_URL ?? "").replace(/\/+$/, "");
  const publicKey = args["public-key"] ?? process.env.LANGFUSE_PUBLIC_KEY ?? "";
  const secretKey = args["secret-key"] ?? process.env.LANGFUSE_SECRET_KEY ?? "";
  const traceId = args["trace-id"];
  if (!baseUrl || !publicKey || !secretKey || !traceId) {
    console.error("usage: probe-writes.mjs --trace-id <real-id> [--base-url URL] [--public-key K] [--secret-key K]");
    return;
  }

  const probes = [
    {
      name: "scores write",
      run: () => call("POST", `${baseUrl}/api/public/scores`,
        publicKey, secretKey,
        { traceId, name: TAG, value: 1, comment: "P0 probe, safe to delete" }),
    },
    {
      name: "dataset create",
      run: () => call("POST", `${baseUrl}/api/public/datasets`,
        publicKey, secretKey,
        { name: TAG, description: "P0 probe, safe to delete" }),
    },
    {
      name: "prompt create",
      // Verified 2026-09-12: chat variant requires type + isActive;
      // text variant and missing isActive 400 on v4 events_only.
      run: () => call("POST", `${baseUrl}/api/public/prompts`,
        publicKey, secretKey,
        { name: `${TAG}-prompt`, type: "chat", prompt: [{ role: "user", content: "P0 probe" }], isActive: false, labels: [TAG] }),
    },
  ];

  for (const p of probes) {
    const r = await p.run();
    const verdict = typeof r.status === "number" && r.status >= 200 && r.status < 300 ? "PASS" : "FAIL";
    console.log(`[${verdict}] ${p.name}: HTTP ${r.status}\n  ${r.body}\n`);
  }
}

await main();
