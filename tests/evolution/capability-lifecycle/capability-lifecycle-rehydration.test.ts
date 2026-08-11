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
import type { Capability } from "../../../src/capability/types.js";
import { JsonlCapabilityLifecycleLedger } from "../../../src/evolution/capability-lifecycle/capability-lifecycle-ledger.js";
import { rehydrateLifecycleOverlay } from "../../../src/evolution/capability-lifecycle/capability-lifecycle-rehydration.js";

function makeCapability(id: string): Capability {
  return {
    id, version: "1.0.0", kind: "core", title: id, description: id,
    tags: [], category: "core", risk: "low", requiredPermissions: ["operator"],
    execution: { strategy: "native" },
  };
}

function appliedRecord(id: string, to: string) {
  return {
    target: { capabilityId: id }, intent: "deprecate" as const, eventType: "applied" as const,
    timestamp: new Date().toISOString(), proposalId: `prop-${id}`, decisionId: `govd-${id}`,
    executionId: `exec-${id}`, evidenceRefs: [],
    observedLifecycleState: "declining" as const, proposedLifecycleState: to as "deprecated" | "active",
  };
}

let dir: string;
let ledger: JsonlCapabilityLifecycleLedger;

// CAP-3: registry is a catalog projection — build over a temp-dir catalog + port.
function makeRegistry(dir: string): CapabilityRegistry {
  const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  const registry = new CapabilityRegistry(catalog);
  registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
  return registry;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "a7-rehydrate-"));
  ledger = new JsonlCapabilityLifecycleLedger(join(dir, "lifecycle.jsonl"));
});

afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("rehydrateLifecycleOverlay", () => {
  it("replays applied records into the overlay for registered capabilities", async () => {
    const registry = makeRegistry(dir);
    registry.register(makeCapability("core.old"));
    await ledger.append(appliedRecord("core.old", "deprecated"));

    const replayed = await rehydrateLifecycleOverlay(registry, ledger);
    assert.equal(replayed, 1);
    assert.equal(registry.getLifecycleState("core.old"), "deprecated");
  });

  it("skips capabilities the registry does not know (no throw, not counted)", async () => {
    const registry = makeRegistry(dir); // empty — nothing registered
    await ledger.append(appliedRecord("core.old", "deprecated"));

    const replayed = await rehydrateLifecycleOverlay(registry, ledger);
    assert.equal(replayed, 0);
    assert.equal(registry.getLifecycleState("core.old"), undefined);
  });

  it("last applied state per capability wins (ledger order)", async () => {
    const registry = makeRegistry(dir);
    registry.register(makeCapability("core.session.list"));
    // Two applied records for the same capability — the last one overwrites.
    await ledger.append(appliedRecord("core.session.list", "deprecated"));
    await ledger.append(appliedRecord("core.session.list", "active"));

    const replayed = await rehydrateLifecycleOverlay(registry, ledger);
    assert.equal(replayed, 2);
    assert.equal(registry.getLifecycleState("core.session.list"), "active");
  });
});
