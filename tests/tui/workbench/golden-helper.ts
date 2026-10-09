import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AlixEvent } from '../../../src/runtime-state/events/types.js';
import { TerminalCanvas } from '../../../src/interfaces/tui/canvas.js';
import { createInitialPerTabState, type TuiAppState } from '../../../src/interfaces/tui/state.js';
import { buildExecutionTrace } from '../../../src/interfaces/tui/runtime/execution-trace-builder.js';
import { TimelineBuilder } from '../../../src/interfaces/tui/runtime/timeline-builder.js';
import { AgentRosterProjection } from '../../../src/interfaces/tui/workbench/projections/agent-roster-projection.js';
import { TaskProjection } from '../../../src/interfaces/tui/workbench/projections/task-projection.js';
import { ArtifactProjection } from '../../../src/interfaces/tui/workbench/projections/artifact-projection.js';
import { resolveWorkbenchSurfaceGeometry, type WorkbenchRegion } from '../../../src/interfaces/tui/workbench/layout/responsive-layout.js';
import { createInitialWorkbenchUiState, type WorkbenchDrawer, type WorkbenchOverlay } from '../../../src/interfaces/tui/workbench/model/ui-state.js';
import { getWorkbenchPreviewTheme } from '../../../src/interfaces/tui/workbench/model/preview-theme.js';
import { projectOperatorShell } from '../../../src/interfaces/tui/workbench/model/operator-shell.js';
import { buildAgentInspectorModel } from '../../../src/interfaces/tui/workbench/model/agent-inspector.js';
import { paintOperatorShell } from '../../../src/interfaces/tui/workbench/views/operator-shell.js';
import { paintRosterDrawer } from '../../../src/interfaces/tui/workbench/views/roster-drawer.js';
import { paintTranscriptToolbar } from '../../../src/interfaces/tui/workbench/views/transcript-toolbar.js';
import { paintAgentInspector } from '../../../src/interfaces/tui/workbench/views/agent-inspector.js';
import type { WorkbenchStore } from '../../../src/interfaces/tui/workbench/app/workbench-store.js';
import type { RuntimeSnapshot } from '../../../src/interfaces/tui/snapshot.js';
import { createWorkbenchRenderHarness } from '../../fixtures/tui/workbench-render-harness.js';

/** Canonical Phase-10 content: the checked-in four-worker preview fixture. */
type PreviewFixture = {
  readonly events: AlixEvent[];
  readonly now: string;
  readonly sessionId: string;
  readonly selectedAgentId: string;
};
const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/tui/workbench-preview-events.json', import.meta.url), 'utf8'),
) as PreviewFixture;
const previewNow = Date.parse(fixture.now);

const originalColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
const originalRows = Object.getOwnPropertyDescriptor(process.stdout, 'rows');

function setTerminalDimensions(columns: number, rows: number): void {
  Object.defineProperty(process.stdout, 'columns', { value: columns, configurable: true });
  Object.defineProperty(process.stdout, 'rows', { value: rows, configurable: true });
}

function restoreTerminalDimensions(): void {
  if (originalColumns) Object.defineProperty(process.stdout, 'columns', originalColumns);
  else Reflect.deleteProperty(process.stdout, 'columns');
  if (originalRows) Object.defineProperty(process.stdout, 'rows', originalRows);
  else Reflect.deleteProperty(process.stdout, 'rows');
}

/**
 * Rebuild the preview fixture's runtime read models (roster, tasks, artifacts,
 * timeline, execution trace) at the fixture's fixed UTC clock. No live clock
 * and no machine paths: replaying the same events yields the same snapshots.
 */
