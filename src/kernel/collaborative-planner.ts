/**
 * collaborative-planner.ts — Capability matching and shared types for
 * collaborative multi-agent planning.
 *
 * Provides:
 * - `normalizeCapability` — normalizes capability strings through a controlled
 *   alias registry to exact canonical IDs.
 * - `matchCapabilities` — matches required capabilities against agent
 *   capabilities using exact canonical ID equality (never substring matching).
 * - `CapabilityRegistry` — an interface mapping agent IDs to their capability
 *   lists.
 */

// ─── Capability alias registry ─────────────────────────────────────────

/**
 * Controlled alias registry.
 * Maps common aliases to their canonical capability IDs.
 * All comparisons use exact canonical ID equality.
 */
const CAPABILITY_ALIASES: Record<string, string> = {
  "read": "filesystem.read",
  "write": "filesystem.write",
  "filesystem_read": "filesystem.read",
  "filesystem_write": "filesystem.write",
  "filesystem.read": "filesystem.read",
  "filesystem.write": "filesystem.write",
};

/**
 * Normalize a capability string to its canonical form.
 *
 * 1. Lowercases and trims.
 * 2. Strips non-alphanumeric characters except `.` and `_`.
 * 3. Looks up in the alias registry.
 * 4. Returns the canonical ID if found, otherwise the normalized string.
 */
export function normalizeCapability(cap: string): string {
  const key = cap.trim().toLowerCase().replace(/[^a-z0-9._]/g, "");
  return CAPABILITY_ALIASES[key] ?? key;
}

// ─── Capability matching ───────────────────────────────────────────────

/**
 * Match required capabilities against an agent's declared capabilities
 * using exact canonical ID matching.
 *
 * - Each required capability is normalized through the alias registry and
 *   compared against the normalized set of agent capabilities.
 * - Only exact canonical ID equality is used — never substring matching.
 * - Score = matched.length / required.length (0 if required is empty).
 *
 * @param required - Capabilities required for a task.
 * @param agentCapabilities - Capabilities the agent declares.
 * @returns An object with `matched` array, `unmatched` array, and `score`.
 */
export function matchCapabilities(
  required: string[],
  agentCapabilities: string[],
): { matched: string[]; unmatched: string[]; score: number } {
  const agentNormalized = new Set(agentCapabilities.map(normalizeCapability));
  const matched = required.filter((r) => agentNormalized.has(normalizeCapability(r)));
  const unmatched = required.filter((r) => !agentNormalized.has(normalizeCapability(r)));
  const score = required.length === 0 ? 0 : matched.length / required.length;
  return { matched, unmatched, score };
}

// ─── Types ─────────────────────────────────────────────────────────────

/**
 * Maps agent IDs to their lists of declared capabilities.
 */
export interface CapabilityRegistry {
  [agentId: string]: string[];
}
