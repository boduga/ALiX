import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog } from '../../../src/events/event-log.js';
import { FileProjectionCheckpointStore } from '../../../src/tui/runtime/projection-checkpoint-store.js';
import { RuntimeCollectorImpl } from '../../../src/tui/runtime-collector.js';
import { TimelineBuilder } from '../../../src/tui/runtime/timeline-builder.js';
import { IncrementalExecutionTraceBuilder } from '../../../src/tui/runtime/execution-trace-builder.js';
import { createProjectionRuntime } from '../../../src/tui/runtime/projection-runtime.js';
import { SnapshotBuilder } from '../../../src/tui/snapshot-builder.js';

describe('runTui bootstrap (thin)', () => {
  it('exports a runTui function', { timeout: 15_000 }, async () => {
    const mod = await import('../../../src/cli/commands/tui.js');
    expect(typeof mod.runTui).toBe('function');
    expect(mod.runTui.length).toBeLessThanOrEqual(3);
    // runTui is `export async function runTui`; it must remain async because
    // runtimeCollector.start() is now async (awaits recovery before the first
    // sample) and tui.ts awaits it at the start() call site.
    expect(mod.runTui.constructor.name).toBe('AsyncFunction');
  });

  it('wires a durable checkpoint store into the RuntimeCollector (the tui.ts construction seam)', { timeout: 15_000 }, async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), 'tui-bootstrap-checkpoint-'));
    try {
      const eventLog = new EventLog(sessionDir);
      await eventLog.init();

      // The exact construction seam tui.ts now uses: the store is built over
      // sessionDir and INJECTED into the collector (constructor injection —
      // the collector never instantiates the store itself).
      const checkpointStore = new FileProjectionCheckpointStore(sessionDir);
      // Options-object constructor (Task 2): sessionId scopes the projections —
      // the appended event below carries sessionId 's1', so the collector must
      // project that session for the trace to populate.
      const runtimeCollector = new RuntimeCollectorImpl({
        eventLog,
        checkpointStore,
        sessionId: 's1',
        projectionRuntime: createProjectionRuntime([['timeline', new TimelineBuilder('s1')], ['trace', new IncrementalExecutionTraceBuilder()]]),
      });

      await eventLog.append({
        type: 'tool.started',
        actor: 'system',
        sessionId: 's1',
        payload: { toolCallId: 'tc1', toolName: 'search' },
      });

      // start() is async (awaits recovery before the first sample) — this is
      // the same call tui.ts makes with `await` at its start() call site.
      await runtimeCollector.start();

      // After a sample, the durable checkpoint must have been written to
      // sessionDir (save-as-commit-marker: the cache advances only after a
      // durable save). Reading the file proves the store injection is live.
      const snapshot = await runtimeCollector.snapshot();
      expect(snapshot?.trace).toHaveLength(1);

      const raw = await readFile(join(sessionDir, 'projection-checkpoint.json'), 'utf-8');
      const persisted = JSON.parse(raw) as { version: number; cursor: string; committedAt: number };
      expect(persisted.version).toBe(1);
      expect(typeof persisted.cursor).toBe('string');
      expect(typeof persisted.committedAt).toBe('number');
      expect(persisted.committedAt).toBeGreaterThan(0);

      runtimeCollector.stop();
    } finally {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  // Task 3.5 regression fix: THREE independent projections over ONE EventLog —
  // an OUTER-scoped runtime collector (projecting the execution trace from
  // outer-session events) PLUS the two sub-session collectors (chat + agent)
  // for the chat/agent timeline projections. The outer collector feeds
  // SnapshotBuilder's `runtime` arg, so snapshot.runtime.trace drives the
  // Phase 4 Runtime tab.
  it('wires THREE collectors (outer runtime + chat + agent) over one EventLog, each with its own per-role checkpoint store', { timeout: 15_000 }, async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), 'tui-bootstrap-three-'));
    try {
      const eventLog = new EventLog(sessionDir);
      await eventLog.init();

      // The exact construction seam tui.ts now uses: three collectors — one
      // per session — EACH with its OWN checkpoint store (own file under
      // `projections/<role>/`). Sharing one store file is NOT safe: the first
      // collector's startup sample advances the log-global watermark, so a
      // later-starting collector would recover past events it never consumed.
      const outerSessionId = 'outer';
      const chatSessionId = `${outerSessionId}-chat`;
      const agentSessionId = `${outerSessionId}-agent`;
      const runtimeCheckpointStore = new FileProjectionCheckpointStore(join(sessionDir, 'projections', 'runtime'));
      const chatCheckpointStore = new FileProjectionCheckpointStore(join(sessionDir, 'projections', 'chat'));
      const agentCheckpointStore = new FileProjectionCheckpointStore(join(sessionDir, 'projections', 'agent'));

      const runtimeCollector = new RuntimeCollectorImpl({
        eventLog,
        checkpointStore: runtimeCheckpointStore,
        sessionId: outerSessionId,
        projectionRuntime: createProjectionRuntime([['timeline', new TimelineBuilder(outerSessionId)], ['trace', new IncrementalExecutionTraceBuilder()]]),
      });
      const chatCollector = new RuntimeCollectorImpl({
        eventLog,
        checkpointStore: chatCheckpointStore,
        sessionId: chatSessionId,
        projectionRuntime: createProjectionRuntime([['timeline', new TimelineBuilder(chatSessionId)], ['trace', new IncrementalExecutionTraceBuilder()]]),
      });
      const agentCollector = new RuntimeCollectorImpl({
        eventLog,
        checkpointStore: agentCheckpointStore,
        sessionId: agentSessionId,
        projectionRuntime: createProjectionRuntime([['timeline', new TimelineBuilder(agentSessionId)], ['trace', new IncrementalExecutionTraceBuilder()]]),
      });

      // Capability/tool/runtime events carry the OUTER sessionId; chat/agent
      // tab emits carry their sub-session ids.
      await eventLog.append({
        type: 'tool.started',
        actor: 'system',
        sessionId: outerSessionId,
        payload: { toolCallId: 'tc1', toolName: 'search' },
      });
      await eventLog.append({
        type: 'chat.message',
        actor: 'system',
        sessionId: chatSessionId,
        payload: { text: 'hi' },
      });
      await eventLog.append({
        type: 'agent.message',
        actor: 'system',
        sessionId: agentSessionId,
        payload: { text: 'thinking' },
      });

      // All three start() — the same calls tui.ts makes with `await`.
      await runtimeCollector.start();
      await chatCollector.start();
      await agentCollector.start();

      // Each collector projects ONLY its own session's events.
      const runtimeSnap = await runtimeCollector.snapshot();
      expect(runtimeSnap?.sessionId).toBe(outerSessionId);
      expect(runtimeSnap?.trace).toHaveLength(1);      // the outer tool.started
      expect(runtimeSnap?.timeline).toHaveLength(1);   // the outer tool.started projects into the timeline (#434)

      const chatSnap = await chatCollector.snapshot();
      expect(chatSnap?.sessionId).toBe(chatSessionId);
      expect(chatSnap?.timeline.map(e => e.kind)).toEqual(['chat.message']);

      const agentSnap = await agentCollector.snapshot();
      expect(agentSnap?.sessionId).toBe(agentSessionId);
      expect(agentSnap?.timeline.map(e => e.kind)).toEqual(['agent.message']);

      // Each collector persists its OWN checkpoint file (independent recovery —
      // the per-collector-store deviation from a single shared store file).
      const chatCheckpointRaw = await readFile(join(sessionDir, 'projections', 'chat', 'projection-checkpoint.json'), 'utf-8');
      const chatPersisted = JSON.parse(chatCheckpointRaw) as { version: number; committedAt: number };
      expect(chatPersisted.version).toBe(1);
      expect(chatPersisted.committedAt).toBeGreaterThan(0);

      // The OUTER-scoped collector feeds SnapshotBuilder's `runtime` arg →
      // snapshot.runtime.trace is populated (the Runtime tab regression fix).
      const stubSession = {
        getState: () => ({ createdAt: new Date().toISOString(), turnCount: 0 }),
        getMode: () => 'auto',
        getPhase: () => 'idle',
        getVersion: () => 'stub',
        getStartedAt: () => Date.now(),
      };
      const stubSubsystem = { snapshot: async () => null };
      const stubDaemon = {
        start: () => {},
        stop: async () => {},
        snapshot: async () => null,
      };
      const builder = new SnapshotBuilder(
        stubSession as never,
        stubSubsystem,
        stubSubsystem as never, // policy slot expects a full PolicyEngine — stub is enough for snapshot.runtime
        stubSubsystem,
        runtimeCollector,
        stubDaemon as never,
        sessionDir,
      );
      const snap = await builder.build(1);
      expect(snap?.runtime?.trace).toHaveLength(1);

      runtimeCollector.stop();
      chatCollector.stop();
      agentCollector.stop();
    } finally {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });
});
