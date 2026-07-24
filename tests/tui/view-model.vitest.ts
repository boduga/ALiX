import { describe, it, expect } from 'vitest';
import { ViewModelBuilder } from '../../src/tui/presentation/builder.js';
import type { DashboardSnapshot, DaemonMetricsSnapshot } from '../../src/tui/snapshot.js';
import { SessionPhase, type PerTabState } from '../../src/tui/state.js';

function mockSnap(o: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return { generatedAt: Date.now(), session: { mode: 'auto', phase: SessionPhase.Idle, version: '0.5.0', startedAt: Date.now(), turns: 0 }, daemon: null, approvals: null, runtime: null, sops: null, policy: null, ...o };
}
function mockState(o: Partial<PerTabState> = {}): PerTabState {
  return { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0, pinnedBottom: true, inputBuffer: '', submittedPrompts: [], agentResponses: [], pendingApprovals: [], resolvedApprovals: [], panelScrollOffsets: { approvals: 0, sops: 0 }, panelFocus: null, ...o };
}

describe('ViewModelBuilder', () => {
  const b = new ViewModelBuilder();

  it('7 tabs, first active', () => { const vm = b.build(mockSnap(), mockState(), 'chat'); expect(vm.tabs).toHaveLength(7); expect(vm.tabs[0]!.active).toBe(true); });
  it('4 panels', () => { expect(b.build(mockSnap(), mockState(), 'chat').panels).toHaveLength(4); });
  it('approvals respects scroll/focus', () => {
    const s = mockState({ panelScrollOffsets: { approvals: 2, sops: 0 }, panelFocus: 'approvals' });
    const vm = b.build(mockSnap(), s, 'approvals');
    expect(vm.panels.find((p) => p.id === 'approvals')!.scrollOffset).toBe(2);
    expect(vm.panels.find((p) => p.id === 'approvals')!.focused).toBe(true);
  });
  it('chat input', () => { expect(b.build(mockSnap(), mockState({ inputBuffer: 'hi' }), 'chat').input.buffer).toBe('hi'); });
  it('agent prompt differs', () => { expect(b.build(mockSnap(), mockState(), 'agent').input.prompt).toBe('alix-agent> '); });
  it('daemon stopped state', () => { expect(b.build(mockSnap({ daemon: null }), mockState(), 'chat').panels.find((p) => p.id === 'daemon')!.items[0]!.title).toContain('not running'); });
  it('pendingApprovalHint is null when active tab has no pending approvals', () => {
    const vm = b.build(mockSnap(), mockState({ pendingApprovals: [] }), 'chat');
    expect(vm.viewContent.pendingApprovalHint).toBeNull();
  });
  it('pendingApprovalHint formats count for active tab', () => {
    const approvals = [
      { id: 'a1', toolName: 't', target: 'x', requestedAt: 1 },
      { id: 'a2', toolName: 't', target: 'y', requestedAt: 2 },
    ];
    const vm = b.build(mockSnap(), mockState({ pendingApprovals: approvals }), 'chat');
    expect(vm.viewContent.pendingApprovalHint).toBe("[2 pending approvals — press 'a' to approve, 'd' to deny]");
  });
  it('pendingApprovalHint reflects active tab only', () => {
    const approvals = [
      { id: 'a1', toolName: 't', target: 'x', requestedAt: 1 },
      { id: 'a2', toolName: 't', target: 'y', requestedAt: 2 },
      { id: 'a3', toolName: 't', target: 'z', requestedAt: 3 },
    ];
    const approvalsTabState = mockState({ pendingApprovals: approvals });
    const chatState = mockState({ pendingApprovals: [] });
    const vmApprovals = b.build(mockSnap(), approvalsTabState, 'approvals');
    expect(vmApprovals.viewContent.pendingApprovalHint).toBe("[3 pending approvals — press 'a' to approve, 'd' to deny]");
    const vmChat = b.build(mockSnap(), chatState, 'chat');
    expect(vmChat.viewContent.pendingApprovalHint).toBeNull();
  });
});