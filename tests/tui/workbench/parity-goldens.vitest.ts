import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stripAnsi } from '../../../src/tui/box.js';
import { expectGolden, renderAsciiPreviewFrame, renderFullFrame } from './golden-helper.js';

/**
 * Phase-10 parity acceptance goldens (plan item 1: "capture deterministic
 * cell/ANSI goldens ... for reference and responsive matrix", plan:181).
 *
 * Each case renders one named scenario to a cell/ANSI frame and compares it
 * against `__goldens__/<name>.txt`. Regenerate with:
 *   UPDATE_GOLDENS=1 npx vitest run tests/tui/workbench/parity-goldens.vitest.ts
 *
 * The plan §2 coverage IDs live in the parameterized test NAMES (via each
 * case's `ids`), so Phase-10 evidence can attach per-ID pass/fail from test
 * output alone — comments are not enough.
 *
 * Semantic guards run before the golden compare so a vacuous frame can never
 * be generated or accepted, and so failures name the missing element even
 * when the golden file itself is what changed.
 */
interface GoldenCase {
  readonly name: string;
  /** Plan §2 coverage IDs this capture evidences (rendered into the test name). */
  readonly ids: string;
  readonly render: () => string;
  /** Plain-text needles checked against the ANSI-stripped frame. */
  readonly mustContain?: readonly string[];
  /** Plain-text needles that must be absent from the stripped frame. */
  readonly mustNotContain?: readonly string[];
  /** Raw-frame needles (e.g. palette probes) that must be absent. */
  readonly rawMustNotContain?: readonly string[];
}

const ASCII_GLYPH = String.fromCharCode(0x25cf); // ● unicode state dot
const TRUECOLOR_PREFIX = String.fromCharCode(27) + '[38;2;';

/** IDs + needles for the persistent three-pane reference layout (>=160x36). */
const THREE_PANE_IDS =
  'V01-V04, H01-H06, L01-L11, T01-T10/T15-T17, R01-R16, C01-C02, F01-F06';
const THREE_PANE_NEEDLES: readonly string[] = [
  'ALiX WORKBENCH', 'PREVIEW', 'workspace: /workspace',
  'auto', '5 agents • 3 running',
  'AGENTS & TASKS', 'All agents', 'Coordination Run',
  'LIVE TRANSCRIPT', 'Auto-follow: ON', 'AGENT DETAILS', 'frontend-agent',
  'Add your next instruction...',
  'Tab views • Ctrl+O details', 'TOKENS unavailable', 'EVENTS 38', 'AGENTS 5',
];

/** Content + chrome needles that survive every responsive breakpoint >=60 cols. */
const MATRIX_NEEDLES: readonly string[] = [
  'ALiX WORKBENCH', 'LIVE TRANSCRIPT', 'Add your next instruction...',
];

/**
 * One preview-fixture content capture per responsive matrix size from
 * plan:181 ("image pixels do not prescribe terminal columns" — cell/ANSI
 * goldens carry the matrix evidence; only three sizes get fixed-font PNGs).
 * 200x44 is the canonical reference size and keeps the full three-pane +
 * shell content.
 */
const matrixCase = (columns: number, rows: number, ids: string, mustContain: readonly string[] = MATRIX_NEEDLES): GoldenCase => ({
  name: `matrix-${columns}x${rows}`,
  ids,
  render: () => renderFullFrame({ columns, rows, selectAgent: true }),
  mustContain,
});

