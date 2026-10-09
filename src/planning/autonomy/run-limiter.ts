export type RunLimits = {
  maxSteps: number;
  maxCost: number;
  maxFileChanges: number;
  maxShellCommands: number;
  maxRetries: number;
  maxRuntimeSeconds: number;
};

export type RunCounters = {
  steps: number;
  cost: number;
  fileChanges: number;
  shellCommands: number;
};

export type LimitCheckResult = {
  allowed: boolean;
  reason?: string;
  limit?: string;
};

export type RemainingCapacity = {
  steps: number;
  cost: number;
  fileChanges: number;
  shellCommands: number;
};

const WARNING_THRESHOLD = 0.8;

export class RunLimiter {
  constructor(private limits: RunLimits) {}

  check(counters: RunCounters): LimitCheckResult {
    if (this.limits.maxSteps > 0 && counters.steps >= this.limits.maxSteps) {
      return { allowed: false, reason: `Max steps reached (${this.limits.maxSteps})`, limit: "maxSteps" };
    }
    if (this.limits.maxCost > 0 && counters.cost >= this.limits.maxCost) {
      return { allowed: false, reason: `Max cost reached (${this.limits.maxCost})`, limit: "maxCost" };
    }
    if (this.limits.maxFileChanges > 0 && counters.fileChanges >= this.limits.maxFileChanges) {
      return { allowed: false, reason: `Max file changes reached (${this.limits.maxFileChanges})`, limit: "maxFileChanges" };
    }
    if (this.limits.maxShellCommands > 0 && counters.shellCommands >= this.limits.maxShellCommands) {
      return { allowed: false, reason: `Max shell commands reached (${this.limits.maxShellCommands})`, limit: "maxShellCommands" };
    }
    return { allowed: true };
  }

  getRemaining(counters: RunCounters): RemainingCapacity {
    return {
      steps: this.limits.maxSteps > 0 ? Math.max(0, this.limits.maxSteps - counters.steps) : Infinity,
      cost: this.limits.maxCost > 0 ? Math.max(0, this.limits.maxCost - counters.cost) : Infinity,
      fileChanges: this.limits.maxFileChanges > 0 ? Math.max(0, this.limits.maxFileChanges - counters.fileChanges) : Infinity,
      shellCommands: this.limits.maxShellCommands > 0 ? Math.max(0, this.limits.maxShellCommands - counters.shellCommands) : Infinity,
    };
  }

  getWarnings(counters: RunCounters): string[] {
    const warnings: string[] = [];
    if (this.limits.maxSteps > 0 && counters.steps / this.limits.maxSteps >= WARNING_THRESHOLD) {
      warnings.push(`steps at ${Math.round(counters.steps / this.limits.maxSteps * 100)}% capacity (${counters.steps}/${this.limits.maxSteps})`);
    }
    if (this.limits.maxCost > 0 && counters.cost / this.limits.maxCost >= WARNING_THRESHOLD) {
      warnings.push(`cost at ${Math.round(counters.cost / this.limits.maxCost * 100)}% capacity (${counters.cost}/${this.limits.maxCost})`);
    }
    if (this.limits.maxFileChanges > 0 && counters.fileChanges / this.limits.maxFileChanges >= WARNING_THRESHOLD) {
      warnings.push(`fileChanges at ${Math.round(counters.fileChanges / this.limits.maxFileChanges * 100)}% capacity (${counters.fileChanges}/${this.limits.maxFileChanges})`);
    }
    if (this.limits.maxShellCommands > 0 && counters.shellCommands / this.limits.maxShellCommands >= WARNING_THRESHOLD) {
      warnings.push(`shellCommands at ${Math.round(counters.shellCommands / this.limits.maxShellCommands * 100)}% capacity (${counters.shellCommands}/${this.limits.maxShellCommands})`);
    }
    return warnings;
  }

  isExpired(startTime: Date): boolean {
    if (this.limits.maxRuntimeSeconds <= 0) {
      return false;
    }
    const elapsedSeconds = (Date.now() - startTime.getTime()) / 1000;
    return elapsedSeconds > this.limits.maxRuntimeSeconds;
  }
}