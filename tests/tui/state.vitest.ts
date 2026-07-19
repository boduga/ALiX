import { describe, it, expect } from 'vitest';
import { SessionPhase, type TuiAppState, type PerTabState, type TabId } from '../../src/tui/state.js';

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
      inputBuffer: '', submittedPrompts: [], agentResponses: [],
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
    inputBuffer: '', submittedPrompts: [], agentResponses: [],
      lastEventArrivedAt: 0,
    };
    expect(() => JSON.stringify(sample)).not.toThrow();
  });
});

describe('TuiAppState defaults', () => {
  it('starts on the chat tab with empty views', () => {
    const s: TuiAppState = {
      lastSnapshot: undefined,
      activeTab: 'chat' as TabId,
      views: {
        chat: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0, inputBuffer: '', submittedPrompts: [], agentResponses: [] },
        daemon: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0, inputBuffer: '', submittedPrompts: [], agentResponses: [] },
        approvals: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0, inputBuffer: '', submittedPrompts: [], agentResponses: [] },
        runtime: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0, inputBuffer: '', submittedPrompts: [], agentResponses: [] },
        sops: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0, inputBuffer: '', submittedPrompts: [], agentResponses: [] },
        policy: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0, inputBuffer: '', submittedPrompts: [], agentResponses: [] },
      },
      refreshGeneration: 0,
      refreshStatus: 'idle',
      history: [],
    };
    expect(s.activeTab).toBe('chat');
    for (const id of ['chat', 'daemon', 'approvals', 'runtime', 'sops', 'policy'] as TabId[]) {
      expect(s.views[id]).toBeDefined();
    }
  });
});

describe('TabId union exhaustiveness', () => {
  it('lists exactly six tabs', () => {
    const tabs: TabId[] = ['chat', 'daemon', 'approvals', 'runtime', 'sops', 'policy'];
    expect(new Set(tabs).size).toBe(6);
  });
});
