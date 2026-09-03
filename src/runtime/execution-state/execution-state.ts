// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * Phase 1 — ExecutionState Contract (patch-only)
 *
 * Bounded decision-state projection. EventLog remains authoritative;
 * ExecutionState is a derived, harness-validated view used for the next
 * governed decision.
 *
 * Spec source: docs/ALiX-ExecutionState-Architecture.md §6-10, §32-33, §41.
 * Resolution: issue #617 (8-field minimal), #618 (schemaVersion vs version).
 *
 * Invariants (from arch doc §41, §7-10):
 *  - EventLog immutable — state never rewrites history.
 *  - Runtime owns schema — only permitted keys accepted.
 *  - Patch-only mutation — model never replaces whole state.
 *  - Version correctness — stale baseStateVersion rejected.
 *  - Explicit deletion — null = delete, omission = preserve.
 *
 * @module execution-state
 */

// ─── Schema version ───────────────────────────────────────────────

/**
 * Current ExecutionState schema version.
 *
 * Bumped only when the permitted field set or field semantics change.
 * Distinct from ExecutionState.version (per-execution monotonic counter).
 */
export const EXECUTION_STATE_SCHEMA_VERSION = "1.0.0" as const;

// ─── Status ───────────────────────────────────────────────────────

export type ExecutionStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export const EXECUTION_STATUSES: readonly ExecutionStatus[] = [
  "pending",
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "cancelled",
] as const;

// ─── Sub-types ────────────────────────────────────────────────────

export type ExecutionIntentReference = Readonly<{
  intentId: string;
  proposalId?: string;
}>;

export type PendingAction = Readonly<{
  actionId: string;
  kind: string;
  description?: string;
}>;

export type ActiveCapabilityReference = Readonly<{
  capabilityId: string;
  version: string;
  availability: "available" | "unavailable" | "degraded";
}>;

export type ExecutionConstraint = Readonly<{
  kind: string;
  value: string;
}>;

export type ArtifactReference = Readonly<{
  artifactId: string;
  uri: string;
  kind?: string;
}>;

// ─── ExecutionState ───────────────────────────────────────────────

/**
 * 8-field minimal (+ refs) bounded decision state.
 *
 * Locked per #617 resolution — fields outside this set must not appear.
 * Four buckets: decision state (objective/status/intent/pending/
 * activeCapabilities/constraints/artifacts), runtime control
 * (executionId/schemaVersion/version/step). Evidence & history are out
 * (EventLog / Evidence, latest observation transient O).
 */
export type ExecutionState = Readonly<{
  executionId: string;
  /** Schema generation — distinct from per-execution version. */
  schemaVersion: string;
  /** Monotonically increasing per-execution counter. */
  version: number;
  /** Step index within execution. */
  step: number;
  /** Decision objective — non-empty string. */
  objective: string;
  status: ExecutionStatus;
  intent: ExecutionIntentReference;
  pendingActions: readonly PendingAction[];
  activeCapabilities: readonly ActiveCapabilityReference[];
  constraints: readonly ExecutionConstraint[];
  artifacts: readonly ArtifactReference[];
}>;

// ─── Allowed / patchable keys ─────────────────────────────────────

export const EXECUTION_STATE_ALLOWED_KEYS = [
  "executionId",
  "schemaVersion",
  "version",
  "step",
  "objective",
  "status",
  "intent",
  "pendingActions",
  "activeCapabilities",
  "constraints",
  "artifacts",
] as const;

export type ExecutionStateKey = (typeof EXECUTION_STATE_ALLOWED_KEYS)[number];

/**
 * Keys the model is permitted to propose via StatePatch.
 * Runtime-owned keys (executionId, schemaVersion, version) are never
 * patchable; step is harness-controlled and likewise excluded from POC
 * patch surface. Only decision fields are patchable.
 */
export const EXECUTION_STATE_PATCHABLE_KEYS = [
  "objective",
  "status",
  "intent",
  "pendingActions",
  "activeCapabilities",
  "constraints",
  "artifacts",
] as const;

