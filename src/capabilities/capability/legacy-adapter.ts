// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import type { Capability } from "./types.js";
import { migrateKind } from "./canonical/kind.js";
import type { CapabilityDefinition } from "./canonical/definition.js";
import type { CapabilityKind } from "./canonical/kind.js";
import type { CapabilityProviderBinding, ProviderType } from "./canonical/provider.js";

/** Map a legacy execution.strategy to a canonical provider type (ADR-0013).
 *  "cli" legacy strategies map to external-cli; everything else maps 1:1. */
const LEGACY_STRATEGY_TO_PROVIDER: Record<string, ProviderType> = {
  native: "native", tool: "tool", mcp: "mcp", cli: "external-cli",
  daemon: "daemon", agent: "agent", plugin: "plugin", "remote-api": "remote-api",
};

/** Best-effort reverse migrateKind — TEMPORARY legacy adapter.
 *  Lossy by design: tool+skill both map to operation, so both read back "tool".
 *  query (no legacy equivalent) reads back "custom". */
const CANONICAL_KIND_TO_LEGACY: Record<CapabilityKind, Capability["kind"]> = {
  core: "core", operation: "tool", workflow: "workflow", agent: "plugin", query: "custom",
};

/** Build canonical provider bindings from a legacy capability.
 *  extensions (incl. toolName) AND execution metadata (timeout/cancellable)
 *  ride binding.config so the canonical round-trip is lossless; executors and
 *  the legacy adapter recover them on the way back. */
export function buildLegacyBindings(cap: Capability): CapabilityProviderBinding[] {
  const provider = LEGACY_STRATEGY_TO_PROVIDER[cap.execution.strategy] ?? "tool";
  const config: Record<string, unknown> = {
    ...cap.extensions,
    ...(cap.execution.timeout != null ? { timeout: cap.execution.timeout } : {}),
    ...(cap.execution.cancellable != null ? { cancellable: cap.execution.cancellable } : {}),
  };
  return [{ id: cap.id, type: provider, ...(Object.keys(config).length > 0 ? { config } : {}) }];
}

/** Convert a legacy Capability to a canonical CapabilityDefinition.
 *  Normalizes version to full SemVer (#479), migrates kind via migrateKind
 *  (throws on "custom"), carries execution/extensions through bindings. */
export function legacyToCanonicalDefinition(cap: Capability): CapabilityDefinition {
  const kind = migrateKind(cap.kind); // throws on "custom" — no canonical equivalent
  return {
    id: cap.id,
    version: cap.version.split(".").length === 2 ? `${cap.version}.0` : cap.version,
    kind,
    title: cap.title,
    description: cap.description,
    tags: cap.tags,
    category: cap.category,
    risk: cap.risk,
    requiredPermissions: cap.requiredPermissions,
    dependencies: cap.dependencies ?? [],
    bindings: buildLegacyBindings(cap),
    ...(cap.argsSchema ? { argsSchema: cap.argsSchema } : {}),
    ...(cap.resultSchema ? { resultSchema: cap.resultSchema } : {}),
  };
}

/** Derive a legacy Capability from canonical state — the TEMPORARY adapter.
 *  Never stored; produced on demand for find()/list()/query() consumers.
 *  toolName, timeout, cancellable are recovered from binding.config (lossless);
 *  aliases/examples genuinely have no canonical home and are omitted. */
export function canonicalToLegacyCapability(def: CapabilityDefinition): Capability {
  const binding = def.bindings[0];
  const providerType = binding?.type ?? "tool";
  const legacyKind = CANONICAL_KIND_TO_LEGACY[def.kind] ?? "custom";
  const config = (binding?.config ?? {}) as Record<string, unknown>;
  const strategy = Object.entries(LEGACY_STRATEGY_TO_PROVIDER).find(([, p]) => p === providerType)?.[0] ?? "tool";
  return {
    id: def.id,
    version: def.version,
    kind: legacyKind,
    title: def.title,
    description: def.description,
    tags: def.tags,
    category: def.category,
    risk: def.risk,
    requiredPermissions: def.requiredPermissions,
    execution: {
      strategy,
      ...(typeof config.timeout === "number" ? { timeout: config.timeout } : {}),
      ...(typeof config.cancellable === "boolean" ? { cancellable: config.cancellable } : {}),
    },
    dependencies: def.dependencies,
    ...(Object.keys(config).length > 0 ? { extensions: config as Capability["extensions"] } : {}),
    ...(def.argsSchema ? { argsSchema: def.argsSchema } : {}),
    ...(def.resultSchema ? { resultSchema: def.resultSchema } : {}),
  };
}
