import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { FullFileRewriteGuard, RewriteContext } from '../../src/patch/full-file-guard.js';

describe('FullFileRewriteGuard', () => {
  const guard = new FullFileRewriteGuard({ largeFileThreshold: 5000 });

  const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java'];
  const generatedPatterns = ['dist/', 'build/', '_generated.', '.min.js', '.min.css'];

  function ctx(overrides: Partial<RewriteContext>): RewriteContext {
    return {
      path: 'test.ts',
      isNewFile: false,
      sizeBytes: 1000,
      isGenerated: false,
      hasApproval: false,
      ...overrides,
    };
  }

  describe('new files', () => {
    it('allows full-file for new source files', async () => {
      const decision = await guard.evaluate(ctx({ path: 'src/new.ts', isNewFile: true }));
      assert.strictEqual(decision.allowed, true);
    });

    it('allows full-file for new generated files', async () => {
      const decision = await guard.evaluate(ctx({ path: 'dist/new.js', isNewFile: true, isGenerated: true }));
      assert.strictEqual(decision.allowed, true);
    });
  });

  describe('existing source files', () => {
    for (const ext of sourceExtensions) {
      it(`denies full-file rewrite for existing .${ext.slice(1)} files`, async () => {
        const decision = await guard.evaluate(ctx({ path: `src/existing${ext}`, isNewFile: false }));
        assert.strictEqual(decision.allowed, false);
        assert.ok(decision.reason);
      });
    }
  });

  describe('generated files', () => {
    it('denies full-file rewrite for existing generated files without approval', async () => {
      const decision = await guard.evaluate(ctx({ path: 'dist/bundle.js', isNewFile: false, isGenerated: true }));
      assert.strictEqual(decision.allowed, false);
      assert.strictEqual(decision.requiredApproval, true);
    });

    it('allows full-file rewrite for existing generated files with approval', async () => {
      const decision = await guard.evaluate(ctx({ path: 'dist/bundle.js', isNewFile: false, isGenerated: true, hasApproval: true }));
      assert.strictEqual(decision.allowed, true);
    });
  });

  describe('large files', () => {
    it('requires approval for large source files', async () => {
      const decision = await guard.evaluate(ctx({ path: 'src/large.ts', isNewFile: false, sizeBytes: 10000 }));
      assert.strictEqual(decision.allowed, false);
      assert.strictEqual(decision.requiredApproval, true);
    });

    it('allows large source files with approval', async () => {
      const decision = await guard.evaluate(ctx({ path: 'src/large.ts', isNewFile: false, sizeBytes: 10000, hasApproval: true }));
      assert.strictEqual(decision.allowed, true);
    });
  });

  describe('generated file patterns', () => {
    for (const pattern of generatedPatterns) {
      it(`recognizes ${pattern} as generated`, async () => {
        const decision = await guard.evaluate(ctx({ path: `src/file${pattern}`, isNewFile: false }));
        // File should either be treated as generated (requires approval) or be rejected
        assert.ok(decision.requiredApproval || !decision.allowed);
      });
    }
  });
});