export type PatchableKey = (typeof EXECUTION_STATE_PATCHABLE_KEYS)[number];

// ─── StatePatch ───────────────────────────────────────────────────

/**
 * Patch-only proposal. Omission = preserve, explicit null = delete.
 * Runtime merges: Σ(next) = Σ(current) ⊕ ΔΣ
 */
export type StatePatch = Readonly<{
  objective?: string | null;
  status?: ExecutionStatus | null;
  intent?: ExecutionIntentReference | null;
  pendingActions?: readonly PendingAction[] | null;
  activeCapabilities?: readonly ActiveCapabilityReference[] | null;
  constraints?: readonly ExecutionConstraint[] | null;
  artifacts?: readonly ArtifactReference[] | null;
}>;

// ─── Validation result ────────────────────────────────────────────

export type ValidationResult =
  | { readonly valid: true; readonly errors: readonly [] }
  | { readonly valid: false; readonly errors: readonly string[] };

// ─── Helpers ──────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

function error(msg: string): string {
  return msg;
}

// ─── Field validators ─────────────────────────────────────────────

function validateIntentReference(v: unknown, path: string): string[] {
  if (!isRecord(v)) return [error(`${path} must be an object`)];
  const errs: string[] = [];
  if (!isNonEmptyString(v.intentId)) errs.push(error(`${path}.intentId must be a non-empty string`));
  if (v.proposalId !== undefined && typeof v.proposalId !== "string") {
    errs.push(error(`${path}.proposalId must be a string if present`));
  }
  const allowed = new Set(["intentId", "proposalId"]);
  for (const k of Object.keys(v)) {
    if (!allowed.has(k)) errs.push(error(`${path} has unknown key "${k}"`));
  }
  return errs;
}

function validatePendingAction(v: unknown, path: string): string[] {
  if (!isRecord(v)) return [error(`${path} must be an object`)];
  const errs: string[] = [];
  if (!isNonEmptyString(v.actionId)) errs.push(error(`${path}.actionId must be a non-empty string`));
  if (!isNonEmptyString(v.kind)) errs.push(error(`${path}.kind must be a non-empty string`));
  if (v.description !== undefined && typeof v.description !== "string") {
    errs.push(error(`${path}.description must be a string if present`));
  }
  const allowed = new Set(["actionId", "kind", "description"]);
  for (const k of ObjectKeys(v)) if (!allowed.has(k)) errs.push(error(`${path} has unknown key "${k}"`));
  return errs;
}

function ObjectKeys(o: Record<string, unknown>): string[] {
  return Object.keys(o);
}

function validateActiveCapability(v: unknown, path: string): string[] {
  if (!isRecord(v)) return [error(`${path} must be an object`)];
  const errs: string[] = [];
  if (!isNonEmptyString(v.capabilityId)) errs.push(error(`${path}.capabilityId must be a non-empty string`));
  if (!isNonEmptyString(v.version)) errs.push(error(`${path}.version must be a non-empty string`));
  if (v.availability !== "available" && v.availability !== "unavailable" && v.availability !== "degraded") {
    errs.push(error(`${path}.availability must be one of available|unavailable|degraded`));
  }
  const allowed = new Set(["capabilityId", "version", "availability"]);
  for (const k of ObjectKeys(v)) if (!allowed.has(k)) errs.push(error(`${path} has unknown key "${k}"`));
  return errs;
}

function validateConstraint(v: unknown, path: string): string[] {
  if (!isRecord(v)) return [error(`${path} must be an object`)];
  const errs: string[] = [];
  if (!isNonEmptyString(v.kind)) errs.push(error(`${path}.kind must be a non-empty string`));
  if (!isNonEmptyString(v.value)) errs.push(error(`${path}.value must be a non-empty string`));
  const allowed = new Set(["kind", "value"]);
  for (const k of ObjectKeys(v)) if (!allowed.has(k)) errs.push(error(`${path} has unknown key "${k}"`));
  return errs;
}

