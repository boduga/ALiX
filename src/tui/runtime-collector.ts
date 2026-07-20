/**
 * runtime-collector.ts — Polls EventLog on an interval and caches a RuntimeSnapshot.
 *
 * Follows the DaemonMetricsCollector pattern:
 *   - constructor injection of real deps
 *   - start() → sample() immediately + setInterval
 *   - stop() → clearInterval
 *   - snapshot() → returns frozen cache
 */

import type { EventLog } from '../events/event-log.js';
import type { RuntimeSnapshot, RuntimeEventSnapshot } from './snapshot.js';

export interface RuntimeCollector {
  start(): void;
  stop(): void;
  snapshot(): Promise<RuntimeSnapshot | null>;
}

export class RuntimeCollectorImpl implements RuntimeCollector {
  private cache: RuntimeSnapshot = {
    events: [],
    workflow: null,
    totalEventCount: 0,
    lastEventAt: null,
  };
  private timer?: ReturnType<typeof setInterval>;
  private readonly eventLog: EventLog;

  constructor(eventLog: EventLog) {
    this.eventLog = eventLog;
  }

  start(): void {
    void this.sample();
    this.timer = setInterval(() => void this.sample(), 1_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async snapshot(): Promise<RuntimeSnapshot | null> {
    return this.cache;
  }

  /**
   * Poll the EventLog, keep the last 100 events, and cache a frozen snapshot.
   * On error the previous cache is preserved so the dashboard never blanks.
   */
  private async sample(): Promise<void> {
    try {
      const events = await this.eventLog.readAll();
      const recent = events.slice(-100);
      const mapped: RuntimeEventSnapshot[] = recent.map(e => ({
        id: e.id,
        kind: `${e.actor}:${e.type}`,
        summary: `${e.actor}:${e.type}`,
        timestamp: Date.parse(e.timestamp) || Date.now(),
      }));
      mapped.sort((a, b) => b.timestamp - a.timestamp);
      this.cache = {
        events: mapped,
        workflow: null,
        totalEventCount: events.length,
        lastEventAt: mapped.length > 0 ? mapped[0].timestamp : null,
      };
    } catch {
      // Keep previous cache on error — dashboard never blanks.
    }
  }
}
