import { describe, it, expect } from 'vitest';
import { AsyncEventQueue } from '../../src/capability/types.js';
import type { Capability } from '../../src/capability/types.js';

describe('Capability type contract', () => {
  it('is structurally typed for a minimal core capability', () => {
    const cap: Capability = {
      id: 'core.session.list', version: '1.0', kind: 'core',
      title: 'List sessions', description: 'List all sessions',
      tags: ['session'], category: 'session', risk: 'low',
      requiredPermissions: ['operator'],
      execution: { strategy: 'native' },
    };
    expect(cap.id).toBe('core.session.list');
    expect(cap.execution.strategy).toBe('native');
  });

  it('accepts multiple required permissions, schemas, examples, deps', () => {
    const cap: Capability = {
      id: 'tool.file.read', version: '1.0', kind: 'tool',
      title: 'Read file', description: 'Read a file',
      tags: ['file'], category: 'file', risk: 'low',
      requiredPermissions: ['developer', 'operator'],
      argsSchema: { type: 'object', properties: { path: { type: 'string' } } },
      resultSchema: { type: 'string' },
      examples: ['/tool.file.read path="a.ts"'],
      execution: { strategy: 'tool', timeout: 10_000, cancellable: false },
      dependencies: ['core.cwd'],
      extensions: { source: 'builtin' },
    };
    expect(cap.requiredPermissions).toContain('developer');
  });
});

describe('AsyncEventQueue', () => {
  it('buffers events and drains them as an async iterable', async () => {
    const q = new AsyncEventQueue<number>();
    q.push(1); q.push(2); q.close();
    const seen: number[] = [];
    for await (const n of q) seen.push(n);
    expect(seen).toEqual([1, 2]);
  });

  it('delivers events pushed after iteration starts', async () => {
    const q = new AsyncEventQueue<number>();
    const seen: number[] = [];
    const iter = (async () => {
      for await (const n of q) { seen.push(n); if (seen.length === 2) break; }
    })();
    q.push(10); q.push(20);
    await iter;
    expect(seen).toEqual([10, 20]);
  });

  it('preserves ordering with a delayed consumer (slow pull)', async () => {
    const q = new AsyncEventQueue<number>();
    const seen: number[] = [];
    const consumer = (async () => {
      for await (const n of q) {
        seen.push(n);
        await new Promise((r) => setTimeout(r, 5)); // consumer is slower than producer
      }
    })();
    // Producer fires several events while the consumer is mid-await.
    q.push(1); q.push(2); q.push(3); q.push(4);
    q.close();
    await consumer;
    expect(seen).toEqual([1, 2, 3, 4]);
  });
});
