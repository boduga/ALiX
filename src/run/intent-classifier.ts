// src/run/intent-classifier.ts
// Classifies the agent's current intent from observed tool calls.
// Sticky: mode only changes after ≥2 consecutive contradictory iterations.
//
// T13 (#384) recognition contract: agent_loop_mode is the orthogonal
// Layer-4 sticky FSM consumed inside the agent loop. It is NOT part of
// the routing chain (see `docs/intent-contracts/canonical-taxonomy.md`).
// This file composes three deterministic sub-recognizers
// (research / mutation / validation) driven solely by observed tool
// calls. The `update` method applies a ≥2-iteration streak filter so
// the emitted `AgentIntent` does not flip-flop.

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

/**
 * Detect validation intent from shell command strings.
 *
 * Covers the canonical validators in this repo:
 *   - `pnpm test`, `jest`, `pytest`, `vitest`
 *   - `pnpm lint`, `eslint`
 *   - `tsc --noEmit`, `pnpm typecheck` (the missing `tsc` was the
 *     documented T13 contract boundary — fixed in this PR)
 *   - `alix verify`, generic `check ./dist`
 *
 * Word-boundary anchored so `tsconfig.json` does NOT match (`tsc` is
 * followed by `o`, no word boundary). Stays additive: every command
 * previously matched as validation remains matched.
 */
const VALIDATION_COMMAND_RE = /\b(test|lint|typecheck|tsc|verify|check|vitest|jest|pytest)\b/i;
const MUTATION_COMMAND_RE = /\b(build|compile|install|format|npm\s+(install|run\s+build)|go\s+build|rustc)\b/i;

export class IntentClassifier {
  /**
   * Classify a batch of tool calls from one iteration.
   * Returns the dominant intent, defaulting to research.
   *
   * Composes three deterministic sub-recognizers:
   *   1. research sub-recognizer — `RESEARCH_TOOLS` set (file.read,
   *      dir.search, web_fetch, web_search, mcp_discovery, grep, glob,
   *      list_files) plus the safe default for unrecognized tools.
   *   2. mutation sub-recognizer — `MUTATION_TOOLS` set (file.edit,
   *      file.create, file.delete, patch.apply, file.write, file.rename)
   *      plus shell.run commands matching `MUTATION_COMMAND_RE` and the
   *      safe default for unrecognized shell.run commands.
   *   3. validation sub-recognizer — shell.run commands matching
   *      `VALIDATION_COMMAND_RE` (pnpm test, vitest, jest, pytest,
   *      pnpm lint, tsc --noEmit, alix verify, check, etc.).
   *
   * Tie-breaking (per T13 contract): validation > mutation > research,
   * because a fresh validation in the same iteration as a stale mutation
   * is more likely to indicate the operator's actual current intent
   * (validators are explicit, mutations may be leftover side effects).
   *
   * Orthogonality: this function MUST NOT consult the user prompt.
   * It only sees observed tool calls. (`currentIntent` is the sticky
   * carry-over for empty sequences; it does not influence the observed
   * classification.)
   */
  classify(toolCalls: Array<{ name: string; args: Record<string, unknown> }>, currentIntent?: AgentIntent): AgentIntent {
    if (toolCalls.length === 0) return currentIntent ?? "research";

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
      // Unrecognized tools: count as research (safe exploration default)
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
   *
   * Rationale: a single iteration of observed tool calls is noisy. The
   * model may emit one exploratory file.read before a batch of file.edit
   * calls. A streak of 2 prevents the emitted `AgentIntent` from
   * flip-flopping and gives the progress ledger a stable section.
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
