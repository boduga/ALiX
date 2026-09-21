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
import { outcomeIssue } from "./contracts.js";

/** Uncalibrated operational default. J4 tunes caps from calibration evidence. */
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
  /** Relevant state/version identifier for replay grouping (journal §9). */
  stateVersion?: string;
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
  /** Relevant state/version identifier for replay grouping (journal §9). */
  stateVersion?: string;
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

function throwIf(when: boolean, message: string): void {
  if (when) throw new JournalValidationError(message);
}

function validateOutcome(outcome: DecisionOutcome): void {
  throwIf(!outcome || typeof outcome !== "object", "outcome must be an object");
  if (outcome.kind === "choice") {
    const candidates = outcome.candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new JournalValidationError("choice.candidates required non-empty (journal §9)");
    }
    throwIf(candidates.length > MAX_CANDIDATES, `choice.candidates exceeds ${MAX_CANDIDATES}`);
  }
  const issue = outcomeIssue(outcome, outcome.kind === "choice" ? outcome.candidates : undefined);
  if (issue !== null) throw new JournalValidationError(issue);
  if (outcome.kind === "failure" && outcome.fallbackEngine !== undefined) {
    throwIf(typeof outcome.fallbackEngine !== "string", "failure.fallbackEngine must be a string when present");
  }
}

/** Pure record builder. No I/O. Never accepts a payload — hashes only. */
export function recordDecision(input: RecordDecisionInput): DecisionJournalRecord {
  throwIf(typeof input.decision !== "string" || input.decision.length === 0, "decision required");
  throwIf(typeof input.engineId !== "string" || input.engineId.length === 0, "engineId required");
  throwIf(
    typeof input.projectionHash !== "string" || input.projectionHash.length === 0,
    "projectionHash required",
  );
  throwIf(
    typeof input.latencyMs !== "number" || !Number.isFinite(input.latencyMs) || input.latencyMs < 0,
    "latencyMs must be >= 0",
  );
  throwIf(typeof input.remote !== "boolean", "remote flag required");
  throwIf(typeof input.redactionApplied !== "boolean", "redactionApplied flag required");
  throwIf(
    input.stateVersion !== undefined && typeof input.stateVersion !== "string",
    "stateVersion must be a string when present",
  );
  validateOutcome(input.outcome);
  const timestamp = input.now ?? Date.now();
  throwIf(!Number.isFinite(timestamp), "timestamp must be finite");
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
    ...(input.stateVersion !== undefined ? { stateVersion: input.stateVersion } : {}),
    latencyMs: input.latencyMs,
    remote: input.remote,
    redactionApplied: input.redactionApplied,
  };
}

/** Store handle. Closure over the directory; calibration export lives in J4. */
export type DecisionJournalStore = {
  append(record: DecisionJournalRecord): void;
  readAll(): DecisionJournalRecord[];
  findByDecision(decision: DecisionType): DecisionJournalRecord[];
  findByExecution(executionId: string): DecisionJournalRecord[];
  findByProjectionHash(projectionHash: string): DecisionJournalRecord[];
};

export function createDecisionJournalStore(dir: string): DecisionJournalStore {
  const journalPath = join(dir, JOURNAL_FILE);
  function readAll(): DecisionJournalRecord[] {
    let text: string;
    try {
      text = readFileSync(journalPath, "utf8");
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
  return {
    append(record: DecisionJournalRecord): void {
      try {
        mkdirSync(dir, { recursive: true });
        appendFileSync(journalPath, `${JSON.stringify(record)}\n`, "utf8");
      } catch (cause) {
        throw new JournalWriteError((cause as Error).message, { cause });
      }
    },
    readAll,
    findByDecision(decision: DecisionType): DecisionJournalRecord[] {
      return readAll().filter((r) => r.decision === decision);
    },
    findByExecution(executionId: string): DecisionJournalRecord[] {
      return readAll().filter((r) => r.executionId === executionId);
    },
    findByProjectionHash(projectionHash: string): DecisionJournalRecord[] {
      return readAll().filter((r) => r.projectionHash === projectionHash);
    },
  };
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
