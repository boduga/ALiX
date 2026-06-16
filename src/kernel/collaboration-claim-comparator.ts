/**
 * collaboration-claim-comparator.ts — Deterministic claim incompatibility classifier.
 *
 * Type-specific rules for boolean, enum/string, number, version, digest, and path claims.
 * Uncertain claims do not create deterministic conflicts.
 */

import type { FindingClaim, ClaimComparison, ClaimCompatibility, ConflictType } from "./collaboration-conflict-types.js";

export const COMPARATOR_VERSION = "1.0.0";

const NUMERIC_TOLERANCE = 0.01;

export class ClaimComparator {
  compare(left: FindingClaim, right: FindingClaim, leftId: string, rightId: string): ClaimComparison {
    const reasons: string[] = [];

    // Different subjects or predicates are different scopes
    if (left.normalizedSubject !== right.normalizedSubject || left.normalizedPredicate !== right.normalizedPredicate) {
      return { leftFindingId: leftId, rightFindingId: rightId, compatibility: "different_scope", reasons: ["different subject/predicate"], comparatorVersion: COMPARATOR_VERSION };
    }

    // Same value → compatible
    if (left.normalizedValue === right.normalizedValue) {
      return { leftFindingId: leftId, rightFindingId: rightId, compatibility: "compatible", reasons: ["same value"], comparatorVersion: COMPARATOR_VERSION };
    }

    // Boolean: true vs false → contradiction
    if (left.valueType === "boolean" && right.valueType === "boolean") {
      return { leftFindingId: leftId, rightFindingId: rightId, compatibility: "incompatible", type: "contradiction", reasons: ["boolean contradiction"], comparatorVersion: COMPARATOR_VERSION };
    }

    // Enum/string decisions
    if (left.valueType === "enum" || right.valueType === "enum" || (left.valueType === "string" && right.valueType === "string")) {
      if (left.scope === right.scope || (!left.scope && !right.scope)) {
        return { leftFindingId: leftId, rightFindingId: rightId, compatibility: "incompatible", type: "competing_decision", reasons: ["competing decisions"], comparatorVersion: COMPARATOR_VERSION };
      }
      return { leftFindingId: leftId, rightFindingId: rightId, compatibility: "different_scope", reasons: ["different scope"], comparatorVersion: COMPARATOR_VERSION };
    }

    // Number: require same unit, check tolerance
    if (left.valueType === "number" && right.valueType === "number") {
      if (left.unit !== right.unit) {
        return { leftFindingId: leftId, rightFindingId: rightId, compatibility: "different_scope", reasons: ["different units"], comparatorVersion: COMPARATOR_VERSION };
      }
      const diff = Math.abs(parseFloat(left.normalizedValue) - parseFloat(right.normalizedValue));
      if (diff <= NUMERIC_TOLERANCE) {
        return { leftFindingId: leftId, rightFindingId: rightId, compatibility: "compatible", reasons: [`within tolerance (diff=${diff.toFixed(4)})`], comparatorVersion: COMPARATOR_VERSION };
      }
      return { leftFindingId: leftId, rightFindingId: rightId, compatibility: "incompatible", type: "contradiction", reasons: [`numeric difference ${diff} exceeds tolerance`], comparatorVersion: COMPARATOR_VERSION };
    }

    // Version: different versions not automatically contradictory
    if (left.valueType === "version" && right.valueType === "version") {
      if (left.scope !== right.scope) {
        return { leftFindingId: leftId, rightFindingId: rightId, compatibility: "different_scope", reasons: ["different scope versions"], comparatorVersion: COMPARATOR_VERSION };
      }
      return { leftFindingId: leftId, rightFindingId: rightId, compatibility: "uncertain", reasons: ["version difference — may represent progression"], comparatorVersion: COMPARATOR_VERSION };
    }

    // Digest: different digest for same subject → artifact_mismatch
    if (left.valueType === "digest" && right.valueType === "digest") {
      return { leftFindingId: leftId, rightFindingId: rightId, compatibility: "incompatible", type: "artifact_mismatch", reasons: ["different digests"], comparatorVersion: COMPARATOR_VERSION };
    }

    return { leftFindingId: leftId, rightFindingId: rightId, compatibility: "uncertain", reasons: ["cannot determine compatibility"], comparatorVersion: COMPARATOR_VERSION };
  }
}
