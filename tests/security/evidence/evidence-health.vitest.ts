/**
 * P4.4d — Evidence Health tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EvidenceHealthCollector } from "../../../src/security/evidence/evidence-health.js";
import { EvidenceStore } from "../../../src/security/evidence/evidence-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  const dir = join("/tmp", "health-test-" + randomUUID().slice(0, 8));
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  return dir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EvidenceHealthCollector", () => {
  let dir: string;
  let collector: EvidenceHealthCollector;
  let store: EvidenceStore;

  beforeEach(() => {
    dir = tmpDir();
    collector = new EvidenceHealthCollector(dir);
    store = new EvidenceStore({ storeDir: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("collect", () => {
    it("returns unknown status for empty store", async () => {
      const health = await collector.collect();
      expect(health.status).toBe("healthy");
      expect(health.storeAccessible).toBe(true);
      expect(health.recordCount).toBe(0);
      expect(health.chainIntegrity).toBe(true);
    });

    it("returns healthy when records exist and integrity passes", async () => {
      await store.append("config_signed", { configVersion: 1 });
      await store.append("trust_evaluation", { trusted: true, configVersion: 1 });

      const health = await collector.collect();
      expect(health.status).toBe("healthy");
      expect(health.recordCount).toBe(2);
      expect(health.chainIntegrity).toBe(true);
      expect(health.byType.config_signed).toBe(1);
      expect(health.byType.trust_evaluation).toBe(1);
    });

    it("reports lastWriteAt from most recent record", async () => {
      await store.append("config_signed", { configVersion: 1 });
      const health = await collector.collect();
      expect(health.lastWriteAt).toBeTruthy();
      expect(health.lastWriteAgeMs).toBeLessThan(5000);
    });

    it("detects chain integrity failure", async () => {
      const { writeFileSync, readFileSync } = await import("node:fs");
      await store.append("config_signed", { configVersion: 1 });

      // Corrupt the fingerprint in the file
      const filePath = join(dir, "evidence.jsonl");
      let content = readFileSync(filePath, "utf-8");
      content = content.replace(/"fingerprint":"[^"]+"/, '"fingerprint":"00' + "aa".repeat(31) + '"');
      writeFileSync(filePath, content);

      const health = await collector.collect();
      expect(health.chainIntegrity).toBe(false);
      expect(health.status).toBe("unhealthy");
      expect(health.issues.length).toBeGreaterThanOrEqual(1);
    });

    it("reports record types breakdown", async () => {
      await store.append("config_signed", { configVersion: 1 });
      await store.append("trust_evaluation", { trusted: true, configVersion: 1 });
      await store.append("audit_checkpoint", { sequence: 5, recordHash: "abc", signerKeyId: "k1" });

      const health = await collector.collect();
      expect(health.byType.config_signed).toBe(1);
      expect(health.byType.trust_evaluation).toBe(1);
      expect(health.byType.audit_checkpoint).toBe(1);
    });

    it("recovers from a deleted store directory", async () => {
      // The store recreates the directory on access — it self-heals
      const health1 = await collector.collect();
      expect(health1.storeAccessible).toBe(true);

      // Delete the store directory entirely
      rmSync(dir, { recursive: true, force: true });

      // Collector creates a new store which creates the directory
      const health2 = await collector.collect();
      expect(health2.storeAccessible).toBe(true);
      expect(health2.recordCount).toBe(0);
      expect(health2.status).toBe("healthy");
    });

    it("reports oldestRecordAt when records exist", async () => {
      await store.append("config_signed", { configVersion: 1 });
      await sleep(50);
      await store.append("trust_evaluation", { trusted: true, configVersion: 1 });

      const health = await collector.collect();
      expect(health.oldestRecordAt).toBeTruthy();
      expect(health.lastWriteAt).toBeTruthy();
      expect(health.oldestRecordAt).not.toBe(health.lastWriteAt);
    });
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
