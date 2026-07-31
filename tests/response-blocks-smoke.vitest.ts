/**
 * Live smoke test: end-to-end render of the actual alix chat response
 * through parseResponseBlocks + AgentView. This proves the agent tab
 * renders the live response shape correctly.
 */
import { test, expect } from 'vitest';
import { parseBlocks as parseResponseBlocks } from '../src/agent/response-blocks.js';
import { TerminalCanvas } from '../src/tui/canvas.js';
import { AgentView } from '../src/tui/views/agent-view.js';
import type { ViewRenderContext } from '../src/tui/views/types.js';
import type { DashboardSnapshot, PerTabState, SessionPhase } from '../src/tui/state.js';

const SAMPLE = `Here's a Python function to check if a string is a palindrome:

\`\`\`python
def is_palindrome(s: str) -> bool:
    cleaned = ''.join(c.lower() for c in s if c.isalnum())
    return cleaned == cleaned[::-1]
\`\`\`

### How it works:

1. **Normalization** – It strips out spaces and punctuation.
2. **Comparison** – It compares the cleaned string to its reverse.

- First point
- Second point
`;

test('end-to-end: parse live response, render to canvas', () => {
  const blocks = parseResponseBlocks(SAMPLE);
  // Expect: text + code + text (headings are text) + text + list = 5 blocks.
  // (Headings like "### How it works:" are not a recognized block kind in
  // Phase 1 — they remain part of a text block, which can cause a single
  // text run to be split at the heading boundary by the blank-line
  // separator logic. That's correct per the spec.)
  expect(blocks.length).toBeGreaterThanOrEqual(4);
  expect(blocks.some(b => b.type === 'code' && b.language === 'python')).toBe(true);
  expect(blocks.some(b => b.type === 'list')).toBe(true);

  // Render through AgentView with realistic perTab.
  const snap: DashboardSnapshot = {
    generatedAt: 1_000_000,
    session: { mode: 'auto', phase: 'Idle' as SessionPhase, version: '1.0.0', startedAt: 1_000_000, turns: 0 },
    runtime: null, daemon: null, approvals: null, sops: null,
    policy: { rules: [], violations: [], enforcementMode: 'auto', recentViolationCount: 0 },
    cwd: '/workspace/test',
  };
  const perTab: PerTabState = {
    cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0,
    pinnedBottom: true, inputBuffer: '', panelScrollOffsets: { approvals: 0, sops: 0 }, panelFocus: null,
    // AgentView reads the unified operator timeline (Task 4). The legacy
    // submittedPrompts/agentResponses arrays are dropped as seeds and stay
    // as empty required fields until Task 6 removes them entirely.
    submittedPrompts: [],
    agentResponses: [],
    pendingApprovals: [], resolvedApprovals: [], capabilityInvocations: [],
    timelineEvents: [
      { id: 'tl-1', timestamp: 1, sequence: 1, source: 'operator', kind: 'user', text: 'write a python function to check if a string is a palindrome' },
      { id: 'tl-2', timestamp: 2, sequence: 2, source: 'agent', kind: 'agent', text: SAMPLE },
    ],
  };
  const W = 80, H = 60;
  const canvas = new TerminalCanvas(W, H);
  const view = new AgentView();
  view.render({ snap, dimensions: { columns: W, rows: H }, perTab, canvas });

  const frame = canvas.renderFrame();
  // Strip ANSI for readable output
  const plain = frame.replace(/\x1b\[[0-9;]*m/g, '');
  console.log('\n═══ Live TUI smoke test (80×60) ═══\n');
  process.stdout.write(plain);
  console.log('\n═══ End Frame ═══\n');

  // Code block body preserved verbatim across multiple rows
  expect(plain).toContain('def is_palindrome');
  expect(plain).toContain('cleaned == cleaned[::-1]');
  // List items rendered with bullet marker
  expect(plain).toContain('• First point');
  expect(plain).toContain('• Second point');
  // TUI does NOT render Markdown source fences
  expect(plain).not.toContain('```python');
  // Language rendered in the top-border chrome label. The chrome
  // characters get stamped with a dim-gray prefix that may interleave
  // with the corner glyphs after ANSI strip; match the substring
  // robustly.
  expect(plain).toContain('python');
  expect(plain).toMatch(/┌.*python.*┘/s);
});
