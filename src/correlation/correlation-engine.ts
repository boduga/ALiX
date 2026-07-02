// src/correlation/correlation-engine.ts

import type { BaselineRegistry } from "../baseline/baseline-registry.js";
import type { ExecutiveTrendStore, ExecutiveTrendSnapshot } from "../executive/trend-store.js";
import type { CorrelationGraph, CorrelationEngineConfig } from "./correlation-types.js";
import { DEFAULT_CORRELATION_CONFIG } from "./correlation-config.js";
import { buildCorrelationGraph } from "./build-correlation-graph.js";

export class CorrelationEngine {
  constructor(
    private readonly registry: BaselineRegistry,
    private readonly trendStore: ExecutiveTrendStore,
    private readonly config: CorrelationEngineConfig = DEFAULT_CORRELATION_CONFIG,
  ) {}

  async run(): Promise<CorrelationGraph> {
    const comparisons = await this.registry.runAll();
    const snapshots = await this.loadTrendHistory();
    return buildCorrelationGraph(comparisons, snapshots, this.config);
  }

  private async loadTrendHistory(): Promise<ExecutiveTrendSnapshot[]> {
    const snapshots: ExecutiveTrendSnapshot[] = [];
    let current = await this.trendStore.loadLatest();
    if (!current) return snapshots;
    snapshots.push(current);

    for (let i = 0; i < this.config.windowSize - 1; i++) {
      const prev = await this.trendStore.findBaseline(current!.generatedAt);
      if (!prev) break;
      snapshots.unshift(prev);
      current = prev;
    }
    return snapshots;
  }
}
