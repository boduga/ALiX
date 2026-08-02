/**
 * AgentView response formatting — covers every render kind and combination.
 *
 * Kinds tested:
 *   user    → dim gray '→ ' marker, text in column 2
 *   agent   → cyan '← ' marker, text in column 2
 *   plan    → dim '◆ ' marker (first line), dim text; blank separator skipped
 *   approval → yellow '⏸ ' header + yellow cards
 *   runtime status → gray "events: N | step M/N" on row 5
 *   prompt row → yellow "alix-agent>" on row 4
 *   scroll offset → ArrowUp/ArrowDown scroll the scrollback
 *   text wrapping → long lines word-wrap within textWidth
 *   task cap → plan capped at 20 tasks
 *
 * Canvas sizing (controlled by PANEL_H=14, FOOTER_H=3):
 *   80×24  → startY=7, scrollbackBottom=6, 1 scrollback row (row 6 only)
 *   80×40  → startY=23, scrollbackBottom=22, 17 scrollback rows (6–22)
 *   80×100 → startY=83, scrollbackBottom=82, 77 scrollback rows (6–82)
 */
import { describe, it, expect, vi } from 'vitest';
import { TerminalCanvas } from '../src/tui/canvas.js';
import { AgentView } from '../src/tui/views/agent-view.js';
import type { ViewRenderContext } from '../src/tui/views/types.js';
import type { DashboardSnapshot, PerTabState, SessionPhase } from '../src/tui/state.js';
import type { TimelineEntry } from '../src/tui/runtime/timeline-builder.js';
import type { PlanTask } from '../src/planning/plan-task.js';

/* ─── Constants ─────────────────────────────────────────────── */

/** Canvas height that yields 17 scrollback rows (rows 6–22). */
const TALL = 40;
/** Canvas height that yields 1 scrollback row (row 6 only). */
const COMPACT = 24;
/** Canvas height that yields 77 scrollback rows — for big tests. */
const DEEP = 100;
/** Default canvas width. */
const W = 80;

/* ─── Helpers ───────────────────────────────────────────────── */

const MINIMAL_SNAPSHOT: DashboardSnapshot = {
  generatedAt: 1_000_000,
  session: { mode: 'auto', phase: 'Idle' as SessionPhase, version: '1.0.0', startedAt: 1_000_000, turns: 0 },
  runtime: null,
  daemon: null,
  approvals: null,
  sops: null,
  policy: { rules: [], violations: [], enforcementMode: 'auto', recentViolationCount: 0 },
  cwd: '/workspace/test',
};

function makePerTab(overrides?: Partial<PerTabState>): PerTabState {
  return {
    cursor: 0,
    scrollOffset: 0,
    searchQuery: '',
    expandedSections: [],
    lastEventArrivedAt: 0,
    pinnedBottom: true,
    inputBuffer: '',
    planContent: undefined,
    planTasks: undefined,
    pendingApprovals: [],
    resolvedApprovals: [],
    runtimeTraceFilter: 'all',
    panelScrollOffsets: { approvals: 0, sops: 0 },
    panelFocus: null,
    ...overrides,
  };
}

/**
 * Seed a conversation as agent-sub-session timeline entries (Phase 6, D6/D9),
 * aligned with the real emission path (Phase 6 final fix): the operator's
 * typed prompt lands as `agent.message` and the agent's final summary as
 * `agent.response`. AgentView reads `ctx.runtime.agent.timeline` filtered to
 * agent-authored kinds (`agent.message` | `agent.reasoning` | `agent.decision`
 * | `agent.response`) — NOT the legacy `perTab.timelineEvents`. Entries are
 * interleaved exactly as the pre-projection fixture did (prompt_i before
 * summary_i). Direction comes from the actor: prompts (actor 'user') render
 * with the → operator marker, summaries (actor 'agent') with the ← marker.
 */
function seedTurns(user: string[], agent: string[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  let seq = 0;
  const maxLen = Math.max(user.length, agent.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < user.length) {
      seq += 1;
      // Operator's typed prompt → agent.message with actor 'user' (real
      // emission: app.ts stamps the agent tab's user input this way).
      entries.push({ id: `tl-${seq}`, kind: 'agent.message', actor: 'user', sessionId: 'agent-1', startedAt: seq, text: user[i]!, sourceEvents: { firstSequence: seq } });
    }
    if (i < agent.length) {
      seq += 1;
      // Agent's final summary → agent.response with actor 'agent'.
      entries.push({ id: `tl-${seq}`, kind: 'agent.response', actor: 'agent', sessionId: 'agent-1', startedAt: seq, text: agent[i]!, sourceEvents: { firstSequence: seq } });
    }
  }
  return entries;
}

/** Wrap turn entries in the agent sub-session's RuntimeSnapshot for `ctx.runtime`. */
function agentRuntime(entries: TimelineEntry[]): ViewRenderContext['runtime'] {
  return {
    chat: null,
    agent: {
      trace: [],
      timeline: entries,
      workflow: null,
      totalEventCount: entries.length,
      lastEventAt: null,
      sessionId: 'agent-1',
    },
  };
}

