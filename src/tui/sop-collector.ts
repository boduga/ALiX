/**
 * sop-collector.ts — Polls the SOP registry on an interval and caches a SopSnapshot.
 *
 * Follows the DaemonMetricsCollector pattern:
 *   - constructor injection of real deps (none beyond the static registry)
 *   - start() → sample() immediately + setInterval
 *   - stop() → clearInterval
 *   - snapshot() → returns frozen cache
 */

import type { SopSnapshot, SopItemSnapshot } from './snapshot.js';
import { listSops } from '../sop/sop-registry.js';

export interface SopCollector {
  start(): void;
  stop(): void;
  snapshot(): Promise<SopSnapshot | null>;
}

export class SopCollectorImpl implements SopCollector {
  private cache: SopSnapshot = { items: [], totalLoaded: 0 };
  private timer?: ReturnType<typeof setInterval>;

  constructor() {}

  start(): void {
    void this.sample();
    this.timer = setInterval(() => void this.sample(), 1_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async snapshot(): Promise<SopSnapshot | null> {
    return this.cache;
  }

  /**
   * Poll the SOP registry and map each SopDefinition to a SopItemSnapshot.
   * On error the previous cache is preserved so the dashboard never blanks.
   */
  private async sample(): Promise<void> {
    try {
      const items: SopItemSnapshot[] = listSops().map(s => ({
        id: s.id,
        name: s.id,
        version: s.manifest?.version ?? '—',
        description: s.description,
        sourcePath: '~/.alix/sops',
        lastUsedAt: null,
      }));
      this.cache = { items, totalLoaded: items.length };
    } catch {
      // Keep previous cache on error — dashboard never blanks.
    }
  }
}
