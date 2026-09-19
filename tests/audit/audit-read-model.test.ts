/**
 * #713 G2.1 — unified cross-domain audit read model.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readUnifiedAudit, readGovernanceAudit } from "../../src/audit/audit-read-model.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "audit-read-model-"));
}

function writeRuntimeAudit(dir: string, records: unknown[]): void {
  mkdirSync(join(dir, ".alix", "audit"), { recursive: true });
  writeFileSync(
    join(dir, ".alix", "audit", "audit.jsonl"),
    records.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
}

function governanceEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventId: "g1",
    timestamp: "2026-06-09T13:00:00Z",
    eventType: "policy.evaluated",
    actorType: "system",
    actorId: "governance",
    subjectType: "policy",
    subjectId: null,
    action: "evaluate",
    decision: "allowed",
    policyId: null,
    policyVersion: null,
    ruleId: null,
    reason: "ok",
    evidenceRefs: [],
    requestId: null,
    traceId: null,
    sessionId: null,
    parentEventId: null,
    riskLevel: "low",
    requiresHumanReview: false,
    metadata: {},
    previousHash: null,
    eventHash: "hash",
    ...overrides,
  };
}

function writeGovernanceAudit(dir: string, events: unknown[]): void {
  mkdirSync(join(dir, ".alix", "governance"), { recursive: true });
  writeFileSync(
    join(dir, ".alix", "governance", "governance-audit-events.jsonl"),
    events.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
}

describe("readUnifiedAudit", () => {
  it("merges runtime and governance rows newest-first", async () => {
    const dir = tempDir();
    try {
      writeRuntimeAudit(dir, [
        { id: "r1", action: "policy.allowed", timestamp: "2026-06-09T12:00:00Z", details: {} },
      ]);
      writeGovernanceAudit(dir, [governanceEvent()]);

      const rows = await readUnifiedAudit(dir, { limit: 10 });
      assert.equal(rows.length, 2);
      assert.equal(rows[0].domain, "governance");
      assert.equal(rows[0].action, "policy.evaluated");
      assert.equal(rows[1].domain, "runtime");
      assert.equal(rows[1].action, "policy.allowed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("normalizes legacy underscored governance event types", async () => {
    const dir = tempDir();
    try {
      writeGovernanceAudit(dir, [governanceEvent({ eventType: "policy_evaluated" })]);
      const rows = await readGovernanceAudit(dir);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].action, "policy.evaluated");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("respects the limit", async () => {
    const dir = tempDir();
    try {
      writeRuntimeAudit(dir, [
        { id: "r1", action: "a", timestamp: "2026-01-01T00:00:00Z", details: {} },
        { id: "r2", action: "b", timestamp: "2026-01-02T00:00:00Z", details: {} },
        { id: "r3", action: "c", timestamp: "2026-01-03T00:00:00Z", details: {} },
      ]);
      const rows = await readUnifiedAudit(dir, { limit: 2 });
      assert.equal(rows.length, 2);
      assert.equal(rows[0].id, "r3");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("excludes the user-scoped auth audit unless includeAuth is set", async () => {
    const dir = tempDir();
    try {
      writeRuntimeAudit(dir, [
        { id: "r1", action: "a", timestamp: "2026-01-01T00:00:00Z", details: {} },
      ]);
      const rows = await readUnifiedAudit(dir, { limit: 10 });
      assert.ok(rows.every((r) => r.domain !== "auth"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
