import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { TaskType } from "../task-classifier.js";

type TaskTypeStats = {
  count: number;
  successCount: number;
  successRate: number;
  avgIterations: number;
  totalIterations: number;
  avgTokens: number;
  totalTokens: number;
};

export type PatternOutcome = {
  success: boolean;
  iterations: number;
  totalTokens: number;
};

export class PatternRegistry {
  private stats: Map<TaskType, TaskTypeStats> = new Map();
  private initialized = false;

  constructor(private dir: string) {}

  async init(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.dir, { recursive: true });
    await this.load();
    this.initialized = true;
  }

  private async load(): Promise<void> {
    const statsPath = join(this.dir, "stats.json");
    try {
      const content = await readFile(statsPath, "utf8");
      const data = JSON.parse(content) as Record<string, TaskTypeStats>;
      for (const [key, value] of Object.entries(data)) {
        this.stats.set(key as TaskType, value);
      }
    } catch {
      // No existing stats - start fresh
    }
  }

  async save(): Promise<void> {
    const statsPath = join(this.dir, "stats.json");
    const data: Record<string, TaskTypeStats> = {};
    for (const [key, value] of this.stats) {
      data[key] = value;
    }
    await writeFile(statsPath, JSON.stringify(data, null, 2));
  }

  async recordOutcome(taskType: TaskType, outcome: PatternOutcome): Promise<void> {
    await this.init();

    const stats = this.stats.get(taskType) ?? {
      count: 0,
      successCount: 0,
      successRate: 0,
      avgIterations: 0,
      totalIterations: 0,
      avgTokens: 0,
      totalTokens: 0,
    };

    stats.count++;
    if (outcome.success) stats.successCount++;
    stats.totalIterations += outcome.iterations;
    stats.totalTokens += outcome.totalTokens;
    stats.successRate = stats.successCount / stats.count;
    stats.avgIterations = stats.totalIterations / stats.count;
    stats.avgTokens = stats.totalTokens / stats.count;

    this.stats.set(taskType, stats);
    await this.save();
  }

  getStats(taskType: TaskType): TaskTypeStats | undefined {
    return this.stats.get(taskType);
  }

  /**
   * Calculates threshold bias based on task-type success rate.
   * Low success rate → more selective context (higher threshold)
   */
  getThresholdBias(taskType: TaskType): number {
    const stats = this.getStats(taskType);
    if (!stats) return 0;

    // Boost threshold for task types with low success rate
    if (stats.successRate < 0.5) {
      return 20; // High selectivity
    } else if (stats.successRate < 0.7) {
      return 10; // Medium selectivity
    } else if (stats.successRate < 0.85) {
      return 5; // Slight selectivity
    }
    return 0;
  }

  /**
   * Clears all statistics (useful for testing).
   */
  async clear(): Promise<void> {
    this.stats.clear();
    await this.save();
  }
}