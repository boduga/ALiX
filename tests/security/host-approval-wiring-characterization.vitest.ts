/**
 * LEAN-G01 host approval wiring.
 *
 * HISTORY — read before editing.
 *
 * This file began as a CHARACTERIZATION test: it asserted that the daemon and the
 * Inspector construct `new DefaultWorkerExecutor()` with no approval store, and
 * that `daemon-runtime-executor.executeTool` ignores `ctx.approvalStore`. Those
 * were true statements about a real wiring gap, and asserting them was the honest
 * thing to do while the gap existed — it made the defect visible instead of
 * leaving it as folklore.
 *
 * The gap is now closed, so every assertion here is inverted. Asserting the
 * repaired behaviour is what stops it regressing. Do not restore the old
 * assertions: they were a description of a bug, not a requirement.
 *
 * These remain SOURCE-TEXT checks. They verify that the wiring is present in the
 * source, which is cheaper and more stable than driving a daemon, but they cannot
 * prove the store is actually used at runtime — the acceptance suites do that
 * (tests/security/worker-approval-*-acceptance.vitest.ts, host-approval-injection).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

/** A host that HAS a store must hand it to the worker it constructs. */
function assertDefaultWorkerWithStore(path: string): void {
  const text = source(path);
  expect(text).toMatch(/new PolicyGate\(config,\s*\{\s*approvalStore\s*\}\)/);
  // The fix: the executor receives the store rather than being constructed bare.
  expect(text).toMatch(/new DefaultWorkerExecutor\(approvalStore\)/);
  // The defect this replaces: a bare constructor silently drops approval
  // enforcement for every worker the host dispatches.
  expect(text).not.toMatch(/new DefaultWorkerExecutor\(\)/);
}

describe('LEAN-G01 host approval wiring (the gap is closed; these guard against regression)', () => {
  it('daemon scheduler passes its approval store to the default worker', () => {
    assertDefaultWorkerWithStore('src/operations/daemon/daemon-server.ts');
  });

  it('Inspector coordination passes its approval store to the default worker', () => {
    assertDefaultWorkerWithStore('src/interfaces/server/coordination-routes.ts');
  });

  it('daemon tool adapter forwards the runtime context approval store', () => {
    const text = source('src/operations/daemon/daemon-runtime-executor.ts');
    const start = text.indexOf('async executeTool(');
    const end = text.indexOf('async executeAgent(', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const method = text.slice(start, end);
    // `ctx`, not `_ctx`: the parameter is used now, and the underscore would
    // silently signal "deliberately ignored".
    expect(method).toMatch(/ctx:\s*RuntimeContext/);
    expect(method).not.toMatch(/_ctx:\s*RuntimeContext/);
    expect(method).toContain('executeToolBehavior(');
    // The fix: the adapter forwards the store it was given.
    expect(method).toContain('ctx.approvalStore');
  });

  it('daemon grounded-chat adapter forwards the runtime context approval store', () => {
    // grounded_chat can reach web.search/web.fetch, so it needs the same
    // forwarding as the tool path.
    const text = source('src/operations/daemon/daemon-runtime-executor.ts');
    const start = text.indexOf('async executeGroundedChat(');
    const end = text.indexOf('async executeTool(', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(text.slice(start, end)).toContain('ctx.approvalStore');
  });

  it('default worker itself forwards its constructor-injected approval store', () => {
    // The inner link: a store passed to the constructor must reach the policy
    // gate for each task, or injecting it at the host changes nothing.
    const text = source('src/coordination/kernel/worker-executor.ts');
    expect(text).toContain('this.approvalStore ? { approvalStore: this.approvalStore } : {}');
  });
});
