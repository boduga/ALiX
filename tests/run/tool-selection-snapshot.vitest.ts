/**
 * T2-e1: isolated snapshot replay. These tests build real git workspaces in
 * temp directories so the worktree path, the dirty-tree fallback, and cleanup
 * are exercised rather than mocked.
 */
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import {
  DEFAULT_SNAPSHOT_EXCLUDES,
  createSnapshotReplayRunner,
  createReplaySnapshot,
  replayToolInIsolation,
} from '../../src/decision/tool-selection-snapshot.js';
import type { ToolSelectionScope } from '../../src/decision/tool-selection-replay.js';
import {
  builtinCandidateId,
  freezeToolCandidates,
} from '../../src/decision/tool-selection-candidates.js';

const run = promisify(execFile);

const frozen = freezeToolCandidates({
  builtin: [
    { name: 'alix_file_read', description: 'Read a file' },
    { name: 'alix_grep_search', description: 'Search file contents' },
  ],
});

const scope: ToolSelectionScope = {
  scopeId: 'scope_7',
  iteration: 7,
  candidates: frozen.candidates,
  bindings: frozen.bindings,
  offered: frozen.candidates.map(candidate => candidate.candidateId),
  requirementCandidates: [],
  scoperRanking: [{ candidateId: builtinCandidateId('alix_file_read'), score: 1 }],
  actualCandidateIds: [builtinCandidateId('alix_grep_search')],
};

async function makeGitWorkspace(options: { dirty?: boolean } = {}): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'alix-snapshot-'));
  await run('git', ['-C', root, 'init', '-q']);
  writeFileSync(join(root, 'PROJECT.md'), 'original content\n');
  // Ignored, not untracked: an untracked file makes the tree dirty for
  // snapshot purposes, because a worktree would not contain it.
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n');
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'dep.js'), 'module.exports = 1;\n');
  await run('git', ['-C', root, 'add', 'PROJECT.md', '.gitignore']);
  await run('git', ['-C', root, '-c', 'user.email=t@example.com', '-c', 'user.name=test', 'commit', '-qm', 'init']);
  if (options.dirty) writeFileSync(join(root, 'PROJECT.md'), 'uncommitted edit\n');
  return root;
}

const okOutcome = { execution: 'success' as const, selection: 'novel' as const, evidence: 'contributed' as const };

describe('createReplaySnapshot', () => {
  it('snapshots a clean git workspace with a worktree and cleans it up', async () => {
    const source = await makeGitWorkspace();
    const snapshot = await createReplaySnapshot(source);
    try {
      expect(snapshot.kind).toBe('worktree');
      expect(snapshot.sourceDirty).toBe(false);
      expect(snapshot.sourceRevision).toMatch(/^[0-9a-f]{7,}/);
      expect(readFileSync(join(snapshot.root, 'PROJECT.md'), 'utf8')).toContain('original content');
    } finally {
      await snapshot.cleanup();
    }
    const worktrees = await run('git', ['-C', source, 'worktree', 'list']);
    expect(worktrees.stdout.trim().split('\n')).toHaveLength(1); // only the source
    rmSync(source, { recursive: true, force: true });
  });

  it('falls back to a copy for a dirty workspace, since a worktree only contains HEAD', async () => {
    const source = await makeGitWorkspace({ dirty: true });
    const snapshot = await createReplaySnapshot(source);
    try {
      expect(snapshot.kind).toBe('copy');
      expect(snapshot.sourceDirty).toBe(true);
      // The uncommitted content is what the counterfactual must see.
      expect(readFileSync(join(snapshot.root, 'PROJECT.md'), 'utf8')).toContain('uncommitted edit');
      expect(snapshot.excluded).toEqual(DEFAULT_SNAPSHOT_EXCLUDES);
      expect(existsSync(join(snapshot.root, 'node_modules'))).toBe(false);
    } finally {
      await snapshot.cleanup();
    }
    rmSync(source, { recursive: true, force: true });
  });

  it('refuses a worktree snapshot of a dirty workspace when the strategy is forced', async () => {
    const source = await makeGitWorkspace({ dirty: true });
    await expect(createReplaySnapshot(source, { strategy: 'worktree' })).rejects.toThrow(/dirty workspace/);
    rmSync(source, { recursive: true, force: true });
  });

  it('copies a plain (non-git) directory', async () => {
    const source = mkdtempSync(join(tmpdir(), 'alix-plain-'));
    writeFileSync(join(source, 'notes.md'), 'plain\n');
    const snapshot = await createReplaySnapshot(source);
    try {
      expect(snapshot.kind).toBe('copy');
      expect(snapshot.sourceRevision).toBeUndefined();
      expect(readFileSync(join(snapshot.root, 'notes.md'), 'utf8')).toBe('plain\n');
    } finally {
      await snapshot.cleanup();
    }
    rmSync(source, { recursive: true, force: true });
  });
});

