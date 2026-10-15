// scripts/benchmark-runtime-ledger-workloads.mjs
//
// G2-E representative workload benchmark for the R2 RuntimeLedger.
//
// Unlike scripts/benchmark-runtime-ledger.mjs (single-process, sequential
// synthetic appends), this harness drives:
//   - multiple concurrent PROCESS writers sharing one WAL+FULL ledger file
//     (mirrors scheduler + CLI + Inspector + daemon all hitting
//     `.alix/runtime-ledger.db`), and
//   - a reader measuring authority-read latency while writes are in flight.
//
// Modes:
//   sustained : each writer appends back-to-back for --seconds
//   burst     : each writer appends --burst events with no delay, repeated
//   session   : models an agent loop iteration (k messages + scope + state)
//
// Emits JSON: aggregate writes/s, p50/p95/p99 append latency, reader latency
// percentiles, WAL growth, and error counts (SQLITE_BUSY etc.).
//
// Usage:
//   node scripts/benchmark-runtime-ledger-workloads.mjs \
//     --writers 4 --seconds 20 --out /tmp/opencode/ledger-bench
//   node scripts/benchmark-runtime-ledger-workloads.mjs --worker <json>

import { fork } from "node:child_process";
import { mkdirSync, existsSync, statSync, rmSync } from "node:fs";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";

const selfPath = fileURLToPath(import.meta.url);

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarize(latencies) {
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.length ? sorted[sorted.length - 1] : null,
    mean: sorted.length ? +(sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(2) : null,
  };
}

// ── worker mode ──────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openLedgerWithRetry(RuntimeLedger, dbPath, attempts = 20) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      return new RuntimeLedger({ dbPath });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/locked|busy/i.test(msg) || i === attempts - 1) throw err;
      await sleep(250);
    }
  }
  throw new Error("unreachable");
}

