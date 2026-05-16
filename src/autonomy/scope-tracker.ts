import { resolve } from "node:path";

export type AgentState = "planning" | "executing" | "verifying" | "repairing" | "summarizing" | "stopped";

export type ScopeTracker = {
  state: AgentState;
  initialFiles: Set<string>;
  approvedFiles: Set<string>;
  pendingApproval: string | null;
  transition(newState: AgentState): void;
  checkMutation(path: string): "allowed" | "scope_expansion" | "approved";
  approveScope(path: string): void;
  denyScope(path: string): void;
  setPending(path: string): void;
  clearPending(): void;
  getDeniedMessage(): string | null;
};

/**
 * Parse file paths mentioned in the task string.
 * Detects patterns like: src/foo.ts, "file.ts", `file.ts`
 */
export function extractInitialScope(task: string): string[] {
  const paths: string[] = [];
  // Match quoted or backtick paths, or paths with slashes that look like file references
  const patterns = [
    /["'`]([^\s`]+?\.(?:ts|tsx|js|jsx|py|go|rs|java|kt|cs|rb|php|swift|c|cpp|h|hpp|json|md|toml|yaml|yml))["'`]/g,
    /(?:^|\s)([\w./-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|kt|cs|rb|php|swift|c|cpp|h|hpp|json|md|toml|yaml|yml))(?=\s|$)/gm,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(task)) !== null) {
      paths.push(match[1]);
    }
  }
  return [...new Set(paths)];
}

/**
 * Normalize a path for comparison (relative to root, trailing slashes removed).
 */
function normalize(path: string, root: string): string {
  try { return resolve(root, path); } catch { return path; }
}

export function createScopeTracker(
  initialFiles: string[],
  root: string
): ScopeTracker {
  const initialSet = new Set(initialFiles.map(p => normalize(p, root)));
  const approvedSet = new Set(initialSet); // initial scope is auto-approved

  let currentState: AgentState = "planning";
  let pendingFile: string | null = null;

  return {
    get state() { return currentState; },

    get initialFiles() { return initialSet; },
    get approvedFiles() { return approvedSet; },
    get pendingApproval() { return pendingFile; },

    transition(newState: AgentState) {
      currentState = newState;
      pendingFile = null;
    },

    checkMutation(path: string): "allowed" | "scope_expansion" | "approved" {
      const n = normalize(path, root);
      if (approvedSet.has(n)) return "approved";
      if (initialSet.has(n)) return "allowed"; // initial scope — auto-approved for mutation
      return "scope_expansion";
    },

    approveScope(path: string) {
      const n = normalize(path, root);
      approvedSet.add(n);
      pendingFile = null;
    },

    denyScope(_path: string) {
      pendingFile = null;
    },

    setPending(path: string) {
      pendingFile = path;
    },

    clearPending() {
      pendingFile = null;
    },

    getDeniedMessage() {
      return pendingFile ? `Scope expansion denied for: ${pendingFile}` : null;
    },
  };
}