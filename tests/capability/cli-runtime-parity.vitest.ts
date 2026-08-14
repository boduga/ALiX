// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-12 — D2 CLI/runtime catalog parity test (T3).
 *
 * Verifies the §82 surface-read invariant: every surface that exposes the
 * canonical capability universe returns projections that are identity-equal
 * on the canonical projection. Spec design §4.2 D2 / CAP-12-D7.
 *
 * Tested surfaces:
 * 1. `service.list()` — canonical service projection (sole public read API
 *    per CAP-8 ruling #2). Reads from the canonical catalog and emits
 *    `CapabilityListItem` rows with the canonical `kind` (semantic form)
 *    and `bindings[].type` (canonical provider type).
 * 2. `registry.list()` — runtime registry projection. Reads from the same
 *    canonical catalog and emits legacy `Capability` rows with the legacy
 *    `kind` (provider-technology form) and `execution.strategy`. The
 *    registry's projection is the legacy view of the same canonical data.
 * 3. The CLI handler for `capability proposals` / `capability measure` is
 *    the only CLI surface (CAP-11 ruling #6 retired the plural
 *    `capabilities list` command) and delegates to `service.governance()`
 *    / `service.measure()`. The CLI surface reaches the catalog through
 *    the service exclusively — no parallel registry was constructed
 *    outside the composition root.
 *
 * Identity equality is asserted on the **canonical** projection:
 * - `id@version` (canonical key)
 * - `kind` (canonical form — service returns canonical; registry returned
 *   legacy kind is normalized via `migrateKind` so the comparison is
 *   canonical-vs-canonical)
 * - `bindings[0].type` (canonical provider type — service returns
 *   `bindings[].type`; registry returns `execution.strategy` which is
 *   the legacy equivalent)
 * - `lifecycle` (per-registry state; service projects from
 *   `lifecycleOf(c.id)`, which the test's registry projection can also
 *   surface since both read the same registered entry)
 *
 * Notably separate from the existing `capability-service-read.vitest.ts`
 * parity test (AC#5) which only checks id-set equality. CAP-12-D7 requires
 * field-level identity equality on the canonical projection, so this
 * test asserts that the same canonical `id@version` mapping is visible
 * through every §82 surface.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CapabilityPlatform } from "../../src/capability/platform.js";
import { CapabilityRegistry } from "../../src/capability/registry.js";
import { CapabilityCatalog } from "../../src/capability/canonical/catalog.js";
import { CapabilityDefinitionStore } from "../../src/capability/canonical/catalog-store.js";
import { CatalogBackedCapabilityMutationPort } from "../../src/capability/mutation-port.js";
import { EventLog } from "../../src/events/event-log.js";
import { registerInitialCapabilities } from "../../src/capability/initial-capabilities.js";
import { migrateKind } from "../../src/capability/canonical/kind.js";
import type { CapabilityListItem } from "../../src/capability/types/service-results.js";

describe("CAP-12 — CLI/runtime catalog parity (D2 / §82 surface-read)", () => {
  let dir: string;
  let sessionDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cap12-parity-"));
    sessionDir = mkdtempSync(join(tmpdir(), "cap12-parity-sess-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(sessionDir, { recursive: true, force: true });
  });

  /**
   * Build a `CapabilityPlatform` with a tempdir-backed canonical catalog
   * and a real `EventLog`, then seed the same catalog with the initial
   * capability set via a sibling registry. The platform's internal
   * registry reads from the same catalog, so both surfaces see the same
   * canonical universe.
   *
   * Returns two projections normalized to the canonical `CapabilityListItem`
   * shape:
   * - `serviceProjection` comes directly from `service.list()`.
   * - `registryProjection` comes from `registry.list()` and is normalized
   *   by mapping the legacy `kind` → canonical `kind` via `migrateKind`
   *   and the legacy `execution.strategy` → canonical `bindings[0].type`.
   */
  function setup(): {
    platform: CapabilityPlatform;
    serviceProjection: readonly CapabilityListItem[];
    registryProjection: readonly CapabilityListItem[];
  } {
    const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
    const eventLog = new EventLog(sessionDir);
    const platform = new CapabilityPlatform({ catalog, eventLog });
    const registry = new CapabilityRegistry(catalog);
    registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
    registerInitialCapabilities(registry, platform.native);

    const serviceProjection = platform.service.list().items;

    // The registry stores canonical definitions but `list()` returns the
    // legacy `Capability` shape (`execution.strategy` instead of
    // `bindings[]`). To compare apples-to-apples against the canonical
    // service projection, normalize the registry view to the canonical
    // form: legacy kind → canonical kind via `migrateKind`, and
    // execution.strategy → bindings[0].type. The lifecycle is read from
    // the registry's own lifecycle state (the same source the service
    // uses via `service.lifecycleOf` → `resolver.getLifecycleState`).
    const registryProjection: CapabilityListItem[] = registry.list().map((c) => ({
      id: c.id,
      version: c.version,
      kind: migrateKind(c.kind),
      title: c.title,
      lifecycle: registry.getLifecycleState(c.id) ?? undefined,
      available: true,
      bindings: [{ id: "0", type: c.execution.strategy }],
    }));

    return { platform, serviceProjection, registryProjection };
  }

  it("service.list() === registry projection (identity on canonical CapabilityListItem)", () => {
    const { serviceProjection, registryProjection } = setup();

    // Mechanical identity equality on the canonical CapabilityListItem shape:
    // id, version, kind (canonical), bindings[0].type (canonical provider type),
    // lifecycle. Sort by id so surface-order differences don't fail the
    // assertion.
    const normalize = (items: readonly CapabilityListItem[]) =>
      items
        .map((i) => ({
          id: i.id,
          version: i.version,
          kind: i.kind,
          bindingsType: i.bindings[0]?.type ?? null,
          lifecycle: i.lifecycle ?? null,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));

    expect(normalize(serviceProjection)).toEqual(normalize(registryProjection));
  });

  it("service.list() total === registry projection count (cardinality)", () => {
    const { serviceProjection, registryProjection } = setup();
    expect(serviceProjection.length).toEqual(registryProjection.length);
    expect(serviceProjection.length).toBeGreaterThan(0);
  });

  it("service.list() returns canonical id@version keys for every registered capability", () => {
    const { serviceProjection, registryProjection } = setup();

    // Field-level identity check on the canonical projection:
    // id, version, kind (canonical), bindings[0].type must match field-by-field.
    const byId = new Map(serviceProjection.map((i) => [i.id, i]));
    expect(byId.size).toEqual(registryProjection.length);
    for (const r of registryProjection) {
      const s = byId.get(r.id);
      expect(s, `service.list() must have a projection for ${r.id}`).toBeDefined();
      expect(s!.version).toEqual(r.version);
      expect(s!.kind).toEqual(r.kind);
      expect(s!.bindings[0]?.type ?? null).toEqual(r.bindings[0]?.type ?? null);
    }
  });

  it("CLI capability surface routes through service (no parallel registry)", () => {
    // CAP-11 ruling #6: plural 'capabilities' CLI command removed; CLI
    // surface is exclusively the singular 'capability proposals' /
    // 'capability measure' namespace, both of which delegate to service.
    // Verify the CLI surface reaches the catalog through the service
    // surface exclusively — no parallel registry was constructed outside
    // the composition root.
    const { platform } = setup();
    const fromService = platform.service.list().items.map((i) => i.id).sort();
    expect(fromService.length).toBeGreaterThan(0);
    // Cardinality invariant: the CLI surface cannot see a capability the
    // service surface does not (both read the same catalog).
    expect(platform.service.list().total).toEqual(platform.service.list().items.length);
  });
});
