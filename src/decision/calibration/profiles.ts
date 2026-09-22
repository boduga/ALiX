/**
 * profiles.ts — Versioned threshold profiles + promotion/rollback (J4 tasks 29-30).
 *
 * A profile is the (decision, engine, risk) → threshold binding the consumer
 * applies. Profiles are:
 *
 *  - **versioned**: a new value is a new id (e.g. `…/v2`), never an in-place edit;
 *  - **engine-specific**: JEV-9 forbids transferring a profile across engines;
 *  - **optionally risk-scoped**: a risk-specific profile wins over the
 *    all-risk one, and an absent risk scope never silently picks a risk-specific
 *    profile;
 *  - **promotion-gated on provenance**: an uncalibrated profile cannot be
 *    promoted, so "thresholds have empirical provenance" is enforced by the
 *    mechanism rather than by review.
 */

import { isRiskContext, type DecisionType, type RiskContext } from "../contracts.js";
import { readJsonFileSync, writeJsonFileAtomicSync } from "../../storage/jsonl-store.js";
import type { ReliabilityReport } from "./reliability.js";

export const PROFILE_STATUSES = ["shadow", "active", "retired"] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

export function isProfileStatus(value: unknown): value is ProfileStatus {
  return (PROFILE_STATUSES as readonly unknown[]).includes(value);
}

export const PROVENANCE_METRICS = ["accuracy", "expectedCalibrationError", "brierScore"] as const;
export type ProvenanceMetric = (typeof PROVENANCE_METRICS)[number];

export function isProvenanceMetric(value: unknown): value is ProvenanceMetric {
  return (PROVENANCE_METRICS as readonly unknown[]).includes(value);
}

/**
 * Why a profile's value is believed. Mirrors the repo's existing learned
 * threshold shape (`src/config/calibration-store.ts`): value + sample size +
 * when it was last computed.
 */
export type CalibrationProvenance = {
  /** Id/hash of the calibration dataset the threshold was derived from. */
  datasetId: string;
  sampleCount: number;
  metric: ProvenanceMetric;
  /** Observed value of `metric` for this threshold. */
  value: number;
  computedAt: number;
};

export type ThresholdProfile = {
  id: string;
  decision: DecisionType;
  engineId: string;
  /** Absent = applies to every risk context. */
  risk?: RiskContext;
  threshold: number;
  status: ProfileStatus;
  /** Present once calibrated; required before promotion. */
  provenance?: CalibrationProvenance;
  promotedAt?: number;
  retiredAt?: number;
};

export type ProfileRegistry = {
  profiles: readonly ThresholdProfile[];
};

export class ProfileValidationError extends Error {
  readonly code = "PROFILE_VALIDATION";
  constructor(message: string) {
    super(message);
    this.name = "ProfileValidationError";
  }
}

function throwIfInvalid(condition: boolean, message: string): void {
  if (condition) throw new ProfileValidationError(message);
}

/** Pure builder + validator for provenance. */
export function createCalibrationProvenance(input: {
  datasetId: string;
  sampleCount: number;
  metric: ProvenanceMetric;
  value: number;
  computedAt?: number;
}): CalibrationProvenance {
  throwIfInvalid(typeof input.datasetId !== "string" || input.datasetId.length === 0, "datasetId required");
  throwIfInvalid(
    !Number.isInteger(input.sampleCount) || input.sampleCount <= 0,
    "sampleCount must be a positive integer",
  );
  throwIfInvalid(!isProvenanceMetric(input.metric), `unknown metric: ${String(input.metric)}`);
  throwIfInvalid(!Number.isFinite(input.value), "value must be finite");
  const computedAt = input.computedAt ?? Date.now();
  throwIfInvalid(!Number.isFinite(computedAt), "computedAt must be finite");
  return {
    datasetId: input.datasetId,
    sampleCount: input.sampleCount,
    metric: input.metric,
    value: input.value,
    computedAt,
  };
}

