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

import { parseArgs } from "./lib/args.mjs";
import { makeClient } from "./lib/client.mjs";

const TAG = `alix-probe-${new Date().toISOString().slice(0, 10)}`;

async function main() {
  const args = parseArgs(process.argv);
  const traceId = args["trace-id"];
  const client = makeClient({
    baseUrl: args["base-url"] ?? process.env.LANGFUSE_BASE_URL ?? "",
    publicKey: args["public-key"] ?? process.env.LANGFUSE_PUBLIC_KEY ?? "",
    secretKey: args["secret-key"] ?? process.env.LANGFUSE_SECRET_KEY ?? "",
  });
  if (client.missing || !traceId) {
    console.error("usage: probe-writes.mjs --trace-id <real-id> [--base-url URL] [--public-key K] [--secret-key K]");
    return;
  }

  const probes = [
    {
      name: "scores write",
      run: () => client.apiRaw("POST", "/api/public/scores", undefined,
        { traceId, name: TAG, value: 1, comment: "P0 probe, safe to delete" }),
    },
    {
      name: "dataset create",
      run: () => client.apiRaw("POST", "/api/public/datasets", undefined,
        { name: TAG, description: "P0 probe, safe to delete" }),
    },
    {
      name: "dataset item append",
      // Shape per corpus.mjs; proves the incident path, not just create.
      run: () => client.apiRaw("POST", "/api/public/dataset-items", undefined,
        { datasetId: TAG, input: { traceId, probe: true }, metadata: { source: "alix-probe" } }),
    },
    {
      name: "prompt create",
      // Verified 2026-09-12: chat variant requires type + isActive;
      // text variant and missing isActive 400 on v4 events_only.
      run: () => client.apiRaw("POST", "/api/public/prompts", undefined,
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
