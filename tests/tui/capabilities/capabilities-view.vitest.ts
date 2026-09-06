// tests/tui/capabilities/capabilities-view.vitest.ts
import { describe, it, expect, vi } from 'vitest';
import { CapabilitiesView } from '../../../src/tui/capabilities/capabilities-view.js';
import { CapabilityService, setCapabilityService, clearCapabilityService } from '../../../src/tui/capabilities/capability-service.js';
import { createInitialTuiAppState } from '../../../src/tui/state.js';
import type { DashboardSnapshot, PerTabState } from '../../../src/tui/state.js';
import { TerminalCanvas } from '../../../src/tui/canvas.js';
import type { InvocationPresenter } from '../../../src/tui/capabilities/invocation-presenter.js';

/** Snapshot carrying a CapabilityProjection stat for `tool.file.read`. */
function snapshotWithCapabilityStat(): DashboardSnapshot {
  return {
    generatedAt: 0,
    session: null,
    daemon: null,
    approvals: null,
    runtime: {
      trace: [],
      timeline: [],
      workflow: null,
      totalEventCount: 3,
      lastEventAt: 1700000000000,
      sessionId: 'test-session',
      capabilities: {
        capabilities: {
          'tool.file.read': {
            capabilityId: 'tool.file.read',
            invocationCount: 3,
            invocationSucceeded: 2,
            invocationFailed: 1,
            invocationCancelled: 0,
            invocationTotalDurationMs: 1500,
            lastInvocationAt: 1700000000000,
            toolInvocationCount: 5,
            toolFailureCount: 1,
            toolDurationMs: 900,
          },
        },
        activeInvocations: 1,
      },
      metrics: null,
      context: null,
    },
    sops: null,
    policy: null,
    cwd: '/tmp',
  };
}

function setup() {
  clearCapabilityService();
  const presenter: InvocationPresenter = { present: vi.fn(async () => {}) };
  const svc = new CapabilityService(presenter);
  setCapabilityService(svc);
  return { svc };
}

