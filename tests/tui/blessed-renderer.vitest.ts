import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OperatorViewState } from '../../src/tui/presentation/types.js';
import type { TerminalControl } from '../../src/tui/terminal-control.js';
import type { RendererEvent } from '../../src/tui/renderer/types.js';

// Mock blessed for deterministic CI (no TTY required).
// Mock tracks screen event registration so we can verify cleanup.
// vi.hoisted ensures shared state is visible to both the mock factory and test assertions.
const { screenDestroySpy, mkEl } = vi.hoisted(() => {
  const screenDestroySpy = vi.fn();
  const mkEl = () => ({
    setContent: vi.fn(),
    setItems: vi.fn(),
    setValue: vi.fn(),
    detach: vi.fn(),
    setScrollPerc: vi.fn(),
    getValue: vi.fn(),
    clearValue: vi.fn(),
    on: vi.fn(),
    focus: vi.fn(),
  });
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
    textarea: () => ({ ...mkEl(), setValue: vi.fn(), value: '', on: vi.fn() }),
    default: { screen: createMockScreen, box: mkEl, list: mkEl, textarea: mkEl },
  };
});

const { BlessedRenderer } = await import('../../src/tui/renderers/blessed-renderer.js');
type BlessedRendererType = InstanceType<typeof BlessedRenderer>;

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

