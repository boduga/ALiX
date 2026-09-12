#!/usr/bin/env node
/**
 * prompt.mjs — P4 prompt version manager for the observe→score→learn→act plan.
 *
 * Langfuse versions prompts server-side on same-name create (v1 observed on
 * verified create; same-name re-create assumed v2 — confirm live on first
 * real promote). Promotion is label-carried: the winning version is created
 * with `--label champion` (labels observed on the prompt object). Nothing is
 * ever overwritten or activated here — pass --label only, never isActive.
 *
 * Verified shape (2026-09-12, chat variant):
 *   POST {baseUrl}/api/public/prompts
 *   { name, type:"chat", prompt:[{role,content}], isActive:false, labels:[] }
 *
 * WRITE PATH: nightly/operator context with write creds — never hot loop.
 *
 * Run: prompt.mjs --create --name <n> --text <prompt> [--label L]
 *        [--base-url URL] [--public-key K] [--secret-key K]
 * env fallback: LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY
 * Fail-open: prints result, exits 0.
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

async function main() {
  const args = parseArgs(process.argv);
  const baseUrl = (args["base-url"] ?? process.env.LANGFUSE_BASE_URL ?? "").replace(/\/+$/, "");
  const publicKey = args["public-key"] ?? process.env.LANGFUSE_PUBLIC_KEY ?? "";
  const secretKey = args["secret-key"] ?? process.env.LANGFUSE_SECRET_KEY ?? "";
  if (!args.create || !args.name || !args.text) {
    console.error("usage: prompt.mjs --create --name <n> --text <prompt> [--label L]");
    return;
  }
  if (!baseUrl || !publicKey || !secretKey) {
    console.log(JSON.stringify({ status: "unavailable", reason: "missing baseUrl/publicKey/secretKey", version: null }));
    return;
  }

  const body = {
    name: String(args.name),
    type: "chat",
    prompt: [{ role: "user", content: String(args.text) }],
    isActive: false,
    labels: args.label ? [String(args.label)] : [],
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/api/public/prompts`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      console.log(JSON.stringify({ status: "error", reason: `HTTP ${res.status} ${text.slice(0, 300)}`, version: null }));
      return;
    }
    let version = null;
    try {
      version = JSON.parse(text)?.version ?? null;
    } catch {
      version = null;
    }
    console.log(JSON.stringify({ status: "ok", name: body.name, version, labels: body.labels }));
  } catch (err) {
    const reason = err?.name === "AbortError" ? `timeout after ${TIMEOUT_MS}ms` : String(err?.message ?? err);
    console.log(JSON.stringify({ status: "unavailable", reason, version: null }));
  } finally {
    clearTimeout(timer);
  }
}

await main();
