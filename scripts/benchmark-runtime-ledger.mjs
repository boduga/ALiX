import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { RuntimeLedger } from "../dist/src/runtime-state/storage/runtime-ledger.js";

const rounds = Number.parseInt(process.argv[2] ?? "3", 10);
const writesPerRound = Number.parseInt(process.argv[3] ?? "250", 10);
if (!Number.isSafeInteger(rounds) || rounds < 1 ||
    !Number.isSafeInteger(writesPerRound) || writesPerRound < 1) {
  throw new Error("usage: node scripts/benchmark-runtime-ledger.mjs [rounds] [writes-per-round]");
}

const directory = await mkdtemp(path.join(tmpdir(), "alix-runtime-ledger-benchmark-"));
const databasePath = path.join(directory, "runtime.db");

try {
  const ledger = new RuntimeLedger({ dbPath: databasePath });
  const results = [];
  let version = 0;

  for (let round = 0; round < rounds; round += 1) {
    const startedAt = performance.now();
    for (let index = 0; index < writesPerRound; index += 1) {
      version += 1;
      const timestamp = new Date().toISOString();
      ledger.append({
        expectedVersion: version - 1,
        event: {
          eventId: `benchmark-${version}`,
          eventType: "benchmark.written",
          schemaVersion: 1,
          entityType: "benchmark",
          entityId: "runtime-ledger",
          entityVersion: version,
          correlationId: `benchmark-round-${round + 1}`,
          actor: { type: "system", id: "benchmark" },
          occurredAt: timestamp,
          recordedAt: timestamp,
          payload: { round, index },
        },
      });
    }
    const elapsedMs = performance.now() - startedAt;
    results.push({
      elapsedMs,
      millisecondsPerWrite: elapsedMs / writesPerRound,
      writesPerSecond: writesPerRound / (elapsedMs / 1_000),
    });
  }

  const mean = (key) => results.reduce((sum, result) => sum + result[key], 0) / results.length;
  console.log(JSON.stringify({
    settings: ledger.durabilitySettings(),
    rounds,
    writesPerRound,
    results,
    mean: {
      millisecondsPerWrite: mean("millisecondsPerWrite"),
      writesPerSecond: mean("writesPerSecond"),
    },
  }, null, 2));
  ledger.close();
} finally {
  await rm(directory, { recursive: true, force: true });
}
