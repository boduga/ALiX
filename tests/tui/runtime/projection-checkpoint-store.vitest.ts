import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileProjectionCheckpointStore, PersistedProjectionCheckpoint } from '../../../src/tui/runtime/projection-checkpoint-store.js';
import { EventLog } from '../../../src/events/event-log.js';

function makeSerialized(log: EventLog, seq = 5): PersistedProjectionCheckpoint {
  return { version: 1, cursor: log.serializeCursor(log.getCursor()), committedAt: 1000 };
}

describe('FileProjectionCheckpointStore', () => {
  let dir: string;
  let store: FileProjectionCheckpointStore;
  let log: EventLog;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'alix-chk-'));
    log = new EventLog(dir);
    await log.init();
    store = new FileProjectionCheckpointStore(dir);
  });

  it('load returns null when no checkpoint exists', async () => {
    expect(await store.load()).toBeNull();
  });

  it('save then load round-trips a serialized cursor string + timestamp', async () => {
    const cp = makeSerialized(log);
    await store.save(cp);
    const loaded = await store.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.cursor).toBe(cp.cursor);       // opaque string preserved verbatim
    expect(loaded!.committedAt).toBe(cp.committedAt);
    // The collector deserializes the opaque string back into an owned cursor:
    expect(log.cursorsEqual(log.deserializeCursor(loaded!.cursor), log.getCursor())).toBe(true);
  });

  it('load returns null for malformed JSON', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'projection-checkpoint.json'), 'not-json', 'utf-8');
    expect(await store.load()).toBeNull();
  });

  it('load returns null for an unknown container version', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'projection-checkpoint.json'), JSON.stringify({ version: 99, cursor: 'x', committedAt: 1 }), 'utf-8');
    expect(await store.load()).toBeNull();
  });

  it('writes atomically (tmp file then rename — no half-written target)', async () => {
    const cp = makeSerialized(log);
    await store.save(cp);
    // A stale tmp file must not exist after a successful save.
    expect(existsSync(join(dir, 'projection-checkpoint.json.tmp'))).toBe(false);
    expect(existsSync(join(dir, 'projection-checkpoint.json'))).toBe(true);
  });
});
