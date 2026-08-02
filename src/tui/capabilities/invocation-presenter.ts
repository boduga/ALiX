import type { EventLog } from '../../events/event-log.js';
import type { Invocation, CapabilityEvent } from '../../capability/types.js';
import { appendLogEntry } from '../log-emit.js';

export interface InvocationInput {
  invocation: Invocation;
  capabilityId: string;
}

export interface InvocationPresenter {
  /** Present an invocation. Default target is the chat operator timeline. */
  present(input: InvocationInput): Promise<void>;
}

/**
 * Emit context for a capability settlement entry (Phase 6 D7/D9). When
 * present, the presenter writes the single authoritative `chat.response`
 * log entry into the EventLog — the log is the single source of truth
 * timeline. `sessionId` is the stamped origin (D1/D3) — the routing
 * dimension the collector projects on.
 */
export interface CapabilityEmitContext {
  readonly eventLog: EventLog;
  readonly sessionId: string;
}

/**
 * Minimal capability status the presenter tracks and displays. The Phase-3
 * in-memory `TimelineEvent` is gone — the presenter needs only the fields that
 * drive the settled chat-surface text.
 */
export interface CapabilityStatus {
  capabilityId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  output?: unknown;
  error?: string;
}

/** Status suffix for a capability event — "core.session.list [completed ✓]". */
export function capabilityStatusText(event: CapabilityStatus): string {
  let text = event.capabilityId;
  if (event.status === 'running') text += ' [running]';
  else if (event.status === 'completed') {
    text += ' [completed ✓]';
    // Review fix: append output ONLY when present — avoids "[completed ✓] """
    // for empty output and "undefined" for absent output.
    if (event.output !== undefined && event.output !== '') text += ` ${JSON.stringify(event.output)}`;
  } else if (event.status === 'failed') text += ` [failed ✗] ${event.error ?? ''}`;
  else text += ' [cancelled]';
  return text.trim();
}

/**
 * Routes capability invocations into the chat tab's log-projected timeline.
 * The chat tab is the operator's execution history — capabilities are execution
 * primitives, not a separate surface. Platform-independent.
 *
 * Phase 6 (D9): the EventLog is the single source of truth timeline — the
 * presenter does NOT push into any per-tab state. It tracks the capability
 * status locally and emits the single authoritative `chat.response` entry at
 * settlement (with the final status text) via the optional emit context.
 */
export class ChatInvocationPresenter implements InvocationPresenter {
  constructor(private readonly emitCtx?: CapabilityEmitContext) {}

  async present({ invocation, capabilityId }: InvocationInput): Promise<void> {
    // Track the capability status locally (never in per-tab state). The
    // terminal status text is what the log projection displays.
    const event: CapabilityStatus = { capabilityId, status: 'running' };

    // Terminal events update the event from the invocation's own
    // event stream. No race with the runtime starting: Invocation.events()
    // is backed by the AsyncEventQueue, which buffers until consumed.
    for await (const evt of invocation.events()) {
      this.applyEvent(event, evt);
    }
    // InvocationCompleted carries NO output — output lives only on the
    // wait() result. Always resolve the settled result and merge
    // output/error; wait() resolves immediately once settled.
    const result = await invocation.wait();
    if (event.status === 'running') {
      event.status = result.status === 'completed' ? 'completed'
        : result.status === 'cancelled' ? 'cancelled' : 'failed';
    }
    // Merge output/error only when consistent with the settled status, so a
    // diverged wait() result cannot clobber event-path terminal state.
    if (event.status === 'completed' && event.output === undefined) event.output = result.output;
    if (event.status === 'failed' && event.error === undefined) event.error = result.error;

    // Emit the capability completion into the chat sub-session's timeline
    // projection with meaningful display text. `chat.response` entries must
    // always carry non-empty `text` — the capability status line (e.g.
    // `core.session.list [completed ✓]`) satisfies that display contract. The
    // status is terminal here (settled above), so every emit carries text.
    // Fire-and-forget; a log-write failure must not fail an already-settled
    // invocation.
    if (this.emitCtx) {
      appendLogEntry(this.emitCtx.eventLog, {
        sessionId: this.emitCtx.sessionId,
        actor: 'agent',
        type: 'chat.response',
        payload: { text: capabilityStatusText(event) },
      });
    }
  }

  private applyEvent(event: CapabilityStatus, evt: CapabilityEvent): void {
    switch (evt.type) {
      case 'InvocationCompleted':
        event.status = 'completed';
        break;
      case 'InvocationFailed':
        event.status = 'failed';
        event.error = evt.error;
        break;
      case 'InvocationCancelled':
        event.status = 'cancelled';
        break;
    }
  }
}
