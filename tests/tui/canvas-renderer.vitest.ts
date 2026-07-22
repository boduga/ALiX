import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasRenderer } from '../../src/tui/renderers/canvas-renderer.js';
import type { OperatorViewState } from '../../src/tui/presentation/types.js';
import type { TerminalControl } from '../../src/tui/terminal-control.js';
import { CanvasSurface } from '../../src/tui/renderers/canvas-surface.js';

type TestTerminalControl = TerminalControl & {
  write: ReturnType<typeof vi.fn>;
  setCursor: ReturnType<typeof vi.fn>;
};

function mockTC(): TestTerminalControl {
  return {
    enterAltBuffer: vi.fn(),
    exitAltBuffer: vi.fn(),
    enterRawMode: vi.fn(),
    exitRawMode: vi.fn(),
    showCursor: vi.fn(),
    onResize: vi.fn(),
    installEmergencyCleanup: vi.fn(),
    write: vi.fn<(data: string) => void>(),
    setCursor: vi.fn<(row: number, column: number) => void>(),
  };
}

function mockVS(): OperatorViewState {
  return {
    tabs: ['chat', 'agent', 'approvals', 'daemon', 'runtime', 'sops', 'policy'].map((id) => ({
      id,
      label: id.charAt(0).toUpperCase() + id.slice(1),
      active: id === 'chat',
    })),
    activeTab: 'chat',
    panels: ['daemon', 'approvals', 'runtime', 'sops_policy'].map((id) => ({
      id,
      title: id.toUpperCase(),
      items: [],
      scrollOffset: 0,
      focused: false,
      totalItems: 0,
      visible: true,
      kind: id as 'daemon' | 'approvals' | 'runtime' | 'sops_policy',
    })),
    input: { buffer: '', prompt: 'alix> ', cursorPos: 0, activeTab: 'chat', mode: 'chat' },
    statusBar: { phaseRadios: [], fields: [{ label: 'DAEMON', value: '○ stopped' }], activeTab: 'chat' },
    sessionMetadata: null,
    daemonStatus: null,
  };
}

describe('CanvasRenderer', () => {
  let renderer: CanvasRenderer;
  let terminal: TestTerminalControl;

  beforeEach(() => {
    renderer = new CanvasRenderer();
    terminal = mockTC();
  });

  it('reports capabilities', () => {
    expect(renderer.capabilities().name).toBe('CanvasRenderer');
  });

  it('initialize stores terminal', async () => {
    await renderer.initialize(terminal);
    expect(renderer).toBeDefined();
  });

  it('render no-ops before initialize', () => {
    expect(() => renderer.render(mockVS())).not.toThrow();
  });

  it('render calls terminal.write after init', async () => {
    await renderer.initialize(terminal);
    renderer.render(mockVS());
    expect(terminal.write).toHaveBeenCalled();
  });

  it('render calls terminal.setCursor after init', async () => {
    await renderer.initialize(terminal);
    renderer.render(mockVS());
    expect(terminal.setCursor).toHaveBeenCalledWith(5, 8);
  });

  it('setPreRenderSurface accepts null', () => {
    expect(() => renderer.setPreRenderSurface(null)).not.toThrow();
  });

  it('setPreRenderSurface accepts CanvasSurface', async () => {
    await renderer.initialize(terminal);
    const surface = new CanvasSurface(80, 24);
    surface.write(0, 0, 'legacy');
    renderer.setPreRenderSurface(surface);
    renderer.render(mockVS());
    expect(terminal.write).toHaveBeenCalled();
  });

  it('resize updates geometry', async () => {
    await renderer.initialize(terminal);
    renderer.resize(120, 40);
    renderer.render(mockVS());
    expect(terminal.write).toHaveBeenCalled();
  });

  it('shutdown clears pre-render surface', async () => {
    await renderer.initialize(terminal);
    renderer.setPreRenderSurface(new CanvasSurface(80, 24));
    await renderer.shutdown();
    renderer.render(mockVS());
  });

  it('exposes PreRenderCapable', () => {
    expect('setPreRenderSurface' in renderer).toBe(true);
  });
});
