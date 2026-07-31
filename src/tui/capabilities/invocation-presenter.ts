import type { PerTabState } from '../state.js';
import { appendTimelineEvent } from '../state.js';
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
 * Routes capability invocations into the chat tab's timeline. The chat
 * tab is the operator's execution history — capabilities are execution
 * primitives, not a separate surface. Platform-independent.
 */
export class ChatInvocationPresenter implements InvocationPresenter {
  constructor(
    private readonly getChatState: () => PerTabState,
  ) {}

  async present({ invocation, capabilityId }: InvocationInput): Promise<void> {
    const state = this.getChatState();
    // appendTimelineEvent returns the actual stored object (never a clone),
    // so mutating `event` below updates the entry in the timeline.
    const event = appendTimelineEvent(state, {
      kind: 'capability',
      invocationId: invocation.id,
      capabilityId,
      status: 'running',
    }) as Extract<TimelineEvent, { kind: 'capability' }>;

    // Terminal events update the entry live from the invocation's own
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
