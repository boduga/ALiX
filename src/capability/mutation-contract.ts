// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-5 — Capability Mutation Contract.
 *
 * The single authoritative definition of what mutations are legal and what
 * state transitions they produce. Pure contract: types + constants + pure
 * validators. No registry/persistence/executor/runtime/governance imports and
 * no side effects. CAP-6 implements the executor that applies these mutations
 * through A4; CAP-9 targets A7 proposals at these intents; CAP-7 reads the
 * transition table for eligibility.
 *
 * Locked decisions: #475 (semantic kind), #477 (consolidation), #479
 * (versioning), #480 (executable update), #481 (lifecycle graph, no dormant).
 * This file grows cumulatively across plan Tasks 1-5.
 */

import type { LifecycleState } from "../adaptation/capability-evolution-types.js";

// ---------------------------------------------------------------------------
// Lifecycle transition policy (#481 — locked six-state graph)
// ---------------------------------------------------------------------------

/**
 * The fixed, acyclic six-state lifecycle graph (#481). Data-driven so the
 * locked graph is visibly auditable and tests have a single source of truth.
 * `deprecated` is terminal (empty legal target list). There is NO `dormant`
 * state — unbound capabilities are expressed on the availability axis, never
 * here. Lifecycle legality is part of the mutation contract: a transition is
 * a legal mutation ONLY if this table permits it.
 */
export const LEGAL_LIFECYCLE_TRANSITIONS: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = {
  emerging: ["active", "deprecated"],
  active: ["mature", "declining"],
  mature: ["declining"],
  stagnant: ["active", "deprecated"],
  declining: ["deprecated"],
  deprecated: [],
};

/** Is `from → to` a legal lifecycle transition under the locked #481 graph? */
export function isLegalTransition(from: LifecycleState, to: LifecycleState): boolean {
  return LEGAL_LIFECYCLE_TRANSITIONS[from].includes(to);
}

import type { CapabilityDefinition, CapabilityRisk, CapabilityPermission } from "./canonical/definition.js";
import type { CapabilityProviderBinding } from "./canonical/provider.js";

// ---------------------------------------------------------------------------
// Mutation payloads (design §20-25; #477/#479/#480/#481)
// ---------------------------------------------------------------------------

/** Mutable definition surface (#480 patch surface). `id`/`version`/`kind` are
 *  immutable and never patchable. Every field here is a governed mutation —
 *  none is a governance loophole. */
export interface CapabilityDefinitionPatch {
  title?: string;
  description?: string;
  aliases?: string[];
  tags?: string[];
  category?: string;
  risk?: CapabilityRisk;
  requiredPermissions?: CapabilityPermission[];
  argsSchema?: Record<string, unknown>;
  resultSchema?: Record<string, unknown>;
  examples?: string[];
  dependencies?: string[];
  bindings?: CapabilityProviderBinding[];
  allowFallbacks?: boolean;
  extensions?: Record<string, unknown>;
}

/** create (#478): an authored, approved definition — no placeholder. A new
 *  capability always enters the graph at `emerging` (#481); `initialLifecycle`
 *  may be omitted and defaults to "emerging". */
export interface CapabilityCreateMutation {
  operation: "capability.create";
  definition: CapabilityDefinition;
  initialLifecycle?: "emerging";
}

/** update (#480): governed source `id@version` → new immutable publication.
 *  `update(id)` meaning "modify current" is explicitly PROHIBITED — the caller
 *  must name the exact source version. Bump is executor-classified via
 *  `classifyUpdateBump` (Task 3). */
export interface CapabilityUpdateMutation {
  operation: "capability.update";
  capabilityId: string;
  sourceVersion: string;
  patch: CapabilityDefinitionPatch;
}

/** transition (#481): explicit `from` is the stale-decision precondition. A
 *  transition is legal ONLY if `from → to` is in `LEGAL_LIFECYCLE_TRANSITIONS`. */
export interface CapabilityTransitionMutation {
  operation: "capability.transition";
  capabilityId: string;
  from: LifecycleState;
  to: LifecycleState;
}

/** consolidate (#477): true governed merge. The proposal carries the explicit
 *  resulting target `definition`; the executor applies exactly the approved
 *  definition and NEVER invents a merge. `target` must not be one of
 *  `sources`; `remove` only when safe (refs/deps — executor concern). */
export interface CapabilityConsolidateMutation {
  operation: "capability.consolidate";
  sources: string[];
  target: string;
  definition: CapabilityDefinition;
  sourceDisposition: "deprecate" | "remove";
}

/** remove (#481, design §25): policy-controlled. A `deprecated` capability may
 *  remain in the catalog for historical/reference purposes. */
export interface CapabilityRemoveMutation {
  operation: "capability.remove";
  capabilityId: string;
  reason: string;
}

export type CapabilityMutation =
  | CapabilityCreateMutation
  | CapabilityUpdateMutation
  | CapabilityTransitionMutation
  | CapabilityConsolidateMutation
  | CapabilityRemoveMutation;

export const CAPABILITY_MUTATION_OPERATIONS: readonly CapabilityMutation["operation"][] = [
  "capability.create",
  "capability.update",
  "capability.transition",
  "capability.consolidate",
  "capability.remove",
];

// ---------------------------------------------------------------------------
// Update bump classification (#479/#480 — locked matrix, user ruling)
// ---------------------------------------------------------------------------