/** Overall accuracy from a reliability report's bins (weighted by count). */
export function reportAccuracy(report: ReliabilityReport): number {
  if (report.sampleCount === 0) return 0;
  return (
    report.bins.reduce((sum, bin) => sum + bin.count * bin.accuracy, 0) / report.sampleCount
  );
}

/** Derive provenance from a reliability report — the J4 calibration → threshold link. */
export function provenanceFromReliability(
  report: ReliabilityReport,
  input: { datasetId: string; metric: ProvenanceMetric; computedAt?: number },
): CalibrationProvenance {
  const value =
    input.metric === "accuracy"
      ? reportAccuracy(report)
      : input.metric === "expectedCalibrationError"
        ? report.expectedCalibrationError
        : report.brierScore;
  return createCalibrationProvenance({
    datasetId: input.datasetId,
    sampleCount: report.sampleCount,
    metric: input.metric,
    value,
    ...(input.computedAt !== undefined ? { computedAt: input.computedAt } : {}),
  });
}

export function isThresholdProfile(value: unknown): value is ThresholdProfile {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    v.id.length > 0 &&
    typeof v.decision === "string" &&
    v.decision.length > 0 &&
    typeof v.engineId === "string" &&
    v.engineId.length > 0 &&
    (v.risk === undefined || isRiskContext(v.risk)) &&
    typeof v.threshold === "number" &&
    Number.isFinite(v.threshold) &&
    isProfileStatus(v.status) &&
    (v.provenance === undefined || typeof v.provenance === "object")
  );
}

/** Structural check used by the loader; stricter than `isThresholdProfile`. */
function assertValidProfile(profile: ThresholdProfile): void {
  throwIfInvalid(
    !isThresholdProfile(profile),
    `invalid profile: ${JSON.stringify(profile)}`,
  );
  throwIfInvalid(
    profile.threshold < 0 || profile.threshold > 1,
    `threshold outside 0..1: ${String(profile.threshold)}`,
  );
  if (profile.provenance !== undefined) {
    createCalibrationProvenance(profile.provenance);
  }
  throwIfInvalid(
    profile.status === "active" && profile.provenance === undefined,
    `active profile ${profile.id} has no provenance (thresholds require empirical provenance)`,
  );
}

export function createProfileRegistry(seed: readonly ThresholdProfile[] = []): ProfileRegistry {
  const ids = new Set<string>();
  for (const profile of seed) {
    assertValidProfile(profile);
    throwIfInvalid(ids.has(profile.id), `duplicate profile id: ${profile.id}`);
    ids.add(profile.id);
  }
  return { profiles: [...seed] };
}

export function profileById(registry: ProfileRegistry, id: string): ThresholdProfile | undefined {
  return registry.profiles.find((profile) => profile.id === id);
}

export type ProfileScope = {
  decision: DecisionType;
  engineId: string;
  risk?: RiskContext;
};

/** Exact scope identity: same decision, engine, and risk (including absent). */
function sameScope(profile: ThresholdProfile, scope: ProfileScope): boolean {
  return (
    profile.decision === scope.decision &&
    profile.engineId === scope.engineId &&
    profile.risk === scope.risk
  );
}

/**
 * Whether a profile may apply to a scope. An all-risk profile (no `risk`)
 * covers every risk context; a risk-specific profile covers only its own.
 */
function coversScope(profile: ThresholdProfile, scope: ProfileScope): boolean {
  return (
    profile.decision === scope.decision &&
    profile.engineId === scope.engineId &&
    (profile.risk === undefined || profile.risk === scope.risk)
  );
}

/**
 * The profile the consumer should apply. A risk-scoped profile wins over the
 * all-risk one; an all-risk profile covers every risk context; and a
 * risk-specific profile is never applied to a different (or absent) risk.
 */
