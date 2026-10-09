/**
 * performance-budgets.ts — Latency budgets for ALiX operations.
 *
 * Each budget has two thresholds:
 *   warningMs  — exceeded → non-fatal warning
 *   failureMs  — exceeded → hard failure
 *
 * Environments let CI and local workstations use different ceilings.
 */

export type BudgetEnvironment = "local" | "ci";

export type PerformanceBudget = {
  name: string;           // kebab-case, matches benchmark case names
  label: string;
  warningMs: number;      // exceeded → warning (non-fatal)
  failureMs: number;      // exceeded → failure
};

export type BudgetContext = {
  os: string;
  arch: string;
  profile?: string;
  environment: BudgetEnvironment;
};

export type BudgetStatus = "pass" | "warning" | "fail" | "unbudgeted";

export type BudgetResult = {
  name: string;
  label: string;
  actualMs: number;
  status: BudgetStatus;
  message: string;
};

// Default local budgets (CI budgets would be a separate profile)
export const PERFORMANCE_BUDGETS: PerformanceBudget[] = [
  { name: "cli-startup",     label: "CLI startup (--help)",              warningMs: 300,  failureMs: 800 },
  { name: "models-doctor",   label: "Hardware + model doctor",           warningMs: 1000, failureMs: 3000 },
  { name: "runtime-index",   label: "RuntimeIndex build + query",        warningMs: 300,  failureMs: 1000 },
  { name: "context-compile", label: "Context compilation (repo map)",     warningMs: 2000, failureMs: 5000 },
  { name: "daemon-submit",   label: "Daemon submit + ack",               warningMs: 50,   failureMs: 200 },
  { name: "no-tool-task",    label: "End-to-end no-tool task (mock)",    warningMs: 5000, failureMs: 15000 },
];

/**
 * Check a single measurement against a budget.
 * Returns pass/warning/fail based on actualMs relative to thresholds.
 */
export function checkBudget(actualMs: number, budget: PerformanceBudget): BudgetResult {
  const rounded = Math.round(actualMs * 100) / 100;
  if (rounded > budget.failureMs) {
    return { name: budget.name, label: budget.label, actualMs: rounded, status: "fail", message: `${budget.label}: ${rounded} ms over failure budget ${budget.failureMs} ms ❌` };
  }
  if (rounded > budget.warningMs) {
    return { name: budget.name, label: budget.label, actualMs: rounded, status: "warning", message: `${budget.label}: ${rounded} ms (warning at ${budget.warningMs} ms) ⚠️` };
  }
  return { name: budget.name, label: budget.label, actualMs: rounded, status: "pass", message: `${budget.label}: ${rounded} ms ✅` };
}

/**
 * Check all measurements against their budgets.
 * Unknown benchmark names return "unbudgeted".
 */
export function checkAllBudgets(
  measurements: Array<{ name: string; meanMs: number }>,
): BudgetResult[] {
  return measurements.map(m => {
    const budget = PERFORMANCE_BUDGETS.find(b => b.name === m.name);
    if (!budget) {
      return { name: m.name, label: m.name, actualMs: m.meanMs, status: "unbudgeted", message: `${m.name}: no budget configured` };
    }
    return checkBudget(m.meanMs, budget);
  });
}
