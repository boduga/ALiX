// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-10 Task 6 — `service.governance()` filter widening.
 *
 * Locked ruling #6, #20:
 *   - Filter widens from `capability.governance.proposal.` to
 *     `capability.governance.` so projection includes BOTH
 *     `proposal.*` (CAP-9) AND `measurement.*` (CAP-10) events.
 *   - Pure projection — never calculate, reinterpret, or override events.
 *   - Widened filter is strictly more permissive; CAP-9 governance tests
 *     must continue to pass.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../../src/events/event-log.js";
import { CapabilityService } from "../../src/capability/capability-service.js";
import { CapabilityCatalog } from "../../src/capability/canonical/catalog.js";
import { CapabilityDefinitionStore } from "../../src/capability/canonical/catalog-store.js";
import { CapabilityRegistry } from "../../src/capability/registry.js";
import { CapabilityResolver } from "../../src/capability/provider-resolver.js";
import { ProviderExecutorRegistry } from "../../src/capability/provider-registry.js";
import { MEASUREMENT_EVENT_PREFIX } from "../../src/capability/measurement/measurement-event-types.js";

describe("CapabilityService.governance() widening (CAP-10 ruling #6, #20)", () => {
  let dir: string;
  let eventLog: EventLog;
  let catalog: CapabilityCatalog;
  let registry: CapabilityRegistry;
  let resolver: CapabilityResolver;
  let service: CapabilityService;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "cap10-svc-gov-widen-"));
    eventLog = new EventLog(dir);
    await eventLog.init();
    catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
    registry = new CapabilityRegistry(catalog);
    resolver = new CapabilityResolver(registry, new ProviderExecutorRegistry());
    const mutationExecutor = {
      async executeStep() {
        return { success: true, output: {} };
      },
    } as never;
    service = new CapabilityService({
      catalog,
      resolver,
      mutationExecutor,
      eventLog,
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("includes measurement events when present (ruling #6)", async () => {
    await eventLog.append({
      type: `${MEASUREMENT_EVENT_PREFIX}measured`,
      actor: "system",
      sessionId: "",
      payload: {
        measurement: { capabilityId: "x", version: "1.0.0" },
        post: {
          observationId: "obs-1",
          takenAt: new Date().toISOString(),
          status: "pass",
          confidence: 0.9,
        },
        outcome: {
          kind: "effective",
          evidenceRefs: [],
          confidence: 0.9,
          summary: "ok",
          signals: [],
        },
      },
    });
    const result = await service.governance();
    expect(
      result.events.some((e) => e.type === `${MEASUREMENT_EVENT_PREFIX}measured`),
    ).toBe(true);
  });

  it("still includes governance proposal events (CAP-9 preserved)", async () => {
    await eventLog.append({
      type: "capability.governance.proposal.submitted",
      actor: "system",
      sessionId: "",
      payload: { proposalId: "p-1" },
    });
    const result = await service.governance();
    expect(
      result.events.some(
        (e) => e.type === "capability.governance.proposal.submitted",
      ),
    ).toBe(true);
  });
});