describe('CapabilitiesView', () => {
  it('renders the catalog into the canvas', () => {
    setup();
    const view = new CapabilitiesView();
    const state = createInitialTuiAppState();
    const canvas = new TerminalCanvas(80, 24);
    const ctx = { snap: state.lastSnapshot, dimensions: { columns: 80, rows: 24 }, perTab: state.views.capabilities, canvas };
    view.render(ctx as never);
    const out = canvas.renderFrame();
    expect(out).toContain('core.session.list');
    expect(out).toContain('tool.file.read');
    // The registry-projected tool surface renders beyond the single preserved
    // id — tool.file.create is a sibling projection, proving the derived
    // (not hardcoded) palette is what reaches the view.
    expect(out).toContain('tool.file.create');
  });

  it('filters by query via ArrowUp/type', () => {
    setup();
    const view = new CapabilitiesView();
    const state = createInitialTuiAppState();
    // Simulate the view's own search query state by calling handleKey.
    const ctx = { snap: state.lastSnapshot, dimensions: { columns: 80, rows: 24 }, perTab: state.views.capabilities };
    view.handleKey('c', ctx as never);
    view.handleKey('o', ctx as never);
    const canvas = new TerminalCanvas(80, 24);
    view.render({ ...ctx, canvas } as never);
    expect(canvas.renderFrame()).toContain('core.session');
  });

  it('renders the activity block for the selected capability when a stat exists', () => {
    setup();
    const view = new CapabilitiesView();
    const state = createInitialTuiAppState();
    const perTab = state.views.capabilities;
    (perTab as PerTabState).capabilitiesSelectedId = 'tool.file.read';
    // Wide canvas so the detail pane does not truncate the telemetry line.
    const canvas = new TerminalCanvas(120, 24);
    const ctx = { snap: snapshotWithCapabilityStat(), dimensions: { columns: 120, rows: 24 }, perTab, canvas };
    view.render(ctx as never);
    const out = canvas.renderFrame();
    expect(out).toContain('activity: 3 invocations');
    expect(out).toContain('succeeded: 2  failed: 1  cancelled: 0');
    expect(out).toContain('avg duration: 500ms');
    expect(out).toContain('last: 2023-11-14T22:13:20.000Z');
    expect(out).toContain('tool telemetry: 5 uses, 1 failures, 900ms');
    // Tab-level activeInvocations is rendered on the snapshot, not per-stat.
    expect(out).toContain('active invocations: 1');
  });

  it('renders — fallbacks for avg duration and last invocation when absent', () => {
    setup();
    const view = new CapabilitiesView();
    const state = createInitialTuiAppState();
    const perTab = state.views.capabilities;
    (perTab as PerTabState).capabilitiesSelectedId = 'tool.file.read';
    // A stat with zero invocations and no lastInvocationAt → both — fallbacks.
    // Build a fresh snapshot (stats are readonly — no in-place mutation).
    const snap = snapshotWithCapabilityStat();
    const snap2: DashboardSnapshot = {
      ...snap,
      runtime: {
        ...snap.runtime!,
        capabilities: {
          activeInvocations: 0,
          capabilities: {
            'tool.file.read': {
              ...snap.runtime!.capabilities!.capabilities['tool.file.read']!,
              invocationCount: 0,
              lastInvocationAt: null,
            },
          },
        },
      },
    };
    const canvas = new TerminalCanvas(120, 24);
    const ctx = { snap: snap2, dimensions: { columns: 120, rows: 24 }, perTab, canvas };
    view.render(ctx as never);
    const out = canvas.renderFrame();
    expect(out).toContain('avg duration: —ms');
    expect(out).toContain('last: —');
  });

  it('shows no activity block for an uninvoked capability (no stat)', () => {
    setup();
    const view = new CapabilitiesView();
    const state = createInitialTuiAppState();
    const perTab = state.views.capabilities;
    (perTab as PerTabState).capabilitiesSelectedId = 'core.session.list';
    const canvas = new TerminalCanvas(120, 24);
    const ctx = { snap: snapshotWithCapabilityStat(), dimensions: { columns: 120, rows: 24 }, perTab, canvas };
    view.render(ctx as never);
    const out = canvas.renderFrame();
    // core.session.list has no stat → the metadata renders but no activity lines.
    expect(out).toContain('core.session.list');
    expect(out).not.toContain('activity:');
  });

  it('renders argsSchema and resultSchema as structured shape lines, not raw JSON (#414)', () => {
    setup();
    const view = new CapabilitiesView();
    const state = createInitialTuiAppState();
    const perTab = state.views.capabilities;
    // Tool capabilities now derive from the canonical registry, which carries
    // no args/result schemas — so schema-shape rendering is exercised on the
    // session-native capability that still declares both (core.session.show).
    (perTab as PerTabState).capabilitiesSelectedId = 'core.session.show';
    const canvas = new TerminalCanvas(120, 24);
    const ctx = { snap: state.lastSnapshot, dimensions: { columns: 120, rows: 24 }, perTab, canvas };
    view.render(ctx as never);
    const out = canvas.renderFrame();

    // Structured shape lines replace raw JSON.stringify(argsSchema).
    expect(out).toContain('args:');
    expect(out).toMatch(/sessionId: string/);      // args shape
    expect(out).toContain('result:');
    expect(out).toContain('state: string');        // result shape
    // No raw JSON-schema object string is dumped.
    expect(out).not.toContain('"required"');
  });

  it('guards when no CapabilityService is wired', () => {
    clearCapabilityService();
    const view = new CapabilitiesView();
    const state = createInitialTuiAppState();
    const canvas = new TerminalCanvas(80, 24);
    const ctx = { snap: state.lastSnapshot, dimensions: { columns: 80, rows: 24 }, perTab: state.views.capabilities, canvas };
    view.render(ctx as never);
    expect(canvas.renderFrame()).toContain('capabilities unavailable');
  });
});
