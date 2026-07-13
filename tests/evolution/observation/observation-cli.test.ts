// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runObserve } from "../../../src/evolution/observation/observation-cli.js";
import { ObservationEngine } from "../../../src/evolution/observation/observation-engine.js";
import { CliObservationProvider } from "../../../src/evolution/observation/providers/cli-provider.js";
import { FilesystemObservationProvider } from "../../../src/evolution/observation/providers/filesystem-provider.js";
import { ExecutionEvidenceStore } from "../../../src/evolution/verification/evidence/evidence-store.js";

describe("runObserve", () => {
  let engine: ObservationEngine;
  let evidenceDir: string;
  let evidenceStore: ExecutionEvidenceStore;

  before(() => {
    evidenceDir = mkdtempSync(join(tmpdir(), "a5-cli-test-"));
    evidenceStore = new ExecutionEvidenceStore(evidenceDir);

    engine = new ObservationEngine();
    engine.register(new CliObservationProvider());
    engine.register(new FilesystemObservationProvider());
  });

  after(() => {
    rmSync(evidenceDir, { recursive: true, force: true });
  });

  it("observes and produces evidence", async () => {
    const result = await runObserve("evol-test-001", {
      engine,
      evidenceStore,
    });

    assert.equal(typeof result.evidenceId, "string");
    assert.equal(result.evidenceClass, "observed");
    assert.equal(result.proposalId, "evol-test-001");
  });

  it("stores evidence in ledger", async () => {
    const result = await runObserve("evol-test-002", {
      engine,
      evidenceStore,
    });

    const stored = await evidenceStore.getByEvidenceId(result.evidenceId);
    assert.ok(stored);
    assert.equal(stored.evidenceId, result.evidenceId);
  });
});
