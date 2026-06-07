import type { Pattern, MatchCondition } from "../types.js";

export type ValidationResult = {
  matched: boolean;
  matchedPatterns: Pattern[];
  issues: Array<{ param: string; patternId: string; issue: string }>;
};

export function validateToolCall(
  patterns: Pattern[],
  toolName: string,
  args: Record<string, unknown>
): ValidationResult {
  const matchedPatterns: Pattern[] = [];
  const issues: Array<{ param: string; patternId: string; issue: string }> = [];

  for (const pattern of patterns) {
    if (!pattern.tools.includes("*") && !pattern.tools.includes(toolName)) continue;

    const match = matchCondition(pattern.match, args, pattern.id);
    if (match.matched) {
      matchedPatterns.push(pattern);
      issues.push(...match.issues);
    }
  }

  return {
    matched: matchedPatterns.length > 0,
    matchedPatterns,
    issues,
  };
}

function matchCondition(
  condition: MatchCondition,
  args: Record<string, unknown>,
  patternId: string
): { matched: boolean; issues: Array<{ param: string; patternId: string; issue: string }> } {
  const issues: Array<{ param: string; patternId: string; issue: string }> = [];

  // Check null fields
  if (condition.null_fields && condition.null_fields.length > 0) {
    for (const field of condition.null_fields) {
      if (args[field] === null) {
        issues.push({
          param: field,
          patternId,
          issue: `Field "${field}" is null/undefined`,
        });
      }
    }
  }

  // Check missing fields
  if (condition.missing_fields && condition.missing_fields.length > 0) {
    for (const field of condition.missing_fields) {
      if (!(field in args)) {
        issues.push({
          param: field,
          patternId,
          issue: `Required field "${field}" is missing`,
        });
      }
    }
  }

  // Check type mismatch on first param that matches
  if (condition.expected_type && condition.actual_type) {
    for (const [key, val] of Object.entries(args)) {
      const actualType = Array.isArray(val) ? "array" : typeof val;
      if (condition.actual_type === actualType) {
        issues.push({
          param: key,
          patternId,
          issue: `Expected ${condition.expected_type}, got ${actualType}`,
        });
      }
    }
  }

  // Check regex pattern on string values
  if (condition.pattern) {
    try {
      const regex = new RegExp(condition.pattern);
      for (const [key, val] of Object.entries(args)) {
        if (typeof val === "string" && regex.test(val)) {
          issues.push({
            param: key,
            patternId,
            issue: `Value matches problematic pattern: ${condition.pattern}`,
          });
        }
      }
    } catch {
      // Invalid regex in pattern — skip
    }
  }

  return { matched: issues.length > 0, issues };
}
