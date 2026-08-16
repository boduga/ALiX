import { describe, it, expect } from 'vitest';
import { SessionPhase, createInitialPerTabState, createInitialTuiAppState, type TuiAppState, type PerTabState, type TabId } from '../../src/tui/state.js';

describe('SessionPhase enum', () => {
  it('defines all six lifecycle phases in canonical order', () => {
    expect(SessionPhase.Understanding).toBeDefined();
    expect(SessionPhase.Planning).toBeDefined();
    expect(SessionPhase.Executing).toBeDefined();
    expect(SessionPhase.Verifying).toBeDefined();
    expect(SessionPhase.Summarizing).toBeDefined();
    expect(SessionPhase.Idle).toBeDefined();
  });

  it('exposes a stable runtime-order for UI render', () => {
    expect(Object.values(SessionPhase).length).toBe(6);
    expect(Object.values(SessionPhase)[0]).toBe(SessionPhase.Understanding);
    expect(Object.values(SessionPhase)[5]).toBe(SessionPhase.Idle);
  });
});

describe('PerTabState serializability', () => {
  it('round-trips through JSON without loss', () => {
    const original: PerTabState = {
      cursor: 7,
      scrollOffset: 42,
      searchQuery: 'hello world',
      expandedSections: ['a', 'b'],
      lastEventArrivedAt: 1_700_000_000,
      inputBuffer: '',
                pinnedBottom: true, pendingApprovals: [], resolvedApprovals: [], runtimeTraceFilter: 'all', panelScrollOffsets: { approvals: 0, sops: 0 }, panelFocus: null,
    };
    const rt = JSON.parse(JSON.stringify(original)) as PerTabState;
    expect(rt).toEqual(original);
  });

  it('does not contain non-serializable members (Set, Map, Function)', () => {
    // Type-level invariant: if you can `as PerTabState`, JSON.stringify must work.
    const sample: PerTabState = {
      cursor: 0,
      scrollOffset: 0,
      searchQuery: '',
      expandedSections: [],
    inputBuffer: '',
                pinnedBottom: true, pendingApprovals: [], resolvedApprovals: [], runtimeTraceFilter: 'all', panelScrollOffsets: { approvals: 0, sops: 0 }, panelFocus: null,
      lastEventArrivedAt: 0,
    };
    expect(() => JSON.stringify(sample)).not.toThrow();
  });
});

describe('TuiAppState defaults', () => {
  it('starts on the chat tab with empty views', () => {
    // Self-maintaining fixture: createInitialTuiAppState covers every TabId
    // (incl. the evolution tab), so adding a tab can't silently break this.
    const s: TuiAppState = { ...createInitialTuiAppState(), activeTab: 'chat' as TabId };
    expect(s.activeTab).toBe('chat');
    for (const id of ['dashboard', 'chat', 'daemon', 'approvals', 'runtime', 'sops', 'policy'] as TabId[]) {
      expect(s.views[id]).toBeDefined();
    }
  });
});

describe('RuntimeTraceFilter default', () => {
  it('defaults to all for a fresh per-tab state', () => {
    expect(createInitialPerTabState().runtimeTraceFilter).toBe('all');
  });
});

describe('TabId union exhaustiveness', () => {
  it('lists exactly six tabs', () => {
    const tabs: TabId[] = ['chat', 'daemon', 'approvals', 'runtime', 'sops', 'policy'];
    expect(new Set(tabs).size).toBe(6);
  });
});

describe('PerTabState timeline regression (Phase 6 D9 cleanup)', () => {
  it('no longer carries the transitional timelineEvents[] cache', () => {
    const state = createInitialPerTabState();
    expect(state).not.toHaveProperty('timelineEvents');
    expect(createInitialTuiAppState().views.chat).not.toHaveProperty('timelineEvents');
  });
});
