/**
 * Tests X3b — ExecutionEvidenceStore.
 *
 * Covers append, list, lookup, integrity validation, and error resilience.
 * All tests are temp-directory backed, deterministic, and isolated.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ExecutionEvidenceStore,
  computeEvidenceChecksum,
} from "../../src/runtime/execution-evidence-store.js";
import type { ExecutionEvidence } from "../../src/runtime/contracts/execution-intent-contract.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvidence(
  overrides: Partial<ExecutionEvidence> = {},
): ExecutionEvidence {
  const base: ExecutionEvidence = {
    evidenceId: "ev-001",
    intentId: "int-001",
    startedAt: "2026-07-10T10:00:00.000Z",
    completedAt: "2026-07-10T11:00:00.000Z",
    outcome: "SUCCESS",
    summary: "Test execution completed successfully.",
    artifacts: ["plan-1.json"],
    verificationPassed: true,
    evidenceHash: "",
  };

  const evidence = { ...base, ...overrides };

  // Auto-compute checksum if not explicitly provided
  if (!evidence.evidenceHash && !overrides.evidenceHash) {
    evidence.evidenceHash = computeEvidenceChecksum(evidence);
  }

  return evidence;
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("ExecutionEvidenceStore", () => {
  let tempDir: string;
  let store: ExecutionEvidenceStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "exec-evidence-store-"));
    store = new ExecutionEvidenceStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Storage lifecycle
  // -----------------------------------------------------------------------

  it("creates missing directory on first append", async () => {
    const nestedDir = join(tempDir, "deep", "nested");
    const nestedStore = new ExecutionEvidenceStore(nestedDir);

    await nestedStore.append(makeEvidence());

    expect(existsSync(nestedDir)).toBe(true);
  });

  it("creates the JSONL file on append", async () => {
    await store.append(makeEvidence());

    expect(existsSync(join(tempDir, "execution-evidence.jsonl"))).toBe(true);
  });

  it("appends one record and returns it via list", async () => {
    const evidence = makeEvidence();
    await store.append(evidence);

    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0].evidenceId).toBe("ev-001");
  });

  it("multiple appends preserve insertion order", async () => {
    const ev1 = makeEvidence({ evidenceId: "ev-001", intentId: "int-001" });
    const ev2 = makeEvidence({ evidenceId: "ev-002", intentId: "int-001" });
    const ev3 = makeEvidence({ evidenceId: "ev-003", intentId: "int-002" });

    await store.append(ev1);
    await store.append(ev2);
    await store.append(ev3);

    const all = await store.list();
    expect(all).toHaveLength(3);
    expect(all[0].evidenceId).toBe("ev-001");
    expect(all[1].evidenceId).toBe("ev-002");
    expect(all[2].evidenceId).toBe("ev-003");
  });

  // -----------------------------------------------------------------------
  // Retrieval
  // -----------------------------------------------------------------------

  it("retrieves by evidence ID", async () => {
    await store.append(makeEvidence({ evidenceId: "ev-find-me" }));
    await store.append(makeEvidence({ evidenceId: "ev-other" }));

    const found = await store.getByEvidenceId("ev-find-me");
    expect(found).toBeDefined();
    expect(found!.evidenceId).toBe("ev-find-me");
  });

  it("returns undefined when evidence ID not found", async () => {
    await store.append(makeEvidence({ evidenceId: "ev-001" }));

    const found = await store.getByEvidenceId("ev-nonexistent");
    expect(found).toBeUndefined();
  });

  it("retrieves by intent ID", async () => {
    await store.append(makeEvidence({ evidenceId: "ev-a", intentId: "int-target" }));
    await store.append(makeEvidence({ evidenceId: "ev-b", intentId: "int-target" }));
    await store.append(makeEvidence({ evidenceId: "ev-c", intentId: "int-other" }));

    const matches = await store.getByIntentId("int-target");
    expect(matches).toHaveLength(2);
    expect(matches.map((r) => r.evidenceId).sort()).toEqual(["ev-a", "ev-b"]);
  });

  it("returns empty array when intent ID not found", async () => {
    await store.append(makeEvidence({ intentId: "int-001" }));

    const matches = await store.getByIntentId("int-nonexistent");
    expect(matches).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Resilience
  // -----------------------------------------------------------------------

  it("returns empty list when file does not exist", async () => {
    const all = await store.list();
    expect(all).toEqual([]);
  });

  it("skips malformed JSONL lines", async () => {
    // Write a mix of valid and invalid lines directly
    const valid = makeEvidence({ evidenceId: "ev-valid" });
    const filePath = join(tempDir, "execution-evidence.jsonl");
    const lines = [
      JSON.stringify(valid),
      "not-json-at-all",
      JSON.stringify(makeEvidence({ evidenceId: "ev-valid-2" })),
      "{truncated json",
    ].join("\n") + "\n";

    const { writeFileSync } = await import("node:fs");
    writeFileSync(filePath, lines, "utf-8");

    const all = await store.list();
    // The valid records should be loaded; malformed lines skipped
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it("skips records with invalid checksum", async () => {
    // Write a record with a tampered checksum
    const corrupted = makeEvidence({
      evidenceId: "ev-corrupted",
      evidenceHash: "tampered-checksum-that-wont-match",
    });
    const valid = makeEvidence({ evidenceId: "ev-valid" });

    const filePath = join(tempDir, "execution-evidence.jsonl");
    const lines = [
      JSON.stringify(corrupted),
      JSON.stringify(valid),
    ].join("\n") + "\n";

    const { writeFileSync } = await import("node:fs");
    writeFileSync(filePath, lines, "utf-8");

    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0].evidenceId).toBe("ev-valid");
  });

  it("append-only: appending twice does not overwrite", async () => {
    const ev1 = makeEvidence({ evidenceId: "ev-001" });
    const ev2 = makeEvidence({ evidenceId: "ev-001" }); // same ID, different record

    await store.append(ev1);
    await store.append(ev2);

    const all = await store.list();
    expect(all).toHaveLength(2);
    expect(all[0].evidenceId).toBe("ev-001");
    expect(all[1].evidenceId).toBe("ev-001");
  });

  // -----------------------------------------------------------------------
  // Checksum — field coverage (X3b integrity primitive)
  // -----------------------------------------------------------------------

  describe("computeEvidenceChecksum — full field coverage", () => {
    const BASE: ExecutionEvidence = {
      evidenceId: "ev-001",
      intentId: "int-001",
      startedAt: "2026-07-10T10:00:00.000Z",
      completedAt: "2026-07-10T11:00:00.000Z",
      outcome: "SUCCESS",
      summary: "Test execution.",
      artifacts: ["plan-1.json"],
      verificationPassed: true,
      evidenceHash: "",
    };

    it("changing startedAt changes the checksum", () => {
      const a = computeEvidenceChecksum(BASE);
      const b = computeEvidenceChecksum({ ...BASE, startedAt: "2026-07-10T12:00:00.000Z" });
      expect(a).not.toBe(b);
    });

    it("changing artifacts changes the checksum", () => {
      const a = computeEvidenceChecksum(BASE);
      const b = computeEvidenceChecksum({ ...BASE, artifacts: ["plan-2.json"] });
      expect(a).not.toBe(b);
    });

    it("changing verificationPassed changes the checksum", () => {
      const a = computeEvidenceChecksum(BASE);
      const b = computeEvidenceChecksum({ ...BASE, verificationPassed: false });
      expect(a).not.toBe(b);
    });

    it("equivalent objects with reordered keys produce the same checksum", () => {
      const normal: ExecutionEvidence = { ...BASE };
      const reordered: ExecutionEvidence = {
        verificationPassed: BASE.verificationPassed,
        artifacts: BASE.artifacts,
        summary: BASE.summary,
        outcome: BASE.outcome,
        completedAt: BASE.completedAt,
        startedAt: BASE.startedAt,
        intentId: BASE.intentId,
        evidenceId: BASE.evidenceId,
        evidenceHash: "",
      };

      expect(computeEvidenceChecksum(normal)).toBe(computeEvidenceChecksum(reordered));
    });
  });
});
