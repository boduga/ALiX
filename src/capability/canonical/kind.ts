// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/** Semantic form of a capability — WHAT ALiX can do, never HOW. */
export type CapabilityKind = "core" | "query" | "operation" | "workflow" | "agent";

export const CAPABILITY_KINDS: readonly CapabilityKind[] = ["core", "query", "operation", "workflow", "agent"] as const;

const KIND_SET = new Set<string>(CAPABILITY_KINDS);

export function isCapabilityKind(v: unknown): v is CapabilityKind {
  return typeof v === "string" && KIND_SET.has(v);
}

/** Pre-greenfield kind vocabulary — superseded by semantic kinds (decisions #475/#476). */
export type LegacyKind = "core" | "tool" | "skill" | "custom" | "workflow" | "plugin";

const LEGACY_TO_KIND: Record<LegacyKind, CapabilityKind> = {
  core: "core",
  tool: "operation",
  skill: "operation",
  workflow: "workflow",
  plugin: "agent",
};

/** Map a legacy kind string to its semantic form. "custom" has no semantic
 *  equivalent and is rejected — provider technologies must not become kinds. */
export function migrateKind(legacy: string): CapabilityKind {
  if (legacy === "custom") throw new Error("legacy kind 'custom' has no semantic CapabilityKind");
  const mapped = LEGACY_TO_KIND[legacy as LegacyKind];
  if (!mapped) throw new Error(`unknown legacy kind: ${legacy}`);
  return mapped;
}
