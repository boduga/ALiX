// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/** Implementation mechanism for a capability — HOW ALiX performs it.
 *  Providers are implementations, never capability identities (ADR-0013 §4). */
export type ProviderType =
  | "native" | "tool" | "mcp" | "external-cli"
  | "daemon" | "agent" | "plugin" | "remote-api";

export const PROVIDER_TYPES: readonly ProviderType[] = [
  "native", "tool", "mcp", "external-cli", "daemon", "agent", "plugin", "remote-api",
] as const;

const PROVIDER_SET = new Set<string>(PROVIDER_TYPES);

/** Declarative binding of a capability to one provider implementation. Pure data. */
export interface CapabilityProviderBinding {
  /** Stable provider id within the runtime composition, e.g. "gh", "gitnexus", "session.list". */
  id: string;
  type: ProviderType;
  /** Provider-specific configuration. Must be JSON-serializable. */
  config?: Record<string, unknown>;
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isSerializable(value: unknown): boolean {
  if (value === null) return true;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return true;
  if (t === "undefined") return false;
  if (Array.isArray(value)) return value.every(isSerializable);
  if (t === "object") return Object.values(value as Record<string, unknown>).every(isSerializable);
  return false; // function, symbol, bigint
}

const EXTERNAL_CLI_REQUIRED = new Set<string>(["external-cli"]);

/** Throws Error with a stable prefix when `binding` is not a valid provider binding. */
export function validateProviderBinding(binding: unknown): asserts binding is CapabilityProviderBinding {
  if (!isPlainRecord(binding)) throw new Error("capability: provider binding must be an object");
  if (typeof binding.id !== "string" || binding.id.trim().length === 0) {
    throw new Error("capability: provider id must be a non-empty string");
  }
  if (typeof binding.type !== "string" || !PROVIDER_SET.has(binding.type)) {
    throw new Error(`capability: provider type '${String(binding.type)}' is not one of ${PROVIDER_TYPES.join("|")}`);
  }
  if (binding.config !== undefined) {
    if (!isPlainRecord(binding.config)) throw new Error("capability: provider config must be an object");
    if (!isSerializable(binding.config)) throw new Error("capability: provider config must be JSON-serializable (no functions)");
  }
  if (EXTERNAL_CLI_REQUIRED.has(binding.type) && (binding.config === undefined || typeof binding.config.executable !== "string" || binding.config.executable.trim().length === 0)) {
    throw new Error(`capability: provider type 'external-cli' requires config.executable`);
  }
}