function previewRuntime(base: RuntimeSnapshot): RuntimeSnapshot {
  const agents = new AgentRosterProjection();
  agents.update(fixture.events);
  const tasks = new TaskProjection();
  tasks.update(fixture.events);
  const artifacts = new ArtifactProjection();
  artifacts.update(fixture.events);
  const timeline = new TimelineBuilder(fixture.sessionId);
  timeline.update(fixture.events);
  return {
    ...base,
    timeline: timeline.snapshot(),
    trace: buildExecutionTrace(fixture.events),
    agents: agents.snapshot(previewNow),
    tasks: tasks.snapshot(),
    artifacts: artifacts.snapshot(),
    totalEventCount: fixture.events.length,
  };
}

function injectPreviewContent(app: unknown, state: TuiAppState): void {
  const runtime = previewRuntime(state.lastSnapshot!.runtime!);
  state.lastSnapshot = { ...state.lastSnapshot!, generatedAt: previewNow, runtime };
  (app as { agentRuntime: RuntimeSnapshot }).agentRuntime = runtime;
}

export interface FullFrameScenario {
  readonly columns: number;
  readonly rows: number;
  /** 'preview' (default) = fixture content; 'shell' = minimal harness chrome. */
  readonly content?: 'preview' | 'shell';
  readonly drawer?: Exclude<WorkbenchDrawer, 'closed'>;
  readonly overlay?: WorkbenchOverlay;
  readonly selectAgent?: boolean;
  /** Pin the transcript at this absolute offset (undefined = follow the tail). */
  readonly scrollOffset?: number;
}

/**
 * Paint one complete Workbench frame at the requested terminal size and
 * return the cell/ANSI frame string (the same `renderFrame()` text the
 * painter diffs against the previous frame).
 */
export function renderFullFrame(scenario: FullFrameScenario): string {
  // Pin the wall clock to the fixture clock: painted chrome can sample
  // Date.now() (approval-wait/liveness status lines), so a future fixture
  // with liveness or pending approvals must not time-stamp goldens with the
  // run time — the same fixed `previewNow` the snapshot projection uses.
  const realNow = Date.now;
  Date.now = () => previewNow;
  try {
    setTerminalDimensions(scenario.columns, scenario.rows);
    const { app, state, paint } = createWorkbenchRenderHarness();
    if (scenario.content !== 'shell') injectPreviewContent(app, state);
    const store = (app as unknown as { workbenchStore: WorkbenchStore }).workbenchStore;
    if (scenario.selectAgent) {
      store.dispatch({ type: 'agent.select', agentId: fixture.selectedAgentId, scrollOffset: 0 });
    }
    if (scenario.drawer) store.dispatch({ type: 'drawer.toggle', drawer: scenario.drawer });
    if (scenario.overlay) store.dispatch({ type: 'overlay.toggle', overlay: scenario.overlay });
    if (scenario.scrollOffset !== undefined) {
      store.dispatch({ type: 'transcript.follow', followTail: false });
      state.views.agent.scrollOffset = scenario.scrollOffset;
    }
    paint();
    const frame = (app as unknown as { framePainter: { previousWorkbenchFrame: string | null } })
      .framePainter.previousWorkbenchFrame;
    if (typeof frame !== 'string') throw new Error('workbench frame was not painted');
    return frame;
  } finally {
    restoreTerminalDimensions();
    Date.now = realNow;
  }
}

/**
 * ASCII/monochrome capture of the theme-injectable region painters (chrome,
 * roster, transcript toolbar, inspector) over the preview fixture. The
 * full-frame path resolves `getWorkbenchPreviewTheme()` with defaults today,
 * so ASCII coverage paints the region painters directly with an explicit
 * `monochrome`/`ascii` theme — the seam the parity plan documents.
 */
