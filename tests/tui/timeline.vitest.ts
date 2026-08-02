// tests/tui/timeline.vitest.ts
//
// Phase 6 (D9): the EventLog is the single source of truth timeline. The
// Phase-3 in-memory helpers (appendTimelineEvent's per-tab push,
// getOrderedTimeline, formatTimelineEvent) were removed — ordering and
// append-only behavior are now covered by the TimelineBuilder projection
// tests (tests/tui/runtime/timeline-builder.vitest.ts) and the deprecated
// wrapper's log emit is covered in state.vitest.ts. This file keeps the one
// retained shared display helper: `capabilityStatusText` (used by the
// presenter's settled chat-surface emit).
import { describe, it, expect } from 'vitest';
import { capabilityStatusText } from '../../src/tui/state.js';
import type { TimelineEvent } from '../../src/tui/state.js';

function capEvent(status: 'running' | 'completed' | 'failed' | 'cancelled', output?: unknown, error?: string): Extract<TimelineEvent, { kind: 'capability' }> {
  const base = {
    id: 'tl-1',
    timestamp: 1,
    sequence: 1,
    source: 'capability' as const,
    kind: 'capability' as const,
    invocationId: 'inv_1',
    capabilityId: 'core.session.list',
    status,
  };
  return {
    ...base,
    ...(output !== undefined ? { output } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}

describe('capabilityStatusText', () => {
  it('formats all capability statuses', () => {
    expect(capabilityStatusText(capEvent('running'))).toBe('core.session.list [running]');
    expect(capabilityStatusText(capEvent('completed', ['s1']))).toBe('core.session.list [completed ✓] ["s1"]');
    expect(capabilityStatusText(capEvent('failed', undefined, 'boom'))).toBe('core.session.list [failed ✗] boom');
    expect(capabilityStatusText(capEvent('cancelled'))).toBe('core.session.list [cancelled]');
  });

  it('completed with empty-string output omits the trailing output suffix', () => {
    expect(capabilityStatusText(capEvent('completed', ''))).toBe('core.session.list [completed ✓]');
  });

  it('completed with undefined output omits the trailing output suffix', () => {
    expect(capabilityStatusText(capEvent('completed'))).toBe('core.session.list [completed ✓]');
  });
});
