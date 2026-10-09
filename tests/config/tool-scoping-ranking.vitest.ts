/**
 * T3 finding 8: the deterministic scoper is not task-conditioned and scored
 * connectives as symbols.
 *
 * Recorded in T3 as "ranked `create_hook` 9 above `file_read` 6 for a
 * read-and-summarize prompt". Reproduced on this branch's tool set and worse
 * than recorded — for "Read the config file and summarize what it does" the
 * old raw-overlap ranking put first:
 *
 *   grep_search  matched [the, and, it, does]   -> 0 content tokens
 *   create_hook  matched [the, file, and, what] -> 1 content token
 *   file_read    matched [read, the, file]      -> 2 content tokens
 *
 * Two properties are pinned here, and the second matters more than the first:
 *
 * 1. The recorded ORDER is task-conditioned — a read task ranks the read tool
 *    first, and connective-only matches no longer win.
 * 2. ADMISSION IS UNCHANGED. The weighting applies to the ranking only. Which
 *    tools are offered is a product decision, and a connective-only match
 *    dropping a tool from the surface would be a much larger change than the
 *    finding describes. `rawOverlapAdmission` below re-implements the old
 *    admission rule and the tests assert the two agree exactly.
 */
import { describe, it, expect } from 'vitest';
import { scopeToolsByTask, CORE_TOOL_NAMES, SCOPING_REASONS } from '../../src/operations/config/tool-scoping.js';
import { BASE_TOOLS } from '../../src/execution/run/helpers.js';
import type { ToolDef } from '../../src/models/providers/types.js';

const TASKS: Array<[string, string]> = [
  ['Read the config file and summarize what it does.', 'research'],
  ['Create a file named report.md with the summary', 'docs'],
  ['search the repo for the symbol', 'research'],
  ['run the tests and verify the fix', 'bugfix'],
  ['coordinate two workers to write docs', 'feature'],
  ['delete the temporary scratch file', 'docs'],
  ['what is the current status of the runs', 'research'],
];

/** The pre-fix admission rule, verbatim: raw overlap > 0. */
function rawOverlapAdmission(tools: ToolDef[], task: string): Set<string> {
  const tokenize = (text: string): string[] =>
    text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const taskTokens = tokenize(task);
  const admitted = new Set<string>();
  for (const tool of tools) {
    if (CORE_TOOL_NAMES.has(tool.name)) { admitted.add(tool.name); continue; }
    const signals = new Set(tokenize(`${tool.description} ${tool.name}`));
    if (taskTokens.some((token) => signals.has(token))) admitted.add(tool.name);
  }
  return admitted;
}

function offered(result: { core: ToolDef[]; extended: ToolDef[] }): string[] {
  return [...result.core, ...result.extended].map(tool => tool.name).sort();
}

function rank(result: ReturnType<typeof scopeToolsByTask>, tool: string): number {
  return result.provenance.ranking.findIndex(entry => entry.tool === tool) + 1;
}

describe('scoper ranking is task-conditioned', () => {
  it('ranks the read tool first for a read-and-summarize task', () => {
    const result = scopeToolsByTask(BASE_TOOLS, [], TASKS[0][0], TASKS[0][1]);
    // Was 5th behind grep_search, create_hook, and two coordination readers.
    expect(rank(result, 'alix_file_read')).toBe(1);
  });

  it('no longer lets a connective-only match outrank real content matches', () => {
    const result = scopeToolsByTask(BASE_TOOLS, [], TASKS[0][0], TASKS[0][1]);
    // grep_search matched four pure function words and used to rank FIRST.
    const grepScore = result.provenance.ranking.find(e => e.tool === 'alix_grep_search')?.score ?? 0;
    const readScore = result.provenance.ranking.find(e => e.tool === 'alix_file_read')?.score ?? 0;
    expect(readScore).toBeGreaterThan(grepScore);
  });

  it('ranks the search tool first for a search task', () => {
    const result = scopeToolsByTask(BASE_TOOLS, [], TASKS[2][0], TASKS[2][1]);
    expect(rank(result, 'alix_grep_search')).toBe(1);
  });

  it('ranks the verification tool first for a verify task', () => {
    const result = scopeToolsByTask(BASE_TOOLS, [], TASKS[3][0], TASKS[3][1]);
    expect(rank(result, 'alix_verify_claim')).toBe(1);
  });

  it('ranks coordination tools first for a coordination task', () => {
    const result = scopeToolsByTask(BASE_TOOLS, [], TASKS[4][0], TASKS[4][1]);
    expect(rank(result, 'alix_coordination_run')).toBeLessThanOrEqual(3);
  });

  it('gives a connective-only match no score at all', () => {
    // A tool admitted purely on function words now scores 0 rather than
    // out-ranking tools that matched real content.
    const result = scopeToolsByTask(BASE_TOOLS, [], TASKS[0][0], TASKS[0][1]);
    const zero = result.provenance.ranking.filter(entry => entry.score === 0);
    expect(zero.length).toBeGreaterThan(0);
  });
});

describe('admission is unchanged by the ranking fix', () => {
  it.each(TASKS)('offers exactly the same tools as raw overlap for %j', (task, taskType) => {
    const result = scopeToolsByTask(BASE_TOOLS, [], task, taskType);
    expect(offered(result)).toEqual([...rawOverlapAdmission(BASE_TOOLS, task)].sort());
  });

  it('still admits a tool whose ONLY match is a function word', () => {
    // The safety property in isolation: weighting must never remove a tool the
    // old rule kept. If this ever fails, the fix has changed the surface.
    const task = 'the and it does';
    const result = scopeToolsByTask(BASE_TOOLS, [], task, 'research');
    const raw = rawOverlapAdmission(BASE_TOOLS, task);
    for (const name of raw) {
      expect(offered(result)).toContain(name);
    }
  });

  it('keeps the admission reasons intact', () => {
    const result = scopeToolsByTask(BASE_TOOLS, [], TASKS[0][0], TASKS[0][1]);
    for (const entry of result.provenance.admitted) {
      expect([
        SCOPING_REASONS.CORE,
        SCOPING_REASONS.RELEVANCE_MATCH,
        SCOPING_REASONS.FALLBACK_FULL,
      ]).toContain(entry.reasons[0]);
    }
  });
});
