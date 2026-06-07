import type { Pattern, RepairOutcome } from "../types.js";
import { applyTransform } from "../transforms/index.js";

export function repairToolCall(
  patterns: Pattern[],
  args: Record<string, unknown>
): RepairOutcome {
  let currentArgs = { ...args };
  const appliedPatterns: string[] = [];
  let anyChanged = false;

  for (const pattern of patterns) {
    let patternChanged = false;

    if (pattern.params["*"]) {
      // Apply "*" transform to all keys
      for (const key of Object.keys(currentArgs)) {
        const result = applyTransform(
          pattern.params["*"].repair,
          currentArgs,
          key,
          pattern.params["*"].value
        );
        if (result.changed) {
          currentArgs = result.args;
          patternChanged = true;
        }
      }
    } else {
      // Apply per-param transforms
      for (const [paramName, paramRepair] of Object.entries(pattern.params)) {
        const result = applyTransform(
          paramRepair.repair,
          currentArgs,
          paramName,
          paramRepair.value
        );
        if (result.changed) {
          currentArgs = result.args;
          patternChanged = true;
        }
      }
    }

    if (patternChanged) {
      appliedPatterns.push(pattern.id);
      anyChanged = true;
    }
  }

  if (!anyChanged) {
    return { repaired: false, args };
  }

  const hints = appliedPatterns
    .map((id) => patterns.find((p) => p.id === id)?.hint)
    .filter(Boolean) as string[];

  return {
    repaired: true,
    args: currentArgs,
    hint: hints.join(" "),
    patternId: appliedPatterns.join(", "),
  };
}
