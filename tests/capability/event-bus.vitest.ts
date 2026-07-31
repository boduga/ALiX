// tests/capability/event-bus.vitest.ts
import { describe, it, expect, vi } from 'vitest';
import { EventBus, toAlixEvent } from '../../src/capability/event-bus.js';
import type { CapabilityEvent } from '../../src/capability/types.js';

describe('EventBus', () => {
  it('delivers emitted events to subscribers in order', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.subscribe((e) => seen.push(e.type));
    bus.emit({ type: 'InvocationStarted', invocationId: 'i1', capabilityId: 'c1', at: 1 });
    bus.emit({ type: 'InvocationOutput', invocationId: 'i1', chunk: 'x', at: 2 });
    expect(seen).toEqual(['InvocationStarted', 'InvocationOutput']);
  });

  it('unsubscribe stops delivery', () => {
    const bus = new EventBus();
    const cb = vi.fn();
    const off = bus.subscribe(cb);
    off();
    bus.emit({ type: 'CapabilityRegistered', capabilityId: 'c1', at: 1 });
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('AlixEvent adapter', () => {
  it('maps a CapabilityEvent to an AlixEvent-shaped record', () => {
    const evt: CapabilityEvent = { type: 'InvocationCompleted', invocationId: 'i1', at: 123 };
    const adapted = toAlixEvent(evt, 'sess-1');
    expect(adapted.type).toBe('capability.InvocationCompleted');
    expect(adapted.sessionId).toBe('sess-1');
    expect(adapted.payload).toEqual({ invocationId: 'i1', at: 123 });
  });
});