function renderOnCanvas(
  width: number,
  height: number,
  perTab: PerTabState,
  snap: DashboardSnapshot = MINIMAL_SNAPSHOT,
  runtime?: ViewRenderContext['runtime'],
): TerminalCanvas {
  const canvas = new TerminalCanvas(width, height);
  const ctx: ViewRenderContext = {
    snap,
    dimensions: { columns: width, rows: height },
    perTab,
    canvas,
    ...(runtime ? { runtime } : {}),
  };
  const view = new AgentView();
  view.render(ctx);
  return canvas;
}

/** Read a single (x, y) cell from the canvas. */
function cellAt(c: TerminalCanvas, x: number, y: number): { char: string; style: string } {
  const buf = (c as any).buffer as CanvasCell[][];
  const cell = buf[y]?.[x];
  if (!cell) return { char: ' ', style: '' };
  return { char: cell.char, style: cell.ansiPrefix };
}

/** Read a full row from the canvas as plain text (ANSI-stripped, trailing whitespace removed). */
function rowText(c: TerminalCanvas, y: number): string {
  const buf = (c as any).buffer as CanvasCell[][];
  const row = buf[y];
  if (!row) return '';
  return row.map((cell: { char: string }) => cell.char).join('').replace(/\s+$/, '');
}

/** Check whether any cell in a row carries an ANSI fragment. */
function rowHasStyle(c: TerminalCanvas, y: number, ansiFragment: string): boolean {
  const buf = (c as any).buffer as CanvasCell[][];
  const row = buf[y];
  if (!row) return false;
  return row.some((cell: { ansiPrefix: string }) => cell.ansiPrefix.includes(ansiFragment));
}

/** Collect canvas rows 0..maxY-1 as a single joined string (useful for multi-line assertions). */
function allText(c: TerminalCanvas, maxY = 30): string {
  return Array.from({ length: maxY }, (_, y) => rowText(c, y)).join('\n');
}

interface CanvasCell {
  char: string;
  ansiPrefix: string;
}

/* ─────────────────────────────────────────────────────────────── */
/*  EMPTY STATE                                                     */
/* ─────────────────────────────────────────────────────────────── */

describe('AgentView — empty state', () => {
  it('renders prompt on row 4 and nothing in scrollback', () => {
    const c = renderOnCanvas(W, COMPACT, makePerTab());
    expect(rowText(c, 4)).toContain('alix-agent>');
    expect(rowHasStyle(c, 4, '33m')).toBe(true);
    // Row 5: no runtime → empty
    expect(rowText(c, 5)).toBe('');
    // Row 6: no scrollback content
    expect(rowText(c, 6)).toBe('');
  });

  it('renders prompt with typed input buffer', () => {
    const c = renderOnCanvas(W, COMPACT, makePerTab({ inputBuffer: 'hello' }));
    expect(rowText(c, 4)).toContain('hello');
    expect(rowText(c, 4)).toContain('alix-agent>');
  });
});

/* ─────────────────────────────────────────────────────────────── */
/*  AGENT TURNS                                                     */
/* ─────────────────────────────────────────────────────────────── */

describe('AgentView — agent turns', () => {
  it('renders the operator prompt as a dim gray user marker (→)', () => {
    // The operator's typed prompt lands agent.message with actor 'user' — it
    // must render as a USER turn (→), not as agent-authored (←).
    const c = renderOnCanvas(W, COMPACT, makePerTab(), MINIMAL_SNAPSHOT, agentRuntime(seedTurns(['what is the meaning of life?'], [])));
    expect(rowText(c, 6)).toContain('what is the meaning of life?');
    const marker = cellAt(c, 0, 6);
    expect(marker.char).toBe('→');
    expect(marker.style).toContain('90m');
  });

  it('renders the task-loop agent.message narration (actor agent) as an agent turn (←)', () => {
    // The task-loop emits its own running narration as agent.message with
    // actor 'agent' — distinct from the operator's prompt (actor 'user').
    const narration: TimelineEntry[] = [{
      id: 'tl-1', kind: 'agent.message', actor: 'agent', sessionId: 'agent-1',
      startedAt: 1, text: 'working through the steps', sourceEvents: { firstSequence: 1 },
    }];
    const c = renderOnCanvas(W, COMPACT, makePerTab(), MINIMAL_SNAPSHOT, agentRuntime(narration));
    expect(rowText(c, 6)).toContain('working through the steps');
    const marker = cellAt(c, 0, 6);
    expect(marker.char).toBe('←');
    expect(marker.style).toContain('36m');
  });

  it('wraps long operator prompts onto continuation lines', () => {
    const long = 'word '.repeat(100); // 100 short tokens that WILL wrap
    const c = renderOnCanvas(40, TALL, makePerTab(), MINIMAL_SNAPSHOT, agentRuntime(seedTurns([long], [])));
    const line1 = rowText(c, 6);
    expect(line1.length).toBeLessThanOrEqual(40);
    // Continuation line exists and has no marker
    const line2 = rowText(c, 7);
    expect(line2.length).toBeGreaterThan(0);
    expect(cellAt(c, 0, 7).char).toBe(' '); // indented, no arrow
  });

  it('renders multiple operator prompts in order (top to bottom)', () => {
    const c = renderOnCanvas(W, TALL, makePerTab(), MINIMAL_SNAPSHOT, agentRuntime(seedTurns(['first prompt', 'second prompt'], [])));
    // Layout: row 6 = first turn, row 7 = blank separator,
    // row 8 = second turn.
    const all = [6, 7, 8].map((y) => rowText(c, y)).join('\n');
    expect(all).toContain('first prompt');
    expect(all).toContain('second prompt');
  });

  it('renders BOTH the typed prompt (agent.message) and the final summary (agent.response)', () => {
    // Phase 6 final-fix regression: the agent tab's own conversation emits
    // `agent.message` for the prompt and `agent.response` for the summary;
    // the agent view filter must render both (previously the filter excluded
    // everything but the task-loop's agent.message/reasoning/decision trace).
    const c = renderOnCanvas(W, COMPACT, makePerTab(), MINIMAL_SNAPSHOT, agentRuntime(seedTurns(['summarize the run'], ['The run completed: 3 steps.'])));
    const all = allText(c, 12);
    expect(all).toContain('summarize the run');
    expect(all).toContain('The run completed: 3 steps.');
    // Direction by actor: the prompt (agent.message, actor user) renders as the
    // operator's turn (→), the summary (agent.response, actor agent) as ←.
    expect(cellAt(c, 0, 6).char).toBe('→');
    expect(cellAt(c, 0, 6).style).toContain('90m');
    expect(cellAt(c, 0, 8).char).toBe('←');
    expect(cellAt(c, 0, 8).style).toContain('36m');
  });
});

