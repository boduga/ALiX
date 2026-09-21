/**
 * journal.ts — Decision journal schema + file store (J0c).
 *
 * Every remote decision is journaled for audit, replay, comparison and
 * calibration (hand-off §9). The primary ledger stores provenance and hashes,
 * never sensitive payloads. Optional debug payloads live in a separate
 * directory and are written only when explicitly enabled.
 *
 * Failure policy: append/read throw JournalWriteError/JournalReadError with
 * cause. Decision callers catch and degrade per decision fallback policy —
 * a journal failure never silently vanishes and never crashes the decision.
 */

import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DecisionType } from "./contracts.js";
import { isValidConfidence, isValidProbability, isValidScore } from "./contracts.js";

export const MAX_CANDIDATES = 200;
const JOURNAL_FILE = "decisions.jsonl";
const DEBUG_DIR = "debug";

/** Native outcome, or an explicit failure descriptor. Shape-level only. */
export type DecisionOutcome =
  | { kind: "choice"; choice: unknown; candidates?: unknown[]; confidence?: number }
  | { kind: "score"; score: number; confidence?: number }
  | { kind: "noul"; probability: number }
  | { kind: "failure"; error: string; fallbackEngine?: string };

export type DecisionJournalRecord = {
  decisionId: string;
  timestamp: number;
  decision: DecisionType;
  engineId: string;
  engineVersion?: string;
  executionId?: string;
  /** Boundary seal hash. Replay fixture key (J5 replays this, never payload). */
  projectionHash: string;
  projectorVersion?: string;
  outcome: DecisionOutcome;
  thresholdProfile?: string;
  policyVersion?: string;
  latencyMs: number;
  remote: boolean;
  redactionApplied: boolean;
};

export type RecordDecisionInput = {
  decision: DecisionType;
  engineId: string;
  engineVersion?: string;
  executionId?: string;
  projectionHash: string;
  projectorVersion?: string;
  outcome: DecisionOutcome;
  thresholdProfile?: string;
  policyVersion?: string;
  latencyMs: number;
  remote: boolean;
  redactionApplied: boolean;
  now?: number;
};

export class JournalValidationError extends Error {
  readonly code = "JOURNAL_VALIDATION";
  constructor(message: string) {
    super(`Invalid decision journal input: ${message}`);
    this.name = "JournalValidationError";
  }
}

export class JournalWriteError extends Error {
  readonly code = "JOURNAL_WRITE";
  constructor(message: string, opts?: { cause?: unknown }) {
    super(`Decision journal write failed: ${message}`);
    this.name = "JournalWriteError";
    if (opts?.cause !== undefined) this.cause = opts.cause;
  }
}

export class JournalReadError extends Error {
  readonly code = "JOURNAL_READ";
  constructor(message: string, opts?: { cause?: unknown }) {
    super(`Decision journal read failed: ${message}`);
    this.name = "JournalReadError";
    if (opts?.cause !== undefined) this.cause = opts.cause;
  }
}

function fail(when: boolean, message: string): void {
  if (when) throw new JournalValidationError(message);
}

function validateOutcome(outcome: DecisionOutcome): void {
  fail(!outcome || typeof outcome !== "object", "outcome must be an object");
  switch (outcome.kind) {
    case "choice":
      fail(!isValidConfidence(outcome.confidence), "choice.confidence must be 0..1 when present");
      if (outcome.candidates !== undefined) {
        fail(!Array.isArray(outcome.candidates), "choice.candidates must be an array");
        fail(outcome.candidates.length > MAX_CANDIDATES, `choice.candidates exceeds ${MAX_CANDIDATES}`);
      }
      break;
    case "score":
      fail(!isValidScore(outcome.score), "score.score must be 0..1");
      fail(!isValidConfidence(outcome.confidence), "score.confidence must be 0..1 when present");
      break;
    case "noul":
      fail(!isValidProbability(outcome.probability), "noul.probability must be 0..1");
      break;
    case "failure":
      fail(typeof outcome.error !== "string" || outcome.error.length === 0, "failure.error must be non-empty");
      fail(
        outcome.fallbackEngine !== undefined && typeof outcome.fallbackEngine !== "string",
        "failure.fallbackEngine must be a string when present",
      );
      break;
    default:
      throw new JournalValidationError(`unknown outcome kind: ${(outcome as { kind: string }).kind}`);
  }
}

