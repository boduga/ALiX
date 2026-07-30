// src/run/intent-classifier.ts
// Classifies the agent's current intent from observed tool calls.
// Sticky: mode only changes after ≥2 consecutive contradictory iterations.

export type AgentIntent = "research" | "mutation" | "validation";

// Tool name patterns for intent classification
const RESEARCH_TOOLS = new Set([
  "file.read", "dir.search", "web_fetch", "web_search",
  "mcp_discovery", "grep", "glob", "list_files",
]);

const MUTATION_TOOLS = new Set([
  "file.edit", "file.create", "file.delete", "patch.apply",
  "file.write", "file.rename",
]);

/** Detect validation intent from shell command strings. */
const VALIDATION_COMMAND_RE = /\b(test|lint|typecheck|verify|check|vitest|jest|pytest)\b/i;
const MUTATION_COMMAND_RE = /\b(build|compile|install|format|npm\s+(install|run\s+build)|go\s+build|rustc)\b/i;

export class IntentClassifier {
  /**
   * Classify a batch of tool calls from one iteration.
   * Returns the dominant intent, defaulting to research.
   */
  classify(toolCalls: Array<{ name: string; args: Record<string, unknown> }>): AgentIntent {
    if (toolCalls.length === 0) return "research";

    let researchScore = 0;
    let mutationScore = 0;
    let validationScore = 0;

    for (const tc of toolCalls) {
      if (RESEARCH_TOOLS.has(tc.name)) {
        researchScore++;
      } else if (MUTATION_TOOLS.has(tc.name)) {
        mutationScore++;
      } else if (tc.name === "shell.run") {
        const command = String(tc.args.command ?? "");
        if (VALIDATION_COMMAND_RE.test(command)) {
          mutationScore--;
          validationScore++;
        } else if (MUTATION_COMMAND_RE.test(command)) {
          mutationScore++;
        } else {
          // Default for shell.run with unknown command: count as mutation
          mutationScore++;
        }
      }
      // Unrecognized tools: count as research (exploration)
      else {
        researchScore++;
      }
    }

    if (validationScore > 0 && validationScore >= researchScore && validationScore >= mutationScore) {
      return "validation";
    }
    if (mutationScore > 0 && mutationScore >= researchScore) {
      return "mutation";
    }
    return "research";
  }

  /**
   * Apply sticky logic: only change mode after ≥2 consecutive iterations
   * where the new intent differs from the current one.
   */
  update(current: AgentIntent, observed: AgentIntent, streak: number): { next: AgentIntent; streak: number } {
    if (observed === current) {
      return { next: current, streak: 0 };
    }
    const newStreak = streak + 1;
    if (newStreak >= 2) {
      return { next: observed, streak: 0 };
    }
    return { next: current, streak: newStreak };
  }
}
