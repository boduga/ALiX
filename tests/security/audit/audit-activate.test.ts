/**
 * audit-activate.test.ts — #683: legacy chain activation and honest verify.
 *
 * Covers: activating a legacy log seals it (verify ok), mutating a sealed
 * legacy record or a chained v2 record fails verification, activation is
 * idempotent, and the checkpoint helper can bootstrap a missing head.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AuditChainWriter } from "../../../src/security/audit/audit-chain-writer.js";
import { verifyAuditLog } from "../../../src/security/audit/audit-verifier.js";
import { activateAuditChain } from "../../../src/cli/commands/security.js";

function seedLegacy(auditDir: string, count = 2): void {
  mkdirSync(auditDir, { recursive: true });
  const records = Array.from({ length: count }, (_, i) => ({
    id: `l${i + 1}`,
    action: "policy.allowed",
    timestamp: `2025-01-0${i + 1}T00:00:00Z`,
    details: {},
  }));
  writeFileSync(join(auditDir, "audit.jsonl"), records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8");
}

describe("AuditChainActivation", () => {
  let auditDir: string;

  beforeEach(() => {
    auditDir = mkdtempSync(join(tmpdir(), "audit-activate-test-"));
  });

  afterEach(() => {
    rmSync(auditDir, { recursive: true, force: true });
  });

  it("activation seals legacy history and verify passes afterwards", async () => {
    seedLegacy(auditDir, 2);

    // Before: honest failure, no chain.
    const before = await verifyAuditLog({ auditDir });
    assert.ok(!before.ok);
    assert.ok(before.findings.some((f) => f.type === "no_chain"));

    // Activate.
    assert.equal(await activateAuditChain(auditDir), true);
    assert.ok(existsSync(join(auditDir, "head.json")));

    // After: sealed legacy (2) + activation record (1 v2), verify ok.
    const after = await verifyAuditLog({ auditDir });
    assert.ok(after.ok, `Expected ok but got: ${JSON.stringify(after.findings)}`);
    assert.equal(after.recordCount.legacy, 2);
    assert.equal(after.recordCount.v2, 1);
  });

  it("mutating a sealed legacy record fails verification", async () => {
    seedLegacy(auditDir, 1);
    assert.equal(await activateAuditChain(auditDir), true);

    const auditPath = join(auditDir, "audit.jsonl");
    writeFileSync(auditPath, readFileSync(auditPath, "utf-8").replace("policy.allowed", "policy.denied"), "utf-8");

    const result = await verifyAuditLog({ auditDir });
    assert.ok(!result.ok);
    assert.ok(result.findings.some((f) => f.type === "legacy_modified"));
  });

  it("mutating a chained v2 record fails verification", async () => {
    seedLegacy(auditDir, 1);
    assert.equal(await activateAuditChain(auditDir), true);

    const writer = new AuditChainWriter({ auditDir });
    await writer.append({ action: "auth.success" as any, timestamp: Date.now(), actor: "test", details: {} });

    const auditPath = join(auditDir, "audit.jsonl");
    writeFileSync(auditPath, readFileSync(auditPath, "utf-8").replace("auth.success", "auth.failure"), "utf-8");

    const result = await verifyAuditLog({ auditDir });
    assert.ok(!result.ok);
    assert.ok(result.findings.some((f) => f.type === "hash_mismatch"));
  });

  it("activation is idempotent and keeps verify green", async () => {
    seedLegacy(auditDir, 1);
    assert.equal(await activateAuditChain(auditDir), true);
    assert.equal(await activateAuditChain(auditDir), true);

    const result = await verifyAuditLog({ auditDir });
    assert.ok(result.ok, `Expected ok but got: ${JSON.stringify(result.findings)}`);
  });

  it("activation on an empty audit dir still produces a usable head", async () => {
    mkdirSync(auditDir, { recursive: true });
    assert.equal(await activateAuditChain(auditDir), true);
    assert.ok(existsSync(join(auditDir, "head.json")));

    const result = await verifyAuditLog({ auditDir });
    assert.ok(result.ok, `Expected ok but got: ${JSON.stringify(result.findings)}`);
  });
});
