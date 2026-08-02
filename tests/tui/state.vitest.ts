import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionPhase, createInitialPerTabState, appendTimelineEvent, type TuiAppState, type PerTabState, type TabId } from '../../src/tui/state.js';
import { EventLog } from '../../src/events/event-log.js';

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
                pinnedBottom: true, pendingApprovals: [], resolvedApprovals: [], timelineEvents: [], runtimeTraceFilter: 'all', panelScrollOffsets: { approvals: 0, sops: 0 }, panelFocus: null,
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
                pinnedBottom: true, pendingApprovals: [], resolvedApprovals: [], timelineEvents: [], runtimeTraceFilter: 'all', panelScrollOffsets: { approvals: 0, sops: 0 }, panelFocus: null,
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
        dashboard: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0, inputBuffer: '',
                pinnedBottom: true, pendingApprovals: [], resolvedApprovals: [], timelineEvents: [], runtimeTraceFilter: 'all', panelScrollOffsets: { approvals: 0, sops: 0 }, panelFocus: null },
        chat: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0, inputBuffer: '',
                pinnedBottom: true, pendingApprovals: [], resolvedApprovals: [], timelineEvents: [], runtimeTraceFilter: 'all', panelScrollOffsets: { approvals: 0, sops: 0 }, panelFocus: null },
        agent: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0, inputBuffer: '',
                pinnedBottom: true, pendingApprovals: [], resolvedApprovals: [], timelineEvents: [], runtimeTraceFilter: 'all', panelScrollOffsets: { approvals: 0, sops: 0 }, panelFocus: null },
        daemon: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0, inputBuffer: '',
                pinnedBottom: true, pendingApprovals: [], resolvedApprovals: [], timelineEvents: [], runtimeTraceFilter: 'all', panelScrollOffsets: { approvals: 0, sops: 0 }, panelFocus: null },
        approvals: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0, inputBuffer: '',
                pinnedBottom: true, pendingApprovals: [], resolvedApprovals: [], timelineEvents: [], runtimeTraceFilter: 'all', panelScrollOffsets: { approvals: 0, sops: 0 }, panelFocus: null },
        runtime: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0, inputBuffer: '',
                pinnedBottom: true, pendingApprovals: [], resolvedApprovals: [], timelineEvents: [], runtimeTraceFilter: 'all', panelScrollOffsets: { approvals: 0, sops: 0 }, panelFocus: null },
        sops: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0, inputBuffer: '',
                pinnedBottom: true, pendingApprovals: [], resolvedApprovals: [], timelineEvents: [], runtimeTraceFilter: 'all', panelScrollOffsets: { approvals: 0, sops: 0 }, panelFocus: null },
        policy: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0, inputBuffer: '',
                pinnedBottom: true, pendingApprovals: [], resolvedApprovals: [], timelineEvents: [], runtimeTraceFilter: 'all', panelScrollOffsets: { approvals: 0, sops: 0 }, panelFocus: null },
        capabilities: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0, inputBuffer: '',
                pinnedBottom: true, pendingApprovals: [], resolvedApprovals: [], timelineEvents: [], runtimeTraceFilter: 'all', panelScrollOffsets: { approvals: 0, sops: 0 }, panelFocus: null },
      },
      refreshGeneration: 0,
      refreshStatus: 'idle',
      history: [],
    };
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

describe('appendTimelineEvent dual-emit (Phase 6, D9)', () => {
  /** Deterministic flush of a fire-and-forget EventLog append: the log notifies
   *  watchers AFTER appendFile resolves, so awaiting `count` watch
   *  notifications guarantees the entries are on disk before readAll. */
  async function flushedAfter(log: EventLog, count: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let seen = 0;
      log.watch(() => { if (++seen >= count) resolve(); });
    });
  }

  function makeLog(): Promise<EventLog> {
    const log = new EventLog(mkdtempSync(join(tmpdir(), 'alix-state-')));
    return log.init().then(() => log);
  }

  it('emits a matching log entry when given an eventLog+sessionId', async () => {
    const log = await makeLog();
    const state = createInitialPerTabState();
    const flushed = flushedAfter(log, 1);
    appendTimelineEvent(state, { kind: 'user', text: 'hi' }, { eventLog: log, sessionId: 'chat-1' });
    await flushed;
    const events = await log.readAll();
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('chat.message');
    expect(events[0]!.sessionId).toBe('chat-1');
    expect(events[0]!.actor).toBe('user');
    expect(events[0]!.payload).toEqual({ text: 'hi' });
  });

  it('maps agent and capability kinds onto chat.response with the agent actor', async () => {
    const log = await makeLog();
    const state = createInitialPerTabState();
    const flushed = flushedAfter(log, 2);
    appendTimelineEvent(state, { kind: 'agent', text: 'ok' }, { eventLog: log, sessionId: 'agent-1' });
    appendTimelineEvent(state, { kind: 'capability', invocationId: 'i1', capabilityId: 'core.x', status: 'running' }, { eventLog: log, sessionId: 'chat-1' });
    await flushed;
    const events = await log.readAll();
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.type)).toEqual(['chat.response', 'chat.response']);
    expect(events[0]!.sessionId).toBe('agent-1');
    expect(events[0]!.actor).toBe('agent');
    expect(events[0]!.payload).toEqual({ text: 'ok' });
    expect(events[1]!.sessionId).toBe('chat-1');
    expect(events[1]!.actor).toBe('agent');
  });

  it('keeps Phase-3 in-memory semantics when no emit context is given', () => {
    const state = createInitialPerTabState();
    const evt = appendTimelineEvent(state, { kind: 'user', text: 'hi' });
    expect(state.timelineEvents).toHaveLength(1);
    expect(evt.kind).toBe('user');
    expect(evt.source).toBe('operator');
  });
});
