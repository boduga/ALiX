import { describe, it, expect } from 'vitest';
import { buildAgentInspectorModel } from '../../../src/tui/workbench/model/agent-inspector.js';
import { buildAgentInspectorSections, paintAgentInspector } from '../../../src/tui/workbench/views/agent-inspector.js';
import { createWorkbenchRenderHarness } from '../../fixtures/tui/workbench-render-harness.js';
import type { AgentSummary } from '../../../src/tui/workbench/model/agent-roster.js';
import { TerminalCanvas } from '../../../src/tui/canvas.js';
import { stripAnsi } from '../../../src/tui/box.js';
import { getWorkbenchPreviewTheme } from '../../../src/tui/workbench/model/preview-theme.js';
const agent = (id: string, overrides: Partial<AgentSummary> = {}): AgentSummary => ({ agentId: id, role: 'frontend-agent', state: 'tool_running', coordinationRunId: 'run1', currentTaskId: 'task1', startedAt: 1000, lastProgressAt: 1000, ownedPaths: [], usage: {}, activeTool: { toolCallId: 'call1', toolName: 'alix_patch_apply', startedAt: 1000, elapsedMs: 0, lastProgressAt: 1000 }, ...overrides });
function snapshot(agents = [agent('a')]) {
  const base = createWorkbenchRenderHarness().state.lastSnapshot!;
  return { ...base, generatedAt: 19000, approvals: { pending: [], recentlyResolved: [], totalPending: 0, totalResolved: 0 }, runtime: { ...base.runtime!, agents: { agents, active: 1, totals: { agents: agents.length, running: 1, waitingApproval: 0, stalled: 0, tokenCoverage: 0, costCoverage: 0 } }, tasks: { tasks: [{ taskId: 'task1', agentId: 'a', coordinationRunId: 'run1', title: 'implement responsive sidebar', state: 'running' as const, ownedPaths: [], createdAt: 1000, updatedAt: 1000 }], queued: 0, running: 1, blocked: 0 }, artifacts: { items: [{ id: 'artifact1', kind: 'artifact' as const, status: 'available' as const, title: 'right-sidebar.ts', agentId: 'a', coordinationRunId: 'run1', createdAt: 1000, sourceSequence: 1 }, { id: 'wrong', kind: 'artifact' as const, status: 'available' as const, title: 'foreign.ts', agentId: 'b', coordinationRunId: 'run1', createdAt: 1000, sourceSequence: 2 }], artifacts: 2, results: 0, failed: 0 } } };
}
describe('selected-agent inspector snapshot joins', () => {
  it('joins exact identity and run, derives elapsed from clock, and retains exact tool name', () => {
    const snap = snapshot([agent('a'), agent('b')]);
    const model = buildAgentInspectorModel(snap, { selectedAgentId: 'a', selectedRunId: 'run1' });
    expect(model.task?.title).toBe('implement responsive sidebar');
    expect(model.artifacts?.map((entry) => entry.id)).toEqual(['artifact1']);
    expect(model.activity?.elapsedMs).toBe(18000);
    expect(model.activity?.toolName).toBe('alix_patch_apply');
    expect(buildAgentInspectorModel(snap, { selectedAgentId: 'a' }, 20000).activity?.elapsedMs).toBe(19000);
    expect(snap.runtime.agents.agents[0]?.activeTool?.elapsedMs).toBe(0);
  });
  it('rejects wrong-run and ambiguous task joins', () => {
    const snap = snapshot();
    expect(buildAgentInspectorModel(snap, { selectedAgentId: 'a', selectedRunId: 'wrong' }).selection).toBe('missing');
    expect(buildAgentInspectorModel({ ...snap, runtime: { ...snap.runtime, tasks: { ...snap.runtime.tasks, tasks: [...snap.runtime.tasks.tasks, ...snap.runtime.tasks.tasks] } } }, { selectedAgentId: 'a' }).task).toBeUndefined();
  });
  it('does not show terminal or correlated closed tool as active', () => {
    expect(buildAgentInspectorModel(snapshot([agent('a', { state: 'completed' })]), { selectedAgentId: 'a' }).activity).toBeUndefined();
    const snap = snapshot();
    const closed = { id: 'trace1', kind: 'tool' as const, status: 'cancelled' as const, title: 'alix_patch_apply', agentId: 'a', toolMetadata: { toolCallId: 'call1' }, startedAt: 1000, sourceEvents: { firstSequence: 1 } };
    expect(buildAgentInspectorModel({ ...snap, runtime: { ...snap.runtime, trace: [closed] } }, { selectedAgentId: 'a' }).activity).toBeUndefined();
    expect(buildAgentInspectorModel({ ...snap, runtime: { ...snap.runtime, trace: [{ ...closed, agentId: 'b' }] } }, { selectedAgentId: 'a' }).activity).toBeDefined();
    expect(buildAgentInspectorModel({ ...snap, runtime: { ...snap.runtime, trace: [{ ...closed, toolMetadata: { toolCallId: 'other' } }] } }, { selectedAgentId: 'a' }).activity).toBeDefined();
  });
  it('distinguishes unavailable approvals from authoritative empty and scopes known/uncorrelated approvals', () => {
    const snap = snapshot();
    expect(buildAgentInspectorModel({ ...snap, approvals: null }, { selectedAgentId: 'a' }).approvals).toBeNull();
    expect(buildAgentInspectorModel(snap, { selectedAgentId: 'a' }).approvals).toEqual([]);
    const approval = { id: 'p', toolName: 'alix_shell_run', target: 'test', args: {}, requestedAt: 1, requestedBy: 'user' };
    const model = buildAgentInspectorModel({ ...snap, approvals: { ...snap.approvals, pending: [{ ...approval, id: 'a', agentId: 'a' }, { ...approval, id: 'b', agentId: 'b' }, approval] } }, { selectedAgentId: 'a' });
    expect(model.approvals?.map((entry) => entry.id)).toEqual(['a', 'p']);
    expect(buildAgentInspectorSections(model)[2]?.rows[1]?.value).toContain('Global:');
  });
  it('keeps explicit zero, missing usage, partial aggregate and context capacity separate', () => {
    const snap = snapshot([agent('a', { usage: { totalTokens: 0, costUsd: 0, contextWindowTokens: 200000 } }), agent('b')]);
    const selected = buildAgentInspectorModel(snap, { selectedAgentId: 'a' });
    expect(selected.tokens).toBe(0); expect(selected.costUsd).toBe(0); expect(selected.tokensPartial).toBe(false);
    const aggregate = buildAgentInspectorModel(snap); expect(aggregate.tokens).toBe(0); expect(aggregate.tokensPartial).toBe(true); expect(aggregate.costPartial).toBe(true);
    const sections = buildAgentInspectorSections(selected);
    expect(sections[4]?.rows.find((entry) => entry.label === 'Context')?.value).toBe('unavailable');
    expect(buildAgentInspectorModel(snap, { selectedAgentId: 'b' }).tokens).toBeUndefined();
  });
  it('handles explicit task mismatches, duplicate roles, token fallback and overflow', () => {
    const snap = snapshot([agent('a', { taskLabel: 'old task', usage: { inputTokens: 2, outputTokens: 3 } }), agent('b')]);
    const selected = buildAgentInspectorModel(snap, { selectedAgentId: 'a', selectedTaskId: 'missing' });
    expect(selected.agent?.agentId).toBe('a'); expect(selected.task).toBeUndefined(); expect(selected.tokens).toBe(5);
    expect(buildAgentInspectorSections(selected)[0]?.rows.find((entry) => entry.label === 'Task')?.value).toBe('unavailable');
    expect(buildAgentInspectorModel(snap, { selectedAgentId: 'a' }, 0).activity?.elapsedMs).toBe(0);
    const overflowing = buildAgentInspectorModel(snapshot([agent('a', { usage: { totalTokens: Number.MAX_VALUE, costUsd: Number.MAX_VALUE } }), agent('b', { usage: { totalTokens: Number.MAX_VALUE, costUsd: Number.MAX_VALUE } })]));
    expect(overflowing.tokens).toBeUndefined(); expect(overflowing.costUsd).toBeUndefined();
  });
  it('distinguishes aggregate, missing selection and unavailable roster', () => {
    const snap = snapshot(); expect(buildAgentInspectorModel(snap).selection).toBe('aggregate');
    expect(buildAgentInspectorModel(snap, { selectedAgentId: 'gone' }).selection).toBe('missing');
    expect(buildAgentInspectorModel({ ...snap, runtime: null }).selection).toBe('unavailable');
  });
});
describe('bounded inspector rendering', () => {
  it('renders reference sections, values, separators and clock in order', () => {
    const model = buildAgentInspectorModel(snapshot([agent('a', { model: 'coding model', usage: { totalTokens: 7352 }, currentOperation: 'writing file...' })]), { selectedAgentId: 'a' });
    const canvas = new TerminalCanvas(50, 40); paintAgentInspector(canvas, { x: 2, y: 2, width: 40, height: 36 }, model);
    const text = stripAnsi(canvas.renderFrame());
    const titles = ['AGENT DETAILS', 'LIVE ACTIVITY', 'APPROVALS', 'ARTIFACTS', 'USAGE'];
    expect(titles.map((title) => text.indexOf(title))).toEqual([...titles.map((title) => text.indexOf(title))].sort((a,b) => a-b));
    expect(text.split('\n').some((row) => row.includes('│            ar'))).toBe(true);
    expect(text).toContain('executing');
    for (const value of ['frontend-agent', 'coding model', 'implement responsive', 'ar', '00:18', 'No pending approvals', 'right-sidebar.ts', '7,352', 'unavailable']) expect(text).toContain(value);
  });
  it.each([[1,1],[2,3],[4,3],[12,9],[24,12],[40,20],[40,36]])('clips %ix%i without writing surrounding cells', (width,height) => {
    const canvas = new TerminalCanvas(width+4,height+4); canvas.write(0,0,'sentinel');
    const model = buildAgentInspectorModel(snapshot([agent('a', { role: '\x1b]52;c;bad\x07\x1b[2J'+'界'.repeat(3000) })]), { selectedAgentId: 'a' });
    paintAgentInspector(canvas, { x: 2,y: 2,width,height }, model, getWorkbenchPreviewTheme('monochrome','ascii'));
    const rows = stripAnsi(canvas.renderFrame()).split('\n');
    expect(rows[0]).toContain('sentinel'.slice(0,width+4));
    expect(rows[1]?.trim()).toBe('');
    for (let i=2;i<height+2;i++) { expect(rows[i]?.slice(0,2)).toBe('  '); expect(rows[i]?.slice(-2)).toBe('  '); }
    expect(rows[height+2]?.trim()).toBe('');
  });
  it('collapses short sections while retaining all five headings and summaries', () => {
    const canvas = new TerminalCanvas(40,12); paintAgentInspector(canvas,{x:0,y:0,width:40,height:12},buildAgentInspectorModel(snapshot()));
    const text = stripAnsi(canvas.renderFrame()); for(const title of ['AGENT DETAILS','LIVE ACTIVITY','APPROVALS','ARTIFACTS','USAGE']) expect(text).toContain(title);
  });
});
