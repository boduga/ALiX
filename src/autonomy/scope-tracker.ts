export type TaskScope = {
  goal: string;
  files: string[];
  approvedAt?: string;
};

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
}