describe('replayToolInIsolation', () => {
  it('replays a hermetic tool inside the snapshot and leaves the source untouched', async () => {
    const source = await makeGitWorkspace();
    const snapshot = await createReplaySnapshot(source);
    let executedAgainst = '';
    try {
      const result = await replayToolInIsolation({
        scope,
        tool: 'alix_file_read',
        snapshot,
        execute: async ({ root }) => {
          executedAgainst = root;
          // The counterfactual may write inside the snapshot; the source must not change.
          writeFileSync(join(root, 'PROJECT.md'), 'rewritten by replay\n');
          return { outcome: okOutcome };
        },
      });

      expect(executedAgainst).toBe(snapshot.root);
      expect(readFileSync(join(source, 'PROJECT.md'), 'utf8')).toContain('original content');
      expect(result).toMatchObject({
        basis: 'replayed',
        environment: 'isolated-worktree',
        scopeId: 'scope_7',
        tool: 'alix_file_read',
        network: 'disabled',
        sourceSnapshot: source,
        outcome: okOutcome,
      });
      expect((result as { replayId: string }).replayId).toBe(snapshot.replayId);
    } finally {
      await snapshot.cleanup();
    }
    rmSync(source, { recursive: true, force: true });
  });

  it('refuses a mutating tool before any snapshot work', async () => {
    const source = await makeGitWorkspace();
    const snapshot = await createReplaySnapshot(source);
    try {
      const result = await replayToolInIsolation({
        scope,
        tool: 'alix_patch_apply',
        snapshot,
        execute: async () => ({ outcome: okOutcome }),
      });
      expect(result).toEqual({
        basis: 'unknown',
        tool: 'alix_patch_apply',
        reason: 'mutating tool: requires an isolated snapshot plus a mutation policy',
      });
    } finally {
      await snapshot.cleanup();
    }
    rmSync(source, { recursive: true, force: true });
  });

  it('keeps a failed replay unknown instead of fabricating an outcome', async () => {
    const source = await makeGitWorkspace();
    const snapshot = await createReplaySnapshot(source);
    try {
      const result = await replayToolInIsolation({
        scope,
        tool: 'alix_grep_search',
        snapshot,
        execute: async () => ({ error: 'pattern invalid' }),
      });
      expect(result).toEqual({ basis: 'unknown', tool: 'alix_grep_search', reason: 'replay failed: pattern invalid' });
    } finally {
      await snapshot.cleanup();
    }
    rmSync(source, { recursive: true, force: true });
  });
});

describe('createSnapshotReplayRunner', () => {
  it('gives the evaluator a fresh isolated snapshot per alternative and cleans up', async () => {
    const source = await makeGitWorkspace();
    const runner = createSnapshotReplayRunner({
      sourceRoot: source,
      // LOCAL ONLY: candidate identity -> executable machinery.
      toolFor: (candidateId) => candidateId.replace(/^builtin:/, ''),
      execute: async ({ root }) => {
        expect(readFileSync(join(root, 'PROJECT.md'), 'utf8')).toContain('original content');
        return { outcome: okOutcome };
      },
    });

    const first = await runner({
      scopeId: 'scope_7',
      candidateId: builtinCandidateId('alix_file_read'),
      domain: 'builtin',
    });
    const second = await runner({
      scopeId: 'scope_7',
      candidateId: builtinCandidateId('alix_grep_search'),
      domain: 'builtin',
    });

    expect(first).toMatchObject({ outcome: okOutcome });
    expect(second).toMatchObject({ outcome: okOutcome });
    // Distinct snapshots, both cleaned up: only the source worktree remains.
    expect((first as { replayId: string }).replayId).not.toBe((second as { replayId: string }).replayId);
    const worktrees = await run('git', ['-C', source, 'worktree', 'list']);
    expect(worktrees.stdout.trim().split('\n')).toHaveLength(1);
    rmSync(source, { recursive: true, force: true });
  });

  it('reports a mutating alternative as an error rather than executing it', async () => {
    const source = await makeGitWorkspace();
    const runner = createSnapshotReplayRunner({
      sourceRoot: source,
      toolFor: (candidateId) => candidateId.replace(/^builtin:/, ''),
      execute: async () => {
        throw new Error('must not run');
      },
    });

    const result = await runner({
      scopeId: 'scope_7',
      candidateId: builtinCandidateId('alix_patch_apply'),
      domain: 'builtin',
    });

    expect(result).toEqual({ error: 'mutating tool: requires an isolated snapshot plus a mutation policy' });
    rmSync(source, { recursive: true, force: true });
  });
});
