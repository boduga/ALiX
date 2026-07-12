// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A2.4 — Lineage Tracker.
 *
 * Accumulates provenance records during a verification run. Every step
 * that contributes to verification evidence is recorded so the full
 * chain from historical evidence → proposal → verification is traceable.
 *
 * @module lineage-tracker
 */

import type { LineageRecord } from "../contracts/verification-contract.js";

// ---------------------------------------------------------------------------
// LineageTracker
// ---------------------------------------------------------------------------

/**
 * Accumulates LineageRecord entries in insertion order.
 *
 * @invariant Records are ordered by insertion — the order reflects the
 *            verification pipeline execution.
 */
export class LineageTracker {
  private readonly records: LineageRecord[] = [];

  /**
   * Add a lineage record.
   */
  addRecord(
    step: string,
    sourceId: string,
    sourceType: LineageRecord["sourceType"],
    timestamp: string,
  ): this {
    this.records.push({ step, sourceId, sourceType, timestamp });
    return this;
  }

  /**
   * Get all lineage records (in insertion order).
   */
  getLineage(): readonly LineageRecord[] {
    return [...this.records];
  }

  /**
   * Get the number of records.
   */
  length(): number {
    return this.records.length;
  }

  /**
   * Clear all records.
   */
  clear(): void {
    this.records.length = 0;
  }
}