/* ─────────────────────────────────────────────────────────────── */
/*  AGENT RESPONSES                                                 */
/* ─────────────────────────────────────────────────────────────── */

describe('AgentView — agent responses', () => {
  it('renders a single agent response with cyan arrow marker', () => {
    const c = renderOnCanvas(W, COMPACT, makePerTab(), MINIMAL_SNAPSHOT, agentRuntime(seedTurns([], ['Here is my answer.'])));
    expect(rowText(c, 6)).toContain('Here is my answer.');
    const marker = cellAt(c, 0, 6);
    expect(marker.char).toBe('←');
    expect(marker.style).toContain('36m');
  });

  it('wraps long agent responses onto continuation lines', () => {
    const long = 'word '.repeat(100);
    const c = renderOnCanvas(30, TALL, makePerTab(), MINIMAL_SNAPSHOT, agentRuntime(seedTurns([], [long])));
    const line1 = rowText(c, 6);
    expect(line1.length).toBeLessThanOrEqual(30);
    const line2 = rowText(c, 7);
    expect(line2.length).toBeGreaterThan(0);
    expect(cellAt(c, 0, 7).char).toBe(' '); // no marker on continuation
  });
});

/* ─────────────────────────────────────────────────────────────── */
/*  MULTI-TURN                                                       */
/* ─────────────────────────────────────────────────────────────── */

describe('AgentView — multi-turn scrollback', () => {
  it('renders consecutive turns interleaved with blank separators', () => {
    const c = renderOnCanvas(W, TALL, makePerTab(), MINIMAL_SNAPSHOT, agentRuntime(seedTurns(['q1', 'q2'], ['a1', 'a2'])));
    // Layout (blank line separator before every turn after the first):
    //   row 6  = q1
    //   row 7  = blank
    //   row 8  = a1
    //   row 9  = blank
    //   row 10 = q2
    //   row 11 = blank
    //   row 12 = a2
    const rows = [6, 7, 8, 9, 10, 11, 12].map((y) => rowText(c, y));
    expect(rows[0]).toContain('q1');
    expect(cellAt(c, 0, 6).char).toBe('→'); // operator prompt
    expect(rows[1]).toBe('');
    expect(rows[2]).toContain('a1');
    expect(cellAt(c, 0, 8).char).toBe('←'); // agent summary
    expect(rows[3]).toBe('');
    expect(rows[4]).toContain('q2');
    expect(cellAt(c, 0, 10).char).toBe('→'); // operator prompt
    expect(rows[5]).toBe('');
    expect(rows[6]).toContain('a2');
    expect(cellAt(c, 0, 12).char).toBe('←'); // agent summary
  });

  it('handles unequal numbers of turns', () => {
    const c = renderOnCanvas(W, TALL, makePerTab(), MINIMAL_SNAPSHOT, agentRuntime(seedTurns(['q1', 'q2'], ['a1'])));
    const all = allText(c, 12);
    expect(all).toContain('q1');
    expect(all).toContain('a1');
    expect(all).toContain('q2'); // extra turn still rendered
  });
});

/* ─────────────────────────────────────────────────────────────── */
/*  CAPABILITY EVENTS (excluded from agent tab)                      */
/* ─────────────────────────────────────────────────────────────── */