/** Pure record builder. No I/O. Never accepts a payload — hashes only. */
export function recordDecision(input: RecordDecisionInput): DecisionJournalRecord {
  fail(typeof input.decision !== "string" || input.decision.length === 0, "decision required");
  fail(typeof input.engineId !== "string" || input.engineId.length === 0, "engineId required");
  fail(
    typeof input.projectionHash !== "string" || input.projectionHash.length === 0,
    "projectionHash required",
  );
  fail(
    typeof input.latencyMs !== "number" || !Number.isFinite(input.latencyMs) || input.latencyMs < 0,
    "latencyMs must be >= 0",
  );
  fail(typeof input.remote !== "boolean", "remote flag required");
  fail(typeof input.redactionApplied !== "boolean", "redactionApplied flag required");
  validateOutcome(input.outcome);
  const timestamp = input.now ?? Date.now();
  fail(!Number.isFinite(timestamp), "timestamp must be finite");
  return {
    decisionId: randomUUID(),
    timestamp,
    decision: input.decision,
    engineId: input.engineId,
    ...(input.engineVersion !== undefined ? { engineVersion: input.engineVersion } : {}),
    ...(input.executionId !== undefined ? { executionId: input.executionId } : {}),
    projectionHash: input.projectionHash,
    ...(input.projectorVersion !== undefined ? { projectorVersion: input.projectorVersion } : {}),
    outcome: input.outcome,
    ...(input.thresholdProfile !== undefined ? { thresholdProfile: input.thresholdProfile } : {}),
    ...(input.policyVersion !== undefined ? { policyVersion: input.policyVersion } : {}),
    latencyMs: input.latencyMs,
    remote: input.remote,
    redactionApplied: input.redactionApplied,
  };
}

export class DecisionJournalStore {
  constructor(private readonly dir: string) {}

  private journalPath(): string {
    return join(this.dir, JOURNAL_FILE);
  }

  append(record: DecisionJournalRecord): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      appendFileSync(this.journalPath(), `${JSON.stringify(record)}\n`, "utf8");
    } catch (cause) {
      throw new JournalWriteError((cause as Error).message, { cause });
    }
  }

  readAll(): DecisionJournalRecord[] {
    let text: string;
    try {
      text = readFileSync(this.journalPath(), "utf8");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new JournalReadError((cause as Error).message, { cause });
    }
    const records: DecisionJournalRecord[] = [];
    for (const [index, line] of text.split("\n").entries()) {
      if (line.trim().length === 0) continue;
      try {
        records.push(JSON.parse(line) as DecisionJournalRecord);
      } catch (cause) {
        throw new JournalReadError(`corrupt line ${index + 1}`, { cause });
      }
    }
    return records;
  }

  findByDecision(decision: DecisionType): DecisionJournalRecord[] {
    return this.readAll().filter((r) => r.decision === decision);
  }

  findByExecution(executionId: string): DecisionJournalRecord[] {
    return this.readAll().filter((r) => r.executionId === executionId);
  }

  findByProjectionHash(projectionHash: string): DecisionJournalRecord[] {
    return this.readAll().filter((r) => r.projectionHash === projectionHash);
  }

  /** Calibration export (J4 seam). Debug payloads excluded by construction. */
  exportForCalibration(): DecisionJournalRecord[] {
    return this.readAll();
  }
}

/**
 * Separate debug-payload retention. No-op unless enabled — the primary
 * ledger never carries payloads regardless of this call.
 */
export function writeDebugPayload(
  dir: string,
  decisionId: string,
  payload: unknown,
  opts: { enabled: boolean },
): void {
  if (!opts.enabled) return;
  if (typeof decisionId !== "string" || decisionId.length === 0) {
    throw new JournalValidationError("decisionId required for debug payload");
  }
  try {
    const debugDir = join(dir, DEBUG_DIR);
    mkdirSync(debugDir, { recursive: true });
    writeFileSync(join(debugDir, `${decisionId}.json`), JSON.stringify(payload), "utf8");
  } catch (cause) {
    throw new JournalWriteError((cause as Error).message, { cause });
  }
}
