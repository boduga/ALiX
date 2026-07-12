// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A1.3 — GovernanceGapStrategy
 *
 * Detects governance gaps by analyzing escalation patterns in governance
 * audit events. Tracks actions that were escalated but never received a
 * resolution decision (allowed or denied). Emits a pattern when the
 * number of unresolved escalations exceeds the configured threshold.
 *
 * Pure detection — no store access, no side effects, I/O only through
 * the provided DiscoveryContext.
 *
 * @module governance-gap-strategy
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
// GovernanceGapConfig
// ---------------------------------------------------------------------------

export interface GovernanceGapConfig {
  /** Minimum unresolved escalations required to emit a pattern. */
  minimumUnresolved: number;
  /** How far back (in days) to consider governance events. */
  lookbackWindowDays: number;
  /** Expected baseline count for confidence scaling. */
  baselineCount: number;
  /** Whether to also count escalations resolved only by override as "unresolved". */
  treatOverrideAsUnresolved: boolean;
}

export const DEFAULT_GOVERNANCE_GAP_CONFIG: GovernanceGapConfig = {
  minimumUnresolved: 3,
  lookbackWindowDays: 30,
  baselineCount: 10,
  treatOverrideAsUnresolved: true,
};

// ---------------------------------------------------------------------------
// Escalation classification helpers
// ---------------------------------------------------------------------------

const ESCALATION_EVENT_TYPES = new Set<string>([
  "action_escalated",
]);

const RESOLUTION_EVENT_TYPES = new Set<string>([
  "action_allowed",
  "action_denied",
]);

/**
 * Check if an event represents an escalation.
 */
function isEscalationEvent(event: GovernanceAuditEvent): boolean {
  return ESCALATION_EVENT_TYPES.has(event.eventType) || event.decision === "escalated";
}

/**
 * Check if an event represents a resolution decision.
 */
function isResolutionEvent(event: GovernanceAuditEvent): boolean {
  return RESOLUTION_EVENT_TYPES.has(event.eventType);
}

/**
 * Build a correlation key for matching escalations to resolutions.
 *
 * Uses subjectType + subjectId when available, falling back to actorId + action.
 */
function correlationKey(event: GovernanceAuditEvent): string {
  if (event.subjectId) {
    return `${event.subjectType}:${event.subjectId}`;
  }
  return `${event.actorType}:${event.actorId}:${event.action}`;
}

// ---------------------------------------------------------------------------
// GovernanceGapStrategy
// ---------------------------------------------------------------------------

/**
 * Detection strategy that identifies governance gaps by tracking
 * unresolved escalation events.
 *
 * Algorithm:
 * 1. Filter events within the lookback window
 * 2. Identify escalation events (action_escalated or decision === "escalated")
 * 3. For each escalation, check if a corresponding resolution (allowed/denied)
 *    exists with a later timestamp
 * 4. Optionally treat overrides as unresolved (configurable)
 * 5. Count unresolved escalations
 * 6. Emit PatternObservation only if unresolved >= minimumUnresolved
 *
 * @invariant Stateless — no mutable state between runs.
 * @invariant No store access — receives all data through DiscoveryContext.
 */
export class GovernanceGapStrategy implements DetectionStrategy {
  readonly name = "GovernanceGapStrategy";
  readonly category: PatternCategory = "governance_gap";

  private readonly config: GovernanceGapConfig;

  constructor(config?: Partial<GovernanceGapConfig>) {
    this.config = { ...DEFAULT_GOVERNANCE_GAP_CONFIG, ...config };
  }

  /**
   * Run detection against the provided context.
   *
   * @param context - Run-scoped context with governance audit events.
   * @returns Discovered governance gap patterns.
   */
  async run(context: DiscoveryContext): Promise<readonly PatternObservation[]> {
    const now = Date.now();
    const windowMs = this.config.lookbackWindowDays * 24 * 60 * 60 * 1000;
    const cutoffMs = now - windowMs;

    // Step 1: Filter events within lookback window, sorted chronologically
    const windowedEvents = context.governanceEvents
      .filter((e) => {
        const eventMs = new Date(e.timestamp).getTime();
        return eventMs >= cutoffMs;
      })
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    if (windowedEvents.length === 0) return [];

    // Step 2: Identify escalation events and resolution events
    const escalations: GovernanceAuditEvent[] = [];
    const resolutions = new Map<string, GovernanceAuditEvent>();

    for (const event of windowedEvents) {
      if (isEscalationEvent(event)) {
        escalations.push(event);
      } else if (isResolutionEvent(event)) {
        const key = correlationKey(event);
        // Keep the latest resolution event per correlation key
        const existing = resolutions.get(key);
        if (!existing || event.timestamp > existing.timestamp) {
          resolutions.set(key, event);
        }
      }
    }

    // Step 3: Check each escalation for a corresponding resolution
    const unresolvedEscalations: GovernanceAuditEvent[] = [];

    for (const escalation of escalations) {
      const key = correlationKey(escalation);
      const resolution = resolutions.get(key);

      if (!resolution) {
        // No resolution found → unresolved
        unresolvedEscalations.push(escalation);
        continue;
      }

      // Resolution exists but is before the escalation (not after) → unresolved
      if (resolution.timestamp <= escalation.timestamp) {
        unresolvedEscalations.push(escalation);
        continue;
      }

      // Resolution exists after escalation → resolved
    }

    // Step 4: Optionally treat overrides as unresolved
    // (Overrides bypass normal governance — they indicate a gap in policy coverage)
    if (this.config.treatOverrideAsUnresolved) {
      for (const event of windowedEvents) {
        if (event.eventType === "override_applied" || event.decision === "overridden") {
          // Only count if not already counted as an escalation
          if (!escalations.includes(event)) {
            unresolvedEscalations.push(event);
          }
        }
      }
    }

    // Step 5-6: Emit pattern if minimum threshold met
    if (unresolvedEscalations.length < this.config.minimumUnresolved) {
      return [];
    }

    // Sort unresolved by timestamp for first/last observed
    const sorted = [...unresolvedEscalations].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp),
    );
    const newest = sorted[sorted.length - 1];

    const newestAgeMs = now - new Date(newest.timestamp).getTime();
    const newestAgeDays = newestAgeMs / (24 * 60 * 60 * 1000);
    const recencyFactor = Math.max(
      0,
      1 - newestAgeDays / this.config.lookbackWindowDays,
    );

    const patternStrength = Math.min(
      1,
      unresolvedEscalations.length / (this.config.minimumUnresolved * 2),
    );

    const confidence = computeConfidence({
      evidenceCount: unresolvedEscalations.length,
      baselineCount: this.config.baselineCount,
      patternStrength,
      recencyFactor,
    });

    const pattern: PatternObservation = {
      patternId: `governance_gap:unresolved`,
      category: "governance_gap",
      frequency: unresolvedEscalations.length,
      confidence,
      evidenceIds: sorted.map((e) => e.eventId),
      description: `Detected ${unresolvedEscalations.length} unresolved governance escalation(s) in the last ${this.config.lookbackWindowDays} days`,
      firstObserved: sorted[0].timestamp,
      lastObserved: newest.timestamp,
    };

    return [pattern];
  }
}