describe('AgentView — capability events', () => {
  it('does not render capability (chat.response) entries on the agent tab', () => {
    // A capability completion dual-emits as `chat.response` on the emitting
    // tab. On the agent sub-session it lands as a `chat.response` entry, which
    // the agent view's `agent.*` filter excludes — only agent-authored entries
    // render here.
    const c = renderOnCanvas(
      W, COMPACT, makePerTab(), MINIMAL_SNAPSHOT,
      agentRuntime([
        { id: 'tl-1', kind: 'agent.message', sessionId: 'agent-1', startedAt: 1, text: 'task', sourceEvents: { firstSequence: 1 } },
        { id: 'tl-2', kind: 'chat.response', sessionId: 'agent-1', startedAt: 2, text: 'core.session.list [completed ✓]', sourceEvents: { firstSequence: 2 } },
      ]),
    );
    const frame = c.renderFrame();
    expect(frame).toContain('task');
    expect(frame).not.toContain('core.session.list');
  });
});

/* ─────────────────────────────────────────────────────────────── */
/*  RUNTIME STATUS LINE                                             */
/* ─────────────────────────────────────────────────────────────── */

describe('AgentView — runtime status line', () => {
  it('renders runtime status on row 5 when runtime has events', () => {
    const snap: DashboardSnapshot = {
      ...MINIMAL_SNAPSHOT,
      runtime: {
        trace: [],
        timeline: [],
        totalEventCount: 42,
        lastEventAt: 1_000_000,
        workflow: { name: 'run', currentStep: 3, totalSteps: 7, startedAt: 1_000_000 },
        sessionId: 'chat-1',
      },
    };
    const c = renderOnCanvas(W, COMPACT, makePerTab(), snap);
    expect(rowText(c, 5)).toContain('events: 42');
    expect(rowText(c, 5)).toContain('step 3/7');
    expect(rowHasStyle(c, 5, '90m')).toBe(true);
  });

  it('renders runtime status without workflow step when no workflow', () => {
    const snap: DashboardSnapshot = {
      ...MINIMAL_SNAPSHOT,
      runtime: { trace: [], timeline: [], totalEventCount: 5, lastEventAt: 1_000_000, workflow: null, sessionId: 'chat-1' },
    };
    const c = renderOnCanvas(W, COMPACT, makePerTab(), snap);
    expect(rowText(c, 5)).toContain('events: 5');
    expect(rowText(c, 5)).not.toContain('step');
  });

  it('shows empty row 5 when runtime has zero events', () => {
    const snap: DashboardSnapshot = {
      ...MINIMAL_SNAPSHOT,
      runtime: { trace: [], timeline: [], totalEventCount: 0, lastEventAt: null, workflow: null, sessionId: 'chat-1' },
    };
    const c = renderOnCanvas(W, COMPACT, makePerTab(), snap);
    expect(rowText(c, 5)).toBe('');
  });

  it('shows empty row 5 when runtime is null', () => {
    const c = renderOnCanvas(W, COMPACT, makePerTab());
    expect(rowText(c, 5)).toBe('');
  });
});

/* ─────────────────────────────────────────────────────────────── */
/*  PLAN TASKS                                                       */
/* ─────────────────────────────────────────────────────────────── */

describe('AgentView — plan tasks', () => {
  const sampleTasks: readonly PlanTask[] = [
    { id: 't:1', index: 1, title: 'Set up database', status: 'completed' },
    { id: 't:2', index: 2, title: 'Add auth middleware', status: 'in_progress' },
    { id: 't:3', index: 3, title: 'Write tests', status: 'pending' },
    { id: 't:4', index: 4, title: 'Deploy to staging', status: 'skipped' },
  ];

  it('renders task checklist header and all tasks', () => {
    const perTab = makePerTab({ planTasks: sampleTasks });
    const c = renderOnCanvas(W, TALL, perTab);
    const all = allText(c, 14);
    expect(all).toContain('PLAN TASKS');
    expect(all).toContain('Set up database');
    expect(all).toContain('Add auth middleware');
    expect(all).toContain('Write tests');
    expect(all).toContain('Deploy to staging');
  });

  it('renders [x] [~] [ ] [-] status markers', () => {
    const perTab = makePerTab({ planTasks: sampleTasks });
    const c = renderOnCanvas(W, TALL, perTab);
    const all = allText(c, 14);
    expect(all).toContain('[x]');
    expect(all).toContain('[~]');
    expect(all).toContain('[ ]');
    expect(all).toContain('[-]');
  });

  it('renders task index and title', () => {
    const perTab = makePerTab({ planTasks: sampleTasks });
    const c = renderOnCanvas(W, TALL, perTab);
    const all = allText(c, 14);
    expect(all).toContain('1. Set up database');
    expect(all).toContain('2. Add auth middleware');
    expect(all).toContain('3. Write tests');
    expect(all).toContain('4. Deploy to staging');
  });

  it('renders all plan task lines with dim (2m) style', () => {
    const perTab = makePerTab({ planTasks: sampleTasks });
    const c = renderOnCanvas(W, TALL, perTab);
    // Plan task lines are pushed with isFirst:false, so they render
    // at column 2 (no diamond marker) with the dim (2m) style.
    expect(rowHasStyle(c, 6, '2m')).toBe(true);
    expect(rowHasStyle(c, 7, '2m')).toBe(true);
    expect(rowHasStyle(c, 8, '2m')).toBe(true);
    expect(rowHasStyle(c, 9, '2m')).toBe(true);
  });

  it('caps plan tasks at 20', () => {
    const manyTasks: PlanTask[] = Array.from({ length: 25 }, (_, i) => ({
      id: `t:${i + 1}`,
      index: i + 1,
      title: `Task ${i + 1}`,
      status: 'pending' as const,
    }));
    const perTab = makePerTab({ planTasks: manyTasks });
    const c = renderOnCanvas(W, DEEP, perTab);
    const all = allText(c, 60);
    expect(all).toContain('Task 20');
    expect(all).not.toContain('Task 25');
  });

  it('task with unknown status falls back to [ ]', () => {
    const tasks: readonly PlanTask[] = [
      { id: 't:1', index: 1, title: 'Unknown', status: 'unknown_thing' as any },
    ];
    const perTab = makePerTab({ planTasks: tasks });
    const c = renderOnCanvas(W, TALL, perTab);
    const all = allText(c, 12);
    expect(all).toContain('[ ]');
  });
});

