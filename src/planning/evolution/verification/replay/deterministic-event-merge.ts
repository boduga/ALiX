// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A2.2 — Deterministic Event Merge.
 *
 * Merges parallel event streams into a single deterministic sequence.
 * Ordering is fixed: tick ascending → sourceId lexicographic →
 * sequenceNumber ascending. This guarantees that concurrent event
 * streams always merge into the same order regardless of arrival timing.
 *
 * @module deterministic-event-merge
 */

// ---------------------------------------------------------------------------
// DeterministicEvent
// ---------------------------------------------------------------------------

export interface DeterministicEvent {
  /** Identifier of the source stream. */
  sourceId: string;
  /** Logical tick at which the event occurred. */
  tick: number;
  /** Sequence number within the source stream. */
  sequenceNumber: number;
  /** Event payload (opaque to the merge function). */
  payload: unknown;
}

// ---------------------------------------------------------------------------
// mergeEvents
// ---------------------------------------------------------------------------

/**
 * Merge parallel event streams into a single deterministic sequence.
 *
 * Ordering:
 *   1. tick ascending
 *   2. sourceId lexicographic ascending
 *   3. sequenceNumber ascending
 *
 * Pure — no side effects, no I/O.
 *
 * @param streams - Array of event streams to merge.
 * @returns A single merged, deterministically ordered event array.
 */
export function mergeEvents(streams: readonly (readonly DeterministicEvent[])[]): DeterministicEvent[] {
  const all: DeterministicEvent[] = [];
  for (const stream of streams) {
    if (Array.isArray(stream)) {
      for (const event of stream) {
        all.push({ ...event });
      }
    }
  }

  all.sort(compareEvents);

  return all;
}

/**
 * Comparator implementing the deterministic ordering rule.
 */
export function compareEvents(a: DeterministicEvent, b: DeterministicEvent): number {
  if (a.tick !== b.tick) return a.tick - b.tick;
  if (a.sourceId !== b.sourceId) {
    return a.sourceId < b.sourceId ? -1 : 1;
  }
  return a.sequenceNumber - b.sequenceNumber;
}
