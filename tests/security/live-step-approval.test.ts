import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { ApprovalStore } from "../../src/governance/approvals/approval-store.js";
import { EventLog } from "../../src/runtime-state/events/event-log.js";
import { ReplayExecutor } from "../../src/runtime-state/runtime/replay-executor.js";
import { RollbackExecutor } from "../../src/runtime-state/runtime/rollback-executor.js";
import type { ReplayPlan } from "../../src/runtime-state/runtime/replay-plan.js";
import type { RollbackPlan } from "../../src/runtime-state/runtime/rollback-plan.js";
import { executeWithEffectJournal, readEffectRecord } from "../../src/capabilities/tools/effect-journal.js";

const run = promisify(execFile);

for (const operation of ["replay", "rollback"] as const) {
  describe(`${operation} exact single-use live approvals`, () => {
    async function fixture(t: import("node:test").TestContext) {
      const cwd = mkdtempSync(join(tmpdir(), "live-step-approval-"));
      t.after(() => rmSync(cwd, { recursive: true, force: true }));
      const sessionDir = join(cwd, ".alix/sessions/live-test");
      mkdirSync(sessionDir, { recursive: true });
      const eventLog = new EventLog(sessionDir);
      await eventLog.init();
      const store = new ApprovalStore(cwd);
      await store.load();
      const replay: ReplayPlan = {
        replayId: "replay-one", sessionId: "source", mode: "approved-live",
        steps: [{ index: 1, traceId: "trace-one", eventType: "tool.started", replayAction: "would-run-tool",
          toolName: "file.create", args: { path: "target.txt", content: "approved bytes" }, status: "ready" }],
        toolCount: 1, blockedSteps: 0, executable: true, approvals: [], warnings: [],
      };
      const snapshotPath = join(cwd, "before.txt");
      writeFileSync(snapshotPath, "approved bytes");
      const rollback: RollbackPlan = {
        replayId: "replay-one", rollbackId: "rollback-one", mode: "approved-live", createdAt: new Date().toISOString(),
        steps: [{ path: "target.txt", action: "restore", rollbackable: true, beforeSnapshotPath: snapshotPath }],
      };
      const execute = async (approvalStore = store, log = eventLog, executionCwd = cwd) => operation === "replay"
        ? new ReplayExecutor(executionCwd, log).execute(replay, { approvalStore })
        : new RollbackExecutor(executionCwd, log).execute(rollback, { approvalStore });
      const approve = async () => {
        const result = await execute();
        assert.equal(result.blockedCount, 1);
        const pending = store.listPending();
        assert.equal(pending.length, 1);
        await store.resolve(pending[0].id, "approved");
        return pending[0].id;
      };
      const child = async (crash = false) => {
        const moduleRoot = new URL("../../src/", import.meta.url).href;
        const receipt = join(cwd, `receipt-${randomUUID()}.json`);
        const code = `
          const { writeFileSync } = await import("node:fs");
          const { closeAllSharedLedgers } = await import(${JSON.stringify(moduleRoot + "runtime-state/storage/runtime-ledger.js")});
          const { ApprovalStore } = await import(${JSON.stringify(moduleRoot + "governance/approvals/approval-store.js")});
          const { EventLog } = await import(${JSON.stringify(moduleRoot + "runtime-state/events/event-log.js")});
          const { ${operation === "replay" ? "ReplayExecutor" : "RollbackExecutor"}: Executor } = await import(${JSON.stringify(moduleRoot + `runtime-state/runtime/${operation}-executor.js`)});
          const store = new ApprovalStore(${JSON.stringify(cwd)});
          await store.load();
          if (${crash}) {
            const consume = store.consumeApproved.bind(store);
            store.consumeApproved = async (...args) => {
              const result = await consume(...args);
              if (result.consumed) process.exit(73);
              return result;
            };
          }
          const log = new EventLog(${JSON.stringify(sessionDir)});
          await log.init();
          const result = await new Executor(${JSON.stringify(cwd)}, log).execute(${JSON.stringify(operation === "replay" ? replay : rollback)}, { approvalStore: store });
          writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({ success: result.successCount, blocked: result.blockedCount }));
          closeAllSharedLedgers();
        `;
        await run(process.execPath, ["--input-type=module", "-e", code]);
        return JSON.parse(readFileSync(receipt, "utf8")) as { success: number; blocked: number };
      };
      return { cwd, store, eventLog, replay, rollback, execute, approve, child, snapshotPath };
    }

    // Authority parity includes valid grants, every terminal state, corrupt expiry,
    // legacy bindings, and changes independent of the argument payload.
    const cases = [
      ["exact approved", "allow"], ["pending", "deny"], ["denied", "deny"],
      ["revoked", "deny"], ["invalidated", "deny"], ["consumed", "deny"],
      ["expired", "deny"], ["invalid expiry", "deny"], ["legacy", "deny"],
      ["toolId only", "deny"], ["changed binding", "deny"], ["changed fingerprint", "deny"],
      ["changed workspace", "deny"], ["changed session", "deny"],
      ["changed args", "deny"], ["changed operation", "deny"], ["changed step", "deny"],
      ["missing operation", "deny"],
    ] as const;
    for (const [scenario, expected] of cases) {
      it(`authority parity: ${scenario} => ${expected}`, async t => {
        const f = await fixture(t);
        const id = await f.approve();
        await f.store.mutate(records => {
          const record = records.find(a => a.id === id)!;
          switch (scenario) {
            case "pending": case "denied": case "revoked": case "invalidated": case "consumed":
              record.status = scenario; break;
            case "expired": record.expiresAt = "2000-01-01T00:00:00Z"; break;
            case "invalid expiry": record.expiresAt = "bad expiry"; break;
            case "legacy": delete record.invocationFingerprint; break;
            case "toolId only": delete record.invocationFingerprint; record.bindingKey = ""; break;
            case "changed binding": record.bindingKey = "wrong"; break;
            case "changed fingerprint": record.invocationFingerprint = "wrong"; break;
          }
        });
        if (scenario === "changed args") {
          if (operation === "replay") f.replay.steps[0].args!.content = "changed bytes";
          else f.rollback.steps[0].path = "other.txt";
        }
        if (scenario === "changed operation") {
          if (operation === "replay") f.replay.replayId = "replay-two";
          else f.rollback.rollbackId = "rollback-two";
        }
        if (scenario === "missing operation") {
          if (operation === "replay") delete f.replay.replayId;
          else f.rollback.rollbackId = "";
        }
        if (scenario === "changed step") {
          if (operation === "replay") f.replay.steps[0].index++;
          else f.rollback.steps.unshift({ path: "skip.txt", action: "skip", rollbackable: false });
        }
        let executionCwd = f.cwd;
        let log = f.eventLog;
        if (scenario === "changed workspace") {
          executionCwd = join(f.cwd, "other-workspace");
          mkdirSync(executionCwd);
        }
        if (scenario === "changed session") {
          log = new EventLog(join(f.cwd, ".alix/sessions/other-session"));
          await log.init();
        }
        const result = await f.execute(f.store, log, executionCwd);
        assert.equal(result.successCount, expected === "allow" ? 1 : 0);
        assert.equal(existsSync(join(f.cwd, "target.txt")), expected === "allow");
        if (expected === "allow") {
          assert.equal(f.store.get(id)?.status, "consumed");
          assert.equal(f.store.get(id)?.executionOutcome, "succeeded");
        }
      });
    }

    const precedenceCases = [
      ["denied", false, false], ["pending", false, false],
      ["revoked", false, false], ["invalidated", false, false],
      ["consumed", false, false], ["expired", false, false],
      ["approved", false, true],
      ["approved", false, true, "consumed"],
      ["denied", true, false], ["approved", true, false],
      ["denied", "equivalent", false], ["approved", "equivalent", false],
    ] as const;
    for (const [status, tied, allowed, olderStatus = "approved"] of precedenceCases) {
      it(`decision precedence: older ${olderStatus}, newer ${status}, tied=${tied} => ${allowed ? "allow" : "deny"}`, async t => {
        const f = await fixture(t);
        const olderId = await f.approve();
        const newerId = `newer-${olderId}`;
        await f.store.mutate(records => {
          const older = records.find(a => a.id === olderId)!;
          older.status = olderStatus;
          older.createdAt = "2026-01-01T00:00:00.000Z";
          records.push({ ...older, id: newerId, status,
            createdAt: tied === "equivalent" ? "2026-01-01T00:00:00Z"
              : tied ? older.createdAt : "2026-01-01T00:00:01.000Z" });
        });
        const result = await f.execute();
        assert.equal(result.successCount, allowed ? 1 : 0);
        assert.equal(existsSync(join(f.cwd, "target.txt")), allowed);
        assert.equal(f.store.get(olderId)?.status, olderStatus);
        assert.equal(f.store.get(newerId)?.status, allowed ? "consumed" : status);
      });
    }

    it("keeps a distinct invocation independent even when its legacy binding key collides", async t => {
      const f = await fixture(t);
      const id = await f.approve();
      await f.store.mutate(records => {
        const original = records.find(a => a.id === id)!;
        original.createdAt = "2026-01-01T00:00:00.000Z";
        records.push({ ...original, id: `unrelated-${id}`, status: "denied",
          invocationFingerprint: "different-invocation", createdAt: "2026-01-01T00:00:01.000Z" });
      });
      assert.equal((await f.execute()).successCount, 1);
      assert.equal(f.store.get(id)?.executionOutcome, "succeeded");
      assert.equal(f.store.get(`unrelated-${id}`)?.status, "denied");
    });

    it("rejects a newer denial committed after selection but before the atomic claim", async t => {
      const f = await fixture(t);
      const id = await f.approve();
      await f.store.mutate(records => { records.find(a => a.id === id)!.createdAt = "2026-01-01T00:00:00.000Z"; });
      const consume = f.store.consumeApproved.bind(f.store);
      const otherProcess = new ApprovalStore(f.cwd);
      f.store.consumeApproved = async (...args) => {
        await otherProcess.mutate(records => {
          const original = records.find(a => a.id === id)!;
          records.push({ ...original, id: `denied-${id}`, status: "denied", createdAt: "2026-01-01T00:00:01.000Z" });
        });
        return consume(...args);
      };
      assert.equal((await f.execute()).blockedCount, 1);
      assert.equal(existsSync(join(f.cwd, "target.txt")), false);
      assert.equal(f.store.get(id)?.status, "approved");
    });

    if (operation === "replay") {
      it("preserves deletion quarantine across new replay IDs and approvals", { skip: process.platform !== "linux" }, async t => {
        const f = await fixture(t);
        f.replay.steps[0].toolName = "file.delete";
        f.replay.steps[0].args = { path: "target.txt" };
        writeFileSync(join(f.cwd, "target.txt"), "operator data");
        const request = { toolCallId: "uncertain-delete", name: "file.delete" as const, args: { path: "target.txt" } };
        await executeWithEffectJournal(f.cwd, request, async () => ({ kind: "error", message: "lost response", outcomeUnknown: true }));
        for (const replayId of ["first-delete", "renewed-delete"]) {
          f.replay.replayId = replayId;
          const id = await f.approve();
          assert.equal((await f.execute()).successCount, 0);
          assert.equal(f.store.get(id)?.executionOutcome, "pending");
          assert.equal(readFileSync(join(f.cwd, "target.txt"), "utf8"), "operator data");
          assert.equal(readEffectRecord(f.cwd, request)?.state, "started_unknown");
        }
      });

      it("journals a successful deletion before refusing replay of a recreated file", { skip: process.platform !== "linux" }, async t => {
        const f = await fixture(t);
        f.replay.steps[0].toolName = "file.delete";
        f.replay.steps[0].args = { path: "target.txt" };
        writeFileSync(join(f.cwd, "target.txt"), "original");
        const id = await f.approve();
        assert.equal((await f.execute()).successCount, 1);
        assert.equal(f.store.get(id)?.executionOutcome, "succeeded");
        writeFileSync(join(f.cwd, "target.txt"), "recreated");
        f.replay.replayId = "renewed-delete";
        await f.approve();
        assert.equal((await f.execute()).successCount, 0);
        assert.equal(readFileSync(join(f.cwd, "target.txt"), "utf8"), "recreated");
      });
    }

    it("never reuses a successful grant or silently requests a replacement", async t => {
      const f = await fixture(t);
      await f.approve();
      assert.equal((await f.execute()).successCount, 1);
      writeFileSync(join(f.cwd, "target.txt"), "operator change");
      assert.equal((await f.execute()).blockedCount, 1);
      assert.equal(readFileSync(join(f.cwd, "target.txt"), "utf8"), "operator change");
      assert.equal(f.store.list().length, 1);
    });

    it("executes the approved bytes even if caller data changes during consumption", async t => {
      const f = await fixture(t);
      const id = await f.approve();
      const consume = f.store.consumeApproved.bind(f.store);
      f.store.consumeApproved = async (...args) => {
        const result = await consume(...args);
        assert.equal(f.store.get(id)?.status, "consumed");
        assert.equal(existsSync(join(f.cwd, "target.txt")), false);
        f.replay.steps[0].args!.content = "unapproved bytes";
        writeFileSync(f.snapshotPath, "unapproved bytes");
        return result;
      };
      assert.equal((await f.execute()).successCount, 1);
      assert.equal(readFileSync(join(f.cwd, "target.txt"), "utf8"), "approved bytes");
    });

    it("cannot execute when the atomic claim fails", async t => {
      const f = await fixture(t);
      await f.approve();
      f.store.consumeApproved = async () => ({ consumed: false, reason: "claim refused" });
      assert.equal((await f.execute()).blockedCount, 1);
      assert.equal(existsSync(join(f.cwd, "target.txt")), false);
      f.store.consumeApproved = async () => { throw new Error("claim persistence failed"); };
      await assert.rejects(f.execute(), /claim persistence failed/);
      assert.equal(existsSync(join(f.cwd, "target.txt")), false);
    });

    it("keeps a failed effect's grant spent without fabricating a definite replay outcome", async t => {
      const f = await fixture(t);
      if (operation === "replay") f.replay.steps[0].args!.path = "parent/target.txt";
      else f.rollback.steps[0].path = "parent/target.txt";
      const id = await f.approve();
      writeFileSync(join(f.cwd, "parent"), "blocks directory creation");
      assert.equal((await f.execute()).successCount, 0);
      assert.equal(f.store.get(id)?.status, "consumed");
      assert.equal(f.store.get(id)?.executionOutcome, operation === "replay" ? "pending" : "failed");
      assert.equal((await f.execute()).blockedCount, 1);
    });

    it("issues separate approvals for identical steps at different positions", async t => {
      const f = await fixture(t);
      if (operation === "replay") f.replay.steps.push(structuredClone(f.replay.steps[0]));
      else f.rollback.steps.push(structuredClone(f.rollback.steps[0]));
      assert.equal((await f.execute()).blockedCount, 2);
      const requests = f.store.listPending();
      assert.equal(requests.length, 2);
      await f.store.resolve(requests[0].id, "approved");
      const result = await f.execute();
      assert.equal(result.successCount, 1);
      assert.equal(result.blockedCount, 1);
      assert.equal(f.store.get(requests[1].id)?.status, "pending");
    });

    // Two independent Node processes contend on a durable approval ledger.
    it("permits only one effect when fresh processes race the same grant", { timeout: 45_000 }, async t => {
      const f = await fixture(t);
      const id = await f.approve();
      const results = await Promise.all([f.child(), f.child()]);
      assert.equal(results.reduce((n, r) => n + r.success, 0), 1);
      assert.equal(results.reduce((n, r) => n + r.blocked, 0), 1);
      await f.store.load();
      assert.equal(f.store.get(id)?.status, "consumed");
      assert.equal(f.store.get(id)?.executionOutcome, "succeeded");
    });

    // Multiple fresh processes cover crash, restart, and refusal to replay.
    it("fails closed after a process exits between durable claim and effect", { timeout: 45_000 }, async t => {
      const f = await fixture(t);
      const id = await f.approve();
      await assert.rejects(f.child(true), (error: unknown) => (error as { code: number }).code === 73);
      assert.equal(existsSync(join(f.cwd, "target.txt")), false);
      await f.store.load();
      assert.equal(f.store.get(id)?.status, "consumed");
      assert.equal(f.store.get(id)?.executionOutcome, "pending");
      const retry = await f.child();
      assert.equal(retry.success, 0);
      assert.equal(retry.blocked, 1);
      assert.equal(existsSync(join(f.cwd, "target.txt")), false);
      await f.store.load();
      assert.equal(f.store.list().length, 1);
    });

    if (operation === "rollback") {
      it("consumes delete approvals once and preserves a subsequently recreated file", async t => {
        const f = await fixture(t);
        f.rollback.steps[0].action = "delete-created";
        writeFileSync(join(f.cwd, "target.txt"), "created by replay");
        await f.approve();
        assert.equal((await f.execute()).successCount, 1);
        assert.equal(existsSync(join(f.cwd, "target.txt")), false);
        writeFileSync(join(f.cwd, "target.txt"), "operator change");
        assert.equal((await f.execute()).blockedCount, 1);
        assert.equal(readFileSync(join(f.cwd, "target.txt"), "utf8"), "operator change");
      });

      it("rejects changed snapshot content at the approved path", async t => {
        const f = await fixture(t);
        await f.approve();
        writeFileSync(f.snapshotPath, "unapproved bytes");
        assert.equal((await f.execute()).blockedCount, 1);
        assert.equal(existsSync(join(f.cwd, "target.txt")), false);
      });
    }
  });
}
