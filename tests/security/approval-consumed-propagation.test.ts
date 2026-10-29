/**
 * approval-consumed-propagation.test.ts — pins the consumption hand-off.
 *
 * The coordination exact-binding branch consumes the approval INSIDE the gate
 * and reports `approvalConsumed: true`. The executor must trust that flag and
 * NOT claim again, or a legitimate worker is denied by a double-consume. This
 * suite pins the flag's whole journey:
 *
 *   PolicyGateDecision.approvalConsumed
 *     → ExecutionDecision.allowed.approvalConsumed
 *       → the executor's claim guard.
 *
 * RECONSTRUCTED 2026-10-19 after the /tmp wipe destroyed the original file and
 * its fix commit.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_CONFIG } from "../../src/operations/config/defaults.js";
import { EventLog } from "../../src/runtime-state/events/event-log.js";
import { ApprovalStore } from "../../src/governance/approvals/approval-store.js";
import { PolicyGate } from "../../src/governance/policy/policy-gate.js";
import { ExecutionAuthorization } from "../../src/runtime-state/runtime/execution-authorization.js";
import { decisionAllowed } from "../../src/runtime-state/runtime/execution-decision.js";
import { hashArgs } from "../../src/capabilities/tools/hash-args.js";
import { computeBindingKey } from "../../src/governance/approvals/approval-binding.js";
import { computePolicyRevision } from "../../src/governance/policy/policy-revision.js";
import { createToolExecutor } from "../../src/capabilities/tools/tool-executor-factory.js";

describe("approval consumption propagation", () => {
  it("decisionAllowed preserves the consumed flag", () => {
    const d = decisionAllowed({ approvalId: "a1", approvalConsumed: true });
    assert.equal(d.status, "allowed");
    assert.equal((d as { approvalConsumed?: boolean }).approvalConsumed, true);
    assert.equal((decisionAllowed({ approvalId: "a1" }) as { approvalConsumed?: boolean }).approvalConsumed, undefined);
  });

  it("ExecutionAuthorization forwards approvalConsumed to the allowed decision", async () => {
    const stubGate = {
      evaluateToolCall: async () => ({
        requestId: "r1", capability: "shell.run", decision: "allow",
        reason: "Approved by prior exact binding", approvalId: "a1",
        matchedRuleId: "exact-binding-approved", approvalConsumed: true,
      }),
    };
    const auth = new ExecutionAuthorization({ policyGate: stubGate as never });
    const decision = await auth.evaluate({
      requestId: "r1", capability: "shell.run", toolName: "shell.run",
      args: { command: "true" }, cwd: process.cwd(), sessionMode: "ask",
      sessionId: "s1", agentId: "alix", source: "tool",
    });
    assert.equal(decision.status, "allowed");
    assert.equal((decision as { approvalConsumed?: boolean }).approvalConsumed, true);
  });

  it("an ordinary allowed decision leaves approvalConsumed undefined", async () => {
    const stubGate = {
      evaluateToolCall: async () => ({
        requestId: "r2", capability: "shell.run", decision: "allow",
        reason: "Allowed by tool policy", approvalId: "a2", matchedRuleId: "tool-policy-shell.run",
      }),
    };
    const auth = new ExecutionAuthorization({ policyGate: stubGate as never });
    const decision = await auth.evaluate({
      requestId: "r2", capability: "shell.run", toolName: "shell.run",
      args: { command: "true" }, cwd: process.cwd(), sessionMode: "ask",
      sessionId: "s1", agentId: "alix", source: "tool",
    });
    assert.equal(decision.status, "allowed");
    assert.equal((decision as { approvalConsumed?: boolean }).approvalConsumed, undefined);
  });

  it("executor records a terminal receipt for an approval preconsumed by the exact-binding gate", async () => {
    const root = mkdtempSync(join(tmpdir(), "alix-consumed-receipt-"));
    try {
      mkdirSync(join(root, ".alix", "approvals"), { recursive: true });
      const log = new EventLog(join(root, ".alix", "sessions", "s1"));
      await log.init();
      const store = new ApprovalStore(root, { eventLog: log });
      await store.load();

      const config = structuredClone(DEFAULT_CONFIG);
      config.permissions.sessionMode = "ask";
      const policyRevision = computePolicyRevision(config);
      const command = "printf receipt > receipt.txt";
      const args = { command };
      const bindingKey = computeBindingKey({
        coordinationRunId: "run-1", workerId: "w1", workerAttempt: 0,
        capabilities: ["shell.run"], ownershipClaims: undefined,
        requestFingerprint: "fp-receipt", policyRevision,
      });
      const rec = await store.requestBound({
        reason: "coord receipt fixture", bindingKey, requestFingerprint: "fp-receipt", policyRevision,
        capabilities: ["shell.run"], coordinationRunId: "run-1", workerId: "w1",
        workerAttempt: 0, sessionId: "s1", agentId: "w1",
        invocation: {
          capability: "shell.run", toolName: "shell.run", workspace: root,
          argsHash: hashArgs(args), sessionId: "s1", agentId: "w1",
        },
      });
      await store.resolve(rec.id, "approved", "coord receipt fixture");

      const executor = createToolExecutor({
        config, log, root, approvalStore: store,
        coordinationContext: {
          coordinationRunId: "run-1", workerId: "w1", workerAttempt: 0,
          requestFingerprint: "fp-receipt",
        },
      });
      const result = await executor.execute({
        toolCallId: "tc-receipt", name: "shell.run", args,
        sessionId: "s1", agentId: "w1", coordinationRunId: "run-1",
        executionId: "exec-receipt", invocationId: "inv-receipt",
      });

      assert.equal(result.kind, "success");
      assert.equal(existsSync(join(root, "receipt.txt")), true);
      const persisted = new ApprovalStore(root);
      await persisted.load();
      assert.equal(persisted.get(rec.id)?.status, "consumed");
      assert.equal(persisted.get(rec.id)?.executionOutcome, "succeeded");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the coordination exact-binding branch consumes once and reports it", async () => {
    const root = mkdtempSync(join(tmpdir(), "alix-consumed-prop-"));
    try {
      mkdirSync(join(root, ".alix", "approvals"), { recursive: true });
      const log = new EventLog(join(root, ".alix", "sessions", "s1"));
      await log.init();
      const store = new ApprovalStore(root, { eventLog: log });
      await store.load();

      const config = structuredClone(DEFAULT_CONFIG);
      config.permissions.sessionMode = "ask";
      const policyRevision = computePolicyRevision(config);
      const gate = new PolicyGate(config, { eventLog: log, approvalStore: store });

      const bindingKey = computeBindingKey({
        coordinationRunId: "run-1",
        workerId: "w1",
        workerAttempt: 0,
        capabilities: ["shell.run"],
        // Undefined (not []) to match the gate's canonical binding.
        ownershipClaims: undefined,
        requestFingerprint: "fp",
        policyRevision,
      });
      const rec = await store.requestBound({
        reason: "coord fixture", bindingKey, requestFingerprint: "fp", policyRevision,
        capabilities: ["shell.run"], coordinationRunId: "run-1", workerId: "w1",
        workerAttempt: 0, sessionId: "s1", agentId: "w1",
        invocation: {
          capability: "shell.run", toolName: "shell.run", workspace: root,
          argsHash: hashArgs({ command: "true" }), sessionId: "s1", agentId: "w1",
        },
      });
      await store.resolve(rec.id, "approved", "coord fixture");

      const decision = await gate.evaluateToolCall({
        requestId: "tc-1", toolName: "shell.run", capability: "shell.run",
        args: { command: "true" }, cwd: root, sessionMode: "ask", sessionId: "s1",
        agentId: "w1", source: "tool",
        coordinationRunId: "run-1", workerId: "w1", workerAttempt: 0, requestFingerprint: "fp",
      });
      assert.equal(decision.decision, "allow");
      assert.equal(decision.approvalConsumed, true, "gate must report it consumed");
      assert.equal(store.get(rec.id)?.status, "consumed");
      const persistedStore = new ApprovalStore(root);
      await persistedStore.load();
      const consumed = persistedStore.get(rec.id);
      assert.ok(consumed);
      assert.equal(consumed.status, "consumed");
      assert.equal(consumed.bindingKey, bindingKey);
      assert.equal(consumed.consumedByWorkerId, "w1");
      assert.equal(consumed.consumedAttempt, 0);
      assert.equal(consumed.executionOutcome, "pending");
      assert.deepEqual(consumed.invocation, rec.invocation);
      assert.equal(consumed.invocationFingerprint, rec.invocationFingerprint);
      const consumedAt = consumed.consumedAt;
      assert.ok(consumedAt);

      // A second identical evaluation is single-use: the record is spent.
      const replay = await gate.evaluateToolCall({
        requestId: "tc-1", toolName: "shell.run", capability: "shell.run",
        args: { command: "true" }, cwd: root, sessionMode: "ask", sessionId: "s1",
        agentId: "w1", source: "tool",
        coordinationRunId: "run-1", workerId: "w1", workerAttempt: 0, requestFingerprint: "fp",
      });
      // `notEqual("allow")` was too weak: returning "ask" and minting a
      // REPLACEMENT approval also satisfies it, while giving away the very
      // authority single use exists to remove (Gate E review, vacuous #9, and
      // defect D4). The states that are actually acceptable are deny, or an
      // explicit unverified classification — never a fresh request.
      // One assertion, not two: `notEqual("allow")` is implied by requiring
      // deny, and keeping both suggested they tested different things.
      assert.ok(
        replay.decision === "deny",
        `a consumed binding must be denied, not re-asked (got ${replay.decision})`,
      );
      // The review's other two requirements: no replacement request, and the
      // original record stays unverified rather than being reissued.
      assert.equal(replay.approvalId, undefined, "no replacement approval may be minted");
      assert.equal(replay.matchedRuleId, "consumed-binding-denied");
      await persistedStore.load();
      const afterReplay = persistedStore.get(rec.id);
      assert.ok(afterReplay);
      assert.equal(afterReplay.status, "consumed", "replay must not reissue authority");
      assert.equal(afterReplay.consumedAt, consumedAt, "the original single-use claim remains");
      assert.equal(afterReplay.consumedByWorkerId, "w1");
      assert.equal(afterReplay.consumedAttempt, 0);
      assert.deepEqual(afterReplay.invocation, consumed.invocation);
      assert.equal(afterReplay.invocationFingerprint, consumed.invocationFingerprint);
      assert.equal(persistedStore.list().length, 1, "replay must not mint a replacement approval");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
