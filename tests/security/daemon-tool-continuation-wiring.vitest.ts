/** D9 structural guard complements the store/executor/watcher acceptance suite. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
const daemon = source('src/operations/daemon/daemon-server.ts');
const watcher = source('src/operations/daemon/approval-watcher.ts');

// Check the production composition root alone, never daemon + watcher text.
// Negative controls below exercise these same checks against deleted wiring.
function hostWiring(body: string): { construction: boolean; callback: boolean; started: boolean } {
  const startup = body.match(/async function startCoordinationService\(\): Promise<void> \{([\s\S]*?)\n\}/)?.[1] ?? '';
  return {
    construction: /toolContinuationResumer\s*=\s*new DaemonToolContinuationResumer\(defaultCwd,\s*config,\s*store,\s*approvalStore,\s*ownershipRegistry,\s*openSessionLog\)/.test(startup),
    callback: /approvalWatcher\s*=\s*new ApprovalWatcher\(defaultCwd,\s*coordinationService,\s*\{\s*resumeApproved:\s*async (\w+)\s*=>\s*\{\s*await toolContinuationResumer\?\.resumeApproved\(\1\);\s*\},?\s*\}\)/.test(startup),
    started: /approvalWatcher\.start\(\)/.test(startup),
  };
}

describe('D9 daemon tool continuation integration', () => {
  it('constructs the execution host with shared authorities, injects its callback, and starts the watcher', () => {
    expect(hostWiring(daemon)).toEqual({ construction: true, callback: true, started: true });
  });

  it('rejects deletion of all daemon continuation wiring even with the watcher unchanged', () => {
    const start = daemon.indexOf('  const { DaemonToolContinuationResumer } =');
    const end = daemon.indexOf('\n}', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(hostWiring(daemon.slice(0, start) + daemon.slice(end))).toEqual({ construction: false, callback: false, started: false });
  });

  it('rejects independently missing construction, callback, or watcher startup', () => {
    expect(hostWiring(daemon.replace('new DaemonToolContinuationResumer(', 'new UnrelatedHost(')).construction).toBe(false);
    expect(hostWiring(daemon.replace('toolContinuationResumer?.resumeApproved(id)', 'Promise.resolve()')).callback).toBe(false);
    expect(hostWiring(daemon.replace('approvalWatcher.start()', 'approvalWatcher.stop()')).started).toBe(false);
  });

  it('the watcher invokes the injected callback with the durable approval id', () => {
    const invokesCallback = (body: string) => /await this\.resumeApproved\(approval\.id\)/.test(body);
    expect(invokesCallback(watcher)).toBe(true);
    expect(invokesCallback(watcher.replace('this.resumeApproved(approval.id)', 'Promise.resolve()'))).toBe(false);
  });
});
