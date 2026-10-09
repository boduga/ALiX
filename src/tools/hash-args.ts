import { createHash } from "node:crypto";

/**
 * Stable SHA-256 over a tool-call args object (sorted keys, deterministic).
 *
 * Extracted from `executor.ts` (R5.3b) so non-dispatch consumers
 * (replay, continuation, task-loop evidence) can hash args without importing
 * the tool-executor implementation.
 */
export function hashArgs(args: Record<string, unknown>): string {
  // Stable SHA-256 using JSON.stringify with sorted keys for deterministic output
  const stable = JSON.stringify(args, (_key: string, value: unknown) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value as Record<string, unknown>)
          .sort()
          .reduce<Record<string, unknown>>((acc, k) => {
            acc[k] = (value as Record<string, unknown>)[k];
            return acc;
          }, {})
      : value
  );
  return createHash("sha256").update(stable).digest("hex");
}
