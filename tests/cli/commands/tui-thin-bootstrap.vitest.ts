import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog } from '../../../src/events/event-log.js';
import { FileProjectionCheckpointStore } from '../../../src/tui/runtime/projection-checkpoint-store.js';
import { RuntimeCollectorImpl } from '../../../src/tui/runtime-collector.js';

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
      const runtimeCollector = new RuntimeCollectorImpl(eventLog, checkpointStore);

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
});
