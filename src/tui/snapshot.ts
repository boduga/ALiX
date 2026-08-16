import type { SessionPhase } from './state.js';
import type { DaemonMetricsSnapshot, ClientSnapshot } from './daemon-metrics-collector.js';
import type { ExecutionTraceEntry } from './runtime/execution-trace.js';
import type { TimelineEntry } from './runtime/timeline-builder.js';
import type { CapabilityProjectionSnapshot } from './runtime/capability-projection.js';
import type { MetricsProjectionSnapshot } from './runtime/metrics-projection.js';
import type { ContextProjectionSnapshot } from './runtime/context-projection.js';
import type { EvolutionProjectionSnapshot } from './runtime/evolution/evolution-projection-snapshot.js';
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
  /**
   * Absolute path of the working directory the TUI was launched from.
   * Populated by SnapshotBuilder from the cwd captured by the TUI command.
   * Surfaced in the DAEMON panel as the "Workspace" row so the operator
   * always knows which project the current dashboard reflects.
   */
  readonly cwd: string;
  /**
   * Most recent progress ledger text rendered by the agent loop.
   * Populated by SnapshotBuilder from agent session state.
   */
  readonly progressLedger?: string;
  /**
   * Pending tool calls for inline scrollback rendering in the agent view.
   * Synced from session state on each refresh.
   */
  readonly pendingToolCalls?: ReadonlyArray<{ readonly name: string; readonly summary?: string }>;
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
  /**
   * Classified agent intent for the current iteration. Populated by
   * SnapshotBuilder from session state when available; undefined when
   * the session does not expose intent (defaults to research, which
   * renders no badge).
   */
  readonly currentIntent?: 'research' | 'mutation' | 'validation';
  /**
   * Pending tool calls surfaced by the agent loop for inline scrollback
   * rendering. Each entry renders as a two-line dim card in the agent view.
   */
  readonly pendingToolCalls?: ReadonlyArray<{ readonly name: string; readonly summary?: string }>;
  /**
   * Cumulative count of files touched (created/changed/deleted) across all
   * turns in this session. Surfaced by the TUI header to replace the prior
   * hardcoded "FILES: 0" placeholder.
   */
  readonly filesTouched?: number;
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
  readonly target: string;
  readonly args: Record<string, unknown>;
  readonly requestedAt: number;
  readonly requestedBy: string;
}

/**
 * Runtime execution telemetry. `trace` holds the operator-facing lifecycle
 * units (interpretation); `timeline` holds the append-only chat/agent/tool
 * narrative for the projected session (D6); `totalEventCount`/`lastEventAt`
 * are raw-log accounting metadata (D7). `sessionId` names the session this
 * snapshot projects — every projection (trace, timeline, workflow) is
 * sessionId-scoped (D1/D3).
 */
export interface RuntimeSnapshot {
  /** Execution-trace lifecycle units, built from the EventLog. Immutable DTOs. */
  readonly trace: readonly ExecutionTraceEntry[];
  /** Append-only timeline entries for the projected session, oldest→newest. */
  readonly timeline: readonly TimelineEntry[];
  readonly workflow: WorkflowStateSnapshot | null;
  readonly totalEventCount: number;
  readonly lastEventAt: number | null;
  /** The session this snapshot projects. All projections are sessionId-scoped. */
  readonly sessionId: string;
  /**
   * Per-capability runtime activity stats (CapabilityProjection). Null when the
   * projection isn't registered (e.g. older collectors).
   */
  readonly capabilities: CapabilityProjectionSnapshot | null;
  /**
   * Session-level metrics aggregate (MetricsProjection). Null when the
   * projection isn't registered (e.g. chat/agent collectors — they see no
   * tool/capability events).
   */
  readonly metrics: MetricsProjectionSnapshot | null;
  /**
   * Candidate-context projection (ContextProjectionBuilder — Task 4, spec
   * #456 F). Immutable budget-agnostic snapshot the assembler consumes; null
   * when the projection isn't registered (e.g. older collectors).
   */
  readonly context: ContextProjectionSnapshot | null;
  /**
   * Evolution-loop projection (A7 lifecycle → A8 learning → A9 forecasts /
   * correlations → A2.5/A3 projected decisions → measurements). Null when the
   * projection isn't registered (e.g. older collectors).
   */
  readonly evolution?: EvolutionProjectionSnapshot | null;
  /**
   * Experimental extension boundary only.
   * Runtime consumers MUST NOT depend on keys here.
   * Typed snapshot fields are the supported API.
   */
  readonly projections?: Readonly<Record<string, unknown>>;
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
