/**
 * policy-revision.ts — Deterministic policy revision fingerprint.
 *
 * Computes a SHA-256 hash of all policy-relevant configuration fields.
 * Used to bind approvals and detect when policy changes invalidate them.
 */

import { createHash } from "node:crypto";
import type { AlixConfig } from "../config/schema.js";

/**
 * Recursively sort the keys of an object for deterministic JSON serialization.
 */
function sortKeys<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sortKeys) as T;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce(
        (acc, key) => {
          acc[key] = sortKeys(obj[key]);
          return acc;
        },
        {} as Record<string, unknown>,
      ) as T;
  }
  return value;
}

/**
 * Compute a deterministic policy revision fingerprint.
 * Any change to policy configuration produces a different hash.
 */
export function computePolicyRevision(config: AlixConfig): string {
  const relevant: Record<string, unknown> = {
    default: config.permissions?.default,
    tools: config.permissions?.tools,
    protectedPaths: config.permissions?.protectedPaths,
    denyCommands: config.permissions?.denyCommands,
    shellWhitelist: config.permissions?.shellWhitelist,
    sessionMode: config.permissions?.sessionMode,
  };

  const canonical = JSON.stringify(sortKeys(relevant));
  return createHash("sha256").update(canonical).digest("hex");
}
