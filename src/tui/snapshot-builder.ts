import type { AgentSession } from '../agent/session.js';
import type { PolicyEngine } from '../policy/policy-engine.js';
import type { EventLog } from '../events/event-log.js';
import type {
  DashboardSnapshot,
  SessionMetadata,
  DaemonMetricsSnapshot,
  ApprovalSnapshot,
  RuntimeSnapshot,
  SopSnapshot,
} from './snapshot.js';
import { SessionPhase } from './state.js';

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

/**
 * Subsystem contract for the approval snapshot. Defined here so SnapshotBuilder
 * stays self-contained before the dedicated collector module lands.
 */
export interface ApprovalCollector {
  snapshot(): Promise<ApprovalSnapshot | null>;
}

/**
 * Subsystem contract for the runtime-event snapshot. Defined here so
 * SnapshotBuilder stays self-contained before the dedicated collector module
 * lands.
 */
export interface RuntimeCollector {
  snapshot(): Promise<any>;
}

/**
 * Subsystem contract for the SOP-snapshot. Defined here so SnapshotBuilder
 * stays self-contained before the dedicated collector module lands.
 */
export interface SopCollector {
  snapshot(): Promise<any>;
}

export type SubsystemSnapshotFn = () => Promise<unknown> | unknown;

/**
 * Composes one immutable DashboardSnapshot per refresh tick.
 *
 * Constructor takes injected subsystems. NEVER throws upward. Returns null
 * on generation cancellation (a newer build has been started).
 */
export class SnapshotBuilder {
  /**
   * Cache for buildSync(). Populated by the most recent build() call. Stored
   * alongside its generation so buildSync() can honor the caller's generation
   * argument and return null when the cached snapshot is stale.
   */
  private lastSnapshot: DashboardSnapshot | undefined;
  private lastSnapshotGeneration: number | undefined;

  /**
   * The generation of the currently in-flight build(). Updated atomically at
   * the top of build() so that, between awaits, a still-running build can
   * detect whether a newer build has begun (and return null in that case).
   */
  private currentGeneration: number = 0;

  constructor(
    private readonly session: AgentSession,
    private readonly approvals: ApprovalCollector,
    private readonly policy: PolicyEngine,
    private readonly sops: SopCollector,
    private readonly runtime: EventLog | RuntimeCollector,
    private readonly daemonMetrics: DaemonMetricsCollector,
  ) {}

  /**
   * Async build. Polls each subsystem. A subsystem that throws produces
   * null for that field only; the rest of the snapshot is still composed.
   *
   * Returns null when:
   * - generation <= 0 (invalid input; preserves the never-throws contract)
   * - A newer build() has been started (currentGeneration bumped mid-await)
   */
  async build(generation: number): Promise<DashboardSnapshot | null> {
    if (generation <= 0) return null;

    // Atomic update: any in-flight build with an older generation will
    // observe currentGeneration !== <its generation> at its next await
    // checkpoint and return null.
    this.currentGeneration = generation;

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
      this.lastSnapshotGeneration = generation;
    }

    // Construct fields locally first; freeze at end. No incremental mutation.
    // Between every awaited subsystem call, re-check currentGeneration so a
    // build whose generation has been superseded returns null.
    if (this.currentGeneration !== generation) return null;
    const session = await this.trySnapshot('session', async () => this.snapshotSession());
    if (this.currentGeneration !== generation) return null;
    const daemon = await this.trySnapshot('daemon', () => this.daemonMetrics.snapshot());
    if (this.currentGeneration !== generation) return null;
    const approvals = await this.trySnapshot('approvals', () => this.approvals.snapshot());
    if (this.currentGeneration !== generation) return null;
    const runtime = await this.trySnapshot('runtime', () => (this.runtime as RuntimeCollector).snapshot());
    if (this.currentGeneration !== generation) return null;
    const sops = await this.trySnapshot('sops', () => this.sops.snapshot());
    if (this.currentGeneration !== generation) return null;
    const policy = await this.trySnapshot('policy', () => this.policy.snapshot());
    if (this.currentGeneration !== generation) return null;

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
    this.lastSnapshotGeneration = generation;
    return snap;
  }

  /**
   * Synchronous read of the cached snapshot. Returns the cached snapshot
   * ONLY when its stored generation matches the caller's generation
   * argument; otherwise returns null. This way a keypress-driven refresh
   * at generation N reads generation-N data, not stale generation-(N-k)
   * data.
   */
  buildSync(generation: number): DashboardSnapshot | null {
    if (this.lastSnapshotGeneration !== generation) return null;
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
        phase: (this.session as any).getPhase?.() ?? SessionPhase.Idle,
        version: (this.session as any).getVersion?.() ?? 'unknown',
        startedAt: (this.session as any).getStartedAt?.() ?? Date.now(),
        turns: (this.session as any).getTurns?.() ?? 0,
      });
    } catch {
      return null;
    }
  }
}