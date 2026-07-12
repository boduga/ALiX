// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A1.1 — PatternDiscoveryEngine
 *
 * Orchestrator that wires the entire pattern discovery pipeline:
 *   1. Load execution evidence and governance audit events (parallel)
 *   2. Build DiscoveryContext
 *   3. Execute detection strategies sequentially with error isolation
 *   4. Flatten results and return DiscoveryResult
 *
 * The engine owns the pipeline lifecycle. Strategies are stateless and
 * receive all input through the shared DiscoveryContext.
 *
 * @module pattern-discovery-engine
 */

import type { ExecutionEvidenceStore } from "../../runtime/execution-evidence-store.js";
import type { AuditStore } from "../../governance/audit-store.js";
import type { DiscoveryContext } from "../contracts/discovery-context.js";
import type {
  DiscoveryResult,
  PatternObservation,
} from "../contracts/pattern-discovery-contract.js";
import type { DetectionStrategy } from "./detection-strategy.js";

// ---------------------------------------------------------------------------
// PatternDiscoveryEngineConfig
// ---------------------------------------------------------------------------

/**
 * Configuration for the PatternDiscoveryEngine.
 *
 * @property evidenceStore  - X3b append-only evidence store (inject, never construct).
 * @property auditStore    - P14 governance audit store (inject, never construct).
 * @property strategies    - Ordered list of detection strategies to run sequentially.
 */
export interface PatternDiscoveryEngineConfig {
  readonly evidenceStore: ExecutionEvidenceStore;
  readonly auditStore: AuditStore;
  readonly strategies: DetectionStrategy[];
}

// ---------------------------------------------------------------------------
// PatternDiscoveryEngine
// ---------------------------------------------------------------------------

/**
 * Orchestrator of the pattern discovery pipeline.
 *
 * Lifecycle:
 *   1. Start timer
 *   2. Load evidence and governance events in parallel
 *   3. Build DiscoveryContext
 *   4. Execute each strategy **sequentially** (deterministic order)
 *   5. Collect results, track failures with error isolation
 *   6. Flatten pattern arrays; return DiscoveryResult
 *
 * @invariant Never constructs stores — receives them through config.
 * @invariant Never mutates DiscoveryContext or strategy outputs.
 * @invariant Error isolation ensures one failing strategy never blocks others.
 */
export class PatternDiscoveryEngine {
  private readonly config: PatternDiscoveryEngineConfig;

  constructor(config: PatternDiscoveryEngineConfig) {
    this.config = config;
  }

  /**
   * Execute one full pattern discovery run.
   *
   * Steps:
   *   1. Load evidence + governance events in parallel
   *   2. Build the shared DiscoveryContext
   *   3. Run strategies sequentially with try/catch isolation
   *   4. Flatten all PatternObservation arrays
   *   5. Return DiscoveryResult with run metadata
   *
   * @returns DiscoveryResult containing patterns, empty candidates/drafts stubs,
   *          and run metadata (timing, counts, failures).
   */
  async run(): Promise<DiscoveryResult> {
    const start = Date.now();

    // Step 1: Load store data in parallel
    const [evidence, governanceEvents] = await Promise.all([
      this.config.evidenceStore.list(),
      this.config.auditStore.listChronological(),
    ]);

    // Step 2: Build shared run-scoped context
    const context: DiscoveryContext = { evidence, governanceEvents };

    // Step 3: Execute strategies sequentially with error isolation
    const strategiesFailed: string[] = [];
    const patternArrays: (readonly PatternObservation[])[] = [];

    for (const strategy of this.config.strategies) {
      try {
        const patterns = await strategy.run(context);
        patternArrays.push(patterns);
      } catch {
        strategiesFailed.push(strategy.name);
      }
    }

    // Step 4+5: Flatten patterns, build result with metadata
    const patterns = patternArrays.flat();
    const detectionDurationMs = Date.now() - start;

    const metadata: DiscoveryResult["metadata"] = {
      evidenceScanned: evidence.length + governanceEvents.length,
      detectionDurationMs,
      strategiesRun: this.config.strategies.length,
    };

    if (strategiesFailed.length > 0) {
      metadata.strategiesFailed = strategiesFailed;
    }

    return {
      patterns,
      candidates: [],
      drafts: [],
      metadata,
    };
  }
}
