// src/tui/capabilities/capability-service.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityPlatform } from '../../capability/platform.js';
import { registerInitialCapabilities } from '../../capability/initial-capabilities.js';
import { registerRegistryToolCapabilities } from '../../capability/registry-capabilities.js';
import { createToolProviderExecutor } from '../../capability/tool-adapter.js';
import { toAlixEvent } from '../../capability/event-bus.js';
import type { Capability, CapabilityStatus, Invocation } from '../../capability/types.js';
import type { CapabilityQuery } from '../../capability/registry.js';
import { EventLog } from '../../events/event-log.js';
import type { ToolCallRequest } from '../../tools/types.js';
import type { ExecuteResult } from '../../tools/executor.js';
import type { InvocationPresenter } from './invocation-presenter.js';

/** The existing ToolExecutor's executable seam (bootstrap-owned). */
export interface ToolExecutorLike {
  execute(req: ToolCallRequest): Promise<ExecuteResult>;
}

export interface CapabilityServiceOptions {
  /** EventLog to bridge capability events into (observability, non-fatal). */
  eventLog?: EventLog;
  /** Resolve the current session id (empty string when none). */
  sessionId?: () => string;
  /** Actor label for invocations. */
  actor?: string;
  /** Working directory for invocations. */
  cwd?: string;
  /** Bootstrap-owned ToolExecutor for tool.* capabilities. */
  toolExecutor?: ToolExecutorLike;
  /**
   * Canonical-capability store directory. Defaults to the platform's
   * `process.cwd()/.alix/capabilities`, which is correct in production.
   *
   * Exposed so a TEST can point the adapter at a tempdir. Without it, running
   * the TUI adapter in a test registers its seeded capabilities — including
   * every registry-derived `tool.*` id — into the developer's real
   * `.alix/capabilities/definitions.jsonl`. Those persisted rows then outlive
   * the test and are re-read on the next run, so a renamed or removed tool
   * keeps appearing as a phantom capability until the file is deleted by hand:
   * the failure surfaces as a TUI-vs-service parity mismatch in an unrelated
   * test, with nothing pointing at the write that caused it.
   */
  catalogDir?: string;
}

/**
 * The TUI façade over the Capability Platform. Owns the platform instance
 * and the InvocationPresenter; wires the full working set (initial
 * capabilities + real session integration + tool executor); bridges
 * platform events into the EventLog. invoke() presents automatically so
 * every caller gets identical behavior without remembering the presenter.
 */
/** Placeholder until TuiApp binds a real presenter (it owns the chat state). */
const NOOP_PRESENTER: InvocationPresenter = { present: async () => {} };

/** Resolved options: the optional seams stay optional (undefined = absent),
 *  while sessionId/actor/cwd get real defaults. */
type ResolvedOptions = Required<Omit<CapabilityServiceOptions, 'eventLog' | 'toolExecutor' | 'catalogDir'>> &
  Pick<CapabilityServiceOptions, 'eventLog' | 'toolExecutor' | 'catalogDir'>;

export class CapabilityService {
  readonly platform: CapabilityPlatform;
  private presenter: InvocationPresenter;
  private readonly opts: ResolvedOptions;
  private readonly initPromise: Promise<void>;