export function renderAsciiPreviewFrame(columns = 160, rows = 36): string {
  setTerminalDimensions(columns, rows);
  try {
    const { app, state } = createWorkbenchRenderHarness();
    injectPreviewContent(app, state);
    const snapshot = state.lastSnapshot!;
    const theme = getWorkbenchPreviewTheme('monochrome', 'ascii');
    const geometry = resolveWorkbenchSurfaceGeometry(columns, rows, 'closed');
    const canvas = new TerminalCanvas(columns, rows);
    const ui = createInitialWorkbenchUiState({ columns, rows });
    const roster: WorkbenchRegion | null = geometry.regions.roster;
    if (roster) {
      paintRosterDrawer({
        canvas,
        left: roster.x,
        terminalColumns: columns,
        top: roster.y,
        bottom: roster.y + roster.height - 1,
        layout: geometry.layout,
        agents: snapshot.runtime?.agents ?? null,
        tasks: snapshot.runtime?.tasks ?? null,
        artifacts: snapshot.runtime?.artifacts ?? null,
        selectedAgentId: fixture.selectedAgentId,
        theme,
      });
    }
    paintTranscriptToolbar(canvas, geometry.regions.transcriptToolbar, ui, 0, theme);
    if (geometry.regions.inspector) {
      paintAgentInspector(
        canvas,
        geometry.regions.inspector,
        buildAgentInspectorModel(snapshot, { selectedAgentId: fixture.selectedAgentId }),
        theme,
      );
    }
    paintOperatorShell({
      canvas,
      width: columns,
      height: rows,
      model: projectOperatorShell(snapshot, createInitialPerTabState(), undefined, 0, {
        closeSurface: false,
        focus: 'composer',
        drawer: geometry.layout.drawer,
      }),
      theme,
    });
    return canvas.renderFrame();
  } finally {
    restoreTerminalDimensions();
  }
}

const GOLDEN_DIR = fileURLToPath(new URL('./__goldens__/', import.meta.url));
const GOLDEN_RELATIVE_DIR = 'tests/tui/workbench/__goldens__';
// Bounds CONTENT rows (ctx/del/ins) only: the two file headers plus every
// emitted `@@` hunk header are extra, so the true worst-case diff is ~47
// lines (30 content + up to 17 header lines) when each content line lands in
// its own hunk.
const MAX_DIFF_CONTENT_LINES = 30;
const MAX_DIFF_LINE_WIDTH = 240;
const ESC = String.fromCharCode(27);

function goldenFile(scenario: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(scenario)) throw new Error(`invalid golden scenario name: ${scenario}`);
  return `${GOLDEN_DIR}${scenario}.txt`;
}

function updating(): boolean {
  return process.env.UPDATE_GOLDENS === '1' || process.env.UPDATE_GOLDENS === 'true';
}

type DiffRow = {
  readonly op: 'ctx' | 'del' | 'ins';
  readonly expectedLine: number;
  readonly actualLine: number;
  readonly text: string;
};

/** Bounded LCS line diff so mismatches report insert/delete, not position noise. */
function diffRows(expected: string[], actual: string[]): DiffRow[] {
  const height = expected.length;
  const width = actual.length;
  const table: number[][] = Array.from({ length: height + 1 }, () => new Array<number>(width + 1).fill(0));
  for (let e = height - 1; e >= 0; e -= 1) {
    for (let a = width - 1; a >= 0; a -= 1) {
      table[e]![a] = expected[e] === actual[a]
        ? table[e + 1]![a + 1]! + 1
        : Math.max(table[e + 1]![a]!, table[e]![a + 1]!);
    }
  }
  const rows: DiffRow[] = [];
  let e = 0;
  let a = 0;
  while (e < height && a < width) {
    if (expected[e] === actual[a]) {
      rows.push({ op: 'ctx', expectedLine: e + 1, actualLine: a + 1, text: expected[e]! });
      e += 1;
      a += 1;
    } else if (table[e + 1]![a]! >= table[e]![a + 1]!) {
      rows.push({ op: 'del', expectedLine: e + 1, actualLine: a + 1, text: expected[e]! });
      e += 1;
    } else {
      rows.push({ op: 'ins', expectedLine: e + 1, actualLine: a + 1, text: actual[a]! });
      a += 1;
    }
  }
  while (e < height) {
    rows.push({ op: 'del', expectedLine: e + 1, actualLine: a + 1, text: expected[e]! });
    e += 1;
  }
  while (a < width) {
    rows.push({ op: 'ins', expectedLine: e + 1, actualLine: a + 1, text: actual[a]! });
    a += 1;
  }
  return rows;
}

