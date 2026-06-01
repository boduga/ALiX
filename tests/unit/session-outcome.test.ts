import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { extractSessionOutcome } from '../../src/context/session-outcome.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

describe('extractSessionOutcome', () => {
  const testDirs: string[] = [];

  beforeEach(async () => {
    // Clean up any previous test dirs
    for (const dir of testDirs) {
      await rm(dir, { force: true, recursive: true }).catch(() => {});
    }
    testDirs.length = 0;
  });

  it('extracts outcome from completed session', async () => {
    const sessionDir = '/tmp/test-session';
    testDirs.push(sessionDir);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, 'events.jsonl'), JSON.stringify({
      type: 'session.started', sessionId: 'test', timestamp: new Date().toISOString(),
      actor: 'system', seq: 1, id: '1', version: 1, payload: {}
    }) + '\n' + JSON.stringify({
      type: 'session.ended', sessionId: 'test', timestamp: new Date().toISOString(),
      actor: 'system', seq: 2, id: '2', version: 1,
      payload: { reason: 'completed', summary: 'Done' }
    }) + '\n' + JSON.stringify({
      type: 'model.usage', sessionId: 'test', timestamp: new Date().toISOString(),
      actor: 'system', seq: 3, id: '3', version: 1,
      payload: { inputTokens: 1000, outputTokens: 500 }
    }) + '\n');

    const outcome = await extractSessionOutcome(sessionDir);
    assert.strictEqual(outcome.success, true);
    assert.strictEqual(outcome.reason, 'completed');
    assert.strictEqual(outcome.totalTokens, 1500);
  });

  it('extracts iteration count', async () => {
    const sessionDir = '/tmp/test-session-iterations';
    testDirs.push(sessionDir);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, 'events.jsonl'),
      JSON.stringify({ type: 'session.started', sessionId: 'test', timestamp: new Date().toISOString(), actor: 'system', seq: 1, id: '1', version: 1, payload: {} }) + '\n' +
      JSON.stringify({ type: 'agent.message', sessionId: 'test', timestamp: new Date().toISOString(), actor: 'system', seq: 2, id: '2', version: 1, payload: { role: 'assistant' } }) + '\n' +
      JSON.stringify({ type: 'agent.message', sessionId: 'test', timestamp: new Date().toISOString(), actor: 'system', seq: 3, id: '3', version: 1, payload: { role: 'assistant' } }) + '\n' +
      JSON.stringify({ type: 'agent.message', sessionId: 'test', timestamp: new Date().toISOString(), actor: 'system', seq: 4, id: '4', version: 1, payload: { role: 'assistant' } }) + '\n' +
      JSON.stringify({ type: 'session.ended', sessionId: 'test', timestamp: new Date().toISOString(), actor: 'system', seq: 5, id: '5', version: 1, payload: { reason: 'completed' } }) + '\n'
    );

    const outcome = await extractSessionOutcome(sessionDir);
    assert.strictEqual(outcome.iterations, 3);
  });

  it('extracts outcome from failed session', async () => {
    const sessionDir = '/tmp/test-session-failed';
    testDirs.push(sessionDir);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, 'events.jsonl'),
      JSON.stringify({ type: 'session.started', sessionId: 'test', timestamp: new Date().toISOString(), actor: 'system', seq: 1, id: '1', version: 1, payload: {} }) + '\n' +
      JSON.stringify({ type: 'session.ended', sessionId: 'test', timestamp: new Date().toISOString(), actor: 'system', seq: 2, id: '2', version: 1, payload: { reason: 'error' } }) + '\n'
    );

    const outcome = await extractSessionOutcome(sessionDir);
    assert.strictEqual(outcome.success, false);
    assert.strictEqual(outcome.reason, 'error');
  });
});