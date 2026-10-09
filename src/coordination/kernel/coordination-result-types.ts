/**
 * coordination-result-types.ts — Types for run-level result aggregation and failure propagation.
 */

import type { CoordinationRunStatus, WorkerStatus, WorkerBlockReason, WorkerFailureKind, WorkerFailureProvenance, CoordinationRunOutcome } from "./coordination-types.js";
import type { CoordinationWorkerResultRecord } from "./coordination-result-store.js";

export type AggregationIssueCode =
  | "missing_result" | "corrupt_result" | "run_mismatch"
  | "worker_mismatch" | "attempt_mismatch" | "invalid_timestamp"
  | "invalid_result_status" | "stale_aggregate" | "invalid_failure_provenance";

export type AggregationIssue = {
  code: AggregationIssueCode;
  workerId?: string;
  message: string;
};

export type WorkerResultSummary = {
  workerId: string;
  taskLabel: string;
  goalPrompt: string;
  agentId: string;
  planOrder?: number;
  status: WorkerStatus;
  attempt: number;
  maxAttempts: number;
  outcome?: "success" | "failure";
  summary?: string;
  error?: string;
  failureKind?: WorkerFailureKind;
  blockReason?: WorkerBlockReason;
  failureProvenance?: WorkerFailureProvenance;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  resultRef?: string;
};

export type FailureChain = {
  rootWorkerId: string;
  rootTaskLabel: string;
  rootFailureKind?: WorkerFailureKind;
  rootError?: string;
  directDependents: string[];
  allAffectedWorkers: string[];
  depthByWorker: Record<string, number>;
};

export type RunResultCounts = {
  workers: number;
  completed: number;
  failed: number;
  blocked: number;
  cancelled: number;
  pending: number;
  running: number;
  successfulResults: number;
  failedResults: number;
  missingResults: number;
};

export type RunResultSummary = {
  schemaVersion: "1.0";
  runId: string;
  rootGoal: string;
  status: CoordinationRunStatus;
  outcome: CoordinationRunOutcome;
  generatedAt: string;
  sourceFingerprint: string;
  sourceRunUpdatedAt: string;
  complete: boolean;
  issues: AggregationIssue[];
  counts: RunResultCounts;
  workerResults: WorkerResultSummary[];
  failureChains: FailureChain[];
  timing: {
    startedAt?: string;
    completedAt?: string;
    wallClockDurationMs?: number;
    totalWorkerDurationMs?: number;
  };
  aggregateRef?: string;
  finalSummary?: string;
  synthesis: {
    status: "not_requested" | "completed" | "failed";
    provider?: string;
    model?: string;
    generatedAt?: string;
    error?: string;
  };
};

export type ResultLoadResult =
  | { status: "ok"; record: CoordinationWorkerResultRecord }
  | { status: "missing"; message: string }
  | { status: "corrupt"; message: string }
  | { status: "invalid_ref"; message: string }
  | { status: "invalid_record"; message: string };
