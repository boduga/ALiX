// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlCapabilityLifecycleLedger } from "../../../src/evolution/capability-lifecycle/capability-lifecycle-ledger.js";
import type { CapabilityLifecycleRecord } from "../../../src/evolution/capability-lifecycle/contracts/lifecycle-contract.js";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "a7-ledger-"));
  file = join(dir, "lifecycle.jsonl");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function baseRecord(overrides: Partial<CapabilityLifecycleRecord> = {}): Omit<CapabilityLifecycleRecord, "recordId"> {
  return {
    target: { capabilityId: "core.session.list" },
    intent: "deprecate",
    eventType: "decided",
    timestamp: "2026-08-10T00:00:00.000Z",
    proposalId: "prop-a7-abc",
    decisionId: "govd-a7-abc",
    evidenceRefs: [],
    observedLifecycleState: "active",
    proposedLifecycleState: "deprecated",
    decisionKind: "APPROVE",
    ...overrides,
  };
}

describe("JsonlCapabilityLifecycleLedger", () => {
  it("appends a record, assigns a unique recordId, and persists to JSONL", async () => {
    const ledger = new JsonlCapabilityLifecycleLedger(file);
    const stored = await ledger.append(baseRecord());
    assert.ok(stored.recordId.startsWith("clr-"));
    assert.ok(stored.recordId.length > 4);

    const raw = readFileSync(file, "utf-8");
    assert.equal(raw.trimEnd().split("\n").length, 1);
    assert.ok(raw.includes(stored.recordId));
  });

  it("lists records in append order", async () => {
    const ledger = new JsonlCapabilityLifecycleLedger(file);
    await ledger.append(baseRecord({ eventType: "intent" }));
    await ledger.append(baseRecord({ eventType: "proposed" }));
    const records = await ledger.list();
    assert.equal(records.length, 2);
    assert.deepEqual(records.map((r) => r.eventType), ["intent", "proposed"]);
  });

  it("lists records by capability", async () => {
    const ledger = new JsonlCapabilityLifecycleLedger(file);
    await ledger.append(baseRecord({ target: { capabilityId: "core.session.list" } }));
    await ledger.append(baseRecord({ target: { capabilityId: "core.session.get" } }));
    const byCap = await ledger.listByCapability("core.session.list");
    assert.equal(byCap.length, 1);
    assert.equal(byCap[0].target.capabilityId, "core.session.list");
  });

  it("lists records by intent", async () => {
    const ledger = new JsonlCapabilityLifecycleLedger(file);
    await ledger.append(baseRecord({ intent: "deprecate" }));
    await ledger.append(baseRecord({ intent: "promote" }));
    const deprecations = await ledger.listByIntent("deprecate");
    assert.equal(deprecations.length, 1);
    assert.equal(deprecations[0].intent, "deprecate");
  });

  it("returns the latest decided record for a capability, or null", async () => {
    const ledger = new JsonlCapabilityLifecycleLedger(file);
    assert.equal(await ledger.listLatestForCapability("core.session.list"), null);
    await ledger.append(baseRecord({ eventType: "proposed" }));
    await ledger.append(baseRecord({ eventType: "decided", decisionKind: "REJECT" }));
    const latest = await ledger.listLatestForCapability("core.session.list");
    assert.equal(latest?.decisionKind, "REJECT");
  });

  it("skips corrupt JSONL lines without suppressing neighbors", async () => {
    const ledger = new JsonlCapabilityLifecycleLedger(file);
    await ledger.append(baseRecord({ eventType: "intent" }));
    // Corrupt the file by appending a malformed line directly.
    const { appendFileSync } = await import("node:fs");
    appendFileSync(file, "{ not valid json\n");
    await ledger.append(baseRecord({ eventType: "proposed" }));
    const records = await ledger.list();
    assert.equal(records.length, 2); // corrupt line skipped, both valid records survive
  });

  it("returns an empty list when the file does not exist", async () => {
    const ledger = new JsonlCapabilityLifecycleLedger(join(dir, "missing.jsonl"));
    assert.deepEqual(await ledger.list(), []);
    assert.equal(await ledger.listLatestForCapability("x"), null);
  });
});
