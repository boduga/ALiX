// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-12 Task 2 — Migration fixture assertion test.
 *
 * Asserts that for every row in `LEGACY_MIGRATION_BUNDLE`, the production
 * `legacy-adapter.legacyToCanonicalDefinition` produces the canonical
 * projection that T1 hand-authored in `expectedCanonical`. Per spec D3
 * (CAP-12 §4.3), the migration fixture must satisfy:
 *
 *   - expected capability IDs survive (no silent loss)
 *   - semantic `kind` mappings are correct (per production code, not spec paraphrase)
 *   - provider bindings survive (legacy `execution.strategy` → canonical `bindings[].type`)
 *   - versions are normalized to full SemVer MAJOR.MINOR.PATCH
 *   - no duplicate semantic identities
 *   - deprecated entries retain history (lifecycle rides through `bindings[0].config.lifecycle`)
 *
 * Per project SDD convention: T1 produced the fixture (data only), T2 produces
 * the assertions. Per user instruction: assertion values follow production code
 * in `legacy-adapter.ts`, not the spec's paraphrase. Where the spec suggests
 * mappings the production code does not implement (e.g. row 1 kind `query`),
 * T1 documented the divergence in the fixture header and used the production
 * mapping; this test asserts what T1 produced.
 *
 * @module tests/capability/cap-12-migration-fixture
 */

import { describe, it, expect } from "vitest";
import {
  legacyToCanonicalDefinition,
  canonicalToLegacyCapability,
} from "../../src/capability/legacy-adapter.js";
import {
  LEGACY_MIGRATION_BUNDLE,
  type LegacyMigrationRow,
} from "./fixtures/legacy-migration-bundle.js";
import { PROVIDER_TYPES } from "../../src/capability/canonical/provider.js";

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

describe("CAP-12 migration fixture (D3 — legacy → canonical round-trip)", () => {
  // Per-row axes: kind, version, bindings[0].type, id preserved.
  for (const row of LEGACY_MIGRATION_BUNDLE) {
    describe(`row: ${row.label}`, () => {
      it("legacy → canonical preserves `id`", () => {
        const canonical = legacyToCanonicalDefinition(row.legacy);
        expect(canonical.id).toBe(row.expectedCanonical.id);
      });

      it("legacy → canonical preserves semantic `kind` (per production code)", () => {
        const canonical = legacyToCanonicalDefinition(row.legacy);
        expect(canonical.kind).toBe(row.expectedCanonical.kind);
      });

      it("legacy → canonical normalizes `version` to full SemVer MAJOR.MINOR.PATCH", () => {
        const canonical = legacyToCanonicalDefinition(row.legacy);
        expect(canonical.version).toBe(row.expectedCanonical.version);
        expect(canonical.version).toMatch(SEMVER_RE);
      });

      it("legacy → canonical maps `execution.strategy` → `bindings[0].type`", () => {
        const canonical = legacyToCanonicalDefinition(row.legacy);
        expect(canonical.bindings.length).toBeGreaterThan(0);
        expect(canonical.bindings[0]!.type).toBe(row.expectedCanonical.bindings[0]!.type);
      });
    });
  }

  // Row-specific axis: deprecated entry retains lifecycle through binding.config.
  // T1 documented that neither `Capability` nor `CapabilityDefinition` carries a
  // top-level `lifecycle` field; the lifecycle annotation rides through the
  // legacy extensions carrier into `bindings[0].config.lifecycle`.
  it("deprecated entry retains lifecycle via binding.config (row 8)", () => {
    const deprecatedRow = LEGACY_MIGRATION_BUNDLE.find(
      (r): r is LegacyMigrationRow => r.expectedCanonical.lifecycle === "deprecated",
    );
    expect(deprecatedRow, "fixture must include a row whose expectedCanonical.lifecycle === 'deprecated'").toBeDefined();
    if (!deprecatedRow) return;

    const canonical = legacyToCanonicalDefinition(deprecatedRow.legacy);

    // Lifecycle must ride through the binding.config carrier — there is no
    // top-level `lifecycle` on canonical CapabilityDefinition.
    expect(
      (canonical.bindings[0] as { config?: Record<string, unknown> } | undefined)?.config?.lifecycle,
      "deprecated row must carry lifecycle on bindings[0].config",
    ).toBe("deprecated");

    // And the round-trip back to legacy must also surface it as `extensions.lifecycle`.
    const back = canonicalToLegacyCapability(canonical);
    expect(
      (back.extensions as Record<string, unknown> | undefined)?.lifecycle,
      "deprecated row must round-trip back with extensions.lifecycle === 'deprecated'",
    ).toBe("deprecated");
  });

  // Dedup axis: every row's legacy ID is unique; produces no duplicate canonical IDs.
  it("produces no duplicate canonical IDs across the bundle", () => {
    const ids = LEGACY_MIGRATION_BUNDLE.map((r) => r.legacy.id);
    expect(new Set(ids).size, "duplicate legacy capability IDs in fixture").toBe(ids.length);

    const canonicalIds = LEGACY_MIGRATION_BUNDLE.map(
      (r) => legacyToCanonicalDefinition(r.legacy).id,
    );
    expect(
      new Set(canonicalIds).size,
      "duplicate canonical capability IDs after legacy-adapter projection",
    ).toBe(canonicalIds.length);
  });

  // Sanity axis: fixture's expected provider types are all valid ProviderType values.
  it("every row's expected bindings[0].type is a valid ProviderType", () => {
    for (const row of LEGACY_MIGRATION_BUNDLE) {
      const t = row.expectedCanonical.bindings[0]?.type;
      expect(typeof t).toBe("string");
      expect(
        PROVIDER_TYPES as readonly string[],
        `row '${row.label}' expected bindings[0].type '${String(t)}' is not a valid ProviderType`,
      ).toContain(t);
    }
  });
});
