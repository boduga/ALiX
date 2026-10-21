#!/usr/bin/env node
/**
 * run-coordination-metered.mjs — run a REAL-MODEL coordination scenario and
 * record its metered cost.
 *
 * Why this exists: the original Gate 7 scenarios (run-fanout, run-deps,
 * run-conflict, run-failure, q7-deny5, restart-final) were driven by a SCRIPTED
 * local model server (`provider-fanout.mjs`, `provider.mjs`), not a real model.
 * Their recorded summaries carry no `model.usage` and cannot be re-costed. To
 * measure strata 6 and 8 you have to actually spend tokens.
 *
 * Usage:
 *   node benchmark/evidence/coordination/run-coordination-metered.mjs \
 *     --provider openai --model gpt-4o --concurrency 3 --out <path>
 *
 * The script NEVER estimates cost. It reports the usage it observed and, when no
 * `model.usage` event exists, says so — `null`, not zero.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

function flag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const provider = flag("provider", "openai");
const model = flag("model", "gpt-4o");
const concurrency = Number(flag("concurrency", "3"));
const outPath = flag("out", join(here, "coordination-metered.json"));

const workspace = join(here, "workspace");
rmSync(workspace, { recursive: true, force: true });
mkdirSync(join(workspace, ".alix"), { recursive: true });
for (const d of ["docs"]) mkdirSync(join(workspace, d), { recursive: true });

// Bypass approvals: this measures COST, not the approval path (already qualified
// in Gate 7 / F1-B). Recorded so the run is not mistaken for an approval test.
writeFileSync(
  join(workspace, ".alix", "config.json"),
  JSON.stringify(
    {
      models: { default: { provider, name: model } },
      permissions: { default: "allow", sessionMode: "bypass", tools: {}, protectedPaths: [], allowNetworkDomains: [], denyCommands: [] },
      context: { repoMap: false, semanticSearch: false },
      runtime: { provider: "process", shell: "/bin/sh", commandTimeoutMs: 60000, envAllowlist: [] },
      ui: { enabled: false },
      mcpServers: [],
    },
    null,
    2,
  ),
);

const objective =
  "Create docs/a.md, docs/b.md, docs/c.md containing exactly their respective markers: A-MARKER, B-MARKER, C-MARKER";

console.log(`[run] ${provider}/${model} concurrency=${concurrency}`);
const started = Date.now();
const proc = spawnSync(
  process.execPath,
  [join(repoRoot, "bin", "alix.js"), "coordination", "run", objective,
   "--max-concurrency", String(concurrency), "--session-mode", "bypass"],
  { cwd: workspace, encoding: "utf-8", timeout: 1_800_000 },
);
const wallSeconds = Math.round((Date.now() - started) / 1000);
console.log(proc.stdout?.slice(-800) ?? "");
if (proc.stderr) console.log("stderr:", proc.stderr.slice(-400));

// --- capture usage from every session log the run produced -------------------
const records = [];
const sessionsRoot = join(workspace, ".alix", "sessions");
for (const dir of existsSync(sessionsRoot) ? readdirSync(sessionsRoot) : []) {
  const path = join(sessionsRoot, dir, "events.jsonl");
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type !== "model.usage") continue;
    records.push({
      sessionId: e.sessionId,
      ...(e.runId ? { runId: e.runId } : {}),
      provider: e.payload?.provider,
      model: e.payload?.model,
      inputTokens: e.payload?.inputTokens,
      outputTokens: e.payload?.outputTokens,
    });
  }
}

const observed = records.length > 0;
const inputTokens = observed ? records.reduce((s, r) => s + (r.inputTokens ?? 0), 0) : null;
const outputTokens = observed ? records.reduce((s, r) => s + (r.outputTokens ?? 0), 0) : null;

const result = {
  source: "headless coordination run on a real model",
  provider,
  model,
  concurrency,
  objective,
  exitCode: proc.status,
  wallSeconds,
  usage: { observed, inputTokens, outputTokens, records },
  costUsd: null,
  costNote: observed
    ? "token totals observed; pricing applied by cost-attribution, not here"
    : "NO model.usage observed — cost unknown, NOT zero",
  artifacts: ["docs/a.md", "docs/b.md", "docs/c.md"].map(p => ({
    path: p,
    exists: existsSync(join(workspace, p)),
    content: existsSync(join(workspace, p)) ? readFileSync(join(workspace, p), "utf-8").trim() : null,
  })),
  recordedAt: new Date().toISOString(),
};

writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
console.log(`\n[usage] observed=${observed} in=${inputTokens} out=${outputTokens} records=${records.length}`);
console.log(`[wall] ${wallSeconds}s  exit=${proc.status}`);
console.log(`[out] ${outPath}`);
