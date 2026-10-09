// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A4.0 — Execution Request type.
 *
 * Separates operator request from governance approval.
 *
 * @module execution-request
 */

// ---------------------------------------------------------------------------
// Execution Request
// ---------------------------------------------------------------------------

/**
 * Separates operator request from governance approval.
 */
export interface ExecutionRequest {
  /** Unique request identifier. */
  readonly requestId: string;
  /** Reference evolution being requested for execution. */
  readonly evolutionId: string;
  /** Who requested execution. */
  readonly requestedBy: string;
  /** When request was made. */
  readonly requestedAt: string;
  /** Optional reason for execution request. */
  readonly reason?: string;
}
