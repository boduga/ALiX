/**
 * @alix/tool-repair — Model-keyed deterministic tool-call repair engine.
 */
import { PatternRegistry } from "./engine/registry.js";
import { validateToolCall } from "./engine/validator.js";
import { repairToolCall } from "./engine/repairer.js";
import { formatHint } from "./engine/hint-formatter.js";
import type { RepairOutcome } from "./types.js";

export class ToolRepair {
  private registry: PatternRegistry;

  constructor(
    private modelId: string,
    threshold?: number
  ) {
    this.registry = new PatternRegistry(threshold);
  }

  process(toolName: string, args: Record<string, unknown>): RepairOutcome {
    const patterns = this.registry.getPatternsForTool(this.modelId, toolName);
    if (patterns.length === 0) {
      return { repaired: false, args };
    }

    const validation = validateToolCall(patterns, toolName, args);
    if (!validation.matched) {
      return { repaired: false, args };
    }

    const outcome = repairToolCall(validation.matchedPatterns, args);
    if (outcome.repaired && outcome.hint) {
      outcome.hint = formatHint(outcome).text;
    }

    return outcome;
  }

  setModel(modelId: string): void {
    this.modelId = modelId;
  }

  reloadPatterns(): void {
    this.registry.reloadAll();
  }
}

export { PatternRegistry } from "./engine/registry.js";
export { validateToolCall } from "./engine/validator.js";
export { repairToolCall } from "./engine/repairer.js";
export { formatHint } from "./engine/hint-formatter.js";
export * from "./types.js";