export function activeProfile(
  registry: ProfileRegistry,
  scope: ProfileScope,
): ThresholdProfile | undefined {
  const candidates = registry.profiles.filter(
    (profile) => profile.status === "active" && coversScope(profile, scope),
  );
  return (
    candidates.find((profile) => profile.risk === scope.risk) ??
    candidates.find((profile) => profile.risk === undefined)
  );
}

export function activeProfilesForEngine(
  registry: ProfileRegistry,
  decision: DecisionType,
  engineId: string,
): ThresholdProfile[] {
  return registry.profiles.filter(
    (profile) =>
      profile.status === "active" &&
      profile.decision === decision &&
      profile.engineId === engineId,
  );
}

/**
 * Promote a profile to active for its scope. Fails closed when the profile is
 * unknown, already active, or has no provenance.
 */
export function promoteProfile(
  registry: ProfileRegistry,
  id: string,
  opts?: { now?: number },
): ProfileRegistry {
  const target = profileById(registry, id);
  throwIfInvalid(target === undefined, `unknown profile: ${id}`);
  const profile = target as ThresholdProfile;
  throwIfInvalid(
    profile.provenance === undefined,
    `cannot promote ${id}: no calibration provenance (thresholds require empirical evidence)`,
  );
  throwIfInvalid(profile.status === "active", `${id} is already active`);

  const now = opts?.now ?? Date.now();
  const scope: ProfileScope = {
    decision: profile.decision,
    engineId: profile.engineId,
    ...(profile.risk !== undefined ? { risk: profile.risk } : {}),
  };
  // Retire the incumbent of the SAME exact scope; a risk-specific promotion
  // must not disable the all-risk profile for other risk contexts.
  const previous = registry.profiles.find(
    (entry) => entry.status === "active" && sameScope(entry, scope),
  );

  return {
    profiles: registry.profiles.map((entry) => {
      if (entry.id === profile.id) {
        return { ...entry, status: "active" as const, promotedAt: now, retiredAt: undefined };
      }
      if (previous !== undefined && entry.id === previous.id) {
        return { ...entry, status: "retired" as const, retiredAt: now };
      }
      return entry;
    }),
  };
}

/**
 * Roll back to the most recently retired profile for the scope. Fails closed
 * when nothing is active or there is nothing to restore.
 */
export function rollbackProfile(
  registry: ProfileRegistry,
  scope: ProfileScope,
  opts?: { now?: number },
): ProfileRegistry {
  const current = registry.profiles.find(
    (profile) => profile.status === "active" && sameScope(profile, scope),
  );
  throwIfInvalid(current === undefined, "no active profile to roll back");

  const retired = registry.profiles
    .filter((profile) => profile.status === "retired" && sameScope(profile, scope))
    .sort((a, b) => (b.retiredAt ?? 0) - (a.retiredAt ?? 0));
  throwIfInvalid(retired.length === 0, "no retired profile to restore");

  const restore = retired[0];
  const now = opts?.now ?? Date.now();
  return {
    profiles: registry.profiles.map((entry) => {
      if (entry.id === restore.id) {
        return { ...entry, status: "active" as const, promotedAt: now, retiredAt: undefined };
      }
      if (entry.id === (current as ThresholdProfile).id) {
        return { ...entry, status: "retired" as const, retiredAt: now };
      }
      return entry;
    }),
  };
}

/** Persist the registry atomically (JSON, 0o600 via the storage primitive). */
export function saveProfileRegistry(path: string, registry: ProfileRegistry): void {
  for (const profile of registry.profiles) assertValidProfile(profile);
  writeJsonFileAtomicSync(path, registry);
}

/** Load the registry; a missing file is an empty registry, a bad one throws. */
export function loadProfileRegistry(path: string): ProfileRegistry {
  const raw = readJsonFileSync<ProfileRegistry>(path);
  if (raw === null) return { profiles: [] };
  throwIfInvalid(!Array.isArray(raw.profiles), "profile registry must contain a profiles array");
  return createProfileRegistry(raw.profiles);
}
