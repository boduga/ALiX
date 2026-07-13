// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LedgerObservationProvider } from "../../../../src/evolution/observation/providers/ledger-provider.js";
import { ExecutionEvidenceStore } from "../../../../src/evolution/verification/evidence/evidence-store.js";

describe("LedgerObservationProvider", () => {
  let evidenceDir: string;
  let store: ExecutionEvidenceStore;
  let provider: LedgerObservationProvider;

  before(() => {
    evidenceDir = mkdtempSync(join(tmpdir(), "a5-ledger-test-"));
    store = new ExecutionEvidenceStore(evidenceDir);
    provider = new LedgerObservationProvider(store);
  });

  after(() => {
    rmSync(evidenceDir, { recursive: true, force: true });
  });

  it("has name 'ledger'", () => {
    assert.equal(provider.name, "ledger");
  });

  it("observes evidence record count", async () => {
    const result = await provider.observe({
      observationId: "obs-1",
      provider: "ledger",
      description: "Evidence count",
      params: { check: "evidence_count" },
    });
    assert.equal(result.status, "pass");
    assert.equal(typeof result.observed, "number");
  });

  it("checks for evidence by proposal", async () => {
    const result = await provider.observe({
      observationId: "obs-2",
      provider: "ledger",
      description: "Has evidence",
      params: { check: "has_evidence", proposalId: "nonexistent" },
    });
    assert.equal(result.status, "pass");
    assert.equal(result.observed, false);
  });

  it("returns error for invalid check type", async () => {
    const result = await provider.observe({
      observationId: "obs-3",
      provider: "ledger",
      description: "Invalid",
      params: { check: "invalid" },
    });
    assert.equal(result.status, "error");
  });
});
