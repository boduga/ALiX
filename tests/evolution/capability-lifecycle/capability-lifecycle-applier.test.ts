// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityRegistry } from "../../../src/capability/registry.js";
import { CapabilityCatalog } from "../../../src/capability/canonical/catalog.js";
import { CapabilityDefinitionStore } from "../../../src/capability/canonical/catalog-store.js";
import { CatalogBackedCapabilityMutationPort } from "../../../src/capability/mutation-port.js";
import { JsonlCapabilityLifecycleLedger } from "../../../src/evolution/capability-lifecycle/capability-lifecycle-ledger.js";
import { CapabilityLifecycleApplier } from "../../../src/evolution/capability-lifecycle/capability-lifecycle-applier.js";
import { toLedgerRecord } from "../../../src/evolution/capability-lifecycle/capability-governance-bridge.js";
import { runCapabilityGovernance } from "../../../src/evolution/capability-lifecycle/capability-governance-bridge.js";
import type { CapabilityLifecycleCandidate } from "../../../src/evolution/capability-lifecycle/contracts/lifecycle-contract.js";
import type { Capability } from "../../../src/capability/types.js";

function makeCapability(id: string): Capability {
  return { id, version: "1.0.0", kind: "core", title: id, description: id, tags: [], category: "core",
    risk: "low", requiredPermissions: ["operator"], execution: { strategy: "native" } };
}
function candidate(intent: "deprecate" | "promote" | "consolidate" | "register", id: string, related: string[] = []): CapabilityLifecycleCandidate {
  return {
    intent, target: { capabilityId: id, ...(related.length ? { relatedCapabilityIds: related } : {}) },
    confidence: 0.9, rationale: ["r"], evidenceRefs: [], observedLifecycleState: "declining",
    proposedLifecycleState: intent === "deprecate" ? "deprecated" : intent === "promote" ? "active" : intent === "consolidate" ? "deprecated" : "emerging",
  };
}

let dir: string;
let ledger: JsonlCapabilityLifecycleLedger;
let registry: CapabilityRegistry;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "a7-applier-"));
  ledger = new JsonlCapabilityLifecycleLedger(join(dir, "lifecycle.jsonl"));
  // CAP-3: registry is a catalog projection — build over a temp-dir catalog + port.
  const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  registry = new CapabilityRegistry(catalog);
  registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
  registry.register(makeCapability("core.old"));
  registry.register(makeCapability("core.session"));
  registry.register(makeCapability("core.session.a"));
  registry.register(makeCapability("core.session.b"));
});

afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("CapabilityLifecycleApplier", () => {
  async function seedDecided(intent: "deprecate" | "promote" | "consolidate" | "register", id: string, related: string[] = []) {
    const c = candidate(intent, id, related);
    const outcome = runCapabilityGovernance(c, "prop-a7-abc");
    await ledger.append(toLedgerRecord("intent", c));
    await ledger.append(toLedgerRecord("proposed", c, { proposalId: "prop-a7-abc" }));
    await ledger.append(toLedgerRecord("decided", c, { proposalId: "prop-a7-abc", outcome }));
    return { c, outcome };
  }

  it("deprecate: gate allowed → overlay mutated + applied record with executionId", async () => {
    await seedDecided("deprecate", "core.old");
    const applier = new CapabilityLifecycleApplier({ ledger, registry });
    const res = await applier.apply("core.old");
    assert.equal(res.status, "applied");
    assert.ok(res.executionId);
    assert.equal(registry.getLifecycleState("core.old"), "deprecated");
    const applied = await ledger.listLatestForCapability("core.old");
    assert.equal(applied?.eventType, "applied");
    assert.ok(applied?.executionId);
    assert.ok(applied?.decisionId);
  });

  it("register → not-executable, no mutation, no write", async () => {
    await seedDecided("register", "core.new");
    const applier = new CapabilityLifecycleApplier({ ledger, registry });
    const res = await applier.apply("core.new");
    assert.equal(res.status, "blocked");
    assert.match(res.reason, /not executable in A7\.1/);
    assert.equal(registry.getLifecycleState("core.new"), undefined);
    assert.equal((await ledger.listByCapability("core.new")).filter((r) => r.eventType === "applied").length, 0);
  });

  it("REJECT decision → blocked, no mutation", async () => {
    const c = candidate("deprecate", "core.old");
    const low = { ...c, confidence: 0.2 };
    const outcome = runCapabilityGovernance(low, "prop-a7-abc");
    await ledger.append(toLedgerRecord("decided", low, { proposalId: "prop-a7-abc", outcome }));
    const applier = new CapabilityLifecycleApplier({ ledger, registry });
    const res = await applier.apply("core.old");
    assert.equal(res.status, "blocked");
    assert.equal(registry.getLifecycleState("core.old"), "emerging"); // never mutated — stays at default current state
  });

  it("duplicate application is blocked (no second applied record)", async () => {
    await seedDecided("deprecate", "core.old");
    const applier = new CapabilityLifecycleApplier({ ledger, registry });
    await applier.apply("core.old");
    const res = await applier.apply("core.old");
    assert.equal(res.status, "blocked");
    assert.match(res.reason, /already completed|duplicate|executed/i);
    assert.equal((await ledger.listByCapability("core.old")).filter((r) => r.eventType === "applied").length, 1);
  });

  it("consolidate: both related deprecated, primary preserved", async () => {
    await seedDecided("consolidate", "core.session", ["core.session.a", "core.session.b"]);
    registry.applyLifecycleTransition("core.session", "active");
    const applier = new CapabilityLifecycleApplier({ ledger, registry });
    const res = await applier.apply("core.session");
    assert.equal(res.status, "applied");
    assert.equal(registry.getLifecycleState("core.session"), "active");
    assert.equal(registry.getLifecycleState("core.session.a"), "deprecated");
    assert.equal(registry.getLifecycleState("core.session.b"), "deprecated");
  });

  it("atomicity: ledger append failure → registry byte-identical after rollback", async () => {
    await seedDecided("deprecate", "core.old");
    registry.applyLifecycleTransition("core.old", "declining"); // pre-state snapshot
    const before = JSON.stringify(registry.list());
    // NOTE: `{ ...ledger }` would drop the class's prototype methods, so the
    // failing ledger is built via Object.create to keep read methods while
    // overriding only append.
    const failing = Object.create(ledger) as JsonlCapabilityLifecycleLedger;
    failing.append = async () => { throw new Error("append failed"); };
    const applier = new CapabilityLifecycleApplier({ ledger: failing, registry });
    await assert.rejects(applier.apply("core.old"), /append failed/);
    assert.equal(JSON.stringify(registry.list()), before);
    assert.equal(registry.getLifecycleState("core.old"), "declining"); // restored to pre-execution value
  });
});
