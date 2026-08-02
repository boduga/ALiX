// tests/tui/timeline.vitest.ts
//
// Phase 6 (D9): the EventLog is the single source of truth timeline. The
// Phase-3 in-memory helpers (appendTimelineEvent's per-tab push,
// getOrderedTimeline, formatTimelineEvent) were removed — ordering and
// append-only behavior are covered by the TimelineBuilder projection tests
// (tests/tui/runtime/timeline-builder.vitest.ts). Phase-7 cleanup removed the
// deprecated `appendTimelineEvent` compatibility wrapper and the shared
// capability-status display helper moved to the presenter
// (src/tui/capabilities/invocation-presenter.ts). This file keeps the
// capability-status display helper's formatting contract.
import { describe, it, expect } from 'vitest';
import { capabilityStatusText } from '../../src/tui/capabilities/invocation-presenter.js';
import type { CapabilityStatus } from '../../src/tui/capabilities/invocation-presenter.js';

function capEvent(status: CapabilityStatus['status'], output?: unknown, error?: string): CapabilityStatus {
  return {
    capabilityId: 'core.session.list',
    status,
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