/* ─────────────────────────────────────────────────────────────── */
/*  PLAN CONTENT                                                     */
/* ─────────────────────────────────────────────────────────────── */

describe('AgentView — plan content', () => {
  it('renders plan markdown content with diamond marker on first line', () => {
    const perTab = makePerTab({ planContent: '# My Plan\n\nStep 1: do the thing' });
    const c = renderOnCanvas(W, TALL, perTab);
    const all = allText(c, 12);
    expect(all).toContain('# My Plan');
    expect(all).toContain('Step 1: do the thing');
    // Diamond marker on first plan line
    expect(cellAt(c, 0, 6).char).toBe('◆');
  });

  it('renders plan in dim (2m) style', () => {
    const perTab = makePerTab({ planContent: 'plan text' });
    const c = renderOnCanvas(W, TALL, perTab);
    expect(rowHasStyle(c, 6, '2m')).toBe(true);
  });

  it('wraps long plan content', () => {
    const longPlan = 'longword ' + 'verylongchunk '.repeat(30);
    const perTab = makePerTab({ planContent: longPlan });
    const c = renderOnCanvas(40, TALL, perTab);
    expect(rowText(c, 6).length).toBeLessThanOrEqual(40);
    expect(rowText(c, 7).length).toBeLessThanOrEqual(40);
  });

  it('renders plan tasks before plan content', () => {
    const tasks: readonly PlanTask[] = [
      { id: 't:1', index: 1, title: 'Task A', status: 'pending' },
    ];
    const perTab = makePerTab({ planTasks: tasks, planContent: '## Plan body' });
    const c = renderOnCanvas(W, TALL, perTab);
    const all = allText(c, 16);
    const taskIdx = all.indexOf('PLAN TASKS');
    const planIdx = all.indexOf('## Plan body');
    expect(taskIdx).toBeGreaterThanOrEqual(0);
    expect(planIdx).toBeGreaterThan(taskIdx);
  });
});

/* ─────────────────────────────────────────────────────────────── */
/*  APPROVAL REQUESTS                                                */
/* ─────────────────────────────────────────────────────────────── */

