export type CheckCost = "cheap" | "medium" | "expensive";

export type VerificationCheck = {
  id: string;
  command: string;
  reason: string;
  cost: CheckCost;
  required: boolean;
};

export type SkippedCheck = {
  command: string;
  reason: string;
};

export type VerificationPlan = {
  id: string;
  changedFiles: string[];
  checks: VerificationCheck[];
  skipped: SkippedCheck[];
};

const COST_ORDER: CheckCost[] = ["cheap", "medium", "expensive"];

export function buildVerificationPlan(checks: VerificationCheck[]): VerificationPlan {
  const sorted = [...checks].sort((a, b) => {
    const aIdx = COST_ORDER.indexOf(a.cost);
    const bIdx = COST_ORDER.indexOf(b.cost);
    if (aIdx !== bIdx) return aIdx - bIdx;
    if (a.required !== b.required) return a.required ? -1 : 1;
    return 0;
  });

  return {
    id: `plan_${Date.now()}`,
    changedFiles: [],
    checks: sorted,
    skipped: [],
  };
}

export function addSkippedCheck(plan: VerificationPlan, command: string, reason: string): VerificationPlan {
  return {
    ...plan,
    skipped: [...plan.skipped, { command, reason }],
  };
}