import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SessionPhase, type PerTabState } from '../../../src/tui/state.js';
import type { DashboardSnapshot, RuntimeSnapshot } from '../../../src/tui/snapshot.js';
import type { TimelineEntry } from '../../../src/tui/runtime/timeline-builder.js';
import type { ExecutionTraceEntry } from '../../../src/tui/runtime/execution-trace.js';
import type { ViewInputContext, ViewRenderContext } from '../../../src/tui/views/types.js';
import { AgentView } from '../../../src/tui/views/agent-view.js';
import { buildWorkbenchScrollbackLines } from '../../../src/tui/workbench/views/workbench-scrollback.js';

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
  it('keeps the compact transcript focused on work and outcomes', () => {
    const lines = buildWorkbenchScrollbackLines(context('compact'), 90);
    const text = lines.map((line) => line.text).join('\n');

    expect(text).toContain('Read README.md');
    expect(text.match(/ALiX/g)).toHaveLength(1);
    expect(text).toContain('✓ file.read');
    expect(text).toContain('✗ file.read');
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
      id: 'tool-1', kind: 'tool', status: 'completed', title: 'tool.shell.run',
      startedAt: 1, completedAt: 1, durationMs: 0,
      sourceEvents: { firstSequence: 1, lastSequence: 1 },
    }];
    const renderContext = context('compact', timeline, trace);
    (renderContext.perTab as PerTabState).pendingApprovals = [{
      id: 'approval-1', toolName: 'shell.run', target: 'for b in llama-cli; do command -v "$b"; done', requestedAt: 2,
    }];

    const text = buildWorkbenchScrollbackLines(renderContext, 90).map((line) => line.text).join('\n');

    expect(text).toContain('shell.run · approval required');
    expect(text).toContain('APPROVAL REQUIRED · shell.run');
    expect(text).toContain('for b in llama-cli; do command -v "$b"; done');
    expect(text).toContain('pending');
    expect(text).toContain('id approval-1');
    expect(text).toContain('a approve · d deny');
    expect(text.match(/APPROVAL REQUIRED/gu)).toHaveLength(1);
    expect(text.indexOf('shell.run · approval required')).toBeLessThan(text.indexOf('APPROVAL REQUIRED · shell.run'));
    expect(text).not.toContain('shell.run · 0ms');
    expect(text).not.toContain('full raw shell command');
    expect(buildWorkbenchScrollbackLines(renderContext, 90).some((line) => (
      line.kind === 'approvalCard' && line.gutter === 'APPROVAL'
    ))).toBe(true);
  });

  it('falls back to one inline card while the semantic approval event catches up', () => {
    const renderContext = context('compact', [], []);
    (renderContext.perTab as PerTabState).pendingApprovals = [{
      id: 'approval-lag', toolName: 'file.write', target: 'src/tui/app.ts', requestedAt: 2,
    }];

    const lines = buildWorkbenchScrollbackLines(renderContext, 64);
    const text = lines.map((line) => line.text).join('\n');

    expect(text.match(/APPROVAL REQUIRED/gu)).toHaveLength(1);
    expect(text).toContain('file.write');
    expect(text).toContain('src/tui/app.ts');
    expect(lines.filter((line) => line.kind === 'approvalCard')).toHaveLength(6);
  });
});
