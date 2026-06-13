/**
 * memory-growth.test.ts — Measure RSS before/after sustained operations.
 *
 * Tier 1 (fast, runs on every commit). Uses deterministic fixtures so
 * results are reproducible across developers. Reports deltas.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function rssMb(): number {
  return Math.round(process.memoryUsage().rss / 1024 / 1024 * 10) / 10;
}

describe("Memory Growth — RuntimeIndex", () => {
  it("measures RSS delta for fixture with 1000 audit + 100 session events", { timeout: 30000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "mem-rix-"));
    mkdirSync(join(dir, ".alix", "audit"), { recursive: true });
    mkdirSync(join(dir, ".alix", "approvals"), { recursive: true });
    mkdirSync(join(dir, ".alix", "graphs"), { recursive: true });
    mkdirSync(join(dir, ".alix", "sessions", "s1"), { recursive: true });

    const auditLines = Array.from({ length: 1000 }, (_, i) =>
      JSON.stringify({ id: `audit_${i}`, timestamp: new Date().toISOString(), source: "session", action: "tool.started", payload: { tool: "file.read" } })
    ).join("\n") + "\n";
    writeFileSync(join(dir, ".alix", "audit", "audit.jsonl"), auditLines, "utf-8");

    const sessionLines = Array.from({ length: 100 }, (_, i) =>
      JSON.stringify({ sessionId: "s1", timestamp: new Date().toISOString(), type: "tool.started", payload: { toolCallId: `tc_${i}` } })
    ).join("\n") + "\n";
    writeFileSync(join(dir, ".alix", "sessions", "s1", "events.jsonl"), sessionLines, "utf-8");

    const before = rssMb();
    const { buildRuntimeIndex } = await import("../../src/runtime/runtime-index.js");
    await buildRuntimeIndex(dir);
    const after = rssMb();
    console.log(`  RuntimeIndex: RSS ${before} MB → ${after} MB (delta: ${(after - before).toFixed(1)} MB)`);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("Memory Growth — ContinuationStore", () => {
  it("measures RSS delta for 1000 persists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mem-cont-"));
    mkdirSync(join(dir, ".alix", "approvals"), { recursive: true });
    const before = rssMb();
    const { ContinuationStore } = await import("../../src/runtime/continuation-store.js");
    const store = new ContinuationStore(dir);
    await store.load();
    for (let i = 0; i < 1000; i++) {
      await store.persist({ approvalId: `apr_${i}`, kind: "tool", sessionId: "s1", cwd: dir, toolCall: { toolCallId: `tc_${i}`, name: "file.read", capability: "file.read", args: { path: "test.txt" }, argsHash: `hash_${i}` }, createdAt: new Date().toISOString() });
    }
    const after = rssMb();
    console.log(`  ContinuationStore (1000 persists): RSS ${before} MB → ${after} MB`);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("Memory Growth — ApprovalStore", () => {
  it("measures RSS delta for 500 approvals", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mem-approve-"));
    mkdirSync(join(dir, ".alix", "approvals"), { recursive: true });
    const before = rssMb();
    const { ApprovalStore } = await import("../../src/approvals/approval-store.js");
    const store = new ApprovalStore(dir);
    await store.load();
    for (let i = 0; i < 500; i++) {
      await store.request({ reason: `mem ${i}`, capability: "cap.test", sessionId: "s1", toolId: `tool.${i}` });
    }
    const after = rssMb();
    console.log(`  ApprovalStore (500 pending): RSS ${before} MB → ${after} MB`);
    rmSync(dir, { recursive: true, force: true });
  });
});
