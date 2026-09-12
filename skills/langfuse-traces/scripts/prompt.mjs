#!/usr/bin/env node
/**
 * prompt.mjs — P4 prompt version manager for the observe→score→learn→act plan.
 *
 * Langfuse versions prompts server-side on same-name create (proven live
 * 2026-09-12: re-create returned version 2). Promotion is label-carried: the winning version is created
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

import { parseArgs } from "./lib/args.mjs";
import { makeClient } from "./lib/client.mjs";

async function main() {
  const args = parseArgs(process.argv);
  const client = makeClient({
    baseUrl: args["base-url"] ?? process.env.LANGFUSE_BASE_URL ?? "",
    publicKey: args["public-key"] ?? process.env.LANGFUSE_PUBLIC_KEY ?? "",
    secretKey: args["secret-key"] ?? process.env.LANGFUSE_SECRET_KEY ?? "",
  });
  if (!args.create || !args.name || !args.text) {
    console.error("usage: prompt.mjs --create --name <n> --text <prompt> [--label L]");
    return;
  }
  if (client.missing) {
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
  const r = await client.apiRaw("POST", "/api/public/prompts", undefined, body);
  if (r.status !== 200 && r.status !== 201) {
    console.log(JSON.stringify({ status: "error", reason: `HTTP ${r.status} ${r.body}`, version: null }));
    return;
  }
  let version = null;
  try {
    version = JSON.parse(r.body)?.version ?? null;
  } catch {
    version = null;
  }
  console.log(JSON.stringify({ status: "ok", name: body.name, version, labels: body.labels }));
}

await main();
