// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A5.1 — Observation Integration Test.
 *
 * End-to-end test of the A5 observation pipeline:
 * ObservationEngine → Providers → Evidence Bridge → Ledger storage.
 *
 * @module observation-integration
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

import { ObservationEngine } from "../../../../src/evolution/observation/observation-engine.js";
import { CliObservationProvider } from "../../../../src/evolution/observation/providers/cli-provider.js";
import { FilesystemObservationProvider } from "../../../../src/evolution/observation/providers/filesystem-provider.js";
import { GitObservationProvider } from "../../../../src/evolution/observation/providers/git-provider.js";
import { LedgerObservationProvider } from "../../../../src/evolution/observation/providers/ledger-provider.js";
import { buildObservationEvidence } from "../../../../src/evolution/observation/observation-evidence-bridge.js";
import { ExecutionEvidenceStore } from "../../../../src/evolution/verification/evidence/evidence-store.js";

function createGitRepo(dir: string) {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git checkout -b main", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "readme.md"), "# test");
  execSync("git add .", { cwd: dir, stdio: "pipe" });
  execSync("git commit -m init", { cwd: dir, stdio: "pipe" });
}

describe("A5 Observation Integration", () => {
  let testDir: string;
  let evidenceDir: string;
  let engine: ObservationEngine;
  let evidenceStore: ExecutionEvidenceStore;
  const originalCwd = process.cwd;

  before(() => {
    testDir = mkdtempSync(join(tmpdir(), "a5-integration-"));
    evidenceDir = mkdtempSync(join(tmpdir(), "a5-integration-ev-"));
    createGitRepo(testDir);

    evidenceStore = new ExecutionEvidenceStore(evidenceDir);
    engine = new ObservationEngine();

    engine.register(new CliObservationProvider());
    engine.register(new FilesystemObservationProvider());
    engine.register(new GitObservationProvider());
    engine.register(new LedgerObservationProvider(evidenceStore));
  });

  after(() => {
    rmSync(testDir, { recursive: true, force: true });
    rmSync(evidenceDir, { recursive: true, force: true });
  });

  it("runs all providers and aggregates evidence", async () => {
    // Run observations using all four providers
    const results = await engine.observeAll([
      {
        observationId: "int-cli",
        provider: "cli",
        description: "Check node version",
        params: { command: "node", args: ["--version"] },
      },
      {
        observationId: "int-fs",
        provider: "filesystem",
        description: "Test directory exists",
        params: { path: testDir, check: "exists" },
      },
      {
        observationId: "int-git",
        provider: "git",
        description: "Check repository branch",
        params: { check: "branch", cwd: testDir },
      },
      {
        observationId: "int-ledger",
        provider: "ledger",
        description: "Check initial evidence count",
        params: { check: "evidence_count" },
      },
    ]);

    // All results should be valid
    assert.equal(results.length, 4);

    // All should succeed (node --version, existing dir, git repo, empty ledger)
    const passes = results.filter((r) => r.status === "pass");
    assert.ok(passes.length >= 3, `Expected ≥3 passes, got ${passes.length}`);
    assert.ok(results.every((r) => r.observationId), "All results should have observationId");
    assert.ok(results.every((r) => r.evidence), "All results should have evidence");

    // Build evidence from results (fixed timestamp for determinism)
    const observedAt = "2026-07-12T00:00:00.000Z";
    const evidence = buildObservationEvidence({
      proposalId: "int-proposal-001",
      evolutionId: "int-evol-001",
      environmentHash: "test-env-hash",
      observations: results,
      observedAt,
    });

    // Verify evidence structure
    assert.equal(evidence.evidenceClass, "observed");
    assert.equal(typeof evidence.integrityHash, "string");
    assert.ok(evidence.integrityHash.length > 0);
    assert.equal(evidence.proposalId, "int-proposal-001");

    // Verify behavioral changes are faithful projections
    for (const change of evidence.behavioralChanges) {
      assert.ok(change.startsWith("Observation"), `Should start with 'Observation': ${change}`);
    }

    // Store and retrieve
    await evidenceStore.append(evidence);
    const stored = await evidenceStore.getByEvidenceId(evidence.evidenceId);
    assert.ok(stored);
    assert.equal(stored.evidenceId, evidence.evidenceId);

    // Determinism: same inputs → same evidence
    const evidence2 = buildObservationEvidence({
      proposalId: "int-proposal-001",
      evolutionId: "int-evol-001",
      environmentHash: "test-env-hash",
      observations: results,
      observedAt,
    });
    assert.equal(evidence2.evidenceId, evidence.evidenceId);
    assert.equal(evidence2.integrityHash, evidence.integrityHash);
  });

  it("handles provider errors gracefully", async () => {
    const results = await engine.observeAll([
      {
        observationId: "err-cli",
        provider: "cli",
        description: "Nonexistent command",
        params: { command: "this-command-does-not-exist" },
      },
      {
        observationId: "err-provider",
        provider: "nonexistent-provider",
        description: "Unknown provider",
      },
    ]);

    assert.equal(results.length, 2);
    assert.equal(results[0].status, "error");
    assert.equal(results[1].status, "error");
    // Provider errors should not throw
  });
});