const cases: readonly GoldenCase[] = [
  {
    // Reference capture: three persistent panes (>=160x36).
    name: 'three-pane-160x36',
    ids: THREE_PANE_IDS,
    render: () => renderFullFrame({ columns: 160, rows: 36, selectAgent: true }),
    mustContain: THREE_PANE_NEEDLES,
  },
  {
    // Responsive matrix: >=120x36 wide breakpoint with the agents drawer as a
    // side pane beside the transcript.
    name: 'side-drawer-120x30',
    ids: 'V02, L01-L11, T01, T04, C01, F01, F05, F06',
    render: () => renderFullFrame({ columns: 120, rows: 30, selectAgent: true, drawer: 'agents' }),
    mustContain: [
      'ALiX WORKBENCH', 'AGENTS & TASKS', 'All agents', 'Coordination Run',
      'LIVE TRANSCRIPT', 'Auto-follow: ON', 'Add your next instruction...',
    ],
  },
  {
    // Responsive matrix: <120 columns makes the open agents drawer a bounded
    // overlay above the transcript.
    name: 'overlay-drawer-110x30',
    ids: 'V02, L01-L11, C01, F01, F05',
    render: () => renderFullFrame({ columns: 110, rows: 30, drawer: 'agents' }),
    mustContain: [
      'ALiX WORKBENCH', 'AGENTS & TASKS', 'All agents', 'Coordination Run',
      'Add your next instruction...',
    ],
  },
  {
    // Narrow matrix: 40x12 keeps chrome, one transcript row and a full-width
    // composer.
    name: 'narrow-40x12',
    ids: 'V02, H01-H03, C01-C02, F05',
    render: () => renderFullFrame({ columns: 40, rows: 12 }),
    mustContain: [
      'ALiX WORKBENCH', 'workspace:', 'LIVE TRANSCRIPT', 'Add your next instruction...', 'Tab views',
    ],
  },
  {
    // Degenerate matrix: 12x6 collapses to chrome + editable composer row.
    // Also serves as plan:181's tiny-window fallback capture.
    name: 'degenerate-12x6',
    ids: 'C01-C02, F05',
    render: () => renderFullFrame({ columns: 12, rows: 6 }),
    mustContain: ['auto', 'Tab views', 'Add you'],
  },
  {
    // Shell-only chrome over the minimal harness snapshot (no roster): honest
    // unavailable counters.
    name: 'shell-chrome-160x36',
    ids: 'H01-H06, F01-F06',
    render: () => renderFullFrame({ columns: 160, rows: 36, content: 'shell' }),
    mustContain: [
      'ALiX WORKBENCH', 'PREVIEW', 'workspace: /workspace',
      'TOKENS unavailable', 'EVENTS 8', 'AGENTS unavailable',
      'Tab views • Ctrl+O details', 'Add your next instruction...', 'pane transcript',
    ],
  },
  {
    // Coordination objective entry overlay (Phase 9 surface inside the
    // responsive shell).
    name: 'coordination-entry-160x36',
    ids: 'L10, F04',
    render: () => renderFullFrame({ columns: 160, rows: 36, overlay: 'coordination' }),
    mustContain: [
      'COORDINATION RUN', 'Objective · mode unavailable · idle',
      'Enter launch · Shift+Enter newline · Esc close', 'ALiX WORKBENCH',
    ],
  },
  {
    // Unpinned transcript window over the first TOOL card: opening timestamps,
    // prose wrap, the verified check and card metadata.
    name: 'transcript-toolcard-160x36',
    ids: 'T05, T09, T10, T12-T14',
    render: () => renderFullFrame({ columns: 160, rows: 36, selectAgent: true, scrollOffset: 10 }),
    mustContain: [
      'LIVE TRANSCRIPT', 'Auto-follow: OFF', '[10:14:21', 'Planning phase complete',
      '✓ 4 agents initialized', 'TOOL alix_file_read', '✓ success',
      'path: src/components/sidebar.tsx', 'requested lines: 1–200', '(142 lines)',
      '├─', 'variants for collapsed and expanded',
    ],
  },
  {
    // ASCII + monochrome substitute coverage via the theme-injectable region
    // painters (chrome, roster, toolbar, inspector).
    name: 'ascii-preview-160x36',
    ids: 'V03-V04',
    render: () => renderAsciiPreviewFrame(),
    mustContain: [
      'ALiX WORKBENCH', 'AGENTS & TASKS', 'LIVE TRANSCRIPT', 'AGENT DETAILS', 'frontend-agent',
      'Tab views . Ctrl+O details',
    ],
    mustNotContain: [ASCII_GLYPH],
    rawMustNotContain: [TRUECOLOR_PREFIX],
  },
  // --- plan:181 golden matrix, remaining sizes (canonical first) ---
  {
    // 200x44 canonical reference: full three-pane + shell content. This is
    // also one of the three fixed-font PNG captures.
    name: 'canonical-200x44',
    ids: THREE_PANE_IDS,
    render: () => renderFullFrame({ columns: 200, rows: 44, selectAgent: true }),
    mustContain: THREE_PANE_NEEDLES,
  },
  // >=160 columns: three persistent panes.
  matrixCase(180, 40, THREE_PANE_IDS, THREE_PANE_NEEDLES),
  // 120-159 columns: center plus one side region; other surfaces overlay.
  matrixCase(159, 36, 'V02, H01-H06, T01, T04, C01, F01, F05, F06'),
  matrixCase(140, 32, 'V02, H01-H06, T01, T04, C01, F01, F05, F06'),
  // 80-119 columns: center primary, side surfaces overlay.
  matrixCase(119, 30, 'V02, H01-H06, T01, T04, C01, F01, F05'),
  matrixCase(100, 28, 'V02, H01-H06, T01, T04, C01, F01, F05'),
  matrixCase(80, 24, 'V02, H01-H06, T01, T04, C01, F01, F05'),
  // <80 columns: single surface, compact metadata.
  matrixCase(79, 24, 'V02, H01-H03, C01-C02, F05'),
  matrixCase(60, 20, 'V02, H01-H03, C01-C02, F05'),
];

