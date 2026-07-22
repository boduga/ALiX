import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OperatorViewState } from '../../src/tui/presentation/types.js';
import type { TerminalControl } from '../../src/tui/terminal-control.js';
import type { BlessedRenderer as BlessedRendererType } from '../../src/tui/renderers/blessed-renderer.js';

// Mock blessed for deterministic CI (no TTY required).
// Mock tracks screen event registration so we can verify cleanup.
// vi.hoisted ensures shared state is visible to both the mock factory and test assertions.
const { screenDestroySpy, mkEl } = vi.hoisted(() => {
  const screenDestroySpy = vi.fn();
  const mkEl = () => ({ setContent: vi.fn(), setItems: vi.fn(), setValue: vi.fn(), detach: vi.fn() });
  return { screenDestroySpy, mkEl };
});

vi.mock('neo-blessed', () => {
  function createMockScreen() {
    return {
      append: vi.fn(),
      render: vi.fn(),
      destroy: screenDestroySpy,
      unkey: vi.fn(),
      key: vi.fn(),
      children: [],
    };
  }

  return {
    screen: createMockScreen,
    box: mkEl,
    list: () => ({ ...mkEl(), setItems: vi.fn(), items: [], select: vi.fn() }),
    textarea: () => ({ ...mkEl(), setValue: vi.fn(), value: '' }),
    default: { screen: createMockScreen, box: mkEl, list: mkEl, textarea: mkEl },
  };
});

const { BlessedRenderer } = await import('../../src/tui/renderers/blessed-renderer.js');

function mockTC(): TerminalControl {
  return {
    input: process.stdin, output: process.stdout,
    enterAltBuffer: vi.fn(), exitAltBuffer: vi.fn(),
    enterRawMode: vi.fn(), exitRawMode: vi.fn(),
    showCursor: vi.fn(), onResize: vi.fn(),
    installEmergencyCleanup: vi.fn(),
    write: vi.fn(), setCursor: vi.fn(),
  } as unknown as TerminalControl;
}

function mockVS(): OperatorViewState {
  return {
    tabs: ['chat','agent','approvals','daemon','runtime','sops','policy'].map((id) => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1), active: id === 'chat' })),
    activeTab: 'chat',
    panels: ['daemon','approvals','runtime','sops_policy'].map((id) => ({ id, title: id.toUpperCase(), items: [], scrollOffset: 0, focused: false, totalItems: 0, visible: true, kind: id as any })),
    input: { buffer: '', prompt: 'alix> ', cursorPos: 0, activeTab: 'chat', mode: 'chat' },
    statusBar: { phaseRadios: [{ phase: 'Idle', active: false, label: 'IDLE' }], fields: [{ label: 'DAEMON', value: '○ stopped' }], activeTab: 'chat' },
    sessionMetadata: null, daemonStatus: null,
    viewContent: {
      mainLines: [],
      scrollPercent: 100,
      sidebarPanels: {
        daemon: { kind: 'daemon', title: 'DAEMON', visible: true, loading: false, items: [], scrollOffset: 0, focused: false, totalItems: 0 },
        approvals: { kind: 'approvals', title: 'APPROVALS', visible: true, loading: false, items: [], scrollOffset: 0, focused: false, totalItems: 0 },
        runtime: { kind: 'runtime', title: 'RUNTIME', visible: true, loading: false, items: [], scrollOffset: 0, focused: false, totalItems: 0 },
        sops_policy: { kind: 'sops_policy', title: 'SOPS & POLICY', visible: true, loading: false, items: [], scrollOffset: 0, focused: false, totalItems: 0 },
      },
      showInput: true,
    },
  };
}

describe('BlessedRenderer', () => {
  let r: BlessedRendererType;
  let tc: TerminalControl;

  beforeEach(() => { r = new BlessedRenderer(); tc = mockTC(); vi.clearAllMocks(); });

  it('capabilities: handlesInput=true', () => {
    expect(r.capabilities().handlesInput).toBe(true);
  });

  it('initialize creates screen', async () => {
    await r.initialize(tc);
    expect(r).toBeDefined();
  });

  it('render updates widgets', async () => {
    await r.initialize(tc);
    expect(() => r.render(mockVS())).not.toThrow();
  });

  it('ALL widgets survive multiple renders (persistence invariant)', async () => {
    await r.initialize(tc);
    const before = r.getWidgetReferences();

    for (let i = 0; i < 5; i++) r.render(mockVS());

    const after = r.getWidgetReferences();
    expect(after.header).toBe(before.header);
    expect(after.status).toBe(before.status);
    expect(after.tabBar).toBe(before.tabBar);
    expect(after.approvals).toBe(before.approvals);
    expect(after.input).toBe(before.input);
  });

  it('initialize/shutdown cycle invokes screen.destroy each time (teardown path)', async () => {
    const cycles = 50;
    for (let i = 0; i < cycles; i++) {
      await r.initialize(tc);
      await r.shutdown();
    }
    // screen.destroy() is blessed's native teardown path.
    // This test verifies it is called on every shutdown cycle.
    // Actual listener retention requires runtime heap profiling.
    expect(screenDestroySpy).toHaveBeenCalledTimes(cycles);
  });

  it('reinitialization destroys previous widget tree', async () => {
    await r.initialize(tc);
    const first = r.getWidgetReferences().screen;
    await r.initialize(tc);
    const second = r.getWidgetReferences().screen;
    expect(first).not.toBe(second);
    expect(screenDestroySpy).toHaveBeenCalled();
  });

  it('render no-ops before initialize', () => {
    expect(() => r.render(mockVS())).not.toThrow();
  });

  it('resize is a no-op', () => {
    expect(() => r.resize(120, 40)).not.toThrow();
  });

  it('shutdown after initialize cleans up', async () => {
    await r.initialize(tc);
    await r.shutdown();
    expect(screenDestroySpy).toHaveBeenCalled();
  });

  it('getWidgetReferences returns all widgets', () => {
    const refs = r.getWidgetReferences();
    expect(refs).toHaveProperty('header');
    expect(refs).toHaveProperty('status');
    expect(refs).toHaveProperty('tabBar');
    expect(refs).toHaveProperty('approvals');
    expect(refs).toHaveProperty('input');
  });
});
