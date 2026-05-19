export type TaskScope = {
  goal: string;
  files: string[];
  approvedAt?: string;
};

export type AgentState = "idle" | "planning" | "executing" | "verifying" | "repairing" | "summarizing" | "waiting_approval" | "completed" | "failed" | "stopped";

export type Expansion = {
  detectedAt: string;
  originalFiles: string[];
  newFiles: string[];
  additionalFiles: string[];
};

export type ChangeEvaluation = {
  approved: boolean;
  reason: string;
  requiresConfirmation?: boolean;
  newFiles?: string[];
};

export class ScopeTracker {
  private scope: TaskScope | undefined;
  private expansions: Expansion[] = [];

  setInitialScope(scope: TaskScope): void {
    this.scope = { ...scope };
    this.expansions = [];
  }

  getCurrentScope(): TaskScope | undefined {
    return this.scope;
  }

  checkExpansion(current: { files?: string[] }): void {
    if (!this.scope || !current.files) return;

    const originalFiles = [...this.scope.files];
    const currentFiles = [...current.files];

    const initialSet = new Set(originalFiles);
    const additionalFiles = currentFiles.filter(f => !initialSet.has(f));

    if (additionalFiles.length === 0) return;

    const expansion: Expansion = {
      detectedAt: new Date().toISOString(),
      originalFiles,
      newFiles: currentFiles,
      additionalFiles,
    };

    this.expansions.push(expansion);
  }

  getExpansions(): Expansion[] {
    return [...this.expansions];
  }

  needsConfirmation(current: { files?: string[] }): boolean {
    if (!this.scope || !current.files) return false;
    if (this.scope.approvedAt) return false;

    const initialSet = new Set(this.scope.files);
    const hasExpansion = current.files.some(f => !initialSet.has(f));
    return hasExpansion;
  }

  evaluateChange(change: { files?: string[] }): ChangeEvaluation {
    if (!this.scope) {
      // No scope established - any change is allowed
      return { approved: true, reason: "No scope established - change allowed", requiresConfirmation: false };
    }

    if (!change.files) {
      return { approved: true, reason: "No files specified", requiresConfirmation: false };
    }

    const initialSet = new Set(this.scope.files);
    const additionalFiles = change.files.filter(f => !initialSet.has(f));

    if (additionalFiles.length === 0) {
      return { approved: true, reason: "Change is within scope", requiresConfirmation: false };
    }

    if (this.scope.approvedAt) {
      return { approved: true, reason: "Scope already approved", requiresConfirmation: false };
    }

    return {
      approved: false,
      reason: `Scope expansion detected: ${additionalFiles.length} new file(s) accessed`,
      requiresConfirmation: true,
      newFiles: additionalFiles,
    };
  }

  confirmExpansion(): void {
    if (!this.scope) return;
    this.scope.approvedAt = new Date().toISOString();
    this.expansions = [];
  }

  checkMutation(path: string): "allowed" | "denied" | "scope_expansion" | "approved" {
    if (!this.scope) return "allowed";
    if (this.scope.files.includes(path)) return "allowed";
    if (this.scope.approvedAt) return "approved";
    return "scope_expansion";
  }

  approveScope(path: string): void {
    if (!this.scope) return;
    if (!this.scope.files.includes(path)) {
      this.scope.files.push(path);
    }
  }

  denyScope(path: string): void {
    // Denying just prevents it from being auto-approved
  }

  setPending(path: string, pending: boolean = true): void {
    // Track pending approval state for a path
  }
}

export function createScopeTracker(initialScope?: TaskScope, cwd?: string): ScopeTracker {
  const tracker = new ScopeTracker();
  if (initialScope) {
    tracker.setInitialScope(initialScope);
  }
  return tracker;
}

export function extractInitialScope(args: string | string[]): TaskScope | undefined {
  const argArray = typeof args === "string" ? args.split(" ") : args;
  const goalArg = argArray.find(arg => !arg.startsWith("-"));
  const files = argArray.filter(arg => arg.startsWith("src/") || arg.startsWith("lib/") || arg.includes(".ts") || arg.includes(".js"));
  return goalArg ? { goal: goalArg, files } : undefined;
}

export function checkMutation(path: string, scope: TaskScope): "allowed" | "denied" | "scope_expansion" | "approved" {
  if (!scope.files) return "allowed";
  if (scope.files.includes(path)) return "allowed";
  if (scope.approvedAt) return "approved";
  return "scope_expansion";
}

export function approveScope(path: string, scope: TaskScope): void {
  if (!scope.files.includes(path)) {
    scope.files.push(path);
  }
}