/**
 * Classify the SemVer bump an update publication earns by comparing the
 * governed SOURCE definition with the NEXT definition. Compares two canonical
 * definitions/publications and returns the minimum required bump; it does NOT
 * apply patches — the caller (CAP-6) applies the update's patch to `previous`
 * to produce `next`, then classifies.
 * MAJOR: argsSchema / resultSchema / requiredPermissions / any binding change
 * (type, id, or config — the effective serving provider is (type, id, config),
 * the canonical CAP-4 provider identity). MINOR: additive-only schema
 * property, aliases / tags / dependencies. PATCH: title, description,
 * examples, category, risk, extensions, allowFallbacks. id/version/kind are
 * immutable and never appear here. Semantic, not textual: an optional→required
 * property is MAJOR. Monotonic: any MAJOR-class change ⇒ MAJOR regardless of
 * simultaneous MINOR/PATCH changes. CAP-6's executor applies this; CAP-5 only
 * classifies.
 */
export function classifyUpdateBump(
  previous: CapabilityDefinition,
  next: CapabilityDefinition,
): "major" | "minor" | "patch" {
  let major = false;
  let minor = false;

  // MAJOR: requiredPermissions
  if (listChanged(previous.requiredPermissions, next.requiredPermissions)) major = true;

  // MAJOR/MINOR: argsSchema + resultSchema (semantic schema classifier)
  const args = classifySchemaChange(previous.argsSchema, next.argsSchema);
  const result = classifySchemaChange(previous.resultSchema, next.resultSchema);
  if (args === "major" || result === "major") major = true;
  if (args === "minor" || result === "minor") minor = true;

  // MAJOR: bindings (any difference changes the serving provider)
  const bindings = classifyBindingsChange(previous.bindings, next.bindings);
  if (bindings === "major") major = true;

  // MINOR: aliases / tags / dependencies
  if (listChanged(previous.aliases ?? [], next.aliases ?? [])) minor = true;
  if (listChanged(previous.tags, next.tags)) minor = true;
  if (listChanged(previous.dependencies, next.dependencies)) minor = true;

  // PATCH fields (title, description, examples, category, risk, extensions,
  // allowFallbacks) contribute nothing — any change here with no MAJOR/MINOR
  // change falls through to PATCH.

  if (major) return "major";
  if (minor) return "minor";
  return "patch";
}

/** Classify an argsSchema/resultSchema change. Semantic, conservative: name-set
 *  + `required`-array + shared-property declared `type`. Adding an optional
 *  property is MINOR; removing a property, making one required, or changing a
 *  shared property's declared type is MAJOR. Anything else that differs is
 *  MAJOR (fail-closed on ambiguity). */
export function classifySchemaChange(
  previous: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined,
): "major" | "minor" | "none" {
  // A schema field toggling present↔absent is a breaking contract change
  // (e.g. adding resultSchema where none existed, or dropping argsSchema).
  // Fail-closed on ambiguity — treat as MAJOR.
  if ((previous === undefined) !== (next === undefined)) return "major";
  const a = schemaShape(previous);
  const b = schemaShape(next);
  if (shapesEqual(a, b)) return "none";

  // removed property → MAJOR
  for (const key of a.props.keys()) {
    if (!b.props.has(key)) return "major";
  }
  // shared property type drift → MAJOR
  for (const [key, typeA] of a.props) {
    const typeB = b.props.get(key);
    if (typeB !== undefined && typeA !== typeB) return "major";
  }
  // property became required → MAJOR
  for (const key of b.props.keys()) {
    if (!a.required.has(key) && b.required.has(key)) return "major";
  }
  // added property that is required → MAJOR
  for (const key of b.props.keys()) {
    if (!a.props.has(key) && b.required.has(key)) return "major";
  }
  // only optional additions remain → MINOR
  return "minor";
}

/** MAJOR if the bindings differ in ANY way (ordered deep compare); NONE if the
 *  arrays are deeply identical. Per the canonical CAP-4 provider identity —
 *  (type, id, config) — any difference changes the serving provider, so there
 *  is NO MINOR binding case. Provider technology is `binding.type`. */
function classifyBindingsChange(
  previous: readonly { type: string; id: string; config?: Record<string, unknown> }[],
  next: readonly { type: string; id: string; config?: Record<string, unknown> }[],
): "major" | "none" {
  return deepEqual(previous, next) ? "none" : "major";
}

function listChanged(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return true;
  return false;
}

interface SchemaShape {
  props: Map<string, string>; // property name → declared type ("" when untyped)
  required: Set<string>;
}

function schemaShape(schema: Record<string, unknown> | undefined): SchemaShape {
  const props = new Map<string, string>();
  const properties = (schema?.properties ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(properties)) {
    const t = (v as Record<string, unknown>)?.type;
    props.set(k, typeof t === "string" ? t : "");
  }
  if (schema && Object.keys(properties).length === 0) {
    for (const k of Object.keys(schema)) {
      if (k !== "required" && k !== "type" && k !== "properties") props.set(k, "");
    }
  }
  const required = new Set<string>(Array.isArray(schema?.required) ? (schema.required as string[]) : []);
  return { props, required };
}

function shapesEqual(a: SchemaShape, b: SchemaShape): boolean {
  if (a.props.size !== b.props.size) return false;
  for (const [k, v] of a.props) if (b.props.get(k) !== v) return false;
  if (a.required.size !== b.required.size) return false;
  for (const r of a.required) if (!b.required.has(r)) return false;
  return true;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}
