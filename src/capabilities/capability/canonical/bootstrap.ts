// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import type { CapabilityDefinition } from "./definition.js";
import { validateCapabilityDefinition } from "./definition.js";
import type { CapabilityProviderBinding } from "./provider.js";

export interface CapabilityBootstrapEntry {
  definition: CapabilityDefinition;
  binding?: CapabilityProviderBinding;
  source: string;
}

/** One source of capability definitions at initialization (§13).
 *  A bootstrap provider is NOT an authority — the catalog is. */
export interface CapabilityBootstrapProvider {
  readonly source: string;
  load(): CapabilityBootstrapEntry[];
}

export const BOOTSTRAP_SOURCE_ORDER = [
  "built-in", "project-local", "plugins", "provider-discovery", "governed", "overrides",
] as const;

/** Rank a bootstrap source for precedence. Lower rank sorts earlier and is
 *  processed first, so it is OVERRIDDEN by every later (higher-rank) source.
 *  An unknown/typo'd source must never override known catalog content, so it
 *  gets the LOWEST precedence (-Infinity, sorts before all known sources). */
function sourceRank(source: string): number {
  const idx = BOOTSTRAP_SOURCE_ORDER.indexOf(source as never);
  return idx === -1 ? -Infinity : idx;
}

/** Deterministic source precedence: later sources override earlier on the same
 *  id@version. Every entry passes canonical validation. */
export function loadCatalogWithPrecedence(providers: CapabilityBootstrapProvider[]): CapabilityBootstrapEntry[] {
  const byKey = new Map<string, CapabilityBootstrapEntry>();
  const ordered = [...providers].sort((a, b) => sourceRank(a.source) - sourceRank(b.source));
  for (const p of ordered) {
    for (const entry of p.load()) {
      validateCapabilityDefinition(entry.definition);
      const key = `${entry.definition.id}@${entry.definition.version}`;
      byKey.set(key, entry); // later source wins
    }
  }
  return [...byKey.values()];
}
