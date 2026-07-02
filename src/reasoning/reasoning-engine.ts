// src/reasoning/reasoning-engine.ts
//
// P11.2 — ReasoningEngine orchestrator.
//
// Wires together the CorrelationGraphStore (P11.1), the RootCauseStore (P11.2),
// and the pure buildRootCauseAnalysis function. Loads the latest correlation
// graph, runs the analysis, and persists the result.

import type { CorrelationGraph } from "../correlation/correlation-types.js";
import { CorrelationGraphStore } from "../correlation/correlation-graph-store.js";
import { RootCauseStore } from "./root-cause-store.js";
import { buildRootCauseAnalysis } from "./build-root-cause-analysis.js";
import type { RootCauseAnalysis, ReasoningEngineConfig } from "./reasoning-types.js";
import { RootCauseAnalysisError } from "./reasoning-types.js";
import { DEFAULT_REASONING_CONFIG } from "./reasoning-config.js";

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class ReasoningEngine {
  constructor(
    private readonly correlationGraphStore: CorrelationGraphStore,
    private readonly rootCauseStore: RootCauseStore,
    private readonly config: ReasoningEngineConfig = DEFAULT_REASONING_CONFIG,
  ) {}

  /**
   * Run the full reasoning pipeline:
   *   1. Load the latest CorrelationGraph
   *   2. Run buildRootCauseAnalysis (pure function)
   *   3. Persist the result
   *   4. Return the analysis
   */
  async run(): Promise<RootCauseAnalysis> {
    const staleOpts = this.config.staleAfterMs !== undefined
      ? { staleAfterMs: this.config.staleAfterMs }
      : undefined;
    const graph: CorrelationGraph | null =
      await this.correlationGraphStore.loadLatest(staleOpts);

    if (graph === null) {
      throw new RootCauseAnalysisError(
        "No correlation graph available. Run 'alix executive correlate' first.",
      );
    }

    const analysis: RootCauseAnalysis = buildRootCauseAnalysis(graph, this.config);
    await this.rootCauseStore.save(analysis);
    return analysis;
  }

  /**
   * Load the most recent RootCauseAnalysis from the store.
   * Returns null if none exists.
   */
  async loadLatest(): Promise<RootCauseAnalysis | null> {
    return this.rootCauseStore.loadLatest();
  }
}
