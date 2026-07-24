import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OperatorViewState } from '../../src/tui/presentation/types.js';
import type { TerminalControl } from '../../src/tui/terminal-control.js';
import type { RendererEvent } from '../../src/tui/renderer/types.js';

// Mock blessed for deterministic CI (no TTY required).
// Mock tracks screen event registration so we can verify cleanup.
// vi.hoisted ensures shared state is visible to both the mock factory and test assertions.
const { screenDestroySpy, mkEl } = vi.hoisted(() => {
  const screenDestroySpy = vi.fn();
  const mkEl = (options: { hidden?: boolean } = {}) => {
    let value = '';
    const element = {
      setContent: vi.fn(),
      setItems: vi.fn(),
      setValue: vi.fn((nextValue: string) => { value = nextValue; }),
      detach: vi.fn(),
      setScrollPerc: vi.fn(),
      getValue: vi.fn(() => value),
      clearValue: vi.fn(() => { value = ''; }),
      on: vi.fn(),
      emit: vi.fn(),
      focus: vi.fn(),
      blur: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      append: vi.fn(),
      key: vi.fn(),
      submit: vi.fn(),
      hidden: options.hidden ?? false,
    };
    element.emit.mockImplementation((event: string, ...args: unknown[]) => {
      const eventCall = element.on.mock.calls.find((callArgs: unknown[]) => callArgs[0] === event);
      eventCall?.[1](...args);
      return eventCall !== undefined;
    });
    element.submit.mockImplementation(() => {
      element.emit('submit');
    });
    return element;
  };
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
    default: {
      screen: createMockScreen,
      box: mkEl,
      list: () => ({ ...mkEl(), setItems: vi.fn(), items: [], select: vi.fn() }),
      textarea: mkEl,
    },
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
      pendingApprovalHint: null,
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
    expect(after.leftPane).toBe(before.leftPane);
    expect(after.rightPane).toBe(before.rightPane);
    expect(after.rightPane.daemon).toBe(before.rightPane.daemon);
    expect(after.rightPane.approvals).toBe(before.rightPane.approvals);
    expect(after.rightPane.runtime).toBe(before.rightPane.runtime);
    expect(after.rightPane.sops_policy).toBe(before.rightPane.sops_policy);
    expect(after.promptBar).toBe(before.promptBar);
    expect(after.promptTextarea).toBe(before.promptTextarea);
    expect(after.approvalHint).toBe(before.approvalHint);
    expect(after.tabBar).toBe(before.tabBar);
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

    it('emits homeTab on Escape', async () => {
      await r.initialize(tc);
      const screen = r.getWidgetReferences().screen!;
      const events: RendererEvent[] = [];
      r.onEvent = (e) => events.push(e);

      getKeyHandler(screen, 'escape')();
      expect(events).toEqual([{ type: 'homeTab' }]);
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

    it('emits exit on C-c only', async () => {
      await r.initialize(tc);
      const screen = r.getWidgetReferences().screen!;
      const events: RendererEvent[] = [];
      r.onEvent = (e) => events.push(e);

      const keyMock = (screen as any).key as ReturnType<typeof vi.fn>;
      const exitCall = keyMock.mock.calls.find(
        (args: any[]) => args[0]?.includes('C-c'),
      );
      expect(exitCall).toBeDefined();
      expect(exitCall![0]).toEqual(['C-c']);

      const exitHandler = exitCall![1];
      exitHandler();
      exitHandler();
      expect(events).toEqual([{ type: 'exit' }, { type: 'exit' }]);
    });

    it('does not exit when q is typed into the focused textarea', async () => {
      await r.initialize(tc);
      const screen = r.getWidgetReferences().screen!;
      const textarea = r.getWidgetReferences().promptTextarea as any;
      const events: RendererEvent[] = [];
      r.onEvent = (event) => events.push(event);

      const keyMock = (screen as any).key as ReturnType<typeof vi.fn>;
      expect(keyMock.mock.calls.some((args: any[]) => args[0]?.includes('q'))).toBe(false);

      const keypressCall = textarea.on.mock.calls.find((args: any[]) => args[0] === 'keypress');
      expect(keypressCall).toBeDefined();
      textarea.setValue('q');
      keypressCall![1]('q', { name: 'q' });
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(events).toEqual([{ type: 'inputChanged', value: 'q' }]);
      expect(events).not.toContainEqual({ type: 'exit' });
    });

    it('does not register an i screen shortcut', async () => {
      await r.initialize(tc);
      const screen = r.getWidgetReferences().screen!;
      const keyMock = (screen as any).key as ReturnType<typeof vi.fn>;

      expect(keyMock.mock.calls.some((args: any[]) => args[0]?.includes('i'))).toBe(false);
    });

    it('emits submitInput from the textarea submit listener and clears the buffer', async () => {
      await r.initialize(tc);
      const textarea = r.getWidgetReferences().promptTextarea as any;
      const events: RendererEvent[] = [];
      r.onEvent = (event) => events.push(event);
      textarea.setValue('expected');

      const submitCall = textarea.on.mock.calls.find((args: any[]) => args[0] === 'submit');
      expect(submitCall).toBeDefined();
      submitCall![1]();

      expect(events).toEqual([
        { type: 'submitInput', value: 'expected' },
        { type: 'inputChanged', value: '' },
      ]);
      expect(textarea.getValue()).toBe('');
    });

    it('submits without retaining neo-blessed\'s Enter newline and clears the textarea', async () => {
      await r.initialize(tc);
      const textarea = r.getWidgetReferences().promptTextarea as any;
      const events: RendererEvent[] = [];
      r.onEvent = (event) => events.push(event);
      textarea.setValue('from-enter');

      const keypressCall = textarea.on.mock.calls.find((args: any[]) => args[0] === 'keypress');
      const enterCall = textarea.key.mock.calls.find(
        (args: any[]) => args[0]?.length === 1 && args[0][0] === 'enter',
      );
      expect(keypressCall).toBeDefined();
      expect(enterCall).toBeDefined();

      keypressCall![1]('\r', { name: 'return' });
      textarea.setValue('from-enter\n');
      enterCall![1]();
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(textarea.emit).toHaveBeenCalledWith('submit');
      expect(events).toEqual([
        { type: 'submitInput', value: 'from-enter' },
        { type: 'inputChanged', value: '' },
      ]);
      expect(textarea.getValue()).toBe('');
    });

    it('emits inputChanged with the value after neo-blessed edits the buffer', async () => {
      await r.initialize(tc);
      const textarea = r.getWidgetReferences().promptTextarea as any;
      const events: RendererEvent[] = [];
      r.onEvent = (event) => events.push(event);

      const keypressCall = textarea.on.mock.calls.find((args: any[]) => args[0] === 'keypress');
      expect(keypressCall).toBeDefined();
      keypressCall![1]('a', { name: 'a' });
      textarea.setValue('a');
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(events).toEqual([{ type: 'inputChanged', value: 'a' }]);
    });

    it('resolves approval with a or d only while the approval hint is visible', async () => {
      await r.initialize(tc);
      const refs = r.getWidgetReferences();
      const textarea = refs.promptTextarea as any;
      const approvalHint = refs.approvalHint as any;
      const events: RendererEvent[] = [];
      r.onEvent = (event) => events.push(event);

      const approvalCall = textarea.key.mock.calls.find((args: any[]) => args[0]?.[0] === 'a');
      const denialCall = textarea.key.mock.calls.find((args: any[]) => args[0]?.[0] === 'd');
      expect(approvalCall).toBeDefined();
      expect(denialCall).toBeDefined();

      approvalHint.hidden = true;
      approvalCall![1]();
      denialCall![1]();
      expect(events).toEqual([]);

      approvalHint.hidden = false;
      approvalCall![1]();
      denialCall![1]();
      expect(events).toEqual([
        { type: 'resolveApproval', status: 'approved' },
        { type: 'resolveApproval', status: 'denied' },
      ]);
    });
  });

  it('render no-ops before initialize', () => {
    expect(() => r.render(mockVS())).not.toThrow();
  });

  describe('renderer synchronization', () => {
    it('shows prompt and focuses textarea when activeTab is chat', async () => {
      await r.initialize(tc);
      const refs = r.getWidgetReferences();
      const promptBar = refs.promptBar as any;
      const promptTextarea = refs.promptTextarea as any;

      r.render(mockVS('chat'));
      expect(promptBar.show).toHaveBeenCalled();
      expect(promptTextarea.focus).toHaveBeenCalled();
    });

    it('shows prompt and focuses textarea when activeTab is agent', async () => {
      await r.initialize(tc);
      const refs = r.getWidgetReferences();
      const promptBar = refs.promptBar as any;
      const promptTextarea = refs.promptTextarea as any;

      r.render(mockVS('agent'));
      expect(promptBar.show).toHaveBeenCalled();
      expect(promptTextarea.focus).toHaveBeenCalled();
    });

    it('hides prompt and blurs textarea when activeTab is not chat/agent', async () => {
      await r.initialize(tc);
      const refs = r.getWidgetReferences();
      const promptBar = refs.promptBar as any;
      const promptTextarea = refs.promptTextarea as any;
      const leftPane = refs.leftPane as any;

      r.render(mockVS('runtime'));
      expect(promptBar.hide).toHaveBeenCalled();
      expect(promptTextarea.blur).toHaveBeenCalled();
      expect(leftPane.focus).toHaveBeenCalled();
    });

    it('transitions focus only on tab change, not every render', async () => {
      await r.initialize(tc);
      const refs = r.getWidgetReferences();
      const promptTextarea = refs.promptTextarea as any;
      const leftPane = refs.leftPane as any;

      // First render: chat -> focus on textarea (transition)
      r.render(mockVS('chat'));
      expect(promptTextarea.focus).toHaveBeenCalledTimes(1);
      expect(leftPane.focus).not.toHaveBeenCalled();

      // Second render: same tab -> no re-focus (optimization)
      r.render(mockVS('chat'));
      expect(promptTextarea.focus).toHaveBeenCalledTimes(1);

      // Third render: tab change to runtime -> blur + leftPane.focus
      r.render(mockVS('runtime'));
      expect(promptTextarea.focus).toHaveBeenCalledTimes(1);
      expect(promptTextarea.blur).toHaveBeenCalledTimes(1);
      expect(leftPane.focus).toHaveBeenCalledTimes(1);

      // Fourth render: same tab runtime -> no re-focus
      r.render(mockVS('runtime'));
      expect(promptTextarea.blur).toHaveBeenCalledTimes(1);
      expect(leftPane.focus).toHaveBeenCalledTimes(1);
    });

    it('re-focuses textarea on first render after shutdown/reinitialize', async () => {
      // First lifecycle: initialize, render chat, expect focus on textarea.
      await r.initialize(tc);
      let refs = r.getWidgetReferences();
      let promptTextarea = refs.promptTextarea as any;

      r.render(mockVS('chat'));
      expect(promptTextarea.focus).toHaveBeenCalledTimes(1);

      // Shut down the first screen, then re-initialize with a brand new widget tree.
      await r.shutdown();
      await r.initialize(tc);

      // Grab the NEW widget references — the old promptTextarea is detached.
      refs = r.getWidgetReferences();
      promptTextarea = refs.promptTextarea as any;

      // First render after re-init: focus MUST be called again. Without the
      // lastActiveTab reset this would be skipped (stale 'chat' === 'chat'),
      // leaving the new textarea without focus.
      r.render(mockVS('chat'));
      expect(promptTextarea.focus).toHaveBeenCalledTimes(1);
    });

    it('defensively syncs textarea only when value differs', async () => {
      await r.initialize(tc);
      const refs = r.getWidgetReferences();
      const promptTextarea = refs.promptTextarea as any;

      // First render: empty buffer, setValue called once (mocks the initial state)
      // Note: initial value is '', viewState input buffer is '' -> should NOT call setValue
      r.render(mockVS('chat'));
      const initialCalls = (promptTextarea.setValue as any).mock.calls.length;
      expect(initialCalls).toBe(0);

      // Render with buffer different from textarea value -> setValue called
      const vs = mockVS('chat');
      (vs.input as { buffer: string }).buffer = 'hello';
      r.render(vs);
      expect(promptTextarea.setValue).toHaveBeenCalledWith('hello');
      // Note: mock sets internal value when setValue is called
      // Now textarea value === 'hello' === viewState.input.buffer

      // Render again with same value -> setValue NOT called
      const setValueCallsBefore = (promptTextarea.setValue as any).mock.calls.length;
      r.render(vs);
      expect((promptTextarea.setValue as any).mock.calls.length).toBe(setValueCallsBefore);
    });

    it('shows approval hint and sets content when pendingApprovalHint is non-null', async () => {
      await r.initialize(tc);
      const refs = r.getWidgetReferences();
      const approvalHint = refs.approvalHint as any;

      const vs = mockVS('chat');
      (vs.viewContent as { pendingApprovalHint: string | null }).pendingApprovalHint = 'Approve: deploy prod? (a/d)';
      r.render(vs);

      expect(approvalHint.setContent).toHaveBeenCalledWith('Approve: deploy prod? (a/d)');
      expect(approvalHint.show).toHaveBeenCalled();
    });

    it('hides approval hint when pendingApprovalHint is null', async () => {
      await r.initialize(tc);
      const refs = r.getWidgetReferences();
      const approvalHint = refs.approvalHint as any;

      // First render with hint visible
      const vs = mockVS('chat');
      (vs.viewContent as { pendingApprovalHint: string | null }).pendingApprovalHint = 'first hint';
      r.render(vs);
      expect(approvalHint.show).toHaveBeenCalled();

      // Now render with null
      (vs.viewContent as { pendingApprovalHint: string | null }).pendingApprovalHint = null;
      r.render(vs);
      expect(approvalHint.hide).toHaveBeenCalled();
    });
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
    expect(refs).toHaveProperty('leftPane');
    expect(refs).toHaveProperty('rightPane');
    expect(refs).toHaveProperty('tabBar');
    expect(refs).toHaveProperty('status');
    expect(refs).toHaveProperty('promptBar');
    expect(refs).toHaveProperty('promptTextarea');
    expect(refs).toHaveProperty('approvalHint');
  });
});
