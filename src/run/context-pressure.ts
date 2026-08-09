import type { AssembledContext } from "../config/context-assembly.js";
import type { ContextPressure } from "../run.js";

export function createContextPressureTracker() {
  let tier4Dropped = 0;
  let tier5Dropped = 0;
  let tier6Dropped = 0;
  let minRemainingTokens = Infinity;
  let totalIterations = 0;
  let peak: ContextPressure["peak"] | undefined;
  let peakScore = -1;

  function record(iteration: number, assembled: AssembledContext): void {
    totalIterations = Math.max(totalIterations, iteration + 1);
    const t4 = assembled.dropped.filter((d) => d.item.category === "recent_conversation").length;
    const t5 = assembled.dropped.filter((d) => d.item.category === "recent_tool_results").length;
    const t6 = assembled.dropped.filter((d) => d.item.category === "older_context").length;
    tier4Dropped += t4;
    tier5Dropped += t5;
    tier6Dropped += t6;
    if (assembled.remainingTokens < minRemainingTokens) minRemainingTokens = assembled.remainingTokens;
    const score = t4 + t5 + t6;
    // Peak tie-breaking: highest drop total wins; on a tie the FIRST
    // iteration reaching it wins (strict `>`, not `>=`), so the peak is
    // stable and deterministic regardless of iteration order.
    if (score > peakScore) {
      peakScore = score;
      peak = { iteration, tier4Dropped: t4, tier5Dropped: t5, tier6Dropped: t6, remainingTokens: assembled.remainingTokens };
    }
  }

  function snapshot(): ContextPressure {
    return {
      aggregate: {
        tier4Dropped,
        tier5Dropped,
        tier6Dropped,
        minRemainingTokens: minRemainingTokens === Infinity ? 0 : minRemainingTokens,
      },
      peak: peak ?? { iteration: 0, tier4Dropped: 0, tier5Dropped: 0, tier6Dropped: 0, remainingTokens: 0 },
      totalIterations,
    };
  }

  return { record, snapshot };
}
