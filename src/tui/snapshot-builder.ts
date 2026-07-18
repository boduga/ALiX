import type { AgentSession } from '../agent/session.js';
import type { ApprovalManager } from './approval-manager.js';
import type { EventLog } from '../events/event-log.js';
import type { PolicyEngine } from '../policy/policy-engine.js';
import type {
  DashboardSnapshot,
  SessionMetadata,
  DaemonMetricsSnapshot,
} from './snapshot.js';

/**
 * Subsystem contract for daemon metrics collection. Defined here (rather than
 * importing from a sibling file) so SnapshotBuilder stays self-contained
 * before the dedicated collector module lands.
 */
export interface DaemonMetricsCollector {
  start(): void;
  stop(): Promise<void>;
  snapshot(): Promise<DaemonMetricsSnapshot>;
}

export type SubsystemSnapshotFn = () => Promise<unknown> | unknown;

/**
 * Composes one immutable DashboardSnapshot per refresh tick.
 *
 * Constructor takes injected subsystems. NEVER throws upward. Returns null
 * on generation cancellation.
 */
export class SnapshotBuilder {
  /**
   * Cache for buildSync(). Populated by the most recent build() call.
   * Subsystem implementations must be idempotent / cached on their end;
   * this cache stores the *whole* frozen snapshot for re-read.
   */
  private lastSnapshot: DashboardSnapshot | undefined;

  constructor(
    private readonly session: AgentSession,
    private readonly approvals: ApprovalManager,
    private readonly policy: PolicyEngine,
    private readonly sops: unknown,
    private readonly eventLog: EventLog,
    private readonly daemonMetrics: DaemonMetricsCollector,
  ) {}

  /**
   * Async build. Polls each subsystem. A subsystem that throws produces
   * null for that field only; the rest of the snapshot is still composed.
   */
  async build(generation: number): Promise<DashboardSnapshot | null> {
    if (generation <= 0) throw new Error('SnapshotBuilder.build: generation must be positive');

    const generatedAt = Date.now();

    // Synchronously seed the cache so buildSync() called during this in-flight
    // build returns the prior snapshot (or a null-fields placeholder on the
    // very first build). Avoids the "fire-and-forget" race where buildSync()
    // would otherwise see lastSnapshot === undefined.
    if (!this.lastSnapshot) {
      this.lastSnapshot = Object.freeze({
        generatedAt,
        session: null,
        daemon: null,
        approvals: null,
        runtime: null,
        sops: null,
        policy: null,
      });
    }

    // Construct fields locally first; freeze at end. No incremental mutation.
    const session = await this.trySnapshot('session', async () => this.snapshotSession());
    const daemon = await this.trySnapshot('daemon', () => this.daemonMetrics.snapshot());
    const approvals = await this.trySnapshot('approvals', async () => (this.approvals as any).snapshot());
    const runtime = await this.trySnapshot('runtime', async () => (this.eventLog as any).snapshot());
    const sops = await this.trySnapshot('sops', async () => (this.sops as any).snapshot());
    const policy = await this.trySnapshot('policy', async () => (this.policy as any).snapshot());

    const snap = Object.freeze({
      generatedAt,
      session,
      daemon,
      approvals,
      runtime,
      sops,
      policy,
    });

    this.lastSnapshot = snap;
    return snap;
  }

  /**
   * Synchronous read of the cached snapshot. Returns null if no async
   * build has run yet. Used for keypress-driven refreshes where I/O
   * must not block.
   */
  buildSync(_generation: number): DashboardSnapshot | null {
    return this.lastSnapshot ?? null;
  }

  private async trySnapshot<R>(label: string, fn: () => Promise<R> | R): Promise<R | null> {
    try {
      return await fn();
    } catch (err) {
      // Subsystem failure — return null; remaining dashboard still renders.
      return null;
    }
  }

  private async snapshotSession(): Promise<SessionMetadata | null> {
    try {
      return Object.freeze({
        mode: ((this.session as any).getMode?.() ?? 'auto') as 'auto' | 'ask' | 'bypass',
        phase: (this.session as any).getPhase?.() ?? null,
        version: (this.session as any).getVersion?.() ?? 'unknown',
        startedAt: (this.session as any).getStartedAt?.() ?? Date.now(),
        turns: (this.session as any).getTurns?.() ?? 0,
      });
    } catch {
      return null;
    }
  }
}
