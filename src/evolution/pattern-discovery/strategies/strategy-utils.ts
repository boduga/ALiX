// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * Shared utilities for pattern discovery strategies.
 *
 * @module strategy-utils
 */

/**
 * Strip the final path segment (after the last `/`) from an intent ID.
 *
 * Different run suffixes within the same workflow use the same parent
 * identifier (everything before the final `/`). Normalization groups
 * these executions together for aggregate analysis.
 *
 * @example
 * normalizeIntentId("agent/workflow/run-01") // "agent/workflow"
 * normalizeIntentId("task-001")             // "task-001"
 *
 * @param intentId - Raw intent ID, potentially containing run-specific suffix.
 * @returns Normalized intent ID with the final path segment removed.
 */
export function normalizeIntentId(intentId: string): string {
  const lastSlash = intentId.lastIndexOf("/");
  return lastSlash >= 0 ? intentId.slice(0, lastSlash) : intentId;
}
