/**
 * Audit-chain crash recovery (P1).
 *
 * A crash after the JSONL record is fsynced but before `head.json` is written
 * must NOT cause the next append to reallocate a committed sequence. Recovery
 * verifies the persisted chain under the audit lock, advances a stale-but-valid
 * head only when it is a verified ancestor of the persisted tip, and fails
 * closed for corrupt/conflicting/unverifiable history without ever truncating,
 * rewriting, or discarding committed records.
 *
 * Repro of the original defect: scripts/probe-audit-chain-crash.mjs
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, appendFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AuditStore } from "../../src/governance/audit/audit-store.js";
import { AuditChainWriter, type AuditRecoveryEvent, type AuditRecoveryFailureEvent } from "../../src/governance/security/audit/audit-chain-writer.js";
import { verifyAuditLog } from "../../src/governance/security/audit/audit-verifier.js";
import { isAuditRecordV2 } from "../../src/governance/audit/audit-types.js";

function auditPaths(cwd: string) {
  const dir = join(cwd, ".alix", "audit");
  return { dir, headPath: join(dir, "head.json"), logPath: join(dir, "audit.jsonl") };
}

function readLines(logPath: string): string[] {
  return readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
}

function readSeqs(logPath: string): (number | "malformed")[] {
  return readLines(logPath).map((l) => {
    try {
      return JSON.parse(l).seq;
    } catch {
      return "malformed";
    }
  });
}

describe("audit-chain crash recovery (P1)", () => {
  let cwd: string;
  let paths: ReturnType<typeof auditPaths>;

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), "audit-recovery-"));
    paths = auditPaths(cwd);
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("normal append chains and verifies", async () => {
    const store = new AuditStore(cwd);
    await store.activateIntegrity();
    const a = await store.append({ action: "policy.allowed", actor: "user", details: { reason: "n1" } });
    const b = await store.append({ action: "policy.allowed", actor: "user", details: { reason: "n2" } });
    assert.ok(isAuditRecordV2(a) && isAuditRecordV2(b));
    assert.equal(b.seq, a.seq + 1);
    const v = await store.verifyIntegrity();
    assert.ok(v.ok, `expected ok: ${JSON.stringify(v.findings)}`);
    assert.deepEqual(readSeqs(paths.logPath), [1, 2, 3]);
  });

  it("missing head: recovery re-derives from the persisted chain", async () => {
    const writer = new AuditChainWriter({ auditDir: paths.dir });
    const a = await writer.append({ action: "policy.allowed", actor: "user", details: {}, timestamp: Date.now() });
    assert.ok(isAuditRecordV2(a));

    unlinkSync(paths.headPath);
    assert.equal(existsSync(paths.headPath), false);

    // The chain writer must still continue the v2 chain, not restart at genesis.
    const next = await writer.append({ action: "policy.allowed", actor: "user", details: {}, timestamp: Date.now() });
    assert.ok(isAuditRecordV2(next));
    assert.equal(next.seq, a.seq + 1);
    assert.deepEqual(readSeqs(paths.logPath), [1, 2]);
    const v = await new AuditStore(cwd).verifyIntegrity();
    assert.ok(v.ok, `expected ok: ${JSON.stringify(v.findings)}`);
  });

  it("malformed head: recovery rebuilds it from the verified chain", async () => {
    const writer = new AuditChainWriter({ auditDir: paths.dir });
    const a = await writer.append({ action: "policy.allowed", actor: "user", details: {}, timestamp: Date.now() });

    writeFileSync(paths.headPath, "{ this is not json", "utf-8");

    const next = await writer.append({ action: "policy.allowed", actor: "user", details: {}, timestamp: Date.now() });
    assert.ok(isAuditRecordV2(next));
    assert.equal(next.seq, a.seq + 1);
    assert.ok((await new AuditStore(cwd).verifyIntegrity()).ok);
  });

  it("stale head after JSONL fsync: no duplicate sequence", async () => {
    const store = new AuditStore(cwd);
    await store.activateIntegrity();
    await store.append({ action: "policy.allowed", details: {} });
    await store.append({ action: "policy.allowed", details: {} });
    const headAfterA2 = readFileSync(paths.headPath, "utf-8");
    const a3 = await store.append({ action: "policy.allowed", details: {} });

    // Simulate the crash window: JSONL holds a3, head still points at a2.
    writeFileSync(paths.headPath, headAfterA2, "utf-8");

    const a4 = await store.append({ action: "policy.allowed", details: {} });
    assert.ok(isAuditRecordV2(a4));
    assert.notEqual(a4.seq, (a3 as { seq: number }).seq, "must not reuse the committed seq");
    assert.equal(a4.seq, (a3 as { seq: number }).seq + 1);
    assert.ok(!readSeqs(paths.logPath).some((s, i, arr) => arr.indexOf(s) !== i), "no duplicate seqs");
    const v = await store.verifyIntegrity();
    assert.ok(v.ok, `expected ok: ${JSON.stringify(v.findings)}`);
  });

  it("crash/restart followed by append recovers cleanly", async () => {
    const storeA = new AuditStore(cwd);
    await storeA.activateIntegrity();
    await storeA.append({ action: "policy.allowed", details: {} });
    await storeA.append({ action: "policy.allowed", details: {} });
    const headAfterA2 = readFileSync(paths.headPath, "utf-8");
    const a3 = await storeA.append({ action: "policy.allowed", details: {} });
    writeFileSync(paths.headPath, headAfterA2, "utf-8"); // crash before head write

    // Fresh process/store instance (no in-memory carryover).
    const storeB = new AuditStore(cwd);
    const recovered = await storeB.append({ action: "policy.allowed", details: {} });
    assert.ok(isAuditRecordV2(recovered));
    assert.equal(recovered.seq, (a3 as { seq: number }).seq + 1);
    assert.ok((await storeB.verifyIntegrity()).ok);
  });

  it("corrupt tail: fails closed and never rewrites the log", async () => {
    const store = new AuditStore(cwd);
    await store.activateIntegrity();
    await store.append({ action: "policy.allowed", details: {} });
    const before = readFileSync(paths.logPath, "utf-8");

    // A truncated/partial final line (crash mid-write).
    appendFileSync(paths.logPath, '{"version":2,"seq":99,"prevHash":', "utf-8");

    await assert.rejects(
      () => store.append({ action: "policy.allowed", details: {} }),
      /recovery failed|malformed/i,
    );
    // Committed bytes are untouched (no truncation, no rewrite).
    assert.equal(readFileSync(paths.logPath, "utf-8"), before + '{"version":2,"seq":99,"prevHash":');
  });

  it("conflicting head (seq matches, hash differs): fails closed", async () => {
    const store = new AuditStore(cwd);
    await store.activateIntegrity();
    await store.append({ action: "policy.allowed", details: {} });
    const head = JSON.parse(readFileSync(paths.headPath, "utf-8"));
    const before = readFileSync(paths.logPath, "utf-8");

    writeFileSync(
      paths.headPath,
      JSON.stringify({ ...head, recordHash: "f".repeat(64) }),
      "utf-8",
    );

    await assert.rejects(
      () => store.append({ action: "policy.allowed", details: {} }),
      /recovery failed|not a verified ancestor/i,
    );
    assert.equal(readFileSync(paths.logPath, "utf-8"), before, "log must be untouched");
  });

  it("conflicting head (seq ahead of the chain): fails closed", async () => {
    const store = new AuditStore(cwd);
    await store.activateIntegrity();
    await store.append({ action: "policy.allowed", details: {} });
    const head = JSON.parse(readFileSync(paths.headPath, "utf-8"));
    const before = readFileSync(paths.logPath, "utf-8");

    writeFileSync(paths.headPath, JSON.stringify({ ...head, seq: head.seq + 500 }), "utf-8");

    await assert.rejects(() => store.append({ action: "policy.allowed", details: {} }));
    assert.equal(readFileSync(paths.logPath, "utf-8"), before);
  });

  it("verifier retains bounded identity, not every record, on a larger log", { timeout: 30_000 }, async () => {
    // Load-sensitive: 40 sequential fsync'd appends exceed the default budget
    // on slow/rotational storage, so pin a workload-rationale timeout.
    const writer = new AuditChainWriter({ auditDir: paths.dir, lock: { timeoutMs: 30_000 } });
    const total = 40;
    for (let i = 0; i < total; i += 1) {
      await writer.append({ action: "policy.allowed", actor: "user", details: {}, timestamp: Date.now() });
    }

    const result = await verifyAuditLog({ auditDir: paths.dir, requestedSeq: 7 });
    assert.ok(result.ok, `expected ok: ${JSON.stringify(result.findings)}`);
    assert.equal(result.recordCount.v2, total);
    // Bounded: only the tip and the single requested record are retained — the
    // result carries no per-record array regardless of log size.
    assert.equal(result.tip?.seq, total);
    assert.equal(result.requestedRecord?.seq, 7);
    assert.ok(!("records" in result), "must not expose the full per-record set");
  });

  it("final record larger than the tail window: fails closed", { timeout: 30_000 }, async () => {
    const store = new AuditStore(cwd);
    await store.activateIntegrity();
    await store.append({ action: "policy.allowed", details: {} });
    const before = readFileSync(paths.logPath, "utf-8");

    // Append a syntactically-valid record line larger than the 256 KB tail
    // window so the bounded reader cannot see the whole final line.
    const huge = JSON.stringify({
      version: 2,
      seq: 999,
      prevHash: null,
      recordHash: "a".repeat(64),
      timestamp: Date.now(),
      action: "policy.allowed",
      details: { reason: "x".repeat(300 * 1024) },
    });
    appendFileSync(paths.logPath, huge + "\n", "utf-8");

    await assert.rejects(
      () => store.append({ action: "policy.allowed", details: {} }),
      /tail read window|recovery failed/i,
    );
    assert.equal(readFileSync(paths.logPath, "utf-8"), before + huge + "\n", "must not rewrite or truncate");
  });

  it("emptied log with a sidecar: fails closed rather than re-genesis", async () => {
    const store = new AuditStore(cwd);
    await store.activateIntegrity();
    await store.append({ action: "policy.allowed", details: {} });

    // Log lost/emptied while head.json remains — committed evidence is gone.
    writeFileSync(paths.logPath, "", "utf-8");

    await assert.rejects(
      () => store.append({ action: "policy.allowed", details: {} }),
      /no records|recovery failed/i,
    );
    assert.equal(readFileSync(paths.logPath, "utf-8"), "", "must not fabricate a chain");
  });

  it("matching ancestor in a corrupt chain never authorizes recovery", async () => {
    // requestedRecord must only be trusted when the WHOLE verified chain passes.
    // Build a good chain, then tamper a later record so the chain is corrupt
    // while the sidecar's seq still resolves to a valid, hash-matching record.
    const writer = new AuditChainWriter({ auditDir: paths.dir, lock: { timeoutMs: 30_000 } });
    const a1 = await writer.append({ action: "policy.allowed", actor: "user", details: {}, timestamp: Date.now() });
    const a2 = await writer.append({ action: "policy.allowed", actor: "user", details: {}, timestamp: Date.now() });
    const headAfterA2 = readFileSync(paths.headPath, "utf-8");
    await writer.append({ action: "policy.allowed", actor: "user", details: {}, timestamp: Date.now() });
    await writer.append({ action: "policy.allowed", actor: "user", details: {}, timestamp: Date.now() });
    assert.equal(a1.seq, 1);
    assert.equal(a2.seq, 2);

    // Tamper the persisted tail so the chain is corrupt (hash mismatch).
    const lines = readLines(paths.logPath);
    const last = JSON.parse(lines[lines.length - 1]);
    last.details = { reason: "tampered-after-commit" };
    lines[lines.length - 1] = JSON.stringify(last);
    writeFileSync(paths.logPath, lines.join("\n") + "\n", "utf-8");
    // Stale head points at a still-valid ancestor (seq 2).
    writeFileSync(paths.headPath, headAfterA2, "utf-8");
    const logBefore = readFileSync(paths.logPath, "utf-8");

    await assert.rejects(
      () => writer.append({ action: "policy.allowed", actor: "user", details: {}, timestamp: Date.now() }),
      /not verifiable|recovery failed/i,
    );
    assert.equal(readFileSync(paths.logPath, "utf-8"), logBefore, "must not rewrite or truncate");
    // The committed corruption is still detectable, not silently repaired.
    const v = await new AuditStore(cwd).verifyIntegrity();
    assert.ok(!v.ok, "corruption must remain detectable");
  });

  it("recovered head preserves the verified tip's timestamp", async () => {
    const writer = new AuditChainWriter({ auditDir: paths.dir, lock: { timeoutMs: 30_000 } });
    await writer.append({ action: "policy.allowed", actor: "user", details: {}, timestamp: 1_700_000_000_000 });
    const headAfterA1 = readFileSync(paths.headPath, "utf-8");
    const a2 = await writer.append({ action: "policy.allowed", actor: "user", details: {}, timestamp: 1_700_000_111_111 });

    // Crash between a2's JSONL fsync and its head write.
    writeFileSync(paths.headPath, headAfterA1, "utf-8");

    const a3 = await writer.append({ action: "policy.allowed", actor: "user", details: {}, timestamp: 1_700_000_222_222 });
    assert.equal(a3.seq, a2.seq + 1);
    // The healed sidecar must reflect a2's committed timestamp, not a synthesized one.
    const head = JSON.parse(readFileSync(paths.headPath, "utf-8"));
    assert.equal(head.seq, a3.seq);
    assert.equal(head.timestamp, 1_700_000_222_222);
  });

  it("concurrent appenders serialize to one chain with unique sequences", { timeout: 30_000 }, async () => {
    // Exercise the writer directly with a generous lock timeout: this test runs
    // inside the parallel node-test lane, where CPU contention can otherwise
    // exhaust the default 5s lock budget for the losing contenders.
    const writer = new AuditChainWriter({ auditDir: paths.dir, lock: { timeoutMs: 30_000 } });
    await writer.append({ action: "policy.allowed", actor: "user", details: {}, timestamp: Date.now() });
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        writer.append({ action: "policy.allowed", actor: "user", details: {}, timestamp: Date.now() }),
      ),
    );
    const seqs = results.map((r) => r.seq).sort((a, b) => a - b);
    assert.equal(seqs.length, 12);
    // Activation-style first append consumes seq 1; the 12 concurrent appends are 2..13.
    assert.deepEqual(seqs, Array.from({ length: 12 }, (_, i) => i + 2));
    const v = await new AuditStore(cwd).verifyIntegrity();
    assert.ok(v.ok, `expected ok: ${JSON.stringify(v.findings)}`);
  });
});

describe("audit-chain recovery telemetry (out-of-band, no chained record)", () => {
  let cwd: string;
  let paths: ReturnType<typeof auditPaths>;
  let events: AuditRecoveryEvent[];

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "audit-recovery-telemetry-"));
    paths = auditPaths(cwd);
    events = [];
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function writer(lock = { timeoutMs: 30_000 }): AuditChainWriter {
    return new AuditChainWriter({ auditDir: paths.dir, lock, onRecovery: (e) => events.push(e) });
  }

  it("normal append (fast path) emits no recovery event", async () => {
    const w = writer();
    await w.append({ action: "policy.allowed", details: {}, timestamp: Date.now() });
    events = [];
    await w.append({ action: "policy.allowed", details: {}, timestamp: Date.now() });
    assert.equal(events.length, 0);
  });

  it("successful stale-head repair emits exactly one event and consumes no sequence", async () => {
    const store = new AuditStore(cwd);
    await store.activateIntegrity();
    await store.append({ action: "policy.allowed", details: {} });
    const headAfterA2 = readFileSync(paths.headPath, "utf-8");
    const a3 = await store.append({ action: "policy.allowed", details: {} });
    // Crash window: JSONL holds a3, head still points at a2.
    writeFileSync(paths.headPath, headAfterA2, "utf-8");

    const w = writer();
    const a4 = await w.append({ action: "policy.allowed", details: {}, timestamp: Date.now() });
    // Sequence semantics preserved: no extra chained record was inserted.
    assert.equal(a4.seq, (a3 as { seq: number }).seq + 1);
    assert.equal(events.length, 1);
    assert.equal(events[0].action, "audit.stale_sidecar_recovered");
    if (events[0].action === "audit.stale_sidecar_recovered") {
      // previousSeq is the stale sidecar's seq (a2); recoveredSeq is the tip (a3).
      assert.equal(events[0].previousSeq, (a3 as { seq: number }).seq - 1);
      assert.equal(events[0].recoveredSeq, (a3 as { seq: number }).seq);
    }
    assert.ok((await new AuditStore(cwd).verifyIntegrity()).ok);
  });

  it("recovery followed by a separate append keeps the caller's sequence unchanged", async () => {
    const store = new AuditStore(cwd);
    await store.activateIntegrity();
    await store.append({ action: "policy.allowed", details: {} });
    const headAfterA2 = readFileSync(paths.headPath, "utf-8");
    const a3 = await store.append({ action: "policy.allowed", details: {} });
    writeFileSync(paths.headPath, headAfterA2, "utf-8"); // crash before head write

    const w = writer();
    // First append performs the repair and emits one event.
    const repairAppend = await w.append({ action: "policy.allowed", details: {}, timestamp: Date.now() });
    assert.equal(repairAppend.seq, (a3 as { seq: number }).seq + 1);
    assert.equal(events.length, 1);

    // A subsequent append runs the fast path: no extra event, contiguous seq.
    const nextAppend = await w.append({ action: "policy.allowed", details: {}, timestamp: Date.now() });
    assert.equal(nextAppend.seq, repairAppend.seq + 1);
    assert.equal(events.length, 1, "the follow-up append must not re-emit recovery");
    assert.ok((await store.verifyIntegrity()).ok);
  });

  it("missing (not stale) sidecar emits one recovery event with previousSeq 0", async () => {
    const store = new AuditStore(cwd);
    await store.activateIntegrity();
    await store.append({ action: "policy.allowed", details: {} });
    unlinkSync(paths.headPath); // absent, not stale

    const w = writer();
    const next = await w.append({ action: "policy.allowed", details: {}, timestamp: Date.now() });
    assert.equal(next.seq, 3); // seq 1 = activation, seq 2 = store append
    assert.equal(events.length, 1, "re-deriving from the chain is a recovery");
    assert.equal(events[0].action, "audit.stale_sidecar_recovered");
    if (events[0].action === "audit.stale_sidecar_recovered") {
      assert.equal(events[0].previousSeq, 0, "a missing sidecar reports previousSeq 0");
      assert.equal(events[0].recoveredSeq, 2);
    }
  });

  it("telemetry sink presence does not change sequence allocation", async () => {
    const store = new AuditStore(cwd);
    await store.activateIntegrity();
    await store.append({ action: "policy.allowed", details: {} });
    // No stale head — a plain append with a telemetry sink installed.
    const w = writer();
    const next = await w.append({ action: "policy.allowed", details: {}, timestamp: Date.now() });
    // seq 1 = activation record, seq 2 = the store append above; no extra seq consumed.
    assert.equal(next.seq, 3);
    assert.equal(events.length, 0);
  });

  it("corrupt chain fails closed and reports failure telemetry, no success event", async () => {
    const store = new AuditStore(cwd);
    await store.activateIntegrity();
    await store.append({ action: "policy.allowed", details: {} });
    appendFileSync(paths.logPath, '{"version":2,"seq":99,"prevHash":', "utf-8");

    const w = writer();
    await assert.rejects(
      () => w.append({ action: "policy.allowed", details: {}, timestamp: Date.now() }),
      /recovery failed|malformed/i,
    );
    const failed = events.filter((e): e is AuditRecoveryFailureEvent => e.action === "audit.recovery");
    const recovered = events.filter((e) => e.action === "audit.stale_sidecar_recovered");
    assert.equal(failed.length, 1, "exactly one failure event");
    assert.equal(failed[0].outcome, "failed");
    assert.equal(recovered.length, 0, "no success event on a failed recovery");
  });

  it("a non-recovery error is reported as outcome \"error\", not mislabeled as a fail-closed failure", async () => {
    // readPersistedTip calls statSync on the log path; a directory there throws
    // EISDIR — a genuine reconciliation defect, not a fail-closed recovery
    // verdict. It must propagate with the original error AND emit an `error`
    // telemetry event (never a success, never outcome:"failed").
    const store = new AuditStore(cwd);
    await store.activateIntegrity();
    await store.append({ action: "policy.allowed", details: {} });
    // Replace the log file with a directory so statSync/readSync throws.
    rmSync(paths.logPath);
    mkdirSync(paths.logPath);

    const w = writer();
    // The original error must propagate unchanged (fail loud), not be swallowed
    // or replaced by the telemetry path.
    await assert.rejects(
      () => w.append({ action: "policy.allowed", details: {}, timestamp: Date.now() }),
      (err: unknown) => {
        assert.ok(err instanceof Error, "original error must propagate");
        assert.equal((err as NodeJS.ErrnoException).code, "EISDIR", "the original EISDIR must survive");
        return true;
      },
    );

    const recovery = events.filter((e): e is AuditRecoveryFailureEvent => e.action === "audit.recovery");
    assert.equal(recovery.length, 1, "reconciliation defects must not go silent");
    assert.equal(recovery[0].outcome, "error", "a defect is outcome:\"error\", not outcome:\"failed\"");
    assert.equal(events.filter((e) => e.action === "audit.stale_sidecar_recovered").length, 0);
  });

  it("throwing telemetry sink never affects a successful repair or the append", async () => {
    const store = new AuditStore(cwd);
    await store.activateIntegrity();
    await store.append({ action: "policy.allowed", details: {} });
    const headAfterA2 = readFileSync(paths.headPath, "utf-8");
    const a3 = await store.append({ action: "policy.allowed", details: {} });
    writeFileSync(paths.headPath, headAfterA2, "utf-8");

    const throwing = new AuditChainWriter({
      auditDir: paths.dir,
      lock: { timeoutMs: 30_000 },
      onRecovery: () => { throw new Error("telemetry sink down"); },
    });
    const a4 = await throwing.append({ action: "policy.allowed", details: {}, timestamp: Date.now() });
    assert.equal(a4.seq, (a3 as { seq: number }).seq + 1);
    assert.ok((await new AuditStore(cwd).verifyIntegrity()).ok);
  });
});
