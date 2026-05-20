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
  private approvedPaths: Set<string> = new Set();
  private deniedPaths: Set<string> = new Set();
  private _pendingApproval: string | null = null;

  get pendingApproval(): string | null {
    return this._pendingApproval;
  }

  setInitialScope(scope: TaskScope): void {
    this.scope = { ...scope };
    this.expansions = [];
  }

  getCurrentScope(): TaskScope | undefined {
    return this.scope;
  }

  checkMutation(path: string): "allowed" | "denied" | "scope_expansion" | "approved" {
    if (!this.scope?.files) return "allowed";

    if (this.approvedPaths.has(path)) return "approved";
    if (this.deniedPaths.has(path)) return "denied";
    if (this.scope.files.includes(path)) return "allowed";

    this._pendingApproval = path;
    return "scope_expansion";
  }

  approveScope(path: string): void {
    this.approvedPaths.add(path);
    this._pendingApproval = null;
  }

  denyScope(path: string): void {
    this.deniedPaths.add(path);
    this._pendingApproval = null;
  }

  setPending(path: string, pending: boolean = true): void {
    this._pendingApproval = pending ? path : null;
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
}

export function createScopeTracker(initialFiles: string[] = [], cwd?: string): ScopeTracker {
  const tracker = new ScopeTracker();
  const files = cwd
    ? initialFiles.map(f => f.startsWith("/") ? f : `${cwd.replace(/\/$/, "")}/${f}`)
    : initialFiles;
  if (files.length > 0) {
    tracker.setInitialScope({ goal: "", files });
    for (const f of files) {
      tracker.approveScope(f);
    }
  }
  return tracker;
}

export function extractInitialScope(args: string | string[]): TaskScope | undefined {
  const argArray = typeof args === "string" ? args.split(" ") : args;
  const goalArg = argArray.find(arg => !arg.startsWith("-"));
  // Match paths: starts with src/, lib/, ./, ../, or ends with .ts/.js/.tsx/.jsx
  // Also handles quoted paths by stripping quotes
  const files = argArray
    .map(arg => arg.replace(/^["']|["']$/g, "")) // strip quotes
    .filter(arg =>
      arg.startsWith("src/") || arg.startsWith("lib/") ||
      arg.startsWith("./") || arg.startsWith("../") ||
      arg.includes(".ts") || arg.includes(".js")
    );
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