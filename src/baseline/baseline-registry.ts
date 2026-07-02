/**
 * P10.10 — BaselineRegistry.
 *
 * Plugin registry matching the pattern established in P10.9.2b
 * (ExecutiveBridgeRemediator registry). Providers register by subsystem
 * name; callers discover, describe, and run them.
 *
 * @module
 */

import type { ProviderInfo } from "./baseline-types.js";
import { BaselineSubsystem } from "./baseline-types.js";
import type { BaselineProvider } from "./baseline-provider.js";
import type { BaselineComparison } from "./baseline-types.js";
import { DemoBaselineProvider } from "./providers/demo-provider.js";
import { GovernanceBaselineProvider } from "./providers/governance-provider.js";
import { MemoryHealthProvider } from "./providers/memory-health-provider.js";
import { NumericComparator } from "./baseline-comparator.js";

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class BaselineRegistry {
  private readonly providers = new Map<BaselineSubsystem, BaselineProvider>();
  private readonly comparator = new NumericComparator();

  /**
   * Register a provider. Throws if a provider for the same subsystem
   * is already registered (prevents silent overwrites).
   */
  register(provider: BaselineProvider): void {
    if (this.providers.has(provider.subsystem)) {
      throw new Error(
        `BaselineRegistry: provider already registered for subsystem "${provider.subsystem}"`,
      );
    }
    this.providers.set(provider.subsystem, provider);
  }

  /**
   * Discover all registered providers.
   */
  discover(): BaselineProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get a provider by subsystem name. Throws if not found.
   */
  get(subsystem: BaselineSubsystem): BaselineProvider {
    const p = this.providers.get(subsystem);
    if (!p) {
      throw new Error(
        `BaselineRegistry: no provider registered for subsystem "${subsystem}"`,
      );
    }
    return p;
  }

  /**
   * Get public metadata for a subsystem (CLI-friendly, no implementation
   * details exposed).
   */
  describe(subsystem: BaselineSubsystem): ProviderInfo {
    const p = this.get(subsystem);
    return {
      subsystem: p.subsystem,
      version: p.version,
      description: p.description,
      capabilities: [...p.capabilities],
      state: p.state,
    };
  }

  /**
   * Run all registered providers: capture → compare → score.
   */
  async runAll(): Promise<BaselineComparison[]> {
    const results: BaselineComparison[] = [];
    for (const provider of this.providers.values()) {
      const result = await this.runOne(provider.subsystem);
      results.push(result);
    }
    return results;
  }

  /**
   * Run a single provider: capture baseline, capture current, compare.
   */
  async runOne(subsystem: BaselineSubsystem): Promise<BaselineComparison> {
    const provider = this.get(subsystem);
    const [baseline, current] = await Promise.all([
      provider.captureBaseline(),
      provider.captureCurrent(),
    ]);
    return this.comparator.compare(baseline, current);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the default baseline registry with built-in providers.
 *
 * Currently registers nothing — providers are added by each P10.10.x phase.
 * The factory exists to match the RemediatorRegistry pattern and to
 * provide a stable import target for the CLI.
 */
export function createDefaultBaselineRegistry(): BaselineRegistry {
  const registry = new BaselineRegistry();
  registry.register(new DemoBaselineProvider());
  registry.register(new GovernanceBaselineProvider());
  registry.register(new MemoryHealthProvider());
  return registry;
}
