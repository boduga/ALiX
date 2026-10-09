import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SessionPhase, type PerTabState } from '../../../src/interfaces/tui/state.js';
import type { DashboardSnapshot, RuntimeSnapshot } from '../../../src/interfaces/tui/snapshot.js';
import type { TimelineEntry } from '../../../src/interfaces/tui/runtime/timeline-builder.js';
import type { ExecutionTraceEntry } from '../../../src/interfaces/tui/runtime/execution-trace.js';
import type { ViewInputContext, ViewRenderContext } from '../../../src/interfaces/tui/views/types.js';
import { AgentView } from '../../../src/interfaces/tui/views/agent-view.js';
import { buildWorkbenchScrollbackLines } from '../../../src/interfaces/tui/workbench/views/workbench-scrollback.js';
import { getWorkbenchPreviewTheme } from '../../../src/interfaces/tui/workbench/model/preview-theme.js';
import { stripAnsi } from '../../../src/interfaces/tui/box.js';
import { createInitialWorkbenchUiState } from '../../../src/interfaces/tui/workbench/model/ui-state.js';

const fixturePath = fileURLToPath(new URL('../../fixtures/tui/workbench-third-trace.json', import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  timeline: TimelineEntry[];
  trace: ExecutionTraceEntry[];
};

function perTab(mode: 'compact' | 'detailed'): PerTabState {
  return {
    cursor: 0,
    scrollOffset: 0,
    searchQuery: '',
    expandedSections: [],
    lastEventArrivedAt: 0,
    pinnedBottom: true,
    inputBuffer: '',
    pendingApprovals: [],
    resolvedApprovals: [],
    panelScrollOffsets: { approvals: 0, sops: 0 },
    panelFocus: null,
    runtimeTraceFilter: 'all',
    transcriptMode: mode,
    streamingActive: false,
  };
}

function runtime(trace: readonly ExecutionTraceEntry[]): RuntimeSnapshot {
  return {
    trace,
    timeline: [],
    workflow: null,
    totalEventCount: trace.length,
    lastEventAt: null,
    sessionId: 'trace',
    capabilities: null,
    metrics: null,
    context: null,
  };
}

function context(
  mode: 'compact' | 'detailed',
  timeline: readonly TimelineEntry[] = fixture.timeline,
  trace: readonly ExecutionTraceEntry[] = fixture.trace,
): ViewRenderContext {
  const snap: DashboardSnapshot = {
    generatedAt: 1,
    session: { mode: 'ask', phase: SessionPhase.Idle, version: 'test', startedAt: 1, turns: 2 },
    daemon: null,
    approvals: null,
    runtime: runtime(trace),
    sops: null,
    policy: null,
    cwd: '/workspace/test',
  };
  return {
    snap,
    dimensions: { columns: 120, rows: 36 },
    perTab: perTab(mode),
    workbenchEnabled: true,
    runtime: {
      chat: null,
      agent: { ...runtime([]), sessionId: 'trace-agent', timeline },
    },
  };
}

describe('Workbench scrollback', () => {
  it('tags semantic rows with stable identities and wrap offsets across widths', () => {
    const narrow = buildWorkbenchScrollbackLines(context('detailed'), 24);
    const wide = buildWorkbenchScrollbackLines(context('detailed'), 90);
    expect(narrow.every((line) => typeof line.itemId === 'string' && Number.isInteger(line.wrappedOffset))).toBe(true);
    expect(new Set(narrow.map((line) => line.itemId))).toEqual(new Set(wide.map((line) => line.itemId)));
    for (const itemId of new Set(narrow.map((line) => line.itemId))) {
      const offsets = narrow.filter((line) => line.itemId === itemId).map((line) => line.wrappedOffset);
      expect(offsets).toEqual(offsets.map((_, index) => index));
    }
  });

  it('keeps the compact transcript focused on work and outcomes', () => {
    const lines = buildWorkbenchScrollbackLines(context('compact'), 90);
    const text = lines.map((line) => line.text).join('\n');

    expect(text).toContain('Read README.md');
    expect(lines.filter((line) => line.kind === 'agent' && line.isFirst)).toHaveLength(2);
    expect(text).toContain('file.read');
    expect(text).toContain('✓ success');
    expect(text).toContain('✗ failed');
    expect(text).toContain('Access denied: path is outside workspace');
    expect(text).not.toContain('context assembled');
    expect(text).not.toContain('context snapshot created');
    expect(text).not.toContain('done');
    expect(lines.some((line) => line.kind === 'user' && line.gutter === 'YOU')).toBe(true);
    expect(lines.some((line) => line.kind === 'agent' && line.gutter === 'ALiX')).toBe(true);
  });

  it('reveals diagnostic plumbing in detailed mode', () => {
    const lines = buildWorkbenchScrollbackLines(context('detailed'), 90);
    const text = lines.map((line) => line.text).join('\n');

    expect(text).toContain('context assembled');
    expect(text).toContain('context snapshot created');
  });

  it('keeps live streaming and scope identities stable across reflow', () => {
    const renderContext = context('compact', [], []);
    (renderContext.perTab as PerTabState).streamingText = 'A streaming response that wraps onto multiple narrow rows.';
    (renderContext as { workbenchUiState?: ReturnType<typeof createInitialWorkbenchUiState> }).workbenchUiState = {
      ...createInitialWorkbenchUiState(), selectedAgentId: 'worker-1',
    };
    const narrow = buildWorkbenchScrollbackLines(renderContext, 20);
    const wide = buildWorkbenchScrollbackLines(renderContext, 90);
    const streamRows = narrow.filter((line) => line.kind === 'streaming');
    expect(streamRows.map((line) => line.wrappedOffset)).toEqual(streamRows.map((_, index) => index));
    expect(streamRows[0]?.text).toContain('??:??:??');
    expect(streamRows.at(-1)?.isLast).toBe(true);
    expect(narrow.filter((line) => line.kind === 'streaming').every((line) => line.itemId === 'streaming:all')).toBe(true);
    expect(wide.find((line) => line.kind === 'streaming')?.itemId).toBe('streaming:all');
    expect(narrow[0]?.itemId).toBe('scope:all');
  });

  it('preserves selected-agent focus after the drawer closes and supports aggregate view', () => {
    const trace: ExecutionTraceEntry[] = [
      { id: 'tool-a', kind: 'tool', status: 'completed', title: 'tool.file.read', agentId: 'agent-1', startedAt: 1, sourceEvents: { firstSequence: 1 } },
      { id: 'tool-b', kind: 'tool', status: 'completed', title: 'tool.shell.run', agentId: 'agent-2', startedAt: 2, sourceEvents: { firstSequence: 2 } },
    ];
    const renderContext = context('compact', [], trace);
    (renderContext as { workbenchUiState?: ReturnType<typeof createInitialWorkbenchUiState> }).workbenchUiState = {
      ...createInitialWorkbenchUiState(), drawer: 'agents', focus: 'drawer', selectedAgentId: 'agent-1', transcriptScope: 'selected',
    };
    const focused = buildWorkbenchScrollbackLines(renderContext, 90).map((line) => line.text).join('\n');
    expect(focused).toContain('focused agent: agent-1');
    expect(focused).toContain('file.read');
    expect(focused).not.toContain('shell.run');

    (renderContext as { workbenchUiState?: ReturnType<typeof createInitialWorkbenchUiState> }).workbenchUiState = {
      ...createInitialWorkbenchUiState(), selectedAgentId: 'agent-1', transcriptScope: 'selected',
    };
    const stillFocused = buildWorkbenchScrollbackLines(renderContext, 90).map((line) => line.text).join('\n');
    expect(stillFocused).not.toContain('shell.run');

    (renderContext as { workbenchUiState?: ReturnType<typeof createInitialWorkbenchUiState> }).workbenchUiState = createInitialWorkbenchUiState();
    const aggregate = buildWorkbenchScrollbackLines(renderContext, 90).map((line) => line.text).join('\n');
    expect(aggregate).toContain('all agents');
    expect(aggregate).toContain('shell.run');
  });

  it('maps Ctrl+O to the transcript density transition', () => {
    const renderContext = context('compact');
    const inputContext: ViewInputContext = {
      snap: renderContext.snap,
      dimensions: renderContext.dimensions,
      perTab: renderContext.perTab as PerTabState,
    };

    expect(new AgentView().handleKey('Ctrl+o', inputContext)).toEqual({ type: 'toggleTranscriptMode' });
  });

  it('renders semantic plan tasks before the final response', () => {
    const timeline: TimelineEntry[] = [
      { id: 'tl-1', kind: 'agent.message', actor: 'user', sessionId: 's', startedAt: 1, text: 'Do it', sourceEvents: { firstSequence: 1 } },
      {
        id: 'tl-2', kind: 'agent.plan', actor: 'agent', sessionId: 's', startedAt: 2,
        text: 'Plan accepted.',
        planTasks: [
          { id: 's:task:1', index: 1, title: 'Inspect', status: 'completed' },
          { id: 's:task:2', index: 2, title: 'Edit', status: 'pending' },
        ],
        sourceEvents: { firstSequence: 2 },
      },
      { id: 'tl-3', kind: 'agent.response', actor: 'agent', sessionId: 's', startedAt: 3, text: 'Finished.', sourceEvents: { firstSequence: 3 } },
    ];

    const text = buildWorkbenchScrollbackLines(context('compact', timeline), 90)
      .map((line) => line.text)
      .join('\n');

    expect(text).toContain('[x] 1. Inspect');
    expect(text).toContain('[ ] 2. Edit');
    expect(text.indexOf('Plan accepted.')).toBeLessThan(text.indexOf('Finished.'));
  });

  it('lets the authoritative approval card own compact pending state', () => {
    const timeline: TimelineEntry[] = [{
      id: 'approval-event', kind: 'approval.requested', actor: 'system', sessionId: 's',
      startedAt: 2, text: 'Approval required: run the full raw shell command',
      sourceEvents: { firstSequence: 2 },
    }];
    const trace: ExecutionTraceEntry[] = [{
      id: 'tool-1', kind: 'tool', status: 'running', title: 'tool.shell.run',
      startedAt: 1,
      sourceEvents: { firstSequence: 1, lastSequence: 1 },
    }];
    const renderContext = context('compact', timeline, trace);
    (renderContext.perTab as PerTabState).pendingApprovals = [{
      id: 'approval-1', toolName: 'shell.run', target: 'for b in llama-cli; do command -v "$b"; done', requestedAt: 2,
    }];

    const text = buildWorkbenchScrollbackLines(renderContext, 90).map((line) => line.text).join('\n');

    expect(text).toContain('shell.run');
    expect(text).toContain('approval required');
    expect(text).toContain('APPROVAL REQUIRED · shell.run');
    expect(text).toContain('for b in llama-cli; do command -v "$b"; done');
    expect(text).toContain('pending');
    expect(text).toContain('id approval-1');
    expect(text).toContain('a approve · d deny');
    expect(text.match(/APPROVAL REQUIRED/gu)).toHaveLength(1);
    expect(text.indexOf('approval required')).toBeLessThan(text.indexOf('APPROVAL REQUIRED · shell.run'));
    expect(text).not.toContain('✓ shell.run');
    expect(text).not.toContain('full raw shell command');
    expect(buildWorkbenchScrollbackLines(renderContext, 90).some((line) => (
      line.kind === 'approvalCard' && line.gutter === 'APPROVAL'
    ))).toBe(true);
  });

  it('does not relabel completed tools when a newer approval uses the same tool name', () => {
    const trace: ExecutionTraceEntry[] = [{
      id: 'tool-old', kind: 'tool', status: 'completed', title: 'tool.shell.run',
      startedAt: 1, completedAt: 2, durationMs: 1,
      sourceEvents: { firstSequence: 1, lastSequence: 2 },
    }];
    const renderContext = context('compact', [], trace);
    (renderContext.perTab as PerTabState).pendingApprovals = [{
      id: 'approval-new', toolName: 'shell.run', target: 'docker info', requestedAt: 3,
    }];

    const text = buildWorkbenchScrollbackLines(renderContext, 90).map((line) => line.text).join('\n');

    expect(text).toContain('✓ success');
    expect(text).toContain('duration: 1ms');
    expect(text.match(/shell\.run · approval required/gu)).toBeNull();
    expect(text).toContain('APPROVAL REQUIRED · shell.run');
  });

  it('falls back to one inline card while the semantic approval event catches up', () => {
    const renderContext = context('compact', [], []);
    (renderContext.perTab as PerTabState).pendingApprovals = [{
      id: 'approval-lag', toolName: 'file.write', target: 'src/interfaces/tui/app.ts', requestedAt: 2,
    }];

    const lines = buildWorkbenchScrollbackLines(renderContext, 64);
    const text = lines.map((line) => line.text).join('\n');

    expect(text.match(/APPROVAL REQUIRED/gu)).toHaveLength(1);
    expect(text).toContain('file.write');
    expect(text).toContain('src/interfaces/tui/app.ts');
    expect(lines.filter((line) => line.kind === 'approvalCard')).toHaveLength(6);
    expect(lines.every((line) => line.itemId === 'pending-approval:approval-lag')).toBe(true);
  });
});

describe('preview transcript columns', () => {
  const timeline: TimelineEntry[] = [{
    id: 'safe-progress', kind: 'agent.progress', actor: 'agent', agentId: 'worker-1', sessionId: 's',
    startedAt: Date.parse('2026-10-03T10:14:25.000Z'), userSafe: true,
    text: 'Reading current sidebar component for context.界界界', sourceEvents: { firstSequence: 3 },
  }];
  it('aligns timestamp/actor/body and wraps continuations under content', () => {
    const lines = buildWorkbenchScrollbackLines(context('compact', timeline, []), 72).filter((line) => line.kind === 'activity');
    expect(stripAnsi(lines[0]!.text)).toMatch(/^\[10:14:25\] worker-1/);
    expect(lines.length).toBeGreaterThan(1);
    const contentOffset = stripAnsi(lines[0]!.text).indexOf('Reading');
    expect(stripAnsi(lines[1]!.text).startsWith(' '.repeat(contentOffset))).toBe(true);
    expect(lines.every((line) => line.previewFormatted && line.itemId === 'conversation-safe-progress')).toBe(true);
  });
  it('stacks metadata above body in narrow transcript', () => {
    const lines = buildWorkbenchScrollbackLines(context('compact', timeline, []), 30).filter((line) => line.kind === 'activity');
    expect(stripAnsi(lines[0]!.text)).toBe('[10:14:25] worker-1');
    expect(stripAnsi(lines[1]!.text)).toMatch(/^  Reading/);
    expect(lines.every((line) => stripAnsi(line.text).length <= 30)).toBe(true);
  });
  it('keeps pending approval visible across unrelated selection and category', () => {
    const ctx = context('compact', [], []);
    (ctx as { workbenchUiState?: ReturnType<typeof createInitialWorkbenchUiState> }).workbenchUiState = {
      ...createInitialWorkbenchUiState(), transcriptScope: 'selected', selectedAgentId: 'worker-1', transcriptFilter: 'response',
    };
    (ctx.perTab as PerTabState).pendingApprovals = [{ id: 'approval', toolName: 'file.write', target: 'src/sidebar.ts', requestedAt: 1, agentId: 'worker-2' }];
    expect(buildWorkbenchScrollbackLines(ctx, 90).some((line) => line.kind === 'approvalCard')).toBe(true);
  });
  it('suppresses landed streaming duplicate and streaming outside response categories', () => {
    const ctx = context('compact', [{ id: 'landed', kind: 'agent.response', sessionId: 's', startedAt: 1, text: 'Finished safely.', sourceEvents: { firstSequence: 1 } }], []);
    (ctx.perTab as PerTabState).streamingText = 'Finished safely.';
    expect(buildWorkbenchScrollbackLines(ctx, 90).some((line) => line.kind === 'streaming')).toBe(false);
    (ctx.perTab as PerTabState).streamingText = 'Next unfinished response';
    (ctx as { workbenchUiState?: ReturnType<typeof createInitialWorkbenchUiState> }).workbenchUiState = { ...createInitialWorkbenchUiState(), transcriptFilter: 'tool' };
    expect(buildWorkbenchScrollbackLines(ctx, 90).some((line) => line.kind === 'streaming')).toBe(false);
  });
});


it.each([
  ['coordinator', 'waiting_dependency', 'purple'],
  ['worker', 'waiting', 'yellow'],
  ['worker', 'waiting_dependency', 'yellow'],
  ['worker', 'waiting_approval', 'yellow'],
  ['worker', 'thinking', 'teal'],
] as const)('colors authoritative %s/%s actor while preserving Markdown emphasis', (role, state, color) => {
  const timeline: TimelineEntry[] = [
    { id: 'state', kind: 'agent.state_changed', agentId: 'worker-1', sessionId: 's', startedAt: 1, activityState: 'waiting_dependency', sourceEvents: { firstSequence: 1 } },
    { id: 'safe', kind: 'agent.progress', agentId: 'worker-1', sessionId: 's', startedAt: 2, userSafe: true, text: '**Safe** activity label', sourceEvents: { firstSequence: 2 } },
  ];
  const ctx = context('compact', timeline, []);
  const coloredContext: ViewRenderContext = { ...ctx, snap: { ...ctx.snap, runtime: {
    ...ctx.snap.runtime!, agents: {
      agents: [{ agentId: 'worker-1', role, state, ownedPaths: [], startedAt: 1, lastProgressAt: 1, usage: {} }],
      active: 1, totals: { agents: 1, running: 0, waitingApproval: 0, stalled: 0, tokenCoverage: 0, costCoverage: 0 },
    },
  } } };
  const line = buildWorkbenchScrollbackLines(coloredContext, 90).find((row) => stripAnsi(row.text).includes('Safe'))!;
  const p = getWorkbenchPreviewTheme().palette;
  expect(line.text).toContain(`${p[color]}worker-1`);
  expect(line.text).toContain(`${p.yellow}WAITING`);
  expect(line.text).toContain('\x1b[1mSafe');
  expect(stripAnsi(line.text)).toContain('Safe activity label');
});

it.each([
  ['success', '✓', 'green'],
  ['failure', '✗', 'red'],
  [undefined, '✓', undefined],
  [undefined, '✗', undefined],
] as const)('colors outcome glyph only from explicit %s evidence', (verifiedOutcome, glyph, color) => {
  const timeline: TimelineEntry[] = [{
    id: 'outcome', kind: 'agent.progress', sessionId: 's', startedAt: 1,
    userSafe: true, text: `${glyph} 4 agents initialized`,
    ...(verifiedOutcome !== undefined ? { verifiedOutcome } : {}),
    sourceEvents: { firstSequence: 1 },
  }];
  const line = buildWorkbenchScrollbackLines(context('compact', timeline, []), 90)[0]!;
  const p = getWorkbenchPreviewTheme().palette;
  expect(stripAnsi(line.text)).toContain(`${glyph} 4 agents initialized`);
  if (color) expect(line.text).toContain(`${p[color]}${glyph}`);
  else {
    expect(line.text).not.toContain(`${p.green}${glyph}`);
    expect(line.text).not.toContain(`${p.red}${glyph}`);
  }
});


it('adds typed outcome badge when prose has none and never duplicates existing glyph', () => {
  for (const text of ['Workers initialized', '✓ Workers initialized']) {
    const timeline: TimelineEntry[] = [{ id: 'outcome', kind: 'agent.progress', sessionId: 's', startedAt: 1,
      userSafe: true, text, verifiedOutcome: 'success', sourceEvents: { firstSequence: 1 } }];
    const line = buildWorkbenchScrollbackLines(context('compact', timeline, []), 90)[0]!;
    expect(stripAnsi(line.text).match(/✓/g)).toHaveLength(1);
    expect(line.text).toContain(`${getWorkbenchPreviewTheme().palette.green}✓`);
  }
});

it('keeps adjacent card anchors keyed to individual calls through detail expansion', () => {
  const trace: ExecutionTraceEntry[] = [
    { id: 'call-a', kind: 'tool', status: 'completed', title: 'tool.file.read', startedAt: 1, detail: 'one result', sourceEvents: { firstSequence: 1, lastSequence: 2 } },
    { id: 'call-b', kind: 'tool', status: 'running', title: 'tool.alix_patch_apply', startedAt: 3, detail: 'two result', sourceEvents: { firstSequence: 3 } },
  ];
  const compact = buildWorkbenchScrollbackLines(context('compact', [], trace), 116);
  const detailed = buildWorkbenchScrollbackLines(context('detailed', [], trace), 116);
  for (const id of ['tool:call-a', 'tool:call-b']) {
    const compactRows = compact.filter((row) => row.itemId === id);
    const detailedRows = detailed.filter((row) => row.itemId === id);
    expect(compactRows.length).toBeGreaterThan(0);
    expect(detailedRows.length).toBeGreaterThan(compactRows.length);
    expect(detailedRows.map((row) => row.wrappedOffset)).toEqual(detailedRows.map((_, index) => index));
    expect(detailedRows.filter((row) => stripAnsi(row.text).includes('TOOL'))).toHaveLength(1);
  }
});
