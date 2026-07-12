// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A2.4 — Verification Evidence Ledger.
 *
 * Append-only storage for VerificationEvidence. The initial implementation
 * is in-memory; the interface is defined so a persistent backing store
 * (X3b) can provide an implementation later.
 *
 * The ledger enforces evidence freshness (Section 13): expired evidence
 * is rejected on read and cannot participate in active governance
 * decisions, though it may remain stored for audit purposes.
 *
 * @module evidence-ledger
 */

import type { VerificationEvidence } from "../contracts/verification-contract.js";
import { isEvidenceExpired } from "./verification-evidence.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class EvidenceNotFoundError extends Error {
  readonly kind = "EvidenceNotFoundError" as const;
  readonly evidenceId: string;

  constructor(evidenceId: string) {
    super(`Verification evidence not found: ${evidenceId}`);
    this.name = "EvidenceNotFoundError";
    this.evidenceId = evidenceId;
  }
}

export class ExpiredEvidenceError extends Error {
  readonly kind = "ExpiredEvidenceError" as const;
  readonly evidenceId: string;

  constructor(evidenceId: string) {
    super(`Verification evidence expired and rejected on read: ${evidenceId}`);
    this.name = "ExpiredEvidenceError";
    this.evidenceId = evidenceId;
  }
}

export class IntegrityMismatchError extends Error {
  readonly kind = "IntegrityMismatchError" as const;
  readonly evidenceId: string;

  constructor(evidenceId: string) {
    super(`Verification evidence integrity hash mismatch: ${evidenceId}`);
    this.name = "IntegrityMismatchError";
    this.evidenceId = evidenceId;
  }
}

// ---------------------------------------------------------------------------
// VerificationEvidenceLedger
// ---------------------------------------------------------------------------

/**
 * Append-only ledger for verification evidence.
 *
 * @invariant Once stored, evidence is never modified or deleted (except
 *            by explicit cleanup of expired entries).
 * @invariant Read operations reject expired evidence (fail-closed).
 * @invariant Read operations verify integrity hash (fail-closed).
 */
export interface VerificationEvidenceLedger {
  /**
   * Store evidence. Returns the stored record.
   */
  store(evidence: VerificationEvidence): Promise<VerificationEvidence>;

  /**
   * Retrieve evidence by ID. Rejects expired or corrupted evidence.
   */
  get(evidenceId: string): Promise<VerificationEvidence>;

  /**
   * List all evidence for a proposal. Excludes expired evidence by default.
   */
  listByProposal(
    proposalId: string,
    options?: { includeExpired?: boolean },
  ): Promise<VerificationEvidence[]>;

  /**
   * Count evidence that has expired (for cleanup/monitoring).
   */
  countExpired(currentTimeMs?: number): Promise<number>;

  /**
   * Get expired evidence IDs (for audit/cleanup).
   */
  listExpired(currentTimeMs?: number): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// InMemoryVerificationEvidenceLedger
// ---------------------------------------------------------------------------

/**
 * In-memory implementation of the verification evidence ledger.
 *
 * Uses a Map for storage. Suitable for testing and initial deployment;
 * swap for a persistent implementation backed by X3b when available.
 */
export class InMemoryVerificationEvidenceLedger implements VerificationEvidenceLedger {
  private readonly entries = new Map<string, VerificationEvidence>();

  async store(evidence: VerificationEvidence): Promise<VerificationEvidence> {
    // Append-only: reject duplicate evidenceId
    if (this.entries.has(evidence.evidenceId)) {
      throw new Error(
        `Evidence ${evidence.evidenceId} already exists (append-only invariant)`,
      );
    }

    // Store a defensive deep copy
    const stored = structuredClone(evidence);
    this.entries.set(evidence.evidenceId, stored);
    return structuredClone(evidence);
  }

  async get(evidenceId: string): Promise<VerificationEvidence> {
    const evidence = this.entries.get(evidenceId);
    if (!evidence) {
      throw new EvidenceNotFoundError(evidenceId);
    }

    // Fail-closed: reject expired evidence
    if (isEvidenceExpired(evidence)) {
      throw new ExpiredEvidenceError(evidenceId);
    }

    // Fail-closed: verify integrity hash
    if (!verifyIntegrity(evidence)) {
      throw new IntegrityMismatchError(evidenceId);
    }

    return { ...evidence };
  }

  async listByProposal(
    proposalId: string,
    options?: { includeExpired?: boolean },
  ): Promise<VerificationEvidence[]> {
    const includeExpired = options?.includeExpired ?? false;
    const results: VerificationEvidence[] = [];

    for (const evidence of this.entries.values()) {
      if (evidence.proposalId !== proposalId) continue;
      if (!includeExpired && isEvidenceExpired(evidence)) continue;
      if (!verifyIntegrity(evidence)) continue;
      results.push({ ...evidence });
    }

    return results;
  }

  async countExpired(currentTimeMs?: number): Promise<number> {
    const now = currentTimeMs ?? Date.now();
    let count = 0;
    for (const evidence of this.entries.values()) {
      if (isEvidenceExpired(evidence, now)) count++;
    }
    return count;
  }

  async listExpired(currentTimeMs?: number): Promise<string[]> {
    const now = currentTimeMs ?? Date.now();
    const ids: string[] = [];
    for (const [id, evidence] of this.entries.entries()) {
      if (isEvidenceExpired(evidence, now)) ids.push(id);
    }
    return ids;
  }
}

// ---------------------------------------------------------------------------
// Integrity verification helper
// ---------------------------------------------------------------------------

import { computeEvidenceIntegrityHash } from "./verification-evidence.js";

function verifyIntegrity(evidence: VerificationEvidence): boolean {
  const expected = evidence.integrityHash;
  const computed = computeEvidenceIntegrityHash(evidence);
  return expected === computed;
}
