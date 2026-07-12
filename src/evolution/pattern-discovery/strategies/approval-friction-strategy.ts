// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A1.1 — ApprovalFrictionStrategy
 *
 * Detects patterns of governance approval friction by analyzing denied vs.
 * approved governance audit events. Emits patterns when the denial rate
 * exceeds a configured threshold within the lookback window.
 *
 * Pure detection — no store access, no side effects, I/O only through
 * the provided DiscoveryContext.
 *
 * @module approval-friction-strategy
 */

import type { DetectionStrategy } from "../detection-strategy.js";
import type { DiscoveryContext } from "../../contracts/discovery-context.js";
import type {
  PatternObservation,
  PatternCategory,
} from "../../contracts/pattern-discovery-contract.js";
import { computeConfidence } from "../../contracts/pattern-discovery-contract.js";
import type { GovernanceAuditEvent } from "../../../governance/audit-types.js";

// ---------------------------------------------------------------------------
// ApprovalFrictionConfig
// ---------------------------------------------------------------------------

export interface ApprovalFrictionConfig {
  /** Denial rate (0-1) above which a pattern is emitted. */
  denialRateThreshold: number;
  /** Minimum total decision events required to consider emitting a pattern. */
  minimumEvents: number;
  /** How far back (in days) to consider governance events. */
  lookbackWindowDays: number;
  /** Expected baseline count for confidence scaling. */
  baselineCount: number;
}

export const DEFAULT_APPROVAL_FRICTION_CONFIG: ApprovalFrictionConfig = {
  denialRateThreshold: 0.5,
  minimumEvents: 10,
  lookbackWindowDays: 30,
  baselineCount: 20,
};

// ---------------------------------------------------------------------------
// Event classification helpers
// ---------------------------------------------------------------------------

const DENIED_EVENT_TYPES = new Set<string>([
  "action_denied",
  "human_approval_denied",
]);

const APPROVED_EVENT_TYPES = new Set<string>([
  "action_allowed",
  "human_approval_granted",
]);

function isDeniedEvent(event: GovernanceAuditEvent): boolean {
  return DENIED_EVENT_TYPES.has(event.eventType);
}

function isApprovedEvent(event: GovernanceAuditEvent): boolean {
  return APPROVED_EVENT_TYPES.has(event.eventType);
}

// ---------------------------------------------------------------------------
// ApprovalFrictionStrategy
// ---------------------------------------------------------------------------

/**
 * Detection strategy that identifies approval friction patterns from
 * governance audit events.
 *
 * Algorithm:
 * 1. Filter governance events to denied/approved within the lookback window
 * 2. Count denied and approved events
 * 3. Require total decision events >= minimumEvents
 * 4. Calculate denial rate = denied / (denied + approved)
 * 5. Emit PatternObservation only if denialRate >= denialRateThreshold
 *
 * @invariant Stateless — no mutable state between runs.
 * @invariant No store access — receives all data through DiscoveryContext.
 */
export class ApprovalFrictionStrategy implements DetectionStrategy {
  readonly name = "ApprovalFrictionStrategy";
  readonly category: PatternCategory = "approval_friction";

  private readonly config: ApprovalFrictionConfig;

  constructor(config?: Partial<ApprovalFrictionConfig>) {
    this.config = { ...DEFAULT_APPROVAL_FRICTION_CONFIG, ...config };
  }

  /**
   * Run detection against the provided context.
   *
   * @param context - Run-scoped context with governance audit events.
   * @returns Discovered approval friction patterns.
   */
  async run(context: DiscoveryContext): Promise<readonly PatternObservation[]> {
    const now = Date.now();
    const windowMs = this.config.lookbackWindowDays * 24 * 60 * 60 * 1000;
    const cutoffMs = now - windowMs;

    // Step 1: Filter to decision events within the lookback window.
    // Only denied and approved events count toward the denominator.
    const decisionEvents = context.governanceEvents.filter((e) => {
      const eventMs = new Date(e.timestamp).getTime();
      if (eventMs < cutoffMs) return false;
      return isDeniedEvent(e) || isApprovedEvent(e);
    });

    // Step 3: Require minimum events before considering a pattern
    if (decisionEvents.length < this.config.minimumEvents) {
      return [];
    }

    // Step 2: Count denied vs approved
    const deniedEvents = decisionEvents.filter(isDeniedEvent);
    const approvedEvents = decisionEvents.filter(isApprovedEvent);
    const deniedCount = deniedEvents.length;
    const approvedCount = approvedEvents.length;

    // Guard: total cannot be zero since we checked minimumEvents
    const total = deniedCount + approvedCount;
    if (total === 0) return [];

    // Step 4: Calculate denial rate
    const denialRate = deniedCount / total;

    // Step 5: Emit pattern only if denial rate meets threshold
    if (denialRate < this.config.denialRateThreshold) {
      return [];
    }

    // Compute recency factor from the newest denied event
    const sorted = [...deniedEvents].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp),
    );
    const newest = sorted[sorted.length - 1];
    const newestAgeMs = now - new Date(newest.timestamp).getTime();
    const newestAgeDays = newestAgeMs / (24 * 60 * 60 * 1000);
    const recencyFactor = Math.max(
      0,
      1 - newestAgeDays / this.config.lookbackWindowDays,
    );

    const patternStrength = Math.min(1, denialRate / this.config.denialRateThreshold);

    const confidence = computeConfidence({
      evidenceCount: deniedCount,
      baselineCount: this.config.baselineCount,
      patternStrength,
      recencyFactor,
    });

    const pattern: PatternObservation = {
      patternId: `approval_friction:strategy`,
      category: "approval_friction",
      frequency: deniedCount,
      confidence,
      evidenceIds: deniedEvents.map((e) => e.eventId),
      description: `Detected ${deniedCount} denied governance action(s) out of ${total} total decisions (denial rate: ${(denialRate * 100).toFixed(1)}%)`,
      firstObserved: sorted[0].timestamp,
      lastObserved: newest.timestamp,
    };

    return [pattern];
  }
}
