#!/usr/bin/env node
/**
 * verify-f1e-cost-proof.mjs — independent verification of an F1-E cost proof.
 *
 * Requirement: establish the full chain from SANITIZED records only. This script
 * never reads an API key, never calls a provider, and never writes to the
 * workspace it inspects.
 *
 *   runId → invocation + timestamp → usage → price at invocation time
 *         → independently recomputed cost → production summary + artifact
 *
 * Each of the eight required checks is reported separately. A missing check fails
 * qualification; a successful file write alone is never sufficient.
 *
 * Usage:
 *   ALIX_DIST=<repo>/dist node verify-f1e-cost-proof.mjs <workspace> <runId>
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dist = process.env.ALIX_DIST;
const workspace = process.argv[2];
const runId = process.argv[3];

if (!dist || !workspace || !runId) {
  console.error("usage: ALIX_DIST=<repo>/dist node verify-f1e-cost-proof.mjs <workspace> <runId>");
  process.exit(2);
}

const EXPECTED_ARTIFACT = "f1e-cost-proof.txt";
const EXPECTED_CONTENT = "F1E_COST_PROOF_OK";

const { correlateRunCost } = await import(pathToFileURL(join(dist, "src/operations/evals/cost-correlation.js")).href);
const { CostAttribution, defaultPricingCatalog } = await import(
  pathToFileURL(join(dist, "src/operations/observability/cost-attribution.js")).href
);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n        ${detail}` : ""}`);
}

// ── Load sanitized events ────────────────────────────────────────────────────
const sessionsDir = join(workspace, ".alix", "sessions");
if (!existsSync(sessionsDir)) {
  console.log("FAIL  no .alix/sessions in workspace");
  process.exit(1);
}

const events = [];
for (const sessionId of readdirSync(sessionsDir)) {
  const p = join(sessionsDir, sessionId, "events.jsonl");
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      events.push({
        id: e.id ?? `${sessionId}:${events.length}`,
        seq: typeof e.seq === "number" ? e.seq : events.length,
        timestamp: e.timestamp,
        type: e.type,
        runId: e.runId,
        sessionId: e.sessionId ?? sessionId,
        payload: e.payload ?? {},
      });
    } catch { /* skip malformed */ }
  }
}

const usage = events.filter(e => e.type === "model.usage");

// ── 1. A real provider responded ────────────────────────────────────────────
const realUsage = usage.filter(e => {
  const p = String(e.payload.provider ?? "").toLowerCase();
  return !["scripted-mock", "mock", "local-llama", "ollama", "test"].includes(p);
});
check(
  "1. model responded through a real (billable) provider",
  realUsage.length > 0,
  realUsage.length > 0
    ? `${realUsage.length} billable usage event(s)`
    : `no billable usage events (found ${usage.length} total)`,
);

// ── 2. usage carries the authoritative runId ────────────────────────────────
const withRunId = usage.filter(e => typeof e.runId === "string" && e.runId.length > 0);
check(
  "2. model.usage carries the authoritative runId",
  withRunId.length > 0,
  withRunId.length > 0
    ? `${withRunId.length}/${usage.length} usage events carry runId`
    : "no usage event carries a runId (F1-A not in effect for this run)",
);

// ── 3. usage identifies provider/model and invocation timestamp ─────────────
const identifiable = usage.filter(e =>
  typeof e.payload.provider === "string" &&
  typeof e.payload.model === "string" &&
  typeof e.timestamp === "string" &&
  Number.isFinite(Date.parse(e.timestamp)));
check(
  "3. usage identifies provider, model and invocation timestamp",
  identifiable.length === usage.length && usage.length > 0,
  `${identifiable.length}/${usage.length} fully identifiable`,
);

// ── 4. pricing resolves an effective rate ───────────────────────────────────
const catalog = defaultPricingCatalog();
const priced = [];
const unpriced = [];
for (const e of usage) {
  const price = catalog.lookup(String(e.payload.provider), String(e.payload.model), e.timestamp);
  if (price) priced.push({ e, price }); else unpriced.push(e);
}
check(
  "4. catalog resolves a rate effective at invocation time",
  priced.length > 0 && unpriced.length === 0,
  unpriced.length === 0
    ? `${priced.length}/${usage.length} priced`
    : `unpriced: ${unpriced.map(e => `${e.payload.provider}/${e.payload.model}`).join(", ")}`,
);

// ── 5. tokens produce a reproducible dollar amount ──────────────────────────
let recomputed = 0;
for (const { e, price } of priced) {
  const inTok = Number(e.payload.inputTokens ?? 0);
  const outTok = Number(e.payload.outputTokens ?? 0);
  recomputed += (inTok / 1_000_000) * price.inputPerMillion + (outTok / 1_000_000) * price.outputPerMillion;
}
recomputed = Math.round(recomputed * 1_000_000) / 1_000_000;
check(
  "5. token counts reproduce a dollar amount",
  priced.length > 0 && recomputed > 0,
  `independently recomputed: $${recomputed} (from ${priced.length} invocation(s))`,
);

// ── 6. canonical observation agrees with the production summary ─────────────
const correlation = correlateRunCost(events, runId, catalog);
const summary = await new CostAttribution(workspace, catalog).summary();

const summaryComplete = summary.costCompleteness === "complete";
const canonicalMatches =
  correlation.observedCostUsd !== null &&
  summaryComplete &&
  Math.abs(correlation.observedCostUsd - summary.totalCost) < 1e-6;

check(
  "6. canonical observation and production summary agree",
  canonicalMatches,
  canonicalMatches
    ? `both $${correlation.observedCostUsd} (completeness=${summary.costCompleteness})`
    : `canonical=${correlation.observedCostUsd ?? "null"} summary=${summary.totalCost} ` +
      `(completeness=${summary.costCompleteness}, gap=${correlation.gap ?? "none"})`,
);

// ── 7. artifact contains the expected text ──────────────────────────────────
const artifactPath = join(workspace, EXPECTED_ARTIFACT);
const artifact = existsSync(artifactPath) ? readFileSync(artifactPath, "utf8") : null;
check(
  "7. artifact contains the expected text",
  artifact !== null && artifact.trim() === EXPECTED_CONTENT,
  artifact === null ? `${EXPECTED_ARTIFACT} missing` : `content: ${JSON.stringify(artifact)}`,
);

// ── 8. no unrelated invocation is included ─────────────────────────────────
const otherRunUsage = usage.filter(e => e.runId && e.runId !== runId);
check(
  "8. cost includes only this run's invocations",
  otherRunUsage.length === 0,
  otherRunUsage.length === 0
    ? "no usage from other runs"
    : `${otherRunUsage.length} usage event(s) belong to other run id(s)`,
);

// ── Verdict ─────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r.ok);
console.log("");
console.log(`checks: ${results.length}, passed: ${results.length - failed.length}, failed: ${failed.length}`);
if (correlation.evidence.length > 0) {
  console.log("\nevidence chain:");
  for (const line of correlation.evidence) console.log(`  ${line}`);
}
console.log(`\nRESULT: ${failed.length === 0 ? "PASS — F1-E qualified" : "FAIL — F1-E not qualified"}`);
process.exit(failed.length === 0 ? 0 : 1);
