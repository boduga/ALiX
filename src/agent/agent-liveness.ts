// src/agent/agent-liveness.ts
//
// Progress-based liveness for agent turns. Agent execution has NO wall-clock
// lifetime limit — a turn may run minutes or hours until it reaches a
// terminal state or the operator cancels. Wall-clock duration is the wrong
// liveness signal. What matters is: *has the execution made progress lately?*
//
// The tracker is fed progress marks (model chunks, model responses, tool
// completions, phase changes) and computes a liveness state from the idle
// window since the last mark. A watchdog observes the snapshot and emits
// warning/stalled events on state transitions — it NEVER terminates the run.

export type AgentProgressKind =
  | "model_chunk"
  | "model_response"
  | "reasoning"
  | "phase_changed"
  | "tool_requested"
  | "tool_started"
  | "tool_output"
  | "tool_completed"
  | "verification"
  | "state_changed";

export type AgentLivenessState = "healthy" | "warning" | "stalled";

export interface AgentLivenessSnapshot {
  /** Monotonic start of the active turn. */
  startedAt: number;
  /** Ms since the last progress mark. Negative before the first mark. */
  idleMs: number;
  /** Total progress marks received this turn. */
  progressCount: number;
  lastProgressAt: number;
  lastProgressKind?: AgentProgressKind;
  lastProgressDescription?: string;
  state: AgentLivenessState;
}

export interface AgentLivenessThresholds {
  /** No progress for this long → RUNNING/WARNING. */
  warningAfterMs: number;
  /** No progress for this long → RUNNING/STALLED. */
  stalledAfterMs: number;
}

export const DEFAULT_LIVENESS_THRESHOLDS: AgentLivenessThresholds = {
  warningAfterMs: 120_000,
  stalledAfterMs: 600_000,
};

export class AgentLiveness {
  private readonly startedAt = Date.now();
  private lastProgressAt = this.startedAt;
  private progressCount = 0;
  private lastProgressKind?: AgentProgressKind;
  private lastProgressDescription?: string;
  /** Minimum interval between model_chunk marks — token flow is far too hot
   *  to record every text chunk as a distinct progress event. */
  private readonly chunkDebounceMs;
  private lastChunkMarkAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly thresholds: AgentLivenessThresholds = DEFAULT_LIVENESS_THRESHOLDS,
    chunkDebounceMs = 1_000,
  ) {
    this.chunkDebounceMs = chunkDebounceMs;
  }

  /** Record a progress event. Cheap and never throws (the watchdog is
   *  observability, not a control surface). */
  mark(kind: AgentProgressKind, description?: string): void {
    const now = Date.now();
    if (kind === "model_chunk") {
      // Debounce hot token flow; every other kind is already discrete.
      if (now - this.lastChunkMarkAt < this.chunkDebounceMs) return;
      this.lastChunkMarkAt = now;
    }
    this.lastProgressAt = now;
    this.progressCount++;
    this.lastProgressKind = kind;
    this.lastProgressDescription = description;
  }

  snapshot(): AgentLivenessSnapshot {
    // A turn that just started has "zero idle" until its first mark.
    const idleMs = Math.max(0, Date.now() - this.lastProgressAt);
    let state: AgentLivenessState = "healthy";
    if (idleMs >= this.thresholds.stalledAfterMs) {
      state = "stalled";
    } else if (idleMs >= this.thresholds.warningAfterMs) {
      state = "warning";
    }
    return {
      startedAt: this.startedAt,
      idleMs,
      progressCount: this.progressCount,
      lastProgressAt: this.lastProgressAt,
      lastProgressKind: this.lastProgressKind,
      lastProgressDescription: this.lastProgressDescription,
      state,
    };
  }
}