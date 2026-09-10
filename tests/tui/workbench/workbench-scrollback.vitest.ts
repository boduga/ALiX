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

function context(mode: 'compact' | 'detailed'): ViewRenderContext {
  const snap: DashboardSnapshot = {
    generatedAt: 1,
    session: { mode: 'ask', phase: SessionPhase.Idle, version: 'test', startedAt: 1, turns: 2 },
    daemon: null,
    approvals: null,
    runtime: runtime(fixture.trace),
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
      agent: { ...runtime([]), sessionId: 'trace-agent', timeline: fixture.timeline },
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
});