function mockVS(tab?: string): OperatorViewState {
  const activeTab = tab || 'chat';
  return {
    tabs: ['chat','agent','approvals','daemon','runtime','sops','policy'].map((id) => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1), active: id === activeTab })),
    activeTab,
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

  it('capabilities: handlesInput=true, supportsMouse=false', () => {
    const caps = r.capabilities();
    expect(caps.handlesInput).toBe(true);
    expect(caps.supportsMouse).toBe(false);
    expect(caps.name).toBe('BlessedRenderer');
    expect(caps.version).toBe('1.0.0');
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
    expect(after.mainBox).toBe(before.mainBox);
    expect(after.sidebarWidgets).toBe(before.sidebarWidgets);
    expect(after.sidebarWidgets.daemon).toBe(before.sidebarWidgets.daemon);
    expect(after.sidebarWidgets.approvals).toBe(before.sidebarWidgets.approvals);
    expect(after.sidebarWidgets.runtime).toBe(before.sidebarWidgets.runtime);
    expect(after.sidebarWidgets.sops_policy).toBe(before.sidebarWidgets.sops_policy);
    expect(after.tabBar).toBe(before.tabBar);
    expect(after.input).toBe(before.input);
    expect(after.status).toBe(before.status);
  });

  it('initialize/shutdown cycle invokes screen.destroy each time (teardown path)', async () => {
    const cycles = 50;
    for (let i = 0; i < cycles; i++) {
      await r.initialize(tc);
      await r.shutdown();
    }
    // screen.destroy() is blessed's native teardown path.
    // This test verifies it is called on every shutdown cycle.
    expect(screenDestroySpy).toHaveBeenCalledTimes(cycles);
  });

  it('shutdown + initialize destroys previous widget tree', async () => {
    await r.initialize(tc);
    const first = r.getWidgetReferences().screen;
    await r.shutdown();
    await r.initialize(tc);
    const second = r.getWidgetReferences().screen;
    expect(first).not.toBe(second);
    expect(screenDestroySpy).toHaveBeenCalled();
  });

  it('double initialize throws error', async () => {
    await r.initialize(tc);
    await expect(r.initialize(tc)).rejects.toThrow();
  });

  it('handlesInput capability is true', () => {
    expect(r.capabilities().handlesInput).toBe(true);
  });

  it('renderer does not contain domain types', () => {
    const fs = require('fs');
    const src = fs.readFileSync('src/tui/renderers/blessed-renderer.ts', 'utf-8');
    expect(src).not.toContain('DashboardSnapshot');
    expect(src).not.toContain('PerTabState');
    expect(src).not.toContain('process.exit');
  });

  it('renders all 7 tabs without error', async () => {
    await r.initialize(tc);
    for (const tab of ['chat', 'agent', 'daemon', 'approvals', 'runtime', 'sops', 'policy']) {
      const vs = mockVS(tab);
      expect(() => r.render(vs)).not.toThrow();
    }
  });

  describe('keyboard events', () => {
    function getKeyHandler(screen: ReturnType<typeof r.getWidgetReferences>['screen'], keyName: string): () => void {
      const keyMock = (screen as any).key as ReturnType<typeof vi.fn>;
      const call = keyMock.mock.calls.find((args: any[]) => args[0]?.includes(keyName));
      return call?.[1] ?? (() => { /* noop */ });
    }

    function findDigitKeyHandler(screen: ReturnType<typeof r.getWidgetReferences>['screen'], digit: string): () => void {
      const keyMock = (screen as any).key as ReturnType<typeof vi.fn>;
      const call = keyMock.mock.calls.find((args: any[]) => args[0]?.length === 1 && args[0][0] === digit);
      return call?.[1] ?? (() => { /* noop */ });
    }

    it('emits cycleTab forward on Tab', async () => {
      await r.initialize(tc);
      const screen = r.getWidgetReferences().screen!;
      const events: RendererEvent[] = [];
      r.onEvent = (e) => events.push(e);

      getKeyHandler(screen, 'Tab')();
      expect(events).toEqual([{ type: 'cycleTab', forward: true }]);
    });

    it('emits cycleTab backward on Shift Tab', async () => {
      await r.initialize(tc);
      const screen = r.getWidgetReferences().screen!;
      const events: RendererEvent[] = [];
      r.onEvent = (e) => events.push(e);

      getKeyHandler(screen, 'S-Tab')();
      expect(events).toEqual([{ type: 'cycleTab', forward: false }]);
    });

    it('emits blurInput on Escape', async () => {
      await r.initialize(tc);
      const screen = r.getWidgetReferences().screen!;
      const events: RendererEvent[] = [];
      r.onEvent = (e) => events.push(e);

      getKeyHandler(screen, 'escape')();
      expect(events).toEqual([{ type: 'blurInput' }]);
    });

    it('emits switchTab on numeric keys 1-7', async () => {
      await r.initialize(tc);
      const screen = r.getWidgetReferences().screen!;
      const events: RendererEvent[] = [];
      r.onEvent = (e) => events.push(e);

      const tabIds = ['chat', 'agent', 'daemon', 'approvals', 'runtime', 'sops', 'policy'];
      for (let i = 0; i < 7; i++) {
        findDigitKeyHandler(screen, String(i + 1))();
      }
      expect(events).toHaveLength(7);
      expect(events[0]).toEqual({ type: 'switchTab', tab: 'chat' });
      expect(events[1]).toEqual({ type: 'switchTab', tab: 'agent' });
      expect(events[2]).toEqual({ type: 'switchTab', tab: 'daemon' });
      expect(events[3]).toEqual({ type: 'switchTab', tab: 'approvals' });
      expect(events[4]).toEqual({ type: 'switchTab', tab: 'runtime' });
      expect(events[5]).toEqual({ type: 'switchTab', tab: 'sops' });
      expect(events[6]).toEqual({ type: 'switchTab', tab: 'policy' });
    });

    it('emits exit on C-c, q, Q', async () => {
      await r.initialize(tc);
      const screen = r.getWidgetReferences().screen!;
      const events: RendererEvent[] = [];
      r.onEvent = (e) => events.push(e);

      // C-c handler: screen.key(['C-c', 'q', 'Q'], handler) — 3 keys, 1 handler
      const keyMock = (screen as any).key as ReturnType<typeof vi.fn>;
      const exitCall = keyMock.mock.calls.find(
        (args: any[]) => args[0]?.includes('C-c'),
      );
      expect(exitCall).toBeDefined();
      const exitHandler = exitCall![1];

      // Trigger twice
      exitHandler();
      exitHandler();
      expect(events).toEqual([{ type: 'exit' }, { type: 'exit' }]);
    });
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
    expect(refs).toHaveProperty('mainBox');
    expect(refs).toHaveProperty('sidebarWidgets');
    expect(refs).toHaveProperty('tabBar');
    expect(refs).toHaveProperty('input');
    expect(refs).toHaveProperty('status');
  });
});
