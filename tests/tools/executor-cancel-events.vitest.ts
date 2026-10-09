import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTempDirSync } from '../helpers/temp.js';
import { ToolExecutor } from '../../src/capabilities/tools/executor.js';
import type { ToolRouter } from '../../src/capabilities/tools/tool-router.js';
import type { EventLog } from '../../src/runtime-state/events/event-log.js';
import type { AlixEvent, NewEvent } from '../../src/runtime-state/events/types.js';
import type { AlixConfig } from '../../src/operations/config/schema.js';
import { ExecutionCancelledError } from '../../src/runtime-state/runtime/cancellation-token.js';
import { buildExecutionTrace } from '../../src/interfaces/tui/runtime/execution-trace-builder.js';

const config: AlixConfig = {
  version: 1, model: { provider: 'mock', name: 'test' },
  permissions: { default: 'allow', tools: {}, protectedPaths: [], allowNetworkDomains: [], denyCommands: [] },
  context: { repoMap: false, repoMapMode: 'lite', maxRepoMapTokens: 0, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
  runtime: { provider: 'process', shell: '/bin/sh', commandTimeoutMs: 30000, envAllowlist: [] },
  ui: { enabled: false, host: 'localhost', port: 0, transport: 'sse' },
};
let directory = '';
afterEach(() => { vi.restoreAllMocks(); if (directory) removeTempDirSync(directory); });

function setup(failTerminal = false) {
  directory = mkdtempSync(join(tmpdir(), 'executor-cancel-event-'));
  const events: AlixEvent[] = [];
  const log = {
    sessionDir: join(directory, 'sessions', 'cancel-session'),
    append: async (event: NewEvent) => {
      if (failTerminal && event.type === 'tool.completed') throw new Error('persistence unavailable');
      events.push({ ...event, id: `event-${events.length + 1}`, seq: events.length + 1, version: 1, timestamp: new Date().toISOString() });
    },
  } as unknown as EventLog;
  const executor = new ToolExecutor(config, log, directory);
  const router = (executor as unknown as { router: ToolRouter }).router;
  return { executor, router, events };
}
const request = { toolCallId: 'cancel-call', name: 'file.read', agentId: 'worker-1',
  invocationId: 'invocation-1', executionId: 'execution-1', replayId: 'replay-1', args: { path: 'read.txt' } };

describe('cancelled tool event producer', () => {
  it('closes the exact call as cancelled and preserves the original cancellation', async () => {
    const { executor, router, events } = setup();
    const cancellation = new ExecutionCancelledError('operator cancel');
    vi.spyOn(router, 'execute').mockRejectedValue(cancellation);
    await expect(executor.execute(request)).rejects.toBe(cancellation);
    expect(events.filter(event => event.type === 'tool.completed')).toHaveLength(1);
    expect(events.find(event => event.type === 'tool.completed')!.payload).toMatchObject({
      toolCallId: 'cancel-call', toolName: 'file.read', agentId: 'worker-1', status: 'cancelled',
      invocationId: 'invocation-1', executionId: 'execution-1', replayId: 'replay-1',
    });
    expect(events.some(event => event.type === 'tool.failed' || event.type === 'tool.output')).toBe(false);
    expect(buildExecutionTrace(events)).toMatchObject([{ status: 'cancelled', agentId: 'worker-1', toolMetadata: { toolCallId: 'cancel-call' } }]);
  });
  it('preserves cancellation when terminal telemetry cannot persist', async () => {
    const { executor, router } = setup(true);
    const cancellation = new ExecutionCancelledError('operator cancel');
    vi.spyOn(router, 'execute').mockRejectedValue(cancellation);
    await expect(executor.execute(request)).rejects.toBe(cancellation);
  });
  it('does not classify an ordinary thrown error as cancellation', async () => {
    const { executor, router, events } = setup();
    const failure = new Error('provider timeout');
    vi.spyOn(router, 'execute').mockRejectedValue(failure);
    await expect(executor.execute(request)).rejects.toBe(failure);
    expect(events.some(event => event.type === 'tool.completed')).toBe(false);
  });
});
