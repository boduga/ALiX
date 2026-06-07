import type { AgentState } from "./scope-tracker.js";

export type RunLimits = {
  maxIterations: number;
  maxRepairs: number;
  maxFileChanges: number;
  maxShellCommands: number;
  maxRuntimeMs: number;
};

export type RunCounters = {
  iterations: number;
  repairs: number;
  fileChanges: number;
  shellCommands: number;
  runtimeMs: number;
};

export type StateSnapshot = {
  state: AgentState;
  counters: RunCounters;
};

export type RunResult = {
  success: boolean;
  reason: string;
  state: AgentState;
  counters: RunCounters;
};

type TransitionGuard = (ctx: TransitionContext) => { allowed: boolean; reason?: string };

type TransitionContext = {
  state: AgentState;
  counters: RunCounters;
  scopeExpanded: boolean;
  verificationPassed: boolean;
  modelSignaledDone: boolean;
  pendingScopeFile: string | null;
};

/**
 * Hard limits for the agent run. Enforces all limits at each transition.
 */
export class RunLimiter {
  constructor(private limits: RunLimits) {}

  canTransition(from: AgentState, to: AgentState, ctx: TransitionContext): { allowed: boolean; reason?: string } {
    if (this.limits.maxIterations > 0 && ctx.counters.iterations >= this.limits.maxIterations) {
      return { allowed: false, reason: `Max iterations reached (${this.limits.maxIterations})` };
    }
    if (this.limits.maxRepairs > 0 && ctx.counters.repairs >= this.limits.maxRepairs) {
      return { allowed: false, reason: `Max repairs reached (${this.limits.maxRepairs})` };
    }
    if (this.limits.maxRuntimeMs > 0 && ctx.counters.runtimeMs > this.limits.maxRuntimeMs) {
      return { allowed: false, reason: `Max runtime exceeded (${this.limits.maxRuntimeMs}ms)` };
    }
    return { allowed: true };
  }

  checkCounter(limit: keyof RunLimits, value: number): boolean {
    const max = this.limits[limit] as number;
    return max > 0 && value >= max;
  }
}

/**
 * State machine for the agent run lifecycle.
 * Transitions are driven by agent actions, not model signaling.
 */
export class TaskStateMachine {
  private state: AgentState = "planning";
  private counters: RunCounters = {
    iterations: 0,
    repairs: 0,
    fileChanges: 0,
    shellCommands: 0,
    runtimeMs: 0,
  };

  constructor(
    private limiter: RunLimiter,
    private onTransition?: (from: AgentState, to: AgentState, reason?: string) => void
  ) {}

  get currentState(): AgentState {
    return this.state;
  }

  get snapshot(): RunCounters {
    return { ...this.counters };
  }

  /**
   * Called at the start of each iteration.
   */
  tick(runtimeMs: number) {
    this.counters.iterations++;
    this.counters.runtimeMs += runtimeMs;
  }

  /**
   * Increment file change counter.
   */
  recordFileChange() {
    this.counters.fileChanges++;
  }

  /**
   * Increment shell command counter.
   */
  recordShellCommand() {
    this.counters.shellCommands++;
  }

  /**
   * Record a repair attempt (verification failed and model is re-attempting).
   */
  recordRepair() {
    this.counters.repairs++;
  }

  /**
   * Transition to executing when model first requests a mutation (write/delete/shell).
   */
  toExecuting(scopeExpanded: boolean): { allowed: boolean; reason?: string } {
    if (scopeExpanded) {
      // Scope expansion detected — don't transition yet, user must approve
      return { allowed: false, reason: "scope_expansion_pending" };
    }
    const ctx = this.buildContext(false, false, false);
    const result = this.limiter.canTransition(this.state, "executing", ctx);
    if (result.allowed && this.state === "planning") {
      this._transition("executing");
    }
    return result;
  }

  /**
   * Transition to verifying when model signals done.
   */
  toVerifying(verificationPassed: boolean): { allowed: boolean; reason?: string } {
    const ctx = this.buildContext(false, verificationPassed, true);
    const result = this.limiter.canTransition(this.state, "verifying", ctx);
    if (result.allowed) {
      if (this.state === "executing" || this.state === "repairing") {
        this._transition("verifying");
      }
    }
    return result;
  }

  /**
   * Transition to repairing when verification fails.
   */
  toRepairing(): { allowed: boolean; reason?: string } {
    const ctx = this.buildContext(false, false, false);
    const result = this.limiter.canTransition(this.state, "repairing", ctx);
    if (result.allowed) {
      if (this.state === "verifying") {
        this._transition("repairing");
        this.recordRepair();
      }
    }
    return result;
  }

  /**
   * Transition to summarizing when verification passed and model signaled done.
   */
  toSummarizing(): { allowed: boolean; reason?: string } {
    const ctx = this.buildContext(false, true, true);
    const result = this.limiter.canTransition(this.state, "summarizing", ctx);
    if (result.allowed) {
      this._transition("summarizing");
    }
    return result;
  }

  /**
   * Hard stop — reached a limit.
   */
  stop(reason: string): RunResult {
    this.state = "stopped";
    return {
      success: false,
      reason,
      state: this.state,
      counters: this.snapshot,
    };
  }

  /**
   * Normal completion — verification passed and model signaled done.
   */
  complete(): RunResult {
    this.state = "stopped";
    return {
      success: true,
      reason: "completed",
      state: this.state,
      counters: this.snapshot,
    };
  }

  private buildContext(scopeExpanded: boolean, verificationPassed: boolean, modelSignaledDone: boolean): TransitionContext {
    return {
      state: this.state,
      counters: this.snapshot,
      scopeExpanded: scopeExpanded,
      verificationPassed,
      modelSignaledDone,
      pendingScopeFile: null,
    };
  }

  private _transition(to: AgentState, reason?: string) {
    const from = this.state;
    this.state = to;
    this.onTransition?.(from, to, reason);
  }

  /** @internal - for testing only */
  _setState(to: AgentState) { this.state = to; }

  /** Serialize state for persistence (session resume). */
  toJSON(): StateSnapshot {
    return {
      state: this.state,
      counters: this.snapshot,
    };
  }

  /** Restore state from a snapshot. */
  static fromJSON(snapshot: StateSnapshot, limiter: RunLimiter, onTransition?: (from: AgentState, to: AgentState, reason?: string) => void): TaskStateMachine {
    const sm = new TaskStateMachine(limiter, onTransition);
    sm.state = snapshot.state;
    sm.counters = { ...snapshot.counters };
    return sm;
  }
}
