// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { CAPABILITY_KINDS, isCapabilityKind } from "./kind.js";
import type { CapabilityKind } from "./kind.js";
import { validateProviderBinding } from "./provider.js";
import type { CapabilityProviderBinding } from "./provider.js";
import { isValidVersion } from "./version.js";

export type CapabilityRisk = "low" | "medium" | "high" | "critical";
export type CapabilityPermission = "operator" | "admin" | "developer" | "internal";

const RISK_LEVELS = new Set<string>(["low", "medium", "high", "critical"]);
const VALID_PERMISSIONS = new Set<string>(["operator", "admin", "developer", "internal"]);

/** Canonical capability artifact. Pure data — no functions, no live handles. */
export interface CapabilityDefinition {
  id: string; // semantic, namespaced: "code.repository.impact"
  version: string; // full SemVer MAJOR.MINOR.PATCH (#479)
  kind: CapabilityKind; // semantic form, never implementation technology (#475)
  title: string;
  description: string;
  aliases?: string[];
  tags: string[];
  category: string;
  risk: CapabilityRisk;
  requiredPermissions: CapabilityPermission[];
  argsSchema?: Record<string, unknown>;
  resultSchema?: Record<string, unknown>;
  examples?: string[];
  dependencies: string[]; // capability-IDs, not id@version refs (#479)
  bindings: CapabilityProviderBinding[]; // one-to-many; identity independent of provider (#476)
  extensions?: Record<string, unknown>;
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
  if (t === "object") {
    // Reject non-plain objects (Date, RegExp, Map, Set, etc.)
    if (Object.prototype.toString.call(value) !== "[object Object]") return false;
    return Object.values(value as Record<string, unknown>).every(isSerializable);
  }
  return false; // function, symbol, bigint
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/** Throws Error with a `capability:` prefix when `d` is not a valid canonical definition. */
export function validateCapabilityDefinition(d: unknown): asserts d is CapabilityDefinition {
  if (!isPlainRecord(d)) throw new Error("capability: definition must be an object");
  if (typeof d.id !== "string" || d.id.trim().length === 0) throw new Error("capability: definition id must be a non-empty string");
  if (!isValidVersion(d.version)) throw new Error(`capability: definition version '${String(d.version)}' is not full SemVer MAJOR.MINOR.PATCH`);
  if (!isCapabilityKind(d.kind)) throw new Error(`capability: definition kind '${String(d.kind)}' is not a semantic kind (provider technologies like tool/mcp/native are not kinds). Must be one of ${CAPABILITY_KINDS.join("|")}`);
  if (typeof d.risk !== "string" || !RISK_LEVELS.has(d.risk)) throw new Error(`capability: definition risk '${String(d.risk)}' must be one of ${[...RISK_LEVELS].join("|")}`);
  if (typeof d.title !== "string" || d.title.trim().length === 0) throw new Error("capability: definition title must be a non-empty string");
  if (typeof d.description !== "string") throw new Error("capability: definition description must be a string");
  if (!isStringArray(d.tags)) throw new Error("capability: definition tags must be a string array");
  if (typeof d.category !== "string") throw new Error("capability: definition category must be a string");
  if (!isStringArray(d.requiredPermissions)) throw new Error("capability: definition requiredPermissions must be a string array");
  if (!d.requiredPermissions.every((p) => VALID_PERMISSIONS.has(p))) throw new Error(`capability: definition requiredPermissions must only contain ${[...VALID_PERMISSIONS].join("|")}`);
  if (!isStringArray(d.dependencies)) throw new Error("capability: definition dependencies must be a string array");
  if (!Array.isArray(d.bindings) || d.bindings.length === 0) throw new Error("capability: definition must declare at least one provider binding");
  for (const b of d.bindings) validateProviderBinding(b);
  if (d.extensions !== undefined) {
    if (!isPlainRecord(d.extensions)) throw new Error("capability: definition extensions must be an object");
    if (!isSerializable(d.extensions)) throw new Error("capability: definition extensions must be JSON-serializable (no functions)");
  }
  if (d.argsSchema !== undefined && !isPlainRecord(d.argsSchema)) throw new Error("capability: definition argsSchema must be a JSON Schema object");
  if (d.resultSchema !== undefined && !isPlainRecord(d.resultSchema)) throw new Error("capability: definition resultSchema must be a JSON Schema object");
}
