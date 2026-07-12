// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A1.1 — Discovery Context Contract.
 *
 * Run-scoped context shared across all detection strategies in a single
 * discovery run. Created once by the PatternDiscoveryEngine, owned by the
 * engine, shared read-only by all strategies.
 *
 * @module discovery-context
 */

import type { ExecutionEvidence } from "../../runtime/contracts/execution-intent-contract.js";
import type { GovernanceAuditEvent } from "../../governance/audit-types.js";

/**
 * Immutable run-scoped context for a single pattern discovery run.
 *
 * Contains the evidence and governance audit events that detection
 * strategies inspect to identify patterns. Constructed by the
 * PatternDiscoveryEngine and passed to each DetectionStrategy.
 *
 * @invariant All fields are readonly — context must not be mutated
 *            during a discovery run.
 */
export interface DiscoveryContext {
  /** Execution evidence loaded from X3b. */
  readonly evidence: readonly ExecutionEvidence[];
  /** Governance audit events loaded from P14. */
  readonly governanceEvents: readonly GovernanceAuditEvent[];
}
