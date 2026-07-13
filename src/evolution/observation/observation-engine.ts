// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A5.1 -- Observation Engine.
 *
 * Orchestrates observation dispatch to registered providers. Handles
 * provider lifecycle, exception containment, unknown provider errors,
 * and bounded concurrent observation execution with ordering guarantees.
 *
 * @module observation-engine
 */

import type {
  Observation,
  ObservationResult,
  ObservationProvider,
} from "./contracts/observation-contract.js";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ObservationEngineConfig {
  /** Maximum concurrent observations for observeAll. */
  maxConcurrency: number;
}

const DEFAULT_CONFIG: ObservationEngineConfig = {
  maxConcurrency: 4,
};

// ---------------------------------------------------------------------------
// ObservationEngine
// ---------------------------------------------------------------------------

export class ObservationEngine {
  private readonly providers = new Map<string, ObservationProvider>();
  private readonly config: ObservationEngineConfig;

  constructor(config?: Partial<ObservationEngineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register an observation provider.
   *
   * @throws {Error} If a provider with the same name is already registered.
   */
  register(provider: ObservationProvider): void {
    if (this.providers.has(provider.name)) {
      throw new Error(`Provider already registered: ${provider.name}`);
    }
    this.providers.set(provider.name, provider);
  }

  /**
   * Get registered provider by name.
   */
  getProvider(name: string): ObservationProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Execute a single observation.
   * Always returns ObservationResult -- never throws.
   */
  async observe(observation: Observation): Promise<ObservationResult> {
    const provider = this.providers.get(observation.provider);
    if (!provider) {
      return unknownProviderResult(observation);
    }

    try {
      return await provider.observe(observation);
    } catch (err) {
      return exceptionResult(observation, err);
    }
  }

  /**
   * Execute multiple observations with bounded concurrency.
   *
   * @invariant Result ordering matches input ordering for deterministic hashing.
   */
  async observeAll(observations: Observation[]): Promise<ObservationResult[]> {
    const results: (ObservationResult | null)[] = new Array(observations.length);
    const running = new Set<number>();
    let nextIndex = 0;

    const startNext = (): Promise<void> => {
      if (nextIndex >= observations.length) return Promise.resolve();

      const idx = nextIndex++;
      running.add(idx);

      return this.observe(observations[idx]).then((result) => {
        results[idx] = result;
        running.delete(idx);
        return startNext();
      });
    };

    const workers: Promise<void>[] = [];
    const workerCount = Math.min(this.config.maxConcurrency, observations.length);
    for (let i = 0; i < workerCount; i++) {
      workers.push(startNext());
    }

    await Promise.all(workers);

    return results.filter((r): r is ObservationResult => r !== null);
  }
}

// ---------------------------------------------------------------------------
// Internal error result helpers
// ---------------------------------------------------------------------------

function unknownProviderResult(observation: Observation): ObservationResult {
  return {
    observationId: observation.observationId,
    status: "error",
    confidence: 0,
    observedAt: new Date().toISOString(),
    evidence: {
      errorType: "unknown_provider",
      message: `No provider registered for: ${observation.provider}`,
    },
  };
}

function exceptionResult(observation: Observation, err: unknown): ObservationResult {
  return {
    observationId: observation.observationId,
    status: "error",
    confidence: 0,
    observedAt: new Date().toISOString(),
    evidence: {
      errorType: "provider_exception",
      message: err instanceof Error ? err.message : String(err),
    },
  };
}