async function runWorker(cfg) {
  const { RuntimeLedger } = await import(
    path.resolve(cwd(), "dist/src/runtime-state/storage/runtime-ledger.js")
  );
  const ledger = await openLedgerWithRetry(RuntimeLedger, cfg.dbPath);
  const latencies = [];
  const errors = [];
  let appended = 0;
  const entityId = `bench-${cfg.workerId}`;
  const deadline = performance.now() + cfg.seconds * 1000;
  const batches = cfg.mode === "burst" ? cfg.bursts : Infinity;
  const batchSize = cfg.mode === "session" ? cfg.sessionK : cfg.mode === "burst" ? cfg.burst : 1;
  let batch = 0;
  const exhausted = () => batch >= batches || performance.now() >= deadline;
  let i = 0;

  while (!exhausted()) {
    // Authority read of the worker's own entity version — mirrors how callers
    // obtain expectedVersion, and makes the harness resilient to lock retries.
    const version = ledger.entityVersion(entityId);
    const ts = new Date().toISOString();
    const t = performance.now();
    try {
      const res = ledger.append({
        expectedVersion: version,
        event: {
          eventId: `${cfg.runId}-${cfg.workerId}-${version + 1}`,
          eventType: "benchmark.written",
          schemaVersion: 1,
          entityType: "benchmark",
          entityId,
          entityVersion: version + 1,
          correlationId: cfg.runId,
          actor: { type: "system", id: "benchmark" },
          occurredAt: ts,
          recordedAt: ts,
          payload: { workerId: cfg.workerId, i },
        },
      });
      if (res.ok) {
        appended += 1;
        latencies.push(+(performance.now() - t).toFixed(3));
      } else if (res.reason !== "version_conflict" && errors.length < 50) {
        errors.push(`${res.reason}:${res.detail}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? `${err.code ?? ""}:${err.message}` : String(err);
      if (errors.length < 50) errors.push(msg);
      await sleep(25);
    }
    i += 1;
    if (i % batchSize === 0) {
      batch += 1;
      if (cfg.mode === "session" && cfg.thinkMs > 0) await sleep(cfg.thinkMs);
    }
  }
  ledger.close();
  process.stdout.write(
    JSON.stringify({ workerId: cfg.workerId, appended, errors, latency: summarize(latencies), raw: latencies }) + "\n",
  );
}

function cwd() {
  return process.cwd();
}

// ── driver mode ──────────────────────────────────────────────────────
async function runDriver(cfg) {
  if (!existsSync(path.join(cwd(), "dist/src/runtime-state/storage/runtime-ledger.js"))) {
    throw new Error("dist not built; run `pnpm build` first");
  }
  mkdirSync(cfg.dir, { recursive: true });
  const dbPath = path.join(cfg.dir, "runtime.db");
  if (existsSync(dbPath)) {
    for (const suffix of ["", "-wal", "-shm"]) {
      try { rmSync(dbPath + suffix, { force: true }); } catch { /* ignore */ }
    }
  }
  const runId = `bench-${Date.now()}`;
  const walPath = `${dbPath}-wal`;

  // Seed genesis so every writer's expectedVersion 0 is valid per entity is not
  // needed (each worker owns its own entityId).
  const children = [];
  for (let w = 0; w < cfg.writers; w += 1) {
    children.push(
      fork(selfPath, [
        "--worker",
        JSON.stringify({ ...cfg, dbPath, workerId: w, runId }),
      ], { stdio: ["ignore", "pipe", "inherit", "ipc"] }),
    );
  }

  // Reader loop: authority read latency during concurrent writes.
  const { RuntimeLedger } = await import(
    path.resolve(cwd(), "dist/src/runtime-state/storage/runtime-ledger.js")
  );
  const reader = await openLedgerWithRetry(RuntimeLedger, dbPath);
  const readerLatencies = [];
  const walSamples = [];
  const startedAt = performance.now();
  let maxP99Append = 0;

  const collect = children.map(
    (child) =>
      new Promise((resolve, reject) => {
        let buf = "";
        child.stdout.on("data", (d) => { buf += d.toString(); });
        child.on("error", reject);
        child.on("exit", (code) => {
          if (code !== 0) return reject(new Error(`worker exited ${code}`));
          const last = buf.trim().split("\n").filter(Boolean).pop();
          try { resolve(JSON.parse(last)); } catch (e) { reject(e); }
        });
      }),
  );

  const readerTimer = setInterval(() => {
    const t = performance.now();
    try {
      reader.readEvents({ sinceSeq: 0, limit: 50 });
      readerLatencies.push(+(performance.now() - t).toFixed(3));
    } catch (err) {
      readerLatencies.push(-1);
    }
    try {
      if (existsSync(walPath)) walSamples.push(statSync(walPath).size);
    } catch { /* ignore */ }
  }, 200);

  const workers = await Promise.allSettled(collect);
  clearInterval(readerTimer);
  const elapsedMs = performance.now() - startedAt;

  // Final WAL + checkpoint behavior.
  let walBeforeCheckpoint = existsSync(walPath) ? statSync(walPath).size : 0;
  const cpStart = performance.now();
  try { reader.db?.pragma?.("wal_checkpoint(TRUNCATE)"); } catch { /* ignore */ }
  // RuntimeLedger does not expose db; use a fresh connection for the checkpoint.
  let checkpointMs = null;
  try {
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath);
    const t = performance.now();
    db.pragma("wal_checkpoint(TRUNCATE)");
    checkpointMs = +(performance.now() - t).toFixed(2);
    db.close();
  } catch { /* ignore */ }
  const walAfterCheckpoint = existsSync(walPath) ? statSync(walPath).size : 0;
  reader.close();

  const ok = workers.filter((w) => w.status === "fulfilled").map((w) => w.value);
  const failed = workers.filter((w) => w.status === "rejected").map((w) => w.reason?.message ?? String(w.reason));
  const allLatencies = ok.flatMap((o) => o.raw);
  const totalAppends = ok.reduce((s, o) => s + o.appended, 0);
  const errors = ok.flatMap((o) => o.errors);

  return {
    config: { writers: cfg.writers, mode: cfg.mode, seconds: cfg.seconds, burst: cfg.burst, bursts: cfg.bursts, sessionK: cfg.sessionK },
    elapsedMs: +elapsedMs.toFixed(1),
    totalAppends,
    aggregateWritesPerSec: +(totalAppends / (elapsedMs / 1000)).toFixed(1),
    appendLatency: summarize(allLatencies),
    readerLatencyMs: summarize(readerLatencies.filter((x) => x >= 0)),
    readerSamples: readerLatencies.length,
    wal: {
      growthMaxBytes: walSamples.length ? Math.max(...walSamples) : 0,
      beforeCheckpointBytes: walBeforeCheckpoint,
      afterCheckpointBytes: walAfterCheckpoint,
      checkpointMs,
    },
    errorCount: errors.length,
    errorSamples: [...new Set(errors)].slice(0, 5),
    workerFailures: failed,
  };
}

function parseArgs(argv) {
  const out = { writers: 4, mode: "sustained", seconds: 20, burst: 25, bursts: 40, sessionK: 6, thinkMs: 0, dir: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--worker") return { worker: JSON.parse(argv[i + 1]) };
    if (a === "--writers") out.writers = Number(argv[++i]);
    else if (a === "--mode") out.mode = argv[++i];
    else if (a === "--seconds") out.seconds = Number(argv[++i]);
    else if (a === "--burst") out.burst = Number(argv[++i]);
    else if (a === "--bursts") out.bursts = Number(argv[++i]);
    else if (a === "--session-k") out.sessionK = Number(argv[++i]);
    else if (a === "--think-ms") out.thinkMs = Number(argv[++i]);
    else if (a === "--out") out.dir = argv[++i];
  }
  if (!out.dir) out.dir = path.join("/tmp/opencode", `ledger-bench-${Date.now()}`);
  return { config: out };
}

const parsed = parseArgs(process.argv.slice(2));
if (parsed.worker) {
  await runWorker(parsed.worker);
} else {
  const result = await runDriver(parsed.config);
  result.storage = process.env.BENCH_STORAGE_LABEL ?? "workspace-ext4-hdd";
  console.log(JSON.stringify(result, null, 2));
}
