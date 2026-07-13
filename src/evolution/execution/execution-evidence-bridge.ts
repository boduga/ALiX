// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A4.3 — Execution Evidence Bridge.
 *
 * Constructs EvolutionExecutionEvidence from a completed ExecutionReport,
 * ExecutionPlan, and environment. Computes deterministic integrity hashes
 * with SHA-256 over canonical JSON, excluding transient runtime metadata.
 *
 * The integrity hash covers all fields except:
 * - `integrityHash` itself (self-referencing)
 * - Transient runtime metadata (`runtimeMetadata`, `lastHeartbeat`)
 *
 * @module execution-evidence-bridge
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../security/audit/canonical-json.js";
import type {
  ExecutionPlan,
  ExecutionReport,
  ExecutionEnvironment,
  EvolutionExecutionEvidence,
} from "./contracts/execution-contract.js";
import type { GovernanceDecision } from "../governance/contracts/decision-contract.js";
import type { EvolutionProposal } from "../contracts/evolution-contract.js";
import type { LineageRecord } from "../verification/contracts/verification-contract.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVIDENCE_PREFIX = "alix-evolution-execution-v1:";
const DEFAULT_TTL_DAYS = 365;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Transient runtime metadata that MUST be excluded from integrity hash.
 * These fields may appear on evidence during transport but must not
 * invalidate the integrity hash when present or absent.
 */
const TRANSIENT_FIELDS = new Set(["runtimeMetadata", "lastHeartbeat"]);

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

/**
 * Input for building execution evidence from its constituent artifacts.
 */
export interface BuildEvidenceInput {
  /** The execution plan that was executed. */
  readonly executionPlan: ExecutionPlan;
  /** The execution report produced by the runtime. */
  readonly executionReport: ExecutionReport;
  /** The environment in which execution occurred. */
  readonly environment: ExecutionEnvironment;
  /** The governance decision that authorized execution. */
  readonly decision: GovernanceDecision;
  /** The evolution proposal that originated the execution. */
  readonly proposal: EvolutionProposal;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Construct an EvolutionExecutionEvidence from a completed execution.
 *
 * 1. Computes expiry as verifiedAt + 365 days.
 * 2. Builds the evidence skeleton without integrityHash.
 * 3. Computes integrity hash over canonical JSON of non-transient fields.
 * 4. Returns the complete evidence with integrityHash.
 *
 * @param input - Artifacts needed to construct evidence.
 * @returns Complete EvolutionExecutionEvidence with integrity hash.
 */
export function buildExecutionEvidence(
  input: BuildEvidenceInput,
): EvolutionExecutionEvidence {
  const expiresAt = computeExpiry();

  // Build evidence without integrity hash
  const evidenceWithoutHash: Omit<EvolutionExecutionEvidence, "integrityHash"> =
    {
      evidenceId: `eve-${createHash("sha256")
        .update(canonicalStringify(input.executionPlan))
        .digest("hex")
        .slice(0, 12)}`,
      evidenceClass: "executed",
      proposalId: input.executionPlan.proposalId,
      decisionId: input.executionPlan.decisionId,
      executionPlan: input.executionPlan,
      executionReport: input.executionReport,
      environment: input.environment,
      lineage: buildLineage(input),
      expiresAt,
    };

  // Compute integrity hash over the non-transient fields
  const integrityHash = computeExecutionEvidenceHash(evidenceWithoutHash);

  return { ...evidenceWithoutHash, integrityHash };
}

/**
 * Compute the deterministic integrity hash for execution evidence.
 *
 * The hash covers the canonical JSON serialization of all evidence fields
 * except `integrityHash` (self-referencing) and transient runtime metadata
 * (`runtimeMetadata`, `lastHeartbeat`).
 *
 * Hash formula: SHA-256("alix-evolution-execution-v1:" + canonicalJSON)
 *
 * @param evidence - Evidence without integrityHash.
 * @returns Hex-encoded SHA-256 digest.
 */
export function computeExecutionEvidenceHash(
  evidence: Omit<EvolutionExecutionEvidence, "integrityHash">,
): string {
  // Remove self-referencing integrityHash if present (cast needed for Omit)
  const { integrityHash: _omitted, ...rest } =
    evidence as EvolutionExecutionEvidence;
  void _omitted; // ensure unused variable is intentional

  // Strip transient runtime metadata
  const normalized = Object.fromEntries(
    Object.entries(rest).filter(([key]) => !TRANSIENT_FIELDS.has(key)),
  );

  const canonical = canonicalStringify(normalized);
  const hash = createHash("sha256");
  hash.update(`${EVIDENCE_PREFIX}${canonical}`);
  return hash.digest("hex");
}

/**
 * Build the provenance lineage for execution evidence.
 *
 * Constructs an ordered chain of LineageRecords linking the evidence
 * to its source artifacts: proposal, decision, plan, and report.
 *
 * @param input - Artifacts used to construct evidence.
 * @returns Ordered array of lineage records.
 */
export function buildLineage(input: BuildEvidenceInput): LineageRecord[] {
  return [
    {
      step: "evolution_proposal",
      sourceId: input.proposal.evolutionId,
      sourceType: "proposal",
      timestamp: "",
    },
    {
      step: "governance_decision",
      sourceId: input.decision.decisionId,
      sourceType: "proposal",
      timestamp: "",
    },
    {
      step: "execution_plan",
      sourceId: input.executionPlan.planId,
      sourceType: "run",
      timestamp: "",
    },
    {
      step: "execution_report",
      sourceId: input.executionReport.reportId,
      sourceType: "evaluation",
      timestamp: "",
    },
  ].filter((r) => r.sourceId) as LineageRecord[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute evidence expiry date as ISO 8601 string.
 *
 * Defaults to 365 days from now.
 */
function computeExpiry(ttlDays: number = DEFAULT_TTL_DAYS): string {
  return new Date(Date.now() + ttlDays * MS_PER_DAY).toISOString();
}
