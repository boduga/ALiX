import { describe, it, expect, vi } from 'vitest';
import { renderLegacyView } from '../../src/tui/legacy/legacy-view-bridge.js';
import { CanvasSurface } from '../../src/tui/renderers/canvas-surface.js';
import type { DashboardSnapshot } from '../../src/tui/snapshot.js';
import type { PerTabState, TabId } from '../../src/tui/state.js';
import type { TuiView } from '../../src/tui/views/types.js';

describe('LegacyViewBridge', () => {
  it('returns null for unknown tab', () => {
    const result = renderLegacyView({
      snap: {} as DashboardSnapshot,
      perTab: {} as PerTabState,
      views: {} as Record<TabId, TuiView>,
      activeTab: 'nonexistent' as TabId,
      surfaceWidth: 80,
      surfaceHeight: 24,
    });
    expect(result).toBeNull();
  });

  it('returns a RenderSurface for valid view', () => {
    const mockView: TuiView = {
      id: 'chat' as TabId,
      render: vi.fn(),
    };
    const result = renderLegacyView({
      snap: { generatedAt: 1, session: null, daemon: null, approvals: null, runtime: null, sops: null, policy: null },
      perTab: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0, pinnedBottom: true, inputBuffer: '', submittedPrompts: [], agentResponses: [], pendingApprovals: [], resolvedApprovals: [], panelScrollOffsets: { approvals: 0, sops: 0 }, panelFocus: null },
      views: { chat: mockView } as Record<TabId, TuiView>,
      activeTab: 'chat' as TabId,
      surfaceWidth: 80,
      surfaceHeight: 24,
    });
    expect(result).not.toBeNull();
    expect(result!.width).toBe(80);
    expect(mockView.render).toHaveBeenCalled();
  });
});
