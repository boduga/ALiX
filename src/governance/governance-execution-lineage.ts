/**
 * X3a.3 — Explicit Execution Lineage Binding.
 *
 * The only way governance candidates get linked to execution evidence.
 * Never infer — only explicit ExecutionLineageRef creates bindings.
 * Missing evidence is silently ignored (no binding produced).
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  type ExecutionRef,
  type ExecutionLineageRef,
} from "./governance-execution-types.js";

// ---------------------------------------------------------------------------
// ExecutionBinding
// ---------------------------------------------------------------------------

/**
 * A resolved binding between a governance candidate and its execution evidence.
 *
 * Produced exclusively by {@link bindExecutionEvidence}. Every binding represents
 * an explicit link — no inferred relationships.
 */
export interface ExecutionBinding {
  /** Unique identifier for the governance candidate. */
  readonly candidateId: string;
  /** The resolved execution evidence reference. */
  readonly executionRef: ExecutionRef;
}

// ---------------------------------------------------------------------------
// bindExecutionEvidence
// ---------------------------------------------------------------------------

/**
 * Resolve explicit lineage links into concrete execution bindings.
 *
 * For each link:
 * 1. Find matching evidence by `evidenceId`.
 * 2. Create a binding if found.
 * 3. Silently skip if no matching evidence exists.
 *
 * Pure function — same inputs always produce the same output.
 * No I/O, no side effects, no mutation.
 *
 * @param links   - Explicit lineage refs to resolve.
 * @param evidence - Available execution evidence refs.
 * @returns Resolved bindings (one per link with matching evidence).
 */
export function bindExecutionEvidence(
  links: readonly ExecutionLineageRef[],
  evidence: readonly ExecutionRef[],
): readonly ExecutionBinding[] {
  const bindings: ExecutionBinding[] = [];

  for (const link of links) {
    const ref = evidence.find((e) => e.evidenceId === link.evidenceId);
    if (ref === undefined) {
      // Missing evidence is silently ignored
      continue;
    }
    bindings.push({
      candidateId: link.candidateId,
      executionRef: ref,
    });
  }

  return bindings;
}