function formatDiffLine(text: string): string {
  const escaped = text.split(ESC).join('\\x1b');
  return escaped.length > MAX_DIFF_LINE_WIDTH ? `${escaped.slice(0, MAX_DIFF_LINE_WIDTH)}...` : escaped;
}

/** Unified-style diff bounded to ~30 content lines (~47 output lines including file/hunk headers) so CI failures stay readable. */
function renderDiff(scenario: string, expected: string[], actual: string[]): string {
  const rows = diffRows(expected, actual);
  const keep = new Set<number>();
  rows.forEach((row, index) => {
    if (row.op === 'ctx') return;
    keep.add(index);
    if (index > 0) keep.add(index - 1);
    if (index + 1 < rows.length) keep.add(index + 1);
  });
  const ordered = [...keep].sort((left, right) => left - right);
  const lines = [`--- golden (expected) ${GOLDEN_RELATIVE_DIR}/${scenario}.txt`, '+++ rendered (actual)'];
  let emitted = 0;
  let truncated = 0;
  let previous = -2;
  for (const index of ordered) {
    if (emitted >= MAX_DIFF_CONTENT_LINES) {
      truncated += 1;
      continue;
    }
    const row = rows[index]!;
    if (index !== previous + 1) lines.push(`@@ expected:${row.expectedLine} rendered:${row.actualLine} @@`);
    lines.push(`${row.op === 'ctx' ? ' ' : row.op === 'del' ? '-' : '+'}${formatDiffLine(row.text)}`);
    previous = index;
    emitted += 1;
  }
  if (truncated > 0) lines.push(`... diff truncated (${truncated} more lines)`);
  return lines.join('\n');
}

/**
 * Goldens are LF on disk (enforced by .gitattributes), but a foreign
 * checkout (e.g. Windows autocrlf) may hand us CRLF — normalize on read so
 * the suite is checkout-proof rather than checkout-dependent.
 */
function readGolden(file: string): string {
  return readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

/**
 * Compare a rendered frame against `tests/tui/workbench/__goldens__/<scenario>.txt`.
 * With `UPDATE_GOLDENS=1` the golden is (re)written and the check passes with
 * a loud console note; otherwise a mismatch throws a bounded unified diff.
 */
export function expectGolden(scenario: string, actual: string): void {
  const file = goldenFile(scenario);
  // Frames render LF; normalize defensively so a regenerated golden is
  // always LF-stable regardless of host.
  const normalized = actual.replace(/\r\n/g, '\n');
  if (updating()) {
    const previous = existsSync(file) ? readGolden(file) : null;
    mkdirSync(GOLDEN_DIR, { recursive: true });
    // Atomic replace: a crashed/interrupted run can never leave a truncated
    // golden behind — readers only ever see the complete tmp file renamed in.
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, normalized, 'utf8');
    renameSync(tmp, file);
    const state = previous === null ? 'created' : previous === normalized ? 'unchanged' : 'UPDATED';
    // Direct stderr write: vitest.config.mts swallows console.* via onConsoleLog.
    process.stderr.write(`[parity-goldens] UPDATE_GOLDENS=1: ${scenario} ${state} -> ${GOLDEN_RELATIVE_DIR}/${scenario}.txt\n`);
    return;
  }
  if (!existsSync(file)) {
    throw new Error(
      `missing golden "${scenario}" - regenerate with: UPDATE_GOLDENS=1 npx vitest run tests/tui/workbench/parity-goldens.vitest.ts`,
    );
  }
  const expected = readGolden(file);
  if (expected === normalized) return;
  throw new Error(`golden mismatch: ${scenario}\n${renderDiff(scenario, expected.split('\n'), normalized.split('\n'))}`);
}
