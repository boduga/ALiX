/**
 * governance-discover.test.ts — #709 end-to-end wiring test.
 *
 * Exercises the production entry point (runDiscoverCli, as composed by
 * `alix governance evolution discover`) against real file-backed stores
 * seeded through their own append APIs: detection runs, candidates are
 * generated, and the intake adapter registers PROPOSED evolutions.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ExecutionEvidenceStore, computeEvidenceChecksum } from "../../../src/runtime/execution-evidence-store.js";
import { FileAuditStore } from "../../../src/governance/audit-store.js";
import { EvolutionStateMachine } from "../../../src/evolution/evolution-state-machine.js";
import { EvolutionState } from "../../../src/evolution/contracts/evolution-contract.js";
import { runDiscoverCli } from "../../../src/evolution/pattern-discovery/discovery-cli.js";
import type { ExecutionEvidence } from "../../../src/runtime/contracts/execution-intent-contract.js";

function evidence(id: string, outcome: "FAILED" | "SUCCESS", dayOffset: number): ExecutionEvidence {
  const day = (offset: number): string => {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    return d.toISOString();
  };
  const record = {
    evidenceId: id,
    intentId: "agent/workflow/run-01",
    startedAt: day(dayOffset),
    completedAt: day(dayOffset),
    outcome,
    summary: outcome === "FAILED" ? "Execution failed" : "Execution succeeded",
    artifacts: [] as string[],
    verificationPassed: outcome === "SUCCESS",
  };
  // evidenceHash covers all other fields; the checksum helper strips it.
  return { ...record, evidenceHash: computeEvidenceChecksum({ ...record, evidenceHash: "" }) };
}

describe("governance evolution discover", () => {
  it("detects failure patterns and intakes candidates end to end", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "discover-e2e-"));
    try {
      const evidenceStore = new ExecutionEvidenceStore(cwd);
      const auditStore = new FileAuditStore(cwd);
      const stateMachine = new EvolutionStateMachine();

      // Seed: 3 failed executions on one intent (execution-failure pattern)
      // plus a denied governance action (approval-friction signal).
      await evidenceStore.append(evidence("ev-fail-1", "FAILED", 2));
      await evidenceStore.append(evidence("ev-fail-2", "FAILED", 1));
      await evidenceStore.append(evidence("ev-fail-3", "FAILED", 0));
      await auditStore.append({
        eventId: "audit-1",
        timestamp: new Date().toISOString(),
        eventType: "action_denied",
        actorType: "agent",
        actorId: "alix-agent",
        subjectType: "action",
        subjectId: "action-1",
        action: "execute_workflow",
        decision: "denied",
        policyId: null,
        policyVersion: null,
        ruleId: null,
        reason: "Policy violation",
        evidenceRefs: [],
        requestId: null,
        traceId: "trace-1",
        sessionId: null,
        parentEventId: null,
        riskLevel: "medium",
        requiresHumanReview: false,
        metadata: {},
      });

      const result = await runDiscoverCli({ evidenceStore, auditStore, stateMachine, json: true });
      assert.equal(result.exitCode, 0);

      const parsed = JSON.parse(result.output) as {
        patterns: Array<{ category: string }>;
        candidates: unknown[];
        intake: { registered: string[]; failed: unknown[] };
        metadata: { evidenceScanned: number; governanceEventsScanned: number };
      };
      assert.equal(parsed.metadata.evidenceScanned, 3);
      assert.equal(parsed.metadata.governanceEventsScanned, 1);
      assert.ok(parsed.patterns.length >= 1, "expected at least one detected pattern");
      assert.ok(
        parsed.patterns.some((p) => p.category === "execution_failure"),
        "expected an execution_failure pattern",
      );
      assert.ok(parsed.candidates.length >= 1, "expected candidates from patterns");
      assert.ok(parsed.intake.registered.length >= 1, "expected at least one registered evolution");
      assert.equal(parsed.intake.failed.length, 0);

      // Registered evolutions land in PROPOSED state (proposal-only intake).
      for (const id of parsed.intake.registered) {
        assert.equal(stateMachine.getStatus(id), EvolutionState.PROPOSED);
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("reports zero findings on empty stores without failing", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "discover-empty-"));
    try {
      const result = await runDiscoverCli({
        evidenceStore: new ExecutionEvidenceStore(cwd),
        auditStore: new FileAuditStore(cwd),
        stateMachine: new EvolutionStateMachine(),
        json: false,
      });
      assert.equal(result.exitCode, 0);
      assert.match(result.output, /0 pattern\(s\)/);
      assert.match(result.output, /0 registered/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
