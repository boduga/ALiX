import { describe, it, expect } from 'vitest';
import {
  formatActivityLine,
  formatActivityElapsed,
  activitySpinnerFrame,
  ACTIVITY_SPINNER_FRAMES,
  isTransientActivityState,
} from '../../../src/tui/views/activity-line.js';
import type { AgentActivity, AgentActivityState } from '../../../src/agent/agent-activity.js';

function activity(state: AgentActivityState, startedAt: number, overrides: Partial<AgentActivity> = {}): AgentActivity {
  return {
    state,
    startedAt,
    lastProgressAt: startedAt,
    lastEventAt: startedAt,
    elapsedMs: 0,
    invocationId: 'inv-1',
    ...overrides,
  };
}

// ─── Task 3.2 / 3.3 — elapsed timer + spinner are local & pure ────────────
describe('formatActivityElapsed — local elapsed formatting (Task 3.2)', () => {
  it('renders whole seconds for sub-minute durations ("4s")', () => {
    expect(formatActivityElapsed(4_000)).toBe('4s');
  });

  it('renders minutes + seconds for sub-hour durations ("2m 14s")', () => {
    expect(formatActivityElapsed(134_000)).toBe('2m 14s');
  });

  it('renders hours + minutes for longer durations', () => {
    expect(formatActivityElapsed(3_900_000)).toBe('1h 05m');
  });

  it('floors sub-second elapsed to "0s"', () => {
    expect(formatActivityElapsed(400)).toBe('0s');
    expect(formatActivityElapsed(0)).toBe('0s');
  });
});

describe('activitySpinnerFrame — animation is pure presentation (Task 3.3)', () => {
  it('cycles through the spinner glyphs in order', () => {
    expect(ACTIVITY_SPINNER_FRAMES).toEqual(['◐', '◓', '◑', '◒']);
  });

  it('advances one frame per elapsed second, repeating after the last frame', () => {
    // Matches the ~1s render cadence: elapsed seconds index the frame array,
    // so no counter, timer, or render-time mutation is needed.
    expect(activitySpinnerFrame(0)).toBe('◐');
    expect(activitySpinnerFrame(999)).toBe('◐');
    expect(activitySpinnerFrame(1_000)).toBe('◓');
    expect(activitySpinnerFrame(2_000)).toBe('◑');
    expect(activitySpinnerFrame(3_000)).toBe('◒');
    expect(activitySpinnerFrame(4_000)).toBe('◐');
    expect(activitySpinnerFrame(4_999)).toBe('◐');
  });

  it('is a pure function of elapsed time — repeated calls are identical', () => {
    expect(activitySpinnerFrame(6_500)).toBe(activitySpinnerFrame(6_500));
  });
});

// ─── Task 3.1 — transient activity rendering ──────────────────────────────
describe('formatActivityLine — transient activity rendering (Task 3.1)', () => {
  it('renders thinking as "◐ Thinking… Ns" with the current spinner frame', () => {
    // thinking started at 1000, now=5000 → 4s elapsed → frame idx 0 = ◐.
    expect(formatActivityLine(activity('thinking', 1_000), 5_000)).toBe('◐ Thinking… 4s');
    // 5s elapsed → frame idx 1 = ◓.
    expect(formatActivityLine(activity('thinking', 1_000), 6_000)).toBe('◓ Thinking… 5s');
  });

  it('renders waiting_for_provider under the Thinking label (per spec)', () => {
    expect(formatActivityLine(activity('waiting_for_provider', 22_000), 40_000)).toBe('◑ Thinking… 18s');
  });

  it('renders verifying and summarizing as transient states', () => {
    expect(formatActivityLine(activity('verifying', 0), 2_000)).toBe('◑ Verifying… 2s');
    expect(formatActivityLine(activity('summarizing', 0), 3_000)).toBe('◒ Summarizing… 3s');
  });

  it('uses the provided spinner frame when given (caller controls animation)', () => {
    expect(formatActivityLine(activity('thinking', 0), 1_000, '◐')).toBe('◐ Thinking… 1s');
  });
});

// ─── Task 3.4 — tool presentation ─────────────────────────────────────────
describe('formatActivityLine — tool presentation (Task 3.4)', () => {
  it('renders a running tool as "⚙ Running <tool>… Ns"', () => {
    const a = activity('tool_running', 1_000, { toolName: 'shell.run' });
    expect(formatActivityLine(a, 4_000)).toBe('⚙ Running shell.run… 3s');
  });

  it('falls back to a generic label when the running tool has no name', () => {
    expect(formatActivityLine(activity('tool_running', 0), 1_000)).toBe('⚙ Running tool… 1s');
  });
});

// ─── Task 3.5 — completion cleanup ────────────────────────────────────────
describe('formatActivityLine — completion cleanup (Task 3.5)', () => {
  it('returns undefined while streaming — streamed text replaces the indicator', () => {
    expect(formatActivityLine(activity('streaming', 0), 10_000)).toBeUndefined();
  });

  it('returns undefined for completed / failed / cancelled — existing completion lines take over, never a permanent spinner', () => {
    expect(formatActivityLine(activity('completed', 0), 10_000)).toBeUndefined();
    expect(formatActivityLine(activity('failed', 0), 10_000)).toBeUndefined();
    expect(formatActivityLine(activity('cancelled', 0), 10_000)).toBeUndefined();
  });

  it('isTransientActivityState admits exactly the live transient states', () => {
    for (const s of ['thinking', 'waiting_for_provider', 'tool_running', 'verifying', 'summarizing', 'possibly_stalled'] as const) {
      expect(isTransientActivityState(s)).toBe(true);
    }
    for (const s of ['streaming', 'completed', 'failed', 'cancelled'] as const) {
      expect(isTransientActivityState(s)).toBe(false);
    }
  });
});

// ─── Test 7.10 — spinner isolation: client-side only ─────────────────────
describe('formatActivityLine — client-side only (Test 7.10)', () => {
  it('is deterministic given the same inputs — no hidden counter or external state', () => {
    const a = activity('thinking', 0);
    const first = formatActivityLine(a, 3_000)!;
    const second = formatActivityLine(a, 3_000)!;
    expect(second).toBe(first);
    // Identical glyphs — the spinner advance is a pure function of elapsed time.
    expect(second).toBe('◒ Thinking… 3s');
  });

  it('reflects runtime state only — nothing is invented because a timer fired', () => {
    // With no activity record there is no line; with a record the line is
    // derived strictly from the record + wall clock.
    expect(formatActivityLine(undefined as never, 5_000)).toBeUndefined();
  });
});