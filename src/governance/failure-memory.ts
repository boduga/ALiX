/**
 * P12.5 — Autonomous governance failure memory.
 *
 * Records and queries failed governance/autonomous-run patterns.
 * Append-only JSONL store — remembers failures, doesn't enforce them.
 *
 * Core invariant: record failure evidence, don't change policy behaviour.
 * No policy mutation, no risk scoring changes, no approval gate changes,
 * no run ledger modification, no P11 execution blocking.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { readFile, appendFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FailureType =
  | "policy_denied"
  | "file_scope_violation"
  | "blocked_command"
  | "verification_timeout"
  | "test_failure"
  | "approval_denied"
  | "pr_rejected";

export const VALID_FAILURE_TYPES: FailureType[] = [
  "policy_denied",
  "file_scope_violation",
  "blocked_command",
  "verification_timeout",
  "test_failure",
  "approval_denied",
  "pr_rejected",
];

export interface FailureRecord {
  runId: string;
  issueId: string;
  failureType: FailureType;
  detail: string;
  timestamp: string;
  filePaths?: string[];
  command?: string;
  policyIds?: string[];
  verificationCommand?: string;
}

export interface FailureRecallQuery {
  issueId?: string;
  failureType?: FailureType;
  filePaths?: string[];
  command?: string;
  policyIds?: string[];
  verificationCommand?: string;
}

export interface CreateFailureRecordInput {
  runId: string;
  issueId: string;
  failureType: FailureType;
  detail: string;
  filePaths?: string[];
  command?: string;
  policyIds?: string[];
  verificationCommand?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Create a failure record from input + explicit timestamp.
 * Pure except for the caller-supplied timestamp parameter.
 */
export function createFailureRecord(
  input: CreateFailureRecordInput,
  timestamp: string,
): FailureRecord {
  return { ...input, timestamp };
}

/**
 * Validate a failure record structure and fields.
 */
export function validateFailureRecord(entry: unknown): ValidationResult {
  const errors: string[] = [];

  if (!entry || typeof entry !== "object") {
    return { valid: false, errors: ["Record must be an object"] };
  }

  const e = entry as Record<string, unknown>;

  if (!isNonEmptyString(e.runId)) errors.push("runId is required");
  if (!isNonEmptyString(e.issueId)) errors.push("issueId is required");

  if (!VALID_FAILURE_TYPES.includes(e.failureType as FailureType)) {
    errors.push(`failureType must be one of: ${VALID_FAILURE_TYPES.join(", ")}`);
  }

  if (!isNonEmptyString(e.detail)) errors.push("detail is required");
  if (!isNonEmptyString(e.timestamp)) errors.push("timestamp is required");

  if (e.filePaths !== undefined && !Array.isArray(e.filePaths)) {
    errors.push("filePaths must be an array");
  }
  if (e.policyIds !== undefined && !Array.isArray(e.policyIds)) {
    errors.push("policyIds must be an array");
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface FailureMemoryStore {
  append(record: FailureRecord): Promise<void>;
  list(limit?: number): Promise<FailureRecord[]>;
  getByRun(runId: string): Promise<FailureRecord[]>;
  getByIssue(issueId: string): Promise<FailureRecord[]>;
  findSimilar(query: FailureRecallQuery, limit?: number): Promise<FailureRecord[]>;
}

// ---------------------------------------------------------------------------
// Filesystem store (JSONL)
// ---------------------------------------------------------------------------

const STORAGE_FILE = "failure-memory.jsonl";

export class FileFailureMemoryStore implements FailureMemoryStore {
  private readonly dir: string;

  constructor(baseDir: string) {
    this.dir = baseDir;
  }

  private get filePath(): string {
    return join(this.dir, STORAGE_FILE);
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

  private async readAll(): Promise<FailureRecord[]> {
    if (!(await this.fileExists())) {
      return [];
    }
    const content = await readFile(this.filePath, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    const records: FailureRecord[] = [];
    for (const line of lines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const validation = validateFailureRecord(parsed);
      if (!validation.valid) {
        continue;
      }
      records.push(parsed as FailureRecord);
    }
    records.reverse();
    return records;
  }

  async append(record: FailureRecord): Promise<void> {
    const validation = validateFailureRecord(record);
    if (!validation.valid) {
      throw new Error(`Invalid failure record: ${validation.errors.join("; ")}`);
    }
    await this.ensureDir();
    await appendFile(this.filePath, JSON.stringify(record) + "\n", "utf8");
  }

  async list(limit?: number): Promise<FailureRecord[]> {
    const records = await this.readAll();
    return limit !== undefined && limit > 0 ? records.slice(0, limit) : records;
  }

  async getByRun(runId: string): Promise<FailureRecord[]> {
    const records = await this.readAll();
    return records.filter((r) => r.runId === runId);
  }

  async getByIssue(issueId: string): Promise<FailureRecord[]> {
    const records = await this.readAll();
    return records.filter((r) => r.issueId === issueId);
  }

  async findSimilar(query: FailureRecallQuery, limit?: number): Promise<FailureRecord[]> {
    const records = await this.readAll();

    const scored = records.map((record) => {
      let score = 0;

      if (query.issueId && record.issueId === query.issueId) score += 3;
      if (query.failureType && record.failureType === query.failureType) score += 2;

      if (query.filePaths && record.filePaths) {
        const overlap = query.filePaths.filter((p) => record.filePaths!.includes(p));
        score += overlap.length;
      }

      if (query.command && record.command === query.command) score += 2;
      if (query.policyIds && record.policyIds) {
        const overlap = query.policyIds.filter((p) => record.policyIds!.includes(p));
        score += overlap.length;
      }
      if (query.verificationCommand && record.verificationCommand === query.verificationCommand) {
        score += 2;
      }

      return { record, score };
    });

    const matched = scored.filter((s) => s.score > 0);
    matched.sort((a, b) => b.score - a.score);

    const results = matched.map((s) => s.record);
    return limit !== undefined && limit > 0 ? results.slice(0, limit) : results;
  }
}