function validateArtifactRef(v: unknown, path: string): string[] {
  if (!isRecord(v)) return [error(`${path} must be an object`)];
  const errs: string[] = [];
  if (!isNonEmptyString(v.artifactId)) errs.push(error(`${path}.artifactId must be a non-empty string`));
  if (!isNonEmptyString(v.uri)) errs.push(error(`${path}.uri must be a non-empty string`));
  if (v.kind !== undefined && typeof v.kind !== "string") errs.push(error(`${path}.kind must be a string if present`));
  const allowed = new Set(["artifactId", "uri", "kind"]);
  for (const k of ObjectKeys(v)) if (!allowed.has(k)) errs.push(error(`${path} has unknown key "${k}"`));
  return errs;
}

// ─── ExecutionState validation ────────────────────────────────────

/**
 * Validate a candidate ExecutionState. Rejects arbitrary keys (no index
 * signature) and enforces required-field types. Does not mutate input.
 */
export function validateExecutionState(input: unknown): ValidationResult {
  if (!isRecord(input)) return { valid: false, errors: [error("ExecutionState must be an object")] };
  const errs: string[] = [];

  const allowed = new Set<string>(EXECUTION_STATE_ALLOWED_KEYS as unknown as string[]);
  for (const k of Object.keys(input)) {
    if (!allowed.has(k)) errs.push(error(`unknown key "${k}" — arbitrary keys not permitted`));
  }

  if (!isNonEmptyString(input.executionId)) errs.push(error("executionId must be a non-empty string"));
  if (!isNonEmptyString(input.schemaVersion)) errs.push(error("schemaVersion must be a non-empty string"));
  if (typeof input.version !== "number" || !Number.isInteger(input.version) || input.version < 0) {
    errs.push(error("version must be a non-negative integer"));
  }
  if (typeof input.step !== "number" || !Number.isInteger(input.step) || input.step < 0) {
    errs.push(error("step must be a non-negative integer"));
  }
  if (!isNonEmptyString(input.objective)) errs.push(error("objective must be a non-empty string"));
  if (typeof input.status !== "string" || !(EXECUTION_STATUSES as readonly string[]).includes(input.status)) {
    errs.push(error(`status must be one of ${EXECUTION_STATUSES.join("|")}`));
  }

  if (input.intent === undefined) {
    errs.push(error("intent is required"));
  } else {
    errs.push(...validateIntentReference(input.intent, "intent"));
  }

  for (const [field, validator] of [
    ["pendingActions", validatePendingAction],
    ["activeCapabilities", validateActiveCapability],
    ["constraints", validateConstraint],
    ["artifacts", validateArtifactRef],
  ] as const) {
    const val = (input as Record<string, unknown>)[field];
    if (!Array.isArray(val)) {
      errs.push(error(`${field} must be an array`));
    } else {
      val.forEach((item: unknown, i: number) => {
        errs.push(...validator(item, `${field}[${i}]`));
      });
    }
  }

  return errs.length === 0 ? { valid: true, errors: [] } : { valid: false, errors: errs };
}

// ─── StatePatch validation ────────────────────────────────────────

/**
 * Validate a StatePatch. Enforces patch-only semantics:
 *  - only patchable keys allowed (no arbitrary keys, no runtime-owned keys)
 *  - omission = preserve (no error), null = explicit delete
 *  - non-null values type-checked per field
 */
