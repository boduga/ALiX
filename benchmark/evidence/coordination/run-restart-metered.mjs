#!/usr/bin/env node
/**
 * run-restart-metered.mjs — stratum 8 (crash / restart, outcome unknown) on a
 * REAL model, with metered cost.
 *
 * The original `restart-final` evidence was driven by a scripted local model and
 * its run *completed* — so "crash" there meant "process restarted", not "killed
 * mid-flight". To measure stratum 8 honestly this script:
 *
 *   1. starts a coordination run
 *   2. kills the process tree mid-flight (SIGKILL, so no graceful shutdown)
 *   3. inspects the persisted run to confirm it is NOT terminal and workers are
 *      not falsely marked complete
 *   4. resumes via the daemon/CLI reclaim path
 *   5. reports usage from BOTH halves and whether the objective landed
 *
 * Cost of a killed half is still real spend, so both halves are summed. If the
 * run never produced usage, that is reported as `null`, never zero.
 */
import { spawn, spawnSync } from "node:child_process";
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
const killAfterMs = Number(flag("kill-after-ms", "6000"));
const outPath = flag("out", join(here, "restart-metered.json"));

const workspace = join(here, "restart-workspace");
rmSync(workspace, { recursive: true, force: true });
mkdirSync(join(workspace, ".alix"), { recursive: true });
mkdirSync(join(workspace, "docs"), { recursive: true });
writeFileSync(
  join(workspace, ".alix", "config.json"),
  JSON.stringify({
    models: { default: { provider, name: model } },
    permissions: { default: "allow", sessionMode: "bypass", tools: {}, protectedPaths: [], allowNetworkDomains: [], denyCommands: [] },
    context: { repoMap: false, semanticSearch: false },
    runtime: { provider: "process", shell: "/bin/sh", commandTimeoutMs: 60000, envAllowlist: [] },
    ui: { enabled: false }, mcpServers: [],
  }, null, 2),
);

const objective =
  "Create docs/a.md, docs/b.md, docs/c.md containing exactly their respective markers: A-MARKER, B-MARKER, C-MARKER";

function readUsage() {
  const root = join(workspace, ".alix", "sessions");
  const records = [];
  for (const dir of existsSync(root) ? readdirSync(root) : []) {
    const p = join(root, dir, "events.jsonl");
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.type === "model.usage") {
        records.push({
          sessionId: e.sessionId, ...(e.runId ? { runId: e.runId } : {}),
          inputTokens: e.payload?.inputTokens, outputTokens: e.payload?.outputTokens,
        });
      }
    }
  }
  return records;
}

function latestRunRecord() {
  const dir = join(workspace, ".alix", "coordination");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter(f => f.startsWith("coord_") && f.endsWith(".json"));
  if (!files.length) return null;
  const newest = files
    .map(f => ({ f, m: Number(f.replace(/\D/g, "").slice(0, 13)) || 0 }))
    .sort((a, b) => b.m - a.m)[0].f;
  try { return JSON.parse(readFileSync(join(dir, newest), "utf-8")); } catch { return null; }
}

const args = [
  join(repoRoot, "bin", "alix.js"), "coordination", "run", objective,
  "--max-concurrency", "3", "--session-mode", "bypass",
];

// ── phase 1: start, then SIGKILL the whole tree mid-flight ────────────────
console.log(`[phase1] starting, will SIGKILL after ${killAfterMs}ms`);
const child = spawn(process.execPath, args, { cwd: workspace, stdio: "ignore", detached: true });
await new Promise(r => setTimeout(r, killAfterMs));
let killed = false;
try { process.kill(-child.pid, "SIGKILL"); killed = true; } catch { /* already gone */ }
await new Promise(r => child.on("exit", r).setTimeout?.(2000) ?? setTimeout(r, 2000));

const usage1 = readUsage();
const afterKill = latestRunRecord();
const killState = {
  killed,
  runStatus: afterKill?.status ?? null,
  workers: (afterKill?.workers ?? []).map(w => ({ id: w.id, status: w.status, attempt: w.attempt })),
  // The point of stratum 8: a crash must not leave a worker falsely complete.
  falselyCompleted: (afterKill?.workers ?? []).filter(w => w.status === "completed").length,
};
console.log("[phase1] after kill:", JSON.stringify(killState));

// ── phase 2: resume ───────────────────────────────────────────────────────
console.log("[phase2] resuming");
const resumeRunId = afterKill?.id;
if (!resumeRunId) {
  console.log("[phase2] SKIPPED: no persisted run to resume (the kill landed before the run was created)");
}
const resume = resumeRunId
  ? spawnSync(
      process.execPath,
      [join(repoRoot, "bin", "alix.js"), "coordination", "resume", resumeRunId],
      { cwd: workspace, encoding: "utf-8", timeout: 1_200_000 },
    )
  : { status: null, stdout: "" };
console.log("[phase2] stdout tail:", (resume.stdout ?? "").slice(-400));

const usage2 = readUsage();
const finalRun = latestRunRecord();
const all = [...usage1, ...usage2];
const observed = all.length > 0;
const inputTokens = observed ? all.reduce((s, r) => s + (r.inputTokens ?? 0), 0) : null;
const outputTokens = observed ? all.reduce((s, r) => s + (r.outputTokens ?? 0), 0) : null;

const result = {
  source: "restart/crash scenario on a real model (stratum 8)",
  provider, model, objective,
  killAfterMs,
  phase1: { usageRecords: usage1.length, killState },
  phase2: { resumedRunId: resumeRunId ?? null, exitCode: resume.status, usageRecords: usage2.length },
  usage: { observed, inputTokens, outputTokens, records: all },
  costUsd: null,
  costNote: observed
    ? "token totals observed across both halves; pricing applied by cost-attribution"
    : "NO model.usage observed — cost unknown, NOT zero",
  finalRun: finalRun
    ? { status: finalRun.status, outcome: finalRun.outcome, workers: finalRun.workers.map(w => w.status) }
    : null,
  artifacts: ["docs/a.md", "docs/b.md", "docs/c.md"].map(p => ({
    path: p, exists: existsSync(join(workspace, p)),
    content: existsSync(join(workspace, p)) ? readFileSync(join(workspace, p), "utf-8").trim() : null,
  })),
  recordedAt: new Date().toISOString(),
};
writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
console.log(`\n[usage] observed=${observed} in=${inputTokens} out=${outputTokens} records=${all.length}`);
console.log(`[final] ${JSON.stringify(result.finalRun)}`);
console.log(`[out] ${outPath}`);
