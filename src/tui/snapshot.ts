import type { SessionPhase } from './state.js';
import type { DaemonMetricsSnapshot, ClientSnapshot } from './daemon-metrics-collector.js';
export type { DaemonMetricsSnapshot, ClientSnapshot } from './daemon-metrics-collector.js';

/**
 * Frozen, immutable view model. Field types are intentionally nullable to
 * allow partial subsystems to fail without crashing the dashboard.
 */
export interface DashboardSnapshot {
  readonly generatedAt: number;
  readonly session: SessionMetadata | null;
  readonly daemon: DaemonMetricsSnapshot | null;
  readonly approvals: ApprovalSnapshot | null;
  readonly runtime: RuntimeSnapshot | null;
  readonly sops: SopSnapshot | null;
  readonly policy: PolicySnapshot | null;
}

/**
 * Session lifecycle metadata. Source of phase truth is AgentSession.phase,
 * projected here as a read-only field.
 */
export interface SessionMetadata {
  readonly mode: 'auto' | 'ask' | 'bypass';
  readonly phase: SessionPhase;
  readonly version: string;
  readonly startedAt: number;
  readonly turns: number;
}

/**
 * DaemonMetricsSnapshot / ClientSnapshot are re-exported from
 * daemon-metrics-collector.ts (their semantic home).
 */

/**
 * Approval queue snapshot. pending + recently-resolved (within last N).
 */
export interface ApprovalSnapshot {
  readonly pending: readonly ApprovalRecordSnapshot[];
  readonly recentlyResolved: readonly ApprovalRecordSnapshot[];
  readonly totalPending: number;
  readonly totalResolved: number;
}

export interface ApprovalRecordSnapshot {
  readonly id: string;
  readonly toolName: string;
  readonly targetPath: string;
  readonly args: Record<string, unknown>;
  readonly requestedAt: number;
  readonly requestedBy: string;
}

/**
 * Runtime events + workflow state. Ordered events: descending by timestamp.
 */
export interface RuntimeSnapshot {
  readonly events: readonly RuntimeEventSnapshot[];
  readonly workflow: WorkflowStateSnapshot | null;
  readonly totalEventCount: number;
  readonly lastEventAt: number | null;
}

export interface RuntimeEventSnapshot {
  readonly id: string;
  readonly kind: string;
  readonly summary: string;
  readonly timestamp: number;
}

export interface WorkflowStateSnapshot {
  readonly name: string;
  readonly currentStep: number;
  readonly totalSteps: number;
  readonly startedAt: number;
}

/**
 * Loaded SOPs snapshot.
 */
export interface SopSnapshot {
  readonly items: readonly SopItemSnapshot[];
  readonly totalLoaded: number;
}

export interface SopItemSnapshot {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly sourcePath: string;
  readonly lastUsedAt: number | null;
}

/**
 * Policy rules + recent violations.
 */
export interface PolicySnapshot {
  readonly rules: readonly PolicyRuleSnapshot[];
  readonly violations: readonly PolicyViolationSnapshot[];
  readonly enforcementMode: 'strict' | 'auto' | 'bypass';
  readonly recentViolationCount: number;
}

export interface PolicyRuleSnapshot {
  readonly id: string;
  readonly name: string;
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
  readonly lastEvaluatedAt: number;
  readonly lastResult: 'pass' | 'fail' | 'skip';
}

export interface PolicyViolationSnapshot {
  readonly id: string;
  readonly ruleId: string;
  readonly message: string;
  readonly at: number;
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
}
