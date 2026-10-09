// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  ReplayStatusIndex,
  replayLedgerStatus,
  resetReplayLedgerStatus,
} from "../../src/runtime/replay-status-index.js";
import {
  ExecutionEvidenceStore,
  computeEvidenceChecksum,
  evidenceLedgerStatus,
  resetEvidenceLedgerStatus,
} from "../../src/runtime/execution-evidence-store.js";
import {
  reconcileReplayLedger,
  reconcileEvidenceLedger,
} from "../../src/runtime/runtime-evidence-ledger-reconcile.js";
import { getSharedLedger, closeSharedLedger, runtimeLedgerPath } from "../../src/storage/runtime-ledger.js";
import type { ExecutionEvidence } from "../../src/runtime/contracts/execution-intent-contract.js";

const dirs: string[] = [];

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "r211-"));
  dirs.push(dir);
  resetReplayLedgerStatus(dir);
  resetEvidenceLedgerStatus(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { closeSharedLedger(dir); } catch { /* ignore */ }
    resetReplayLedgerStatus(dir);
    resetEvidenceLedgerStatus(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

function evidence(id: string): ExecutionEvidence {
  const base = {
    evidenceId: id,
    intentId: `intent_${randomUUID()}`,
    startedAt: "2026-10-07T00:00:00.000Z",
    completedAt: "2026-10-07T00:00:10.000Z",
    outcome: "SUCCESS" as const,
    summary: "did the thing",
    artifacts: ["a.txt"],
    verificationPassed: true,
    evidenceHash: "",
  };
  return { ...base, evidenceHash: computeEvidenceChecksum(base as ExecutionEvidence) };
}

describe("replay-index ledger authority (R2.17)", () => {
  it("setStatus mirrors created + updated; reconcile clean", async () => {
    const dir = tmp();
    const index = new ReplayStatusIndex(dir);
    const replayId = `replay_${randomUUID()}`;

    await index.setStatus(replayId, "capturing");
    const ledger = getSharedLedger(dir);
    assert.equal(ledger.entityVersion(replayId), 1);
    assert.equal(ledger.lastEvent(replayId)?.eventType, "replay.status_created");

    await index.setStatus(replayId, "completed", "full");
    assert.equal(ledger.entityVersion(replayId), 2);
    const last = ledger.lastEvent(replayId);
    assert.equal(last?.eventType, "replay.status_updated");
    assert.equal((last?.payload as { entry: { status: string } }).entry.status, "completed");

    assert.equal(replayLedgerStatus(dir).failures, 0);
    const report = await reconcileReplayLedger(dir);
    assert.equal(report.scannedEntries, 1);
    assert.equal(report.issues.length, 0, JSON.stringify(report.issues));
    assert.equal(report.ok, true);
    assert.deepEqual(report.unknownEventTypes, {});
    assert.equal(report.truncated, false);
  });

  it("legacy index entry reported missing_in_ledger", async () => {
    const dir = tmp();
    mkdirSync(join(dir, ".alix", "replays"), { recursive: true });
    writeFileSync(join(dir, ".alix", "replays", "index.json"), JSON.stringify({
      entries: [{ replayId: "replay_legacy", status: "completed", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
    }, null, 2));

    const report = await reconcileReplayLedger(dir);
    const kinds = report.issues.map(i => i.kind);
    assert.ok(kinds.includes("missing_in_ledger"), JSON.stringify(report.issues));
    assert.equal(report.ok, false);
  });

  it("tampered index status reported as record_mismatch", async () => {
    const dir = tmp();
    const index = new ReplayStatusIndex(dir);
    const replayId = `replay_${randomUUID()}`;
    await index.setStatus(replayId, "capturing");

    const path = join(dir, ".alix", "replays", "index.json");
    const data = JSON.parse(readFileSync(path, "utf-8")) as { entries: Array<{ replayId: string; status: string }> };
    data.entries.find(e => e.replayId === replayId)!.status = "locked";
    writeFileSync(path, JSON.stringify(data, null, 2));

    const report = await reconcileReplayLedger(dir);
    const mismatch = report.issues.find(i => i.kind === "record_mismatch");
    assert.ok(mismatch, JSON.stringify(report.issues));
    assert.match(mismatch!.detail, /status: json=locked ledger=capturing/);
  });

  it("append failure fails setStatus — no JSON-only state (R2.17 authority)", async () => {
    const dir = tmp();
    closeSharedLedger(dir);
    mkdirSync(runtimeLedgerPath(dir), { recursive: true });

    const index = new ReplayStatusIndex(dir);
    await assert.rejects(() => index.setStatus(`replay_${randomUUID()}`, "capturing"), /SQLITE|unable|not a database|ledger append failed/i);
    assert.equal(replayLedgerStatus(dir).failures >= 1, true);
    assert.ok(replayLedgerStatus(dir).lastError);
    assert.ok(!existsSync(join(dir, ".alix", "replays", "index.json")));

    rmSync(runtimeLedgerPath(dir), { recursive: true, force: true });
  });

  it("projection write failure is tolerated; load still returns authority entries", async () => {
    const dir = tmp();
    // Occupy index.json with a DIRECTORY so save() fails.
    mkdirSync(join(dir, ".alix", "replays", "index.json"), { recursive: true });

    const index = new ReplayStatusIndex(dir);
    const replayId = `replay_${randomUUID()}`;
    await index.setStatus(replayId, "capturing"); // must NOT throw
    assert.equal(replayLedgerStatus(dir).projectionFailures, 1);
    assert.equal(getSharedLedger(dir).entityVersion(replayId), 1);

    const fresh = new ReplayStatusIndex(dir);
    const data = await fresh.load(); // authority read
    assert.equal(data.entries.find(e => e.replayId === replayId)?.status, "capturing");

    rmSync(join(dir, ".alix", "replays", "index.json"), { recursive: true, force: true });
    const report = await reconcileReplayLedger(dir);
    const kinds = report.issues.map(i => i.kind);
    assert.ok(kinds.includes("projection_missing"), JSON.stringify(report.issues));
  });

  it("load prefers the LEDGER over a tampered index file", async () => {
    const dir = tmp();
    const index = new ReplayStatusIndex(dir);
    const replayId = `replay_${randomUUID()}`;
    await index.setStatus(replayId, "capturing");

    const path = join(dir, ".alix", "replays", "index.json");
    const data = JSON.parse(readFileSync(path, "utf-8")) as { entries: Array<{ replayId: string; status: string }> };
    data.entries.find(e => e.replayId === replayId)!.status = "locked";
    writeFileSync(path, JSON.stringify(data, null, 2));

    const fresh = new ReplayStatusIndex(dir);
    const loaded = await fresh.load();
    assert.equal(loaded.entries.find(e => e.replayId === replayId)?.status, "capturing");
  });
});

describe("execution-evidence ledger authority (R2.17)", () => {
  it("append mirrors recorded; reconcile clean", async () => {
    const dir = tmp();
    const storeDir = join(dir, ".alix", "governance");
    const store = new ExecutionEvidenceStore(storeDir);
    const e1 = evidence("ev_1");
    await store.append(e1);
    const e2 = evidence("ev_2");
    await store.append(e2);

    const ledger = getSharedLedger(dir);
    assert.equal(ledger.entityVersion("ev_1"), 1);
    assert.equal(ledger.lastEvent("ev_1")?.eventType, "evidence.recorded");
    // Append-only contract: duplicate evidenceIds are legal (callers own
    // deduplication) and each physical append mirrors.
    await store.append(e1);
    assert.equal(ledger.entityVersion("ev_1"), 2);
    assert.equal((await store.list()).length, 3); // ev_1, ev_2, ev_1 — line order preserved

    assert.equal(evidenceLedgerStatus(dir).failures, 0);
    const report = await reconcileEvidenceLedger(dir);
    assert.equal(report.scannedRecords, 2);
    assert.equal(report.ledgerEntities, 2);
    assert.equal(report.issues.length, 0, JSON.stringify(report.issues));
    assert.equal(report.ok, true);
    assert.deepEqual(report.unknownEventTypes, {});
  });

  it("append failure fails evidence append — no JSON-only state (R2.17 authority)", async () => {
    const dir = tmp();
    closeSharedLedger(dir);
    mkdirSync(runtimeLedgerPath(dir), { recursive: true });

    const store = new ExecutionEvidenceStore(join(dir, ".alix", "governance"));
    await assert.rejects(() => store.append(evidence("ev_blocked")), /SQLITE|unable|not a database|ledger append failed/i);
    assert.equal(evidenceLedgerStatus(dir).failures >= 1, true);

    rmSync(runtimeLedgerPath(dir), { recursive: true, force: true });
  });

  it("list prefers the LEDGER over a tampered JSONL record", async () => {
    const dir = tmp();
    const storeDir = join(dir, ".alix", "governance");
    const store = new ExecutionEvidenceStore(storeDir);
    const e = evidence("ev_1");
    await store.append(e);

    const path = join(storeDir, "execution-evidence.jsonl");
    const lines = readFileSync(path, "utf-8").trim().split("\n").map(l => JSON.parse(l) as ExecutionEvidence);
    lines[0] = { ...lines[0], summary: "tampered" };
    writeFileSync(path, lines.map(l => JSON.stringify(l)).join("\n") + "\n");

    const fresh = new ExecutionEvidenceStore(storeDir);
    const records = await fresh.list();
    assert.equal(records.find(r => r.evidenceId === "ev_1")?.summary, "did the thing"); // ledger truth
  });

  it("legacy JSONL record reported missing_in_ledger", async () => {
    const dir = tmp();
    const storeDir = join(dir, ".alix", "governance");
    mkdirSync(storeDir, { recursive: true });
    writeFileSync(join(storeDir, "execution-evidence.jsonl"), JSON.stringify(evidence("ev_legacy")) + "\n");

    const report = await reconcileEvidenceLedger(dir);
    const kinds = report.issues.map(i => i.kind);
    assert.ok(kinds.includes("missing_in_ledger"), JSON.stringify(report.issues));
    assert.equal(report.ok, false);
  });

  it("tampered outcome reported as record_mismatch", async () => {
    const dir = tmp();
    const storeDir = join(dir, ".alix", "governance");
    const store = new ExecutionEvidenceStore(storeDir);
    const e = evidence("ev_1");
    await store.append(e);

    const path = join(storeDir, "execution-evidence.jsonl");
    const lines = readFileSync(path, "utf-8").trim().split("\n").map(l => JSON.parse(l) as ExecutionEvidence);
    lines[0] = { ...lines[0], outcome: "FAILED" };
    writeFileSync(path, lines.map(l => JSON.stringify(l)).join("\n") + "\n");

    const report = await reconcileEvidenceLedger(dir);
    const mismatch = report.issues.find(i => i.kind === "record_mismatch");
    assert.ok(mismatch, JSON.stringify(report.issues));
    assert.match(mismatch!.detail, /json=\{FAILED,/);
    assert.match(mismatch!.detail, /ledger=\{SUCCESS,/);
  });

  it("fresh workspace reconciles clean (replay + evidence)", async () => {
    const dir = tmp();
    const replay = await reconcileReplayLedger(dir);
    assert.equal(replay.ok, true);
    assert.equal(replay.scannedEntries, 0);
    const ev = await reconcileEvidenceLedger(dir);
    assert.equal(ev.ok, true);
    assert.equal(ev.scannedRecords, 0);
  });
});
