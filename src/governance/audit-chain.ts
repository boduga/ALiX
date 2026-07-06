/**
 * P14.5a — Governance Audit Trail: chain verification.
 *
 * Verifies the integrity of a hash-linked audit event chain:
 * - Each event's eventHash must match a recomputed hash of its contents
 * - Each event's previousHash (except the first) must match the prior
 *   event's eventHash
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { computeEventHash } from "./audit-store.js";
import type { GovernanceAuditEvent } from "./audit-types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChainFindingType =
  | "ok"
  | "hash_mismatch"
  | "previous_hash_break"
  | "chain_break";

export interface ChainFinding {
  type: ChainFindingType;
  index: number;
  eventId: string;
  detail: string;
}

export interface ChainVerificationResult {
  /** True when no findings (full chain integrity). */
  valid: boolean;
  findings: ChainFinding[];
  /** Total events examined. */
  eventCount: number;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Verify the integrity of a hash-linked audit event chain.
 *
 * Events MUST be in chronological order (oldest first = index 0).
 * Returns all findings rather than failing fast, so callers can report
 * every integrity issue.
 */
export function verifyChain(events: GovernanceAuditEvent[]): ChainVerificationResult {
  const findings: ChainFinding[] = [];

  if (events.length === 0) {
    return { valid: true, findings: [], eventCount: 0 };
  }

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    // 1. Recompute event hash (strips eventHash internally)
    const expectedHash = recomputeEventHash(event);

    if (expectedHash !== event.eventHash) {
      findings.push({
        type: "hash_mismatch",
        index: i,
        eventId: event.eventId,
        detail: `Event hash mismatch at index ${i}: expected ${expectedHash}, got ${event.eventHash}`,
      });
    }

    // 2. Verify previousHash link (skip for first event)
    if (i === 0) {
      if (event.previousHash !== null) {
        findings.push({
          type: "previous_hash_break",
          index: i,
          eventId: event.eventId,
          detail: `First event must have previousHash=null, got ${event.previousHash}`,
        });
      }
    } else {
      const priorEvent = events[i - 1];

      if (event.previousHash === null) {
        findings.push({
          type: "chain_break",
          index: i,
          eventId: event.eventId,
          detail: `Non-first event at index ${i} has previousHash=null`,
        });
      } else if (event.previousHash !== priorEvent.eventHash) {
        findings.push({
          type: "previous_hash_break",
          index: i,
          eventId: event.eventId,
          detail: `Previous hash break at index ${i}: expected ${priorEvent.eventHash}, got ${event.previousHash}`,
        });
      }
    }
  }

  return {
    valid: findings.length === 0,
    findings,
    eventCount: events.length,
  };
}

/**
 * Return the list of broken chain positions.
 */
export function findBrokenLinks(events: GovernanceAuditEvent[]): ChainFinding[] {
  const result = verifyChain(events);
  return result.findings;
}

/**
 * Recompute the eventHash for a single event.
 * Strips the eventHash field and hashes the remaining payload.
 */
export function recomputeEventHash(event: GovernanceAuditEvent): string {
  const { eventHash: _, ...body } = event;
  return computeEventHash(body as unknown as Record<string, unknown>);
}
