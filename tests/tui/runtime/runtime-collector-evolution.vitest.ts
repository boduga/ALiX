// tests/tui/runtime/runtime-collector-evolution.vitest.ts
import { describe, expect, it } from 'vitest';
import { ProjectionRuntime } from '../../../src/tui/runtime/projection-runtime.js';
import { ProjectionIds } from '../../../src/tui/runtime/projection-ids.js';

class AsyncSnapBuilder {
  async snapshot(): Promise<{ generatedAt: number }> {
    return { generatedAt: 42 };
  }
  update(): void {}
  reset(): void {}
}

describe('ProjectionRuntime.snapshotOfAsync', () => {
  it('awaits an async builder snapshot', async () => {
    const rt = new ProjectionRuntime();
    rt.register(ProjectionIds.evolution, new AsyncSnapBuilder() as any);
    await expect(rt.snapshotOfAsync(ProjectionIds.evolution)).resolves.toEqual({ generatedAt: 42 });
  });

  it('returns undefined for an unregistered id', async () => {
    const rt = new ProjectionRuntime();
    await expect(rt.snapshotOfAsync('evolution')).resolves.toBeUndefined();
  });
});
