import type { TimelineEmitContext } from '../state.js';
import { capabilityStatusText, nextTimelineSequence } from '../state.js';
import type { TimelineEvent } from '../state.js';
import type { Invocation, CapabilityEvent } from '../../capability/types.js';

export interface InvocationInput {
  invocation: Invocation;
  capabilityId: string;
}

export interface InvocationPresenter {
  /** Present an invocation. Default target is the chat operator timeline. */
  present(input: InvocationInput): Promise<void>;
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
  constructor(private readonly emitCtx?: TimelineEmitContext) {}

  async present({ invocation, capabilityId }: InvocationInput): Promise<void> {
    // Track the capability status locally (never in per-tab state). The
    // terminal status text is what the log projection displays.
    const sequence = nextTimelineSequence();
    const event: Extract<TimelineEvent, { kind: 'capability' }> = {
      id: `tl-${sequence}`,
      timestamp: Date.now(),
      sequence,
      source: 'capability',
      kind: 'capability',
      invocationId: invocation.id,
      capabilityId,
      status: 'running',
    };

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
      void this.emitCtx.eventLog.append({
        sessionId: this.emitCtx.sessionId,
        actor: 'agent',
        type: 'chat.response',
        payload: { text: capabilityStatusText(event) },
      });
    }
  }

  private applyEvent(event: Extract<TimelineEvent, { kind: 'capability' }>, evt: CapabilityEvent): void {
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
