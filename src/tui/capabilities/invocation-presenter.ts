import type { PerTabState, CapabilityInvocationEntry } from '../state.js';
import type { Invocation, CapabilityEvent } from '../../capability/types.js';

export interface InvocationInput {
  invocation: Invocation;
  capabilityId: string;
  args: Record<string, unknown>;
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

  async present({ invocation, capabilityId, args }: InvocationInput): Promise<void> {
    const state = this.getChatState();
    const entry: CapabilityInvocationEntry = {
      invocationId: invocation.id,
      capabilityId,
      args,
      status: 'running',
      at: Date.now(),
    };
    state.capabilityInvocations.push(entry);

    // Terminal events update the entry live from the invocation's own
    // event stream (Phase-1 fix delivers terminal events there). No race
    // with the runtime starting: `Invocation.events()` is backed by the
    // AsyncEventQueue, which buffers emitted events until consumed — a
    // subscriber attaching after the runtime began still receives the
    // full lifecycle.
    for await (const evt of invocation.events()) {
      this.applyEvent(entry, evt);
    }
    // Fallback: if the stream closed without a terminal event, use the
    // settled result.
    if (entry.status === 'running') {
      const result = await invocation.wait();
      entry.status = result.status === 'completed' ? 'completed'
        : result.status === 'cancelled' ? 'cancelled' : 'failed';
      if (entry.status === 'completed') entry.output = result.output;
      if (entry.status === 'failed') entry.error = result.error;
    }
  }

  private applyEvent(entry: CapabilityInvocationEntry, evt: CapabilityEvent): void {
    switch (evt.type) {
      case 'InvocationCompleted':
        entry.status = 'completed';
        break;
      case 'InvocationFailed':
        entry.status = 'failed';
        entry.error = evt.error;
        break;
      case 'InvocationCancelled':
        entry.status = 'cancelled';
        break;
    }
  }
}
