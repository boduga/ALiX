/**
 * P12.4 — Autonomous governance run ledger.
 *
 * Persists the full governance decision trail for every autonomous run.
 * Filesystem-backed JSONL store — append-only, auditable, easy to inspect.
 *
 * Core invariant: record evidence, don't decide anything.
 * No approval, no denial, no risk scoring, no policy evaluation.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { ApprovalGate } from "./approval-workflow.js";
import type { RiskScore } from "./risk-scoring.js";
import type { GovernancePolicyResult } from "./autonomous-policy.js";
import { readFile, appendFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LedgerOutcome = "completed" | "failed" | "cancelled" | "denied";

export interface VerificationResult {
  command: string;
  status: string;
  [key: string]: unknown;
}

export interface LedgerEntry {
  runId: string;
  issueId: string;
  policyResult: GovernancePolicyResult;
  riskScore: RiskScore;
  approvals: ApprovalGate[];
  filesChanged: string[];
  verificationResults: VerificationResult[];
  draftPrId?: string;
  outcome: LedgerOutcome;
  timestamp: string;
}

export interface CreateLedgerEntryInput {
  runId: string;
  issueId: string;
  policyResult: GovernancePolicyResult;
  riskScore: RiskScore;
  approvals: ApprovalGate[];
  filesChanged: string[];
  verificationResults: VerificationResult[];
  draftPrId?: string;
  outcome: LedgerOutcome;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_OUTCOMES: LedgerOutcome[] = ["completed", "failed", "cancelled", "denied"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Create a ledger entry from input + explicit timestamp.
 * Pure except for the caller-supplied timestamp parameter.
 */
export function createLedgerEntry(input: CreateLedgerEntryInput, timestamp: string): LedgerEntry {
  return { ...input, timestamp };
}

/**
 * Validate a ledger entry structure and fields.
 */
export function validateLedgerEntry(entry: unknown): ValidationResult {
  const errors: string[] = [];

  if (!entry || typeof entry !== "object") {
    return { valid: false, errors: ["Entry must be an object"] };
  }

  const e = entry as Record<string, unknown>;

  if (!isNonEmptyString(e.runId)) errors.push("runId is required");
  if (!isNonEmptyString(e.issueId)) errors.push("issueId is required");

  const policy = e.policyResult as Record<string, unknown> | undefined;
  if (!policy || typeof policy !== "object") {
    errors.push("policyResult is required");
  } else if (!isNonEmptyString(policy.decision)) {
    errors.push("policyResult.decision is required");
  }
  if (policy && typeof policy === "object") {
    if (!Array.isArray((policy as Record<string, unknown>).matchedPolicies)) {
      errors.push("policyResult.matchedPolicies must be an array");
    }
    if (!Array.isArray((policy as Record<string, unknown>).requiredApprovals)) {
      errors.push("policyResult.requiredApprovals must be an array");
    }
  }

  const risk = e.riskScore as Record<string, unknown> | undefined;
  if (!risk || typeof risk !== "object") {
    errors.push("riskScore is required");
  } else {
    if (!isNonEmptyString(risk.level)) errors.push("riskScore.level is required");
    if (typeof risk.score !== "number" || !Number.isFinite(risk.score)) errors.push("riskScore.score is required");
    if (!Array.isArray((risk as Record<string, unknown>).factors)) errors.push("riskScore.factors must be an array");
  }

  if (!Array.isArray(e.approvals)) errors.push("approvals must be an array");
  if (!Array.isArray(e.filesChanged)) {
    errors.push("filesChanged must be an array");
  } else if (!e.filesChanged.every((f: unknown) => typeof f === "string")) {
    errors.push("filesChanged must contain only strings");
  }
  if (!Array.isArray(e.verificationResults)) errors.push("verificationResults must be an array");
  if (!VALID_OUTCOMES.includes(e.outcome as LedgerOutcome)) {
    errors.push("outcome must be one of: completed, failed, cancelled, denied");
  }
  if (!isNonEmptyString(e.timestamp)) errors.push("timestamp is required");

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface RunLedgerStore {
  append(entry: LedgerEntry): Promise<void>;
  list(limit?: number): Promise<LedgerEntry[]>;
  get(runId: string): Promise<LedgerEntry | undefined>;
}

// ---------------------------------------------------------------------------
// Filesystem store (JSONL)
// ---------------------------------------------------------------------------

const LEDGER_FILE = "run-ledger.jsonl";

export class FileLedgerStore implements RunLedgerStore {
  private readonly dir: string;

  constructor(baseDir: string) {
    this.dir = baseDir;
  }

  private get filePath(): string {
    return join(this.dir, LEDGER_FILE);
  }

  private async dirExists(): Promise<boolean> {
    try { await stat(this.dir); return true; }
    catch { return false; }
  }

  private async ensureDir(): Promise<void> {
    if (!(await this.dirExists())) {
      await mkdir(this.dir, { recursive: true });
    }
  }

  private async fileExists(): Promise<boolean> {
    try { await stat(this.filePath); return true; }
    catch { return false; }
  }

  async append(entry: LedgerEntry): Promise<void> {
    const validation = validateLedgerEntry(entry);
    if (!validation.valid) {
      throw new Error(`Invalid ledger entry: ${validation.errors.join("; ")}`);
    }
    await this.ensureDir();
    await appendFile(this.filePath, JSON.stringify(entry) + "\n", "utf8");
  }

  async list(limit?: number): Promise<LedgerEntry[]> {
    if (!(await this.fileExists())) {
      return [];
    }
    const content = await readFile(this.filePath, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    const entries: LedgerEntry[] = [];
    for (const line of lines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        console.warn("Skipping malformed JSON ledger row");
        continue;
      }
      const validation = validateLedgerEntry(parsed);
      if (!validation.valid) {
        console.warn(`Skipping invalid ledger row: ${validation.errors.join("; ")}`);
        continue;
      }
      entries.push(parsed as LedgerEntry);
    }
    entries.reverse();
    return limit !== undefined && limit > 0 ? entries.slice(0, limit) : entries;
  }

  async get(runId: string): Promise<LedgerEntry | undefined> {
    const entries = await this.list();
    return entries.find((entry) => entry.runId === runId);
  }
}

// ---------------------------------------------------------------------------
// Thin delegators (public API aligned with P12.4 design spec)
// ---------------------------------------------------------------------------

export async function appendLedgerEntry(
  store: RunLedgerStore,
  entry: LedgerEntry,
): Promise<void> {
  await store.append(entry);
}

export async function listLedgerEntries(
  store: RunLedgerStore,
  limit?: number,
): Promise<LedgerEntry[]> {
  return store.list(limit);
}

export async function getLedgerEntry(
  store: RunLedgerStore,
  runId: string,
): Promise<LedgerEntry | undefined> {
  return store.get(runId);
}
