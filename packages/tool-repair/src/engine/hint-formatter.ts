import type { RepairOutcome } from "../types.js";

export type FormattedHint = {
  text: string;
  structured?: {
    fixed: Array<{ param: string; issue: string; action: string }>;
    total_fixes: number;
  };
};

export function formatHint(
  outcome: RepairOutcome,
  _verbose = false
): FormattedHint {
  if (!outcome.repaired) {
    return { text: "" };
  }

  const text = outcome.hint ?? "";

  return {
    text,
    structured: !_verbose
      ? undefined
      : {
          fixed: [],
          total_fixes: outcome.patternId?.split(", ").length ?? 0,
        },
  };
}