describe('Phase 10 Workbench parity goldens', () => {
  for (const golden of cases) {
    it(`${golden.name} matches its checked-in cell/ANSI golden [${golden.ids}]`, () => {
      const rendered = golden.render();
      expect(rendered.length).toBeGreaterThan(0);
      const plain = stripAnsi(rendered);
      for (const needle of golden.mustContain ?? []) {
        expect(plain, `"${golden.name}" must contain ${JSON.stringify(needle)}`).toContain(needle);
      }
      for (const needle of golden.mustNotContain ?? []) {
        expect(plain, `"${golden.name}" must not contain ${JSON.stringify(needle)}`).not.toContain(needle);
      }
      for (const needle of golden.rawMustNotContain ?? []) {
        expect(rendered, `"${golden.name}" raw frame must not contain ${JSON.stringify(needle)}`).not.toContain(needle);
      }
      expectGolden(golden.name, rendered);
    });
  }
});

/**
 * Fixed-font screenshot evidence (plan:360 + plan:213): existence gate only —
 * no pixel comparison. The PNGs and their capture-settings.md are evidence
 * artifacts regenerated manually via `python3 tests/manual/render-golden-png.py`.
 */
describe('Phase 10 fixed-font screenshot evidence', () => {
  const PNG_CAPTURES = ['canonical-200x44', 'three-pane-160x36', 'ascii-preview-160x36'] as const;
  const goldenDir = fileURLToPath(new URL('./__goldens__/', import.meta.url));

  it('capture-settings.md and the three PNG captures exist and are non-empty', () => {
    const settings = `${goldenDir}capture-settings.md`;
    expect(existsSync(settings), `missing ${settings} - regenerate with: python3 tests/manual/render-golden-png.py`).toBe(true);
    if (existsSync(settings)) expect(statSync(settings).size).toBeGreaterThan(0);
    for (const name of PNG_CAPTURES) {
      const png = `${goldenDir}png/${name}.png`;
      expect(existsSync(png), `missing ${png} - regenerate with: python3 tests/manual/render-golden-png.py`).toBe(true);
      if (existsSync(png)) expect(statSync(png).size, `${name}.png is empty`).toBeGreaterThan(0);
    }
  });
});