export function validateStatePatch(input: unknown): ValidationResult {
  if (!isRecord(input)) return { valid: false, errors: [error("StatePatch must be an object")] };
  const errs: string[] = [];

  const patchable = new Set<string>(EXECUTION_STATE_PATCHABLE_KEYS as unknown as string[]);
  const allowed = new Set<string>(EXECUTION_STATE_ALLOWED_KEYS as unknown as string[]);

  for (const k of Object.keys(input)) {
    if (!patchable.has(k)) {
      if (allowed.has(k)) {
        errs.push(error(`key "${k}" is runtime-owned and not patchable`));
      } else {
        errs.push(error(`unknown key "${k}" — arbitrary keys not permitted`));
      }
    }
  }

  const v = input as Record<string, unknown>;

  if ("objective" in v) {
    const val = v.objective;
    if (val !== null && !isNonEmptyString(val)) errs.push(error("objective must be a non-empty string or null"));
  }
  if ("status" in v) {
    const val = v.status;
    if (val !== null && (typeof val !== "string" || !(EXECUTION_STATUSES as readonly string[]).includes(val))) {
      errs.push(error(`status must be one of ${EXECUTION_STATUSES.join("|")} or null`));
    }
  }
  if ("intent" in v) {
    const val = v.intent;
    if (val !== null) errs.push(...validateIntentReference(val, "intent"));
  }
  if ("pendingActions" in v) {
    const val = v.pendingActions;
    if (val !== null) {
      if (!Array.isArray(val)) errs.push(error("pendingActions must be an array or null"));
      else val.forEach((item: unknown, i: number) => errs.push(...validatePendingAction(item, `pendingActions[${i}]`)));
    }
  }
  if ("activeCapabilities" in v) {
    const val = v.activeCapabilities;
    if (val !== null) {
      if (!Array.isArray(val)) errs.push(error("activeCapabilities must be an array or null"));
      else val.forEach((item: unknown, i: number) => errs.push(...validateActiveCapability(item, `activeCapabilities[${i}]`)));
    }
  }
  if ("constraints" in v) {
    const val = v.constraints;
    if (val !== null) {
      if (!Array.isArray(val)) errs.push(error("constraints must be an array or null"));
      else val.forEach((item: unknown, i: number) => errs.push(...validateConstraint(item, `constraints[${i}]`)));
    }
  }
  if ("artifacts" in v) {
    const val = v.artifacts;
    if (val !== null) {
      if (!Array.isArray(val)) errs.push(error("artifacts must be an array or null"));
      else val.forEach((item: unknown, i: number) => errs.push(...validateArtifactRef(item, `artifacts[${i}]`)));
    }
  }

  return errs.length === 0 ? { valid: true, errors: [] } : { valid: false, errors: errs };
}

// ─── Patch application ────────────────────────────────────────────

/**
 * Apply a validated patch to a state snapshot with patch-only semantics:
 *  - omission = preserve
 *  - null = delete (field removed; for required fields caller must ensure
 *    resulting state remains valid — this helper does not fabricate defaults)
 *  - non-null = replace
 *
 * Does not mutate inputs; does not bump version/step (harness owns
 * versioning). Throws if patch fails validation.
 *
 * Note: for required fields (objective/status) a null delete will produce
 * an invalid ExecutionState — validate the result with validateExecutionState
 * before persisting.
 */
export function applyStatePatch(state: ExecutionState, patch: StatePatch): ExecutionState {
  const pv = validateStatePatch(patch);
  if (!pv.valid) throw new Error(`Invalid StatePatch: ${pv.errors.join("; ")}`);

  const sv = validateExecutionState(state);
  if (!sv.valid) throw new Error(`Invalid base ExecutionState: ${sv.errors.join("; ")}`);

  // Shallow merge — omission preserved via spread, null deletes.
  const merged: Record<string, unknown> = { ...state };

  for (const key of EXECUTION_STATE_PATCHABLE_KEYS) {
    if (!(key in patch)) continue;
    const val = (patch as Record<string, unknown>)[key];
    if (val === null) {
      // Explicit delete — remove key. For ExecutionState this yields a
      // missing required field; caller must handle/validate before persist.
      delete merged[key];
    } else {
      merged[key] = val;
    }
  }

  return merged as ExecutionState;
}

// ─── Version helpers ──────────────────────────────────────────────

/**
 * Returns true if schemaVersion matches the current contract version.
 */
export function isCurrentSchemaVersion(v: string): boolean {
  return v === EXECUTION_STATE_SCHEMA_VERSION;
}