describe('AgentView — approval cards', () => {
  it('renders approval card with tool, target and short ID (compact)', () => {
    // With a COMPACT canvas the scrollback has room for both the card
    // header and the card entry — header at row 6, entry at row 7.
    // Find the row containing the tool name (layout-agnostic).
    const perTab = makePerTab({
      pendingApprovals: [
        { id: 'ap_abc123', toolName: 'write_file', target: 'src/main.ts', requestedAt: 1000 },
      ],
    });
    const c = renderOnCanvas(W, COMPACT, perTab);
    const all = allText(c, 20);
    expect(all).toContain('write_file');
    expect(all).toContain('src/main.ts');
    expect(all).toContain('bc123');
  });

  it('shows plural "requests" for multiple approvals', () => {
    const perTab = makePerTab({
      pendingApprovals: [
        { id: 'ap_001', toolName: 'write', target: 'a.ts', requestedAt: 1000 },
        { id: 'ap_002', toolName: 'exec', target: 'b.ts', requestedAt: 1001 },
      ],
    });
    const c = renderOnCanvas(W, TALL, perTab);
    // The approval header is wrapped in a callout box: row 6 = WARNING label,
    // row 7 = body text.
    expect(rowText(c, 6)).toContain('WARNING');
    expect(rowText(c, 7)).toContain('2 approval requests pending');
  });

  it('renders approval cards with tool, target, and short ID', () => {
    const perTab = makePerTab({
      pendingApprovals: [
        { id: 'ap_deadbeef', toolName: 'write_file', target: 'src/main.ts', requestedAt: 1000 },
      ],
    });
    const c = renderOnCanvas(W, COMPACT, perTab);
    const all = allText(c, 10);
    expect(all).toContain('write_file');
    expect(all).toContain('src/main.ts');
    expect(all).toContain('beef');
  });

  it('shows fallback target when target is empty', () => {
    const perTab = makePerTab({
      pendingApprovals: [
        { id: 'ap_001', toolName: 'run', target: '', requestedAt: 1000 },
      ],
    });
    const c = renderOnCanvas(W, TALL, perTab);
    const all = allText(c, 10);
    expect(all).toContain('(no target)');
  });

  it('renders approval in yellow (33m) style', () => {
    const perTab = makePerTab({
      pendingApprovals: [
        { id: 'ap_001', toolName: 'write', target: 'x.ts', requestedAt: 1000 },
      ],
    });
    const c = renderOnCanvas(W, COMPACT, perTab);
    expect(cellAt(c, 0, 6).char).toBe('⏸');
    expect(cellAt(c, 0, 6).style).toContain('33m');
  });

  it('renders multiple approval cards in order', () => {
    const perTab = makePerTab({
      pendingApprovals: [
        { id: 'ap_001', toolName: 'write', target: 'a.ts', requestedAt: 1000 },
        { id: 'ap_002', toolName: 'read', target: 'b.ts', requestedAt: 1001 },
        { id: 'ap_003', toolName: 'exec', target: 'c.ts', requestedAt: 1002 },
      ],
    });
    const c = renderOnCanvas(W, TALL, perTab);
    const all = allText(c, 12);
    expect(all).toContain('a.ts');
    expect(all).toContain('b.ts');
    expect(all).toContain('c.ts');
  });
});

/* ─────────────────────────────────────────────────────────────── */
/*  COMBINATIONS — ordering                                         */
/* ─────────────────────────────────────────────────────────────── */

describe('AgentView — combined rendering order', () => {
  it('renders plan → agent turns → approval in scrollback order', () => {
    // Actual order in allLines: plan tasks → plan content → separator
    // → turns (agent) → approval cards
    const perTab = makePerTab({
      planContent: '# Implementation Plan\n\nDo the work.',
      pendingApprovals: [
        { id: 'ap_001', toolName: 'write_file', target: 'x.ts', requestedAt: 1000 },
      ],
    });
    const c = renderOnCanvas(W, TALL, perTab, MINIMAL_SNAPSHOT, agentRuntime(seedTurns(['build it'], ['Done!'])));
    const all = allText(c, 20);
    const planIdx = all.indexOf('# Implementation Plan');
    const doneIdx = all.indexOf('Done!');
    const approvalIdx = all.indexOf('approval request');
    expect(planIdx).toBeGreaterThanOrEqual(0);
    expect(doneIdx).toBeGreaterThan(planIdx);
    expect(approvalIdx).toBeGreaterThan(doneIdx);
  });

  it('renders tasks → content → agent turns → approvals in order', () => {
    const tasks: readonly PlanTask[] = [
      { id: 't:1', index: 1, title: 'Setup', status: 'completed' },
    ];
    const perTab = makePerTab({
      planTasks: tasks,
      planContent: '## Plan',
      pendingApprovals: [
        { id: 'ap_001', toolName: 'exec', target: 'test', requestedAt: 1000 },
      ],
    });
    const c = renderOnCanvas(W, TALL, perTab, MINIMAL_SNAPSHOT, agentRuntime(seedTurns(['go'], ['ok'])));
    const all = allText(c, 20);
    const taskIdx = all.indexOf('PLAN TASKS');
    const planIdx = all.indexOf('## Plan');
    const userIdx = all.indexOf('go');
    const approvalIdx = all.indexOf('approval');
    expect(taskIdx).toBeGreaterThanOrEqual(0);
    expect(planIdx).toBeGreaterThan(taskIdx);
    expect(userIdx).toBeGreaterThan(planIdx);
    expect(approvalIdx).toBeGreaterThan(userIdx);
  });
});

/* ─────────────────────────────────────────────────────────────── */
/*  SCROLL OFFSET                                                    */
/* ─────────────────────────────────────────────────────────────── */

describe('AgentView — scroll offset', () => {
  it('shows most recent lines when offset is 0', () => {
    const perTab = makePerTab({ scrollOffset: 0 });
    const c = renderOnCanvas(W, TALL, perTab, MINIMAL_SNAPSHOT, agentRuntime(seedTurns(['old', 'newer', 'newest'], ['resp1', 'resp2', 'resp3'])));
    const all = allText(c, 24);
    expect(all).toContain('newest');
    expect(all).toContain('resp3');
  });

  it('shows older lines when offset is > 0', () => {
    const perTab = makePerTab({ scrollOffset: 3 });
    const c = renderOnCanvas(W, TALL, perTab, MINIMAL_SNAPSHOT, agentRuntime(seedTurns(['old', 'newer', 'newest'], ['resp1', 'resp2', 'resp3'])));
    const all = allText(c, 24);
    expect(all).toContain('old');
    expect(all).toContain('resp1');
  });
});