  constructor(presenter: InvocationPresenter = NOOP_PRESENTER, opts: CapabilityServiceOptions = {}) {
    this.presenter = presenter;
    this.opts = {
      eventLog: undefined,
      sessionId: () => '',
      actor: 'operator',
      cwd: process.cwd(),
      toolExecutor: undefined,
      ...opts,
      // AFTER the spread, so an explicitly-passed `catalogDir: undefined` cannot
      // clobber the default back to "inherit process.cwd()".
      catalogDir: opts.catalogDir ?? mkdtempSync(join(tmpdir(), "alix-cap-catalog-")),
    };
    // Locked ruling #12 — the platform requires an authoritative EventLog.
    // When the TUI service is constructed without one, give the platform a
    // throwaway EventLog under the temp dir — the same default `catalogDir`
    // takes above — so an un-wired caller never writes `events.jsonl` into
    // the process cwd. The TUI's own `eventLog` opt (when supplied) takes
    // precedence — both land in the same EventLog.
    const eventLog = this.opts.eventLog ?? new EventLog(mkdtempSync(join(tmpdir(), "alix-cap-events-")));
    this.opts.eventLog = eventLog;
    this.platform = new CapabilityPlatform({
      eventLog,
      ...(this.opts.catalogDir ? { catalogDir: this.opts.catalogDir } : {}),
    });
    // Subscribe BEFORE registering initial capabilities so the bridge
    // (EventBus does not replay past events to late subscribers) captures
    // every CapabilityRegistered emission.
    this.wireEventBridge();
    // Register through the platform's public register surface (ruling #2 —
    // the registry itself stays private).
    registerInitialCapabilities({ register: (cap) => this.platform.register(cap) }, this.platform.native);
    // Tool capabilities derive from the canonical tool registry — no
    // independently-managed tool taxonomy (projection in
    // registry-capabilities.ts preserves toolName → tool-provider routing).
    // Registered synchronously in the constructor: it is static data (no I/O),
    // so the palette surface is complete + deterministically ordered before
    // initialize()'s async session wiring resolves.
    registerRegistryToolCapabilities({ register: (cap) => this.platform.register(cap) });
    this.initPromise = this.initialize();
  }

  private async initialize(): Promise<void> {
    // Session integration (core.session.* → real session API).
    try {
      const { registerSessionCapabilities } = await import('../../integrations/session-capabilities.js');
      await registerSessionCapabilities({ register: (cap) => this.platform.register(cap) }, this.platform.native);
    } catch (err) {
      console.error('[capabilities] session integration unavailable:', err);
    }
    // Tool executor (tool.* → bootstrap-owned ToolExecutor). Tool
    // capabilities show as unavailable rather than crashing when the
    // executor is missing.
    if (this.opts.toolExecutor) {
      this.platform.registerProvider('tool', createToolProviderExecutor(this.opts.toolExecutor));
    }
  }

  /** Resolves once the async wiring (session/tool) has settled. */
  async ready(): Promise<void> { await this.initPromise; }

  private wireEventBridge(): void {
    const log = this.opts.eventLog;
    if (!log) return;
    this.platform.events.subscribe((evt) => {
      try { void log.append(toAlixEvent(evt, this.opts.sessionId())); } catch { /* non-fatal */ }
    });
  }

  query(q: CapabilityQuery = {}): Capability[] { return this.platform.query(q); }
  find(id: string): Capability | undefined { return this.platform.find(id); }
  getStatus(id: string): CapabilityStatus | undefined { return this.platform.capabilityStatus(id); }

  /**
   * Bind the presenter. The TUI owns the chat state, so TuiApp supplies
   * a ChatInvocationPresenter bound to its own state after construction.
   */
  setPresenter(presenter: InvocationPresenter): void { this.presenter = presenter; }

  /** Single invocation path — every invocation is presented automatically. */
  invoke(id: string, args: Record<string, unknown> = {}): Invocation {
    const invocation = this.platform.invoke(id, args, {
      actor: this.opts.actor,
      cwd: this.opts.cwd,
      workspace: this.opts.cwd,
      sessionId: this.opts.sessionId(),
    });
    // Presentation is non-fatal — the invocation itself is independent, so
    // swallow a presenter rejection rather than leaving an unhandled one.
    // Pass the capability's resultSchema (if any) so the presenter renders
    // structured output (Phase 2, #308).
    const resultSchema = this.platform.find(id)?.resultSchema;
    void this.presenter.present({ invocation, capabilityId: id, resultSchema })
      .catch((err) => { console.error('[capabilities] present failed:', err); });
    return invocation;
  }
}

// Module-level shared instance — views are module singletons, so they
// resolve the service through this accessor (set at bootstrap).
let shared: CapabilityService | undefined;
export function setCapabilityService(service: CapabilityService): void { shared = service; }
export function getCapabilityService(): CapabilityService {
  if (!shared) throw new Error('CapabilityService not initialized');
  return shared;
}
export function clearCapabilityService(): void { shared = undefined; }
