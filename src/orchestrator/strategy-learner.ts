/**
 * Strategy Learner — Learn from repair outcomes to improve strategy selection
 *
 * Tracks repair history in ~/.config/alix/repair-history.jsonl
 * Analyzes success rates by failure type and strategy
 * Recommends strategies based on learned patterns
 */

import { appendFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { RefineStrategyName } from "./refine-strategies.js";

export interface RepairOutcome {
  timestamp: string;
  taskType: string;
  failureType: "syntax" | "test" | "scope" | "logic" | "unknown";
  strategy: RefineStrategyName;
  success: boolean;
  repairNumber: number;
}

const HISTORY_DIR = join(process.env.HOME ?? "", ".config", "alix");
const HISTORY_FILE = join(HISTORY_DIR, "repair-history.jsonl");

/**
 * Record a repair outcome for learning
 */
export async function recordRepairOutcome(
  outcome: Omit<RepairOutcome, "timestamp">
): Promise<void> {
  const entry = {
    timestamp: new Date().toISOString(),
    ...outcome,
  };

  // Ensure directory exists
  try {
    await mkdir(HISTORY_DIR, { recursive: true });
  } catch {
    // Directory may already exist
  }

  await appendFile(HISTORY_FILE, JSON.stringify(entry) + "\n");
}

/**
 * Classify failure type from failure output
 */
export function classifyFailureType(failureOutput: string): RepairOutcome["failureType"] {
  if (/syntax|syntax error|parse error|unexpected token/i.test(failureOutput)) {
    return "syntax";
  }
  if (/test|assert/i.test(failureOutput)) {
    return "test";
  }
  if (/scope|denied|permission/i.test(failureOutput)) {
    return "scope";
  }
  if (/logic|condition|algorithm/i.test(failureOutput)) {
    return "logic";
  }
  return "unknown";
}

/**
 * Get strategy success rates by failure type
 */
export async function getStrategyPerformance(): Promise<
  Record<string, Record<RefineStrategyName, { total: number; success: number }>>
> {
  try {
    const content = await readFile(HISTORY_FILE, "utf8");
    const lines = content.split("\n").filter(Boolean);

    const stats: Record<string, Record<RefineStrategyName, { total: number; success: number }>> = {};

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as RepairOutcome;

        if (!stats[entry.failureType]) {
          stats[entry.failureType] = {} as Record<RefineStrategyName, { total: number; success: number }>;
        }

        const key = entry.strategy as RefineStrategyName;
        if (!stats[entry.failureType][key]) {
          stats[entry.failureType][key] = { total: 0, success: 0 };
        }

        stats[entry.failureType][key].total++;
        if (entry.success) {
          stats[entry.failureType][key].success++;
        }
      } catch {
        // Skip malformed lines
      }
    }

    return stats;
  } catch {
    return {};
  }
}

/**
 * Recommend best strategy based on learned history
 */
export async function recommendStrategy(
  failureOutput: string,
  taskType: string
): Promise<RefineStrategyName> {
  const performance = await getStrategyPerformance();
  const failureType = classifyFailureType(failureOutput);

  // Find best performing strategy for this failure type
  if (performance[failureType]) {
    const strategies = Object.entries(performance[failureType]) as [RefineStrategyName, { total: number; success: number }][];

    // Sort by success rate, minimum 3 samples
    const sorted = strategies
      .filter(([, stats]) => stats.total >= 3)
      .sort(([, a], [, b]) => (b.success / b.total) - (a.success / a.total));

    if (sorted.length > 0) {
      return sorted[0][0];
    }
  }

  // Fall back to heuristic selection
  return heuristicSelect(failureOutput, taskType);
}

/**
 * Fallback heuristic selection when no history
 */
function heuristicSelect(failureOutput: string, taskType: string): RefineStrategyName {
  if (/syntax/i.test(failureOutput)) return "simplify";
  if (/test/i.test(failureOutput)) return "verify_only";
  if (/scope|denied/i.test(failureOutput)) return "analyze";
  if (taskType === "bugfix") return "decompose";
  return "retry";
}

/**
 * Get strategy recommendation confidence
 */
export async function getRecommendationConfidence(
  failureOutput: string
): Promise<{ confidence: "low" | "medium" | "high"; samples: number }> {
  const performance = await getStrategyPerformance();
  const failureType = classifyFailureType(failureOutput);

  if (!performance[failureType]) {
    return { confidence: "low", samples: 0 };
  }

  const totalSamples = Object.values(performance[failureType]).reduce(
    (sum, stats) => sum + stats.total,
    0
  );

  if (totalSamples < 3) return { confidence: "low", samples: totalSamples };
  if (totalSamples < 10) return { confidence: "medium", samples: totalSamples };
  return { confidence: "high", samples: totalSamples };
}