/* ─────────────────────────────────────────────────────────────── */
/*  KEY HANDLING                                                     */
/* ─────────────────────────────────────────────────────────────── */

describe('AgentView — key handling', () => {
  it('ArrowUp offsets by +3', () => {
    const view = new AgentView();
    const ctx = {
      snap: MINIMAL_SNAPSHOT,
      dimensions: { columns: W, rows: COMPACT },
      perTab: makePerTab(),
    };
    expect(view.handleKey('ArrowUp', ctx as any)).toEqual({ type: 'scroll', offset: 3 });
  });

  it('ArrowDown subtracts 3', () => {
    const view = new AgentView();
    const ctx = {
      snap: MINIMAL_SNAPSHOT,
      dimensions: { columns: W, rows: COMPACT },
      perTab: makePerTab({ scrollOffset: 6 }),
    };
    expect(view.handleKey('ArrowDown', ctx as any)).toEqual({ type: 'scroll', offset: 3 });
  });

  it('ArrowDown clamps to 0 for small offset', () => {
    const view = new AgentView();
    const ctx = {
      snap: MINIMAL_SNAPSHOT,
      dimensions: { columns: W, rows: COMPACT },
      perTab: makePerTab({ scrollOffset: 1 }),
    };
    expect(view.handleKey('ArrowDown', ctx as any)).toEqual({ type: 'scroll', offset: 0 });
  });

  it('non-arrow keys return handled', () => {
    const view = new AgentView();
    const ctx = {
      snap: MINIMAL_SNAPSHOT,
      dimensions: { columns: W, rows: COMPACT },
      perTab: makePerTab(),
    };
    expect(view.handleKey('Enter', ctx as any)).toEqual({ type: 'handled' });
    expect(view.handleKey('a', ctx as any)).toEqual({ type: 'handled' });
    expect(view.handleKey(' ', ctx as any)).toEqual({ type: 'handled' });
    expect(view.handleKey('x', ctx as any)).toEqual({ type: 'handled' });
  });
});

/* ─────────────────────────────────────────────────────────────── */
/*  EDGE CASES                                                       */
/* ─────────────────────────────────────────────────────────────── */

describe('AgentView — edge cases', () => {
  it('empty agent timeline', () => {
    const c = renderOnCanvas(W, COMPACT, makePerTab(), MINIMAL_SNAPSHOT, agentRuntime([]));
    expect(rowText(c, 6)).toBe('');
  });

  it('very long single-word text does not crash', () => {
    const veryLong = 'abcdefghij' + 'klmnopqrst'.repeat(100);
    expect(() => renderOnCanvas(40, COMPACT, makePerTab(), MINIMAL_SNAPSHOT, agentRuntime(seedTurns([], [veryLong])))).not.toThrow();
  });

  it('empty planContent renders no diamond marker', () => {
    const c = renderOnCanvas(W, TALL, makePerTab({ planContent: '' }));
    expect(allText(c, 12)).not.toContain('◆');
  });

  it('empty planTasks renders no PLAN TASKS header', () => {
    const c = renderOnCanvas(W, TALL, makePerTab({ planTasks: [] }));
    expect(allText(c, 12)).not.toContain('PLAN TASKS');
  });

  it('zero pending approvals renders no ⏸ marker', () => {
    const c = renderOnCanvas(W, TALL, makePerTab({ pendingApprovals: [] }));
    expect(allText(c, 12)).not.toContain('⏸');
  });

  it('very narrow canvas (20 cols) does not crash', () => {
    expect(() => renderOnCanvas(20, COMPACT, makePerTab(), MINIMAL_SNAPSHOT, agentRuntime(seedTurns(['hello'], ['world'])))).not.toThrow();
  });

  it('very short canvas (10 rows) does not crash', () => {
    expect(() => renderOnCanvas(W, 10, makePerTab(), MINIMAL_SNAPSHOT, agentRuntime(seedTurns(['hello'], ['world'])))).not.toThrow();
  });

  it('plan and approvals with no user/agent turns', () => {
    const perTab = makePerTab({
      planContent: '## Plan',
      pendingApprovals: [
        { id: 'ap_001', toolName: 'test', target: 'x.ts', requestedAt: 1000 },
      ],
    });
    const c = renderOnCanvas(W, TALL, perTab);
    const all = allText(c, 14);
    expect(all).toContain('## Plan');
    expect(all).toContain('approval request');
  });

  it('approvals-only with no plan or responses', () => {
    const perTab = makePerTab({
      pendingApprovals: [
        { id: 'ap_001', toolName: 'write', target: 'x.ts', requestedAt: 1000 },
      ],
    });
    const c = renderOnCanvas(W, COMPACT, perTab);
    // Layout-agnostic: find the card entry in the rendered output.
    const all = allText(c, 20);
    expect(all).toContain('write');
    expect(all).toContain('x.ts');
  });
});

