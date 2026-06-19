export interface CapabilityRequirement {
  capability: string;
  reason: string;
  priority: "required" | "optional";
}

export interface OutcomeNode {
  id: string;
  description: string;
  requiredCapabilities: string[];
  estimatedEffort: "small" | "medium" | "large";
}

export interface GoalPlan {
  goal: string;
  outcomeNodes: OutcomeNode[];
  requiredCapabilities: string[];
  suggestedSkill?: string;
  riskFlags: string[];
  requiresApproval: boolean;
}

export type GoalVerdict = "feasible" | "needs_info" | "not_feasible";
