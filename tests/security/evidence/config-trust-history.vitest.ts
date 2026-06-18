/**
 * P4.4c — Config Trust History tests.
 *
 * Tests that ConfigSigner events produce durable evidence records.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ConfigTrustHistory } from "../../../src/security/evidence/config-trust-history.js";
import { EvidenceStore } from "../../../src/security/evidence/evidence-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConfigSignature {
  schemaVersion: number;
  keyId: string;
  signature: string;
  signedAt: string;
  configVersion: number;
  configHash: string;
  prevConfigHash: string | null;
}

interface TrustIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
}

interface TrustReport {
  trusted: boolean;
  signed: boolean;
  signatureValid: boolean;
  versionOk: boolean;
  keyId?: string;
  issues: TrustIssue[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  const dir = join("/tmp", "trust-history-test-" + randomUUID().slice(0, 8));
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  return dir;
}

function makeSig(overrides?: Partial<ConfigSignature>): ConfigSignature {
  return {
    schemaVersion: 1,
    keyId: "a1b2c3d4e5f6a7b8",
    signature: "ff".repeat(32),
    signedAt: new Date().toISOString(),
    configVersion: 1,
    configHash: "da39a3ee5e6b4b0d3255bfef95601890afd80709",
    prevConfigHash: null,
    ...overrides,
  };
}

function makeReport(overrides?: Partial<TrustReport>): TrustReport {
  return {
    trusted: true,
    signed: true,
    signatureValid: true,
    versionOk: true,
    keyId: "a1b2c3d4e5f6a7b8",
    issues: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConfigTrustHistory", () => {
  let dir: string;
  let history: ConfigTrustHistory;

  beforeEach(() => {
    dir = tmpDir();
    history = new ConfigTrustHistory(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // recordSign
  // -----------------------------------------------------------------------

  describe("recordSign", () => {
    it("records a config_signed evidence record", async () => {
      const sig = makeSig({ configVersion: 1 });
      const ev = await history.recordSign(sig);

      expect(ev).not.toBeNull();
      expect(ev!.type).toBe("config_signed");
      expect(ev!.payload.configVersion).toBe(1);
      expect(ev!.payload.keyId).toBe("a1b2c3d4e5f6a7b8");
      expect(ev!.payload.configHash).toBeTruthy();
      expect(ev!.payload.signatureFingerprint).toBeTruthy();
    });

    it("records the config hash for traceability", async () => {
      const sig = makeSig({ configHash: "abc123def456" });
      const ev = await history.recordSign(sig);

      expect(ev).not.toBeNull();
      expect(ev!.payload.configHash).toBe("abc123def456");
    });

    it("records prevConfigHash when present", async () => {
      const sig = makeSig({ prevConfigHash: "prev_hash_value" });
      const ev = await history.recordSign(sig);

      expect(ev).not.toBeNull();
      expect(ev!.payload.prevConfigHash).toBe("prev_hash_value");
    });

    it("records prevConfigHash as null on first sign", async () => {
      const sig = makeSig({ prevConfigHash: null });
      const ev = await history.recordSign(sig);

      expect(ev).not.toBeNull();
      expect(ev!.payload.prevConfigHash).toBeNull();
    });

    it("recovers from a deleted store directory", async () => {
      // The store recreates the directory on next append — this should work
      const sig = makeSig();
      const result1 = await history.recordSign(sig);
      expect(result1).not.toBeNull();

      // Delete the evidence file and directory entirely
      rmSync(dir, { recursive: true, force: true });

      // Should recover gracefully
      const result2 = await history.recordSign(sig);
      // The store creates the directory and file on next append
      expect(result2).not.toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // recordTrustEvaluation
  // -----------------------------------------------------------------------

  describe("recordTrustEvaluation", () => {
    it("records a trust_evaluation evidence record", async () => {
      const report = makeReport({ trusted: true });
      const ev = await history.recordTrustEvaluation(report, 1);

      expect(ev).not.toBeNull();
      expect(ev!.type).toBe("trust_evaluation");
      expect(ev!.payload.trusted).toBe(true);
      expect(ev!.payload.signed).toBe(true);
      expect(ev!.payload.signatureValid).toBe(true);
      expect(ev!.payload.versionOk).toBe(true);
      expect(ev!.payload.configVersion).toBe(1);
    });

    it("records a failed trust evaluation with error details", async () => {
      const report = makeReport({
        trusted: false,
        signed: true,
        signatureValid: false,
        issues: [
          { severity: "error", code: "CONFIG_INVALID_SIGNATURE", message: "Signature does not match" },
        ],
      });

      const ev = await history.recordTrustEvaluation(report, 5);

      expect(ev).not.toBeNull();
      expect(ev!.payload.trusted).toBe(false);
      expect(ev!.payload.signatureValid).toBe(false);
      // Failed evaluation records the first error code and message
      expect(ev!.payload.firstErrorCode).toBe("CONFIG_INVALID_SIGNATURE");
      expect(ev!.payload.firstErrorMessage).toBe("Signature does not match");
      expect(ev!.payload.issueCount).toBe(1);
    });

    it("records a rollback detection", async () => {
      const report = makeReport({
        trusted: false,
        versionOk: false,
        issues: [
          { severity: "error", code: "CONFIG_ROLLBACK_DETECTED", message: "Config version 2 is older than last accepted version 5" },
        ],
      });

      const ev = await history.recordTrustEvaluation(report, 2);

      expect(ev).not.toBeNull();
      expect(ev!.payload.trusted).toBe(false);
      expect(ev!.payload.versionOk).toBe(false);
      expect(ev!.payload.firstErrorCode).toBe("CONFIG_ROLLBACK_DETECTED");
      expect(ev!.payload.issueCount).toBe(1);
    });

    it("records warnings without errors", async () => {
      const report = makeReport({
        trusted: true,
        signed: false,
        issues: [
          { severity: "warning", code: "CONFIG_NO_SIGNATURE", message: "Config is not signed" },
        ],
      });

      const ev = await history.recordTrustEvaluation(report, 1);

      expect(ev).not.toBeNull();
      expect(ev!.payload.trusted).toBe(true);
      expect(ev!.payload.issueCount).toBe(1);
      // No firstError since there are no errors (only warnings)
      expect(ev!.payload.firstErrorCode).toBeUndefined();
    });

    it("recovers from a deleted store directory for evaluations", async () => {
      const report = makeReport();
      const result1 = await history.recordTrustEvaluation(report, 1);
      expect(result1).not.toBeNull();

      rmSync(dir, { recursive: true, force: true });

      const result2 = await history.recordTrustEvaluation(report, 1);
      expect(result2).not.toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Integration: evidence is queryable
  // -----------------------------------------------------------------------

  describe("evidence query integration", () => {
    it("recorded evidence is visible via the underlying store", async () => {
      const sig = makeSig({ configVersion: 7 });
      const report = makeReport({ trusted: true });

      await history.recordSign(sig);
      await history.recordTrustEvaluation(report, 7);

      // Create a fresh store pointing at the same dir to verify persistence
      const store = new EvidenceStore({ storeDir: dir });

      const signed = await store.query({ type: "config_signed" });
      expect(signed.records.length).toBe(1);
      expect(signed.records[0].payload.configVersion).toBe(7);

      const evalRecords = await store.query({ type: "trust_evaluation" });
      expect(evalRecords.records.length).toBe(1);
      expect(evalRecords.records[0].payload.trusted).toBe(true);

      const all = await store.query();
      expect(all.records.length).toBe(2);
    });

    it("CLI can list the recorded evidence", async () => {
      const sig = makeSig({ configVersion: 3 });
      await history.recordSign(sig);

      // Verify the record exists and has correct type for CLI display
      const store = new EvidenceStore({ storeDir: dir });
      const listResult = await store.query();
      expect(listResult.records.length).toBe(1);
      expect(listResult.records[0].type).toBe("config_signed");
      expect(listResult.records[0].fingerprint).toBeTruthy();
    });

    it("records multiple signing events as a timeline", async () => {
      for (let v = 1; v <= 3; v++) {
        const sig = makeSig({ configVersion: v });
        const r = await history.recordSign(sig);
        expect(r).not.toBeNull();
      }

      // Read raw file to verify 3 records
      const raw = readFileSync(join(dir, "evidence.jsonl"), "utf-8");
      const lines = raw.trim().split("\n").filter((l: string) => l.trim());
      expect(lines.length).toBe(3);
    });
  });
});
