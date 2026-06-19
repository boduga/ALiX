export interface OutcomeNode {
  id: string;
  description: string;
  requiredCapabilities: string[];
  estimatedEffort: "small" | "medium" | "large" | "unknown";
  dependencies?: string[];
  acceptanceCriteria?: string[];
}

export interface GoalPlan {
  /** The original natural-language goal */
  goal: string;
  /** Decomposed outcome nodes */
  outcomeNodes: OutcomeNode[];
  /** All capabilities required across all nodes */
  requiredCapabilities: string[];
  /** Suggested skill or workflow ID */
  suggestedSkill?: string;
  /** Risk flags identified during decomposition */
  riskFlags: string[];
  /** If true, human approval is required before execution */
  requiresApproval: boolean;
  /** Justification for the decomposition */
  reasoning?: string;
}
