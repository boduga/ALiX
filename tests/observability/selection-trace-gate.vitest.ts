/**
 * Tool-selection tracing is OFF by default. The event exists to answer an
 * experiment question T3 already answered negatively, and nothing reads it at
 * runtime — the only consumer is the offline corpus sampler, over sessions
 * recorded while a cohort is being collected.
 *
 * These tests pin both halves of that decision: the default is quiet, and an
 * explicit opt-in restores the full corpus signal. The opt-in half matters as
 * much as the default — a gate that cannot be opened is a deletion.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventLog } from '../../src/runtime-state/events/event-log.js';
import {
  buildSelectionObservation,
  emitSelectionNotApplicable,
  emitSelectionObservation,
} from '../../src/operations/observability/tool-selection-observation.js';
import { TOOL_EVENT_TYPES } from '../../src/runtime-state/events/types.js';
import { builtinCandidateId, freezeToolCandidates } from '../../src/planning/decision/tool-selection-candidates.js';

const frozen = freezeToolCandidates({
  builtin: [
    { name: 'alix_file_read', description: 'Read a file' },
    { name: 'alix_grep_search', description: 'Search file contents' },
  ],
});

/**
 * Flat input, matching `buildSelectionObservation` directly. The task-loop
 * wrapper (`emitSelectionObservation` in `task-loop/main.ts`) is a different
 * shape and is exercised by the task-loop suite.
 */
function observationInput() {
  return {
    scopeId: 'scope_1',
    iteration: 1,
    candidates: frozen.candidates,
    candidateBindings: frozen.bindings,
    chosen: 'alix_file_read',
    chosenCandidateId: builtinCandidateId('alix_file_read'),
    executor: 'file.read',
    argsSignature: 'file.read:{"path":"a.ts"}',
    seenSignatures: new Map<string, number>(),
    executorSuccess: true,
    hasContent: true,
  };
}

describe('tool-selection trace gate', () => {
  let dir: string;
  let log: EventLog;
  const original = process.env.ALIX_TOOL_SELECTION_TRACE;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'selection-trace-'));
    log = new EventLog(dir);
    await log.init();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (original === undefined) delete process.env.ALIX_TOOL_SELECTION_TRACE;
    else process.env.ALIX_TOOL_SELECTION_TRACE = original;
  });

  async function types(): Promise<string[]> {
    return (await log.readAll()).map(e => e.type);
  }

  it('appends nothing by default', async () => {
    delete process.env.ALIX_TOOL_SELECTION_TRACE;
    await emitSelectionObservation(log, { sessionId: 's1', actor: 'system' }, observationInput());
    expect(await types()).not.toContain(TOOL_EVENT_TYPES.SELECTION_OBSERVED);
  });

  it('still RETURNS the built observation when tracing is off', async () => {
    // The task loop derives completion signals from this return value. Gating
    // the append must not change what callers receive — only what is persisted.
    delete process.env.ALIX_TOOL_SELECTION_TRACE;
    const result = await emitSelectionObservation(log, { sessionId: 's1', actor: 'system' }, observationInput());
    expect(result.scopeId).toBe('scope_1');
    expect(result.chosenCandidateId).toBe(builtinCandidateId('alix_file_read'));
    // Byte-identical to the pure builder: the gate cannot alter the payload.
    expect(result).toEqual(buildSelectionObservation(observationInput()));
  });

  it('appends when explicitly enabled', async () => {
    process.env.ALIX_TOOL_SELECTION_TRACE = '1';
    await emitSelectionObservation(log, { sessionId: 's1', actor: 'system' }, observationInput());
    const events = await log.readAll();
    expect(events.filter(e => e.type === TOOL_EVENT_TYPES.SELECTION_OBSERVED)).toHaveLength(1);
  });

  it('appends an identical payload on both sides of the gate', async () => {
    // The gate must gate the append, not the content. A collection run that
    // compared a gated-off baseline against a gated-on cohort would otherwise
    // be comparing two different payload shapes.
    delete process.env.ALIX_TOOL_SELECTION_TRACE;
    const off = await emitSelectionObservation(log, { sessionId: 's1', actor: 'system' }, observationInput());
    rmSync(dir, { recursive: true, force: true });
    log = new EventLog(dir);
    await log.init();
    process.env.ALIX_TOOL_SELECTION_TRACE = '1';
    await emitSelectionObservation(log, { sessionId: 's1', actor: 'system' }, observationInput());
    const persisted = (await log.readAll()).find(e => e.type === TOOL_EVENT_TYPES.SELECTION_OBSERVED);
    expect(persisted?.payload).toEqual(off);
  });

  it('gates not_applicable on the same switch — it is corpus vocabulary', async () => {
    // A `not_applicable` record without its `observed` scopes is unusable: the
    // sampler needs both to compute selector coverage.
    delete process.env.ALIX_TOOL_SELECTION_TRACE;
    await emitSelectionNotApplicable(log, { sessionId: 's1', actor: 'system' }, {
      scopeId: 'scope_2',
      iteration: 1,
      reason: 'no_tool_call',
    } as any);
    expect(await types()).not.toContain(TOOL_EVENT_TYPES.SELECTION_NOT_APPLICABLE);

    process.env.ALIX_TOOL_SELECTION_TRACE = '1';
    await emitSelectionNotApplicable(log, { sessionId: 's1', actor: 'system' }, {
      scopeId: 'scope_3',
      iteration: 1,
      reason: 'no_tool_call',
    } as any);
    expect(await types()).toContain(TOOL_EVENT_TYPES.SELECTION_NOT_APPLICABLE);
  });

  it('treats any value other than "1" as off', async () => {
    for (const value of ['0', 'true', 'yes', '']) {
      rmSync(dir, { recursive: true, force: true });
      log = new EventLog(dir);
      await log.init();
      process.env.ALIX_TOOL_SELECTION_TRACE = value;
      await emitSelectionObservation(log, { sessionId: 's1', actor: 'system' }, observationInput());
      expect(await types(), `"${value}" must not enable tracing`).not.toContain(TOOL_EVENT_TYPES.SELECTION_OBSERVED);
    }
  });
});