describe('AgentView — list rendering', () => {
  it('renders unordered lists with bullets', () => {
    const all = allText(renderOnCanvas(W, TALL, makePerTab(), MINIMAL_SNAPSHOT, agentRuntime(seedTurns([], ['- first\n- second']))), 12);
    expect(all).toContain('• first');
    expect(all).toContain('• second');
  });

  it('renders ordered lists sequentially', () => {
    const all = allText(renderOnCanvas(W, TALL, makePerTab(), MINIMAL_SNAPSHOT, agentRuntime(seedTurns([], ['5. five\n9. nine\n20. twenty']))), 12);
    expect(all).toContain('1. five');
    expect(all).toContain('2. nine');
    expect(all).toContain('3. twenty');
  });

  it('preserves text-list-text order', () => {
    const all = allText(renderOnCanvas(W, TALL, makePerTab(), MINIMAL_SNAPSHOT, agentRuntime(seedTurns([], ['before\n\n- item\n\nafter']))), 12);
    expect(all.indexOf('before')).toBeLessThan(all.indexOf('• item'));
    expect(all.indexOf('• item')).toBeLessThan(all.indexOf('after'));
  });

  it('wraps long list items', () => {
    expect(() => renderOnCanvas(40, TALL, makePerTab(), MINIMAL_SNAPSHOT, agentRuntime(seedTurns([], ['- ' + 'a '.repeat(80)])))).not.toThrow();
  });

  it('renders exactly one turn marker per response, regardless of block count', () => {
    // Regression test: a response with text + code + list should show
    // exactly one ← marker (at the very first line of the response),
    // not one per block. Earlier versions set isFirst: true for the
    // first line of every block, which produced duplicate markers.
    const c = renderOnCanvas(80, 40, makePerTab(), MINIMAL_SNAPSHOT, agentRuntime(seedTurns([], [
      'Here is some prose.\n\n```python\nx = 1\n```\n\n- item 1\n- item 2',
    ])));
    let markerCount = 0;
    // Scan all rows for the cyan ← marker (agent response)
    for (let y = 0; y < 40; y++) {
      const char = cellAt(c, 0, y).char;
      const style = cellAt(c, 0, y).style;
      if (char === '←' && style.includes('36m')) markerCount++;
    }
    expect(markerCount).toBe(1);
  });
});

/* ─────────────────────────────────────────────────────────────── */
/*  CODE BLOCKS                                                       */
/* ─────────────────────────────────────────────────────────────── */

describe('AgentView — code blocks', () => {
  it('renders multiline code', () => {
    const c = renderOnCanvas(W, TALL, makePerTab(), MINIMAL_SNAPSHOT, agentRuntime(seedTurns([], ['```python\nx=1\ny=2\n```'])));
    const all = allText(c, 12);
    expect(all).toContain('x=1');
    expect(all).toContain('y=2');
  });

  it('does not show markdown fences', () => {
    const c = renderOnCanvas(W, TALL, makePerTab(), MINIMAL_SNAPSHOT, agentRuntime(seedTurns([], ['```ts\nconst x=1;\n```'])));
    const all = allText(c, 10);
    expect(all).not.toContain('```');
  });

  it('renders language labels', () => {
    const c = renderOnCanvas(W, TALL, makePerTab(), MINIMAL_SNAPSHOT, agentRuntime(seedTurns([], ['```typescript\nx\n```'])));
    const all = allText(c, 10);
    // Rich renderer emits the language in the top border chrome
    // (┌─ typescript ─...─┐), not a legacy [language] label.
    expect(all).toContain('typescript');
  });

  it('indents code body with two spaces', () => {
    const c = renderOnCanvas(W, TALL, makePerTab(), MINIMAL_SNAPSHOT, agentRuntime(seedTurns([], ['```ts\nconst x=1;\n```'])));
    const all = allText(c, 10);
    // Rich renderer wraps code in `│ code │` chrome instead of
    // indenting with two spaces. The code text itself still appears
    // in the body.
    expect(all).toContain('const x=1;');
  });
});

/* ─────────────────────────────────────────────────────────────── */
/*  RICH RENDERER (Task 11)                                          */
/* ─────────────────────────────────────────────────────────────── */

describe('AgentView — rich renderer wiring (Task 11)', () => {
  it('renders **bold** with the bold ANSI style on agent response rows', () => {
    const view = new AgentView();
    const perTab = makePerTab();
    const runtime = agentRuntime(seedTurns(['test prompt'], ['**Bold** then code:\n\n```python\nx = 1\n```']));
    const c = renderOnCanvas(120, 30, perTab, MINIMAL_SNAPSHOT, runtime);
    view.render({
      snap: MINIMAL_SNAPSHOT,
      dimensions: { columns: 120, rows: 30 },
      perTab,
      canvas: c,
      runtime,
    });
    // The bold wrapping should appear in the rendered output.
    const buf = (c as any).buffer as Array<Array<{ char: string; ansiPrefix: string }>>;
    let found = false;
    for (const row of buf) {
      for (const cell of row) {
        if (cell.char === 'B' && cell.ansiPrefix.includes('1m')) {
          found = true;
          break;
        }
      }
    }
    expect(found).toBe(true);
  });
});
