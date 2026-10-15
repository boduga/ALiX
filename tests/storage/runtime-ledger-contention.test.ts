// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT
//
// P2 — RuntimeLedger multi-process write contention.
//
// The ledger is a shared WAL database written by concurrent OS processes
// (scheduler + CLI + Inspector + daemon). `append()` must:
//   - take the write lock up front (BEGIN IMMEDIATE), so a read snapshot is
//     never upgraded to a write transaction on the later INSERT — the deferred
//     default produces SQLITE_BUSY_SNAPSHOT, which `busy_timeout` cannot retry;
//   - still report a genuine optimistic `version_conflict` for the same entity,
//     never a spurious busy failure.

import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);

interface ChildResult {
  workerId: number;
  ok: number;
  busy: number;
  conflicts: number;
  other: number;
}

// Child mode: hammer one shared ledger with per-entity appends for `seconds`.
// Construction is guarded so an open-time failure (e.g. a lock error while
// switching a fresh database to WAL) is reported on stdout as a typed result
// instead of an opaque `process.exit(1)`.
if (process.env.ALIX_LEDGER_STRESS_CHILD === "1") {
  const { dbPath, workerId, seconds, perEntity } = JSON.parse(process.env.ALIX_LEDGER_STRESS_CFG ?? "{}");
  const { RuntimeLedger } = await import(
    join(dirnameOfSelf(), "..", "..", "src", "runtime-state", "storage", "runtime-ledger.js")
  );

  const empty = { workerId, ok: 0, busy: 0, conflicts: 0, other: 0 };
  let ledger: InstanceType<typeof RuntimeLedger>;
  try {
    ledger = new RuntimeLedger({ dbPath });
  } catch (err) {
    const msg = err instanceof Error ? `${(err as NodeJS.ErrnoException).code ?? ""}:${err.message}` : String(err);
    // An open-time BUSY is itself contention the fix must not produce.
    const busy = /BUSY|locked/i.test(msg) ? 1 : 0;
    process.stdout.write(JSON.stringify({ ...empty, busy, other: busy ? 0 : 1, openError: msg }), () => {
      process.exit(0);
    });
  }

  // Measure from when THIS child is open and ready, not from a shared deadline
  // computed before fork: opening a fresh shared DB under contention can wait on
  // busy_timeout, which would otherwise consume a shared window unevenly.
  const until = Date.now() + seconds * 1000;
  let ok = 0;
  let busy = 0;
  let conflicts = 0;
  let other = 0;
  let i = 0;
  while (Date.now() < until) {
    const entityId = perEntity ? "shared-entity" : `w${workerId}-entity`;
    const expected = ledger.entityVersion(entityId);
    try {
      const res = ledger.append({
        expectedVersion: expected,
        event: {
          eventId: `w${workerId}-${i}`,
          eventType: "stress.written",
          schemaVersion: 1,
          entityType: "stress",
          entityId,
          entityVersion: expected + 1,
          correlationId: "stress",
          actor: { type: "system", id: `w${workerId}` },
          occurredAt: new Date().toISOString(),
          recordedAt: new Date().toISOString(),
          payload: { i },
        },
      });
      if (res.ok) ok += 1;
      else if (res.reason === "version_conflict") conflicts += 1;
      else other += 1;
    } catch (err) {
      const msg = err instanceof Error ? `${(err as NodeJS.ErrnoException).code ?? ""}:${err.message}` : String(err);
      if (/BUSY|locked/i.test(msg)) busy += 1;
      else other += 1;
    }
    i += 1;
  }
  ledger.close();
  // Write the result, then exit from the write callback so the pipe is flushed
  // before termination. `process.exit(0)` (not exitCode) is required because
  // the forked IPC channel keeps the event loop referenced.
  process.stdout.write(JSON.stringify({ workerId, ok, busy, conflicts, other }), () => {
    process.exit(0);
  });
}

function dirnameOfSelf(): string {
  return fileURLToPath(new URL(".", import.meta.url));
}

function runChild(cfg: Record<string, unknown>): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = fork(SELF, {
      env: { ...process.env, ALIX_LEDGER_STRESS_CHILD: "1", ALIX_LEDGER_STRESS_CFG: JSON.stringify(cfg) },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    let out = "";
    let errText = "";
    child.stdout?.on("data", (d) => { out += d.toString(); });
    child.stderr?.on("data", (d) => { errText += d.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => {
      const line = out.trim().split("\n").filter(Boolean).pop();
      if (line === undefined) {
        // No result emitted at all — surface the child's stderr so a setup
        // failure is diagnosable rather than an opaque exit code.
        return reject(new Error(`child ${String(cfg.workerId)} produced no result (exit ${code}): ${errText.trim()}`));
      }
      try {
        resolve(JSON.parse(line) as ChildResult);
      } catch (err) {
        reject(new Error(`child ${String(cfg.workerId)} emitted unparseable output (exit ${code}): ${line}\n${errText}`));
      }
    });
  });
}

const WRITERS = 4;

async function runContention(spec: { perEntity: boolean; seconds: number }): Promise<ChildResult[]> {
  const dir = await mkdtemp(join(tmpdir(), "alix-ledger-stress-"));
  const dbPath = join(dir, ".alix", "runtime-ledger.db");
  try {
    return await Promise.all(
      Array.from({ length: WRITERS }, (_, workerId) =>
        runChild({ dbPath, workerId, seconds: spec.seconds, perEntity: spec.perEntity }),
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Workload-scaled timeout: 4 forked writers each run for ~6s of fsync-bound
// appends plus process spawn/teardown; CI headroom is 6s×4-way + spawn slack.
test("concurrent multi-process writes do not produce SQLITE_BUSY and serialize cleanly", { timeout: 120_000 }, async () => {
  const results = await runContention({ perEntity: false, seconds: 6 });
  const ok = results.reduce((s, r) => s + r.ok, 0);
  const busy = results.reduce((s, r) => s + r.busy, 0);
  const other = results.reduce((s, r) => s + r.other, 0);

  // The regression: the deferred transaction shape produced thousands of
  // SQLITE_BUSY (BUSY_SNAPSHOT) failures; BEGIN IMMEDIATE must eliminate them.
  assert.equal(busy, 0, `expected no SQLITE_BUSY, got ${busy} (per-worker ${JSON.stringify(results)})`);
  assert.equal(other, 0, `expected no other errors, got ${other} (${JSON.stringify(results)})`);
  assert.ok(ok > 0, `expected progress, got ${ok}`);
});

// Workload-scaled timeout: as above, with a shorter 4s run on one hot entity.
test("concurrent writers on ONE entity surface optimistic conflicts, never busy errors", { timeout: 120_000 }, async () => {
  const results = await runContention({ perEntity: true, seconds: 4 });
  const busy = results.reduce((s, r) => s + r.busy, 0);
  const ok = results.reduce((s, r) => s + r.ok, 0);
  const conflicts = results.reduce((s, r) => s + r.conflicts, 0);

  assert.equal(busy, 0, `expected no SQLITE_BUSY, got ${busy} (${JSON.stringify(results)})`);
  // Contention on one entity must resolve as a genuine optimistic conflict, not
  // a transient database error: at least one append wins and the rest no-op.
  assert.ok(ok > 0, `expected some successful appends, got ${ok}`);
  assert.ok(ok + conflicts > 0, `expected winners and/or conflicts, got ok=${ok} conflicts=${conflicts}`);
});
