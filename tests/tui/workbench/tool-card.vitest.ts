import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AlixEvent } from '../../../src/runtime-state/events/types.js';
import { stripAnsi } from '../../../src/interfaces/tui/box.js';
import { displayWidth } from '../../../src/interfaces/tui/terminal-text.js';
import { buildWorkbenchToolCardLines } from '../../../src/interfaces/tui/workbench/views/tool-card.js';
import type { ToolItem } from '../../../src/interfaces/tui/workbench/model/transcript-item.js';
import { getWorkbenchPreviewTheme } from '../../../src/interfaces/tui/workbench/model/preview-theme.js';
import { IncrementalExecutionTraceBuilder } from '../../../src/interfaces/tui/runtime/execution-trace-builder.js';
import { ConversationProjection } from '../../../src/interfaces/tui/workbench/projections/conversation-projection.js';

function tool(overrides: Partial<ToolItem> = {}): ToolItem {
  return { id: 'call-row', name: 'file.read', status: 'completed', startedAt: 1,
    sourceEvents: { firstSequence: 1, lastSequence: 3 },
    metadata: { toolCallId: 'call-1', path: 'src/components/sidebar.tsx', requestedRange: { startLine: 1, endLine: 200 }, observedLineCount: 142 },
    ...overrides };
}
const plain = (rows: ReturnType<typeof buildWorkbenchToolCardLines>): string[] => rows.map((row) => stripAnsi(row.text));

describe('bounded Workbench tool cards', () => {
  it('renders requested and observed facts in distinct columns inside a complete outline', () => {
    const rows = buildWorkbenchToolCardLines(tool(), { width: 116, indent: 41 });
    const text = plain(rows).join('\n');
    expect(text).toContain('TOOL file.read');
    expect(text).toContain('✓ success');
    expect(text).toContain('path: src/components/sidebar.tsx');
    expect(text).toContain('requested lines: 1–200');
    expect(text).toContain('(142 lines)');
    expect(text).toContain('│ │');
    expect(rows[0]?.text).toContain('├─');
    expect(rows[0]?.text).toContain('╭');
    expect(rows.at(-1)?.text).toContain('└─');
    expect(rows.at(-1)?.text).toContain('╰');
    expect(plain(rows).every((line) => displayWidth(line) === 116)).toBe(true);
    expect(new Set(rows.map((row) => row.itemId))).toEqual(new Set(['tool:call-row']));
    expect(rows.map((row) => row.wrappedOffset)).toEqual(rows.map((_, index) => index));
  });
  it.each([
    ['running', '→ running'], ['completed', '✓ success'], ['failed', '✗ failed'], ['cancelled', '○ cancelled'],
  ] as const)('renders authoritative %s lifecycle independently', (status, expected) => {
    const text = plain(buildWorkbenchToolCardLines(tool({ status }), { width: 80 })).join('\n');
    expect(text).toContain(expected);
    expect(text.match(/TOOL/g)).toHaveLength(1);
  });
  it('keeps unknown counts distinct from known zero and never recounts detail', () => {
    const unknown = tool({ metadata: { toolCallId: 'call-1', requestedRange: { startLine: 1, endLine: 200 } }, detail: 'first\nsecond\nthird' });
    const text = plain(buildWorkbenchToolCardLines(unknown, { width: 90, mode: 'detailed' })).join('\n');
    expect(text).toContain('lines unavailable');
    expect(text).toContain('requested lines: 1–200');
    expect(text).not.toContain('(3 lines)');
    expect(plain(buildWorkbenchToolCardLines(tool({ metadata: { toolCallId: 'call-1', observedLineCount: 0 } }), { width: 90 })).join('\n')).toContain('(0 lines)');
  });
  it('expands within the same invocation identity with bounded detail', () => {
    const item = tool({ detail: 'output\n'.repeat(100000) });
    const compact = buildWorkbenchToolCardLines(item, { width: 90 });
    const expanded = buildWorkbenchToolCardLines(item, { width: 90, mode: 'detailed' });
    expect(expanded.length).toBeGreaterThan(compact.length);
    expect(expanded.length).toBeLessThan(24);
    expect(new Set(expanded.map((row) => row.itemId))).toEqual(new Set(compact.map((row) => row.itemId)));
    expect(plain(expanded).join('\n')).toContain('[output truncated]');
  });
  it('escapes terminal controls, bounds large paths and never changes source metadata', () => {
    const item = tool({ name: '\x1b[2Jfile.read\x1b]52;c;stolen\x07', metadata: { toolCallId: 'call', path: `src/\x1b[31m${'界a/'.repeat(10000)}` }, detail: '\x1b]8;;https://host/\x07output\x1b[?25l' });
    const rows = buildWorkbenchToolCardLines(item, { width: 36, mode: 'detailed', theme: getWorkbenchPreviewTheme('monochrome', 'ascii') });
    expect(rows.length).toBeLessThan(24);
    expect(rows.every((row) => displayWidth(row.text) <= 36)).toBe(true);
    expect(rows.some((row) => row.text.includes('\x1b'))).toBe(false);
    expect(plain(rows).join('\n')).not.toContain('stolen');
    expect(item.metadata?.path).toContain('\x1b[31m');
  });
  it.each([1, 2, 4, 8, 12, 24, 35, 72, 116])('clips every row at %i columns with ASCII monochrome', (width) => {
    const rows = buildWorkbenchToolCardLines(tool({ name: 'long '.repeat(40), detail: 'failure output '.repeat(100), status: 'failed' }), { width, indent: 41, mode: 'detailed', theme: getWorkbenchPreviewTheme('monochrome', 'ascii') });
    expect(rows.every((row) => displayWidth(row.text) <= width)).toBe(true);
    expect(rows.every((row) => !/[╭╰╮╯│─✓✗→…]/.test(row.text))).toBe(true);
  });
  it('annotates running approval only, without relabeling completed calls', () => {
    expect(plain(buildWorkbenchToolCardLines(tool({ status: 'running' }), { width: 80, approvalPending: true })).join('\n')).toContain('approval required');
    expect(plain(buildWorkbenchToolCardLines(tool(), { width: 80, approvalPending: true })).join('\n')).not.toContain('approval required');
  });
});

it('renders both event-backed reference cards with explicit concept display labels', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../fixtures/tui/workbench-preview-events.json', import.meta.url), 'utf8')) as { events: AlixEvent[]; transcriptGroups: { category: string; toolCallId?: string; displayLabel?: string }[] };
  const trace = new IncrementalExecutionTraceBuilder(); trace.update(fixture.events);
  const items = new ConversationProjection().project({ timeline: [], trace: trace.snapshot(), mode: 'compact' }).items;
  const tools = items.flatMap((item) => item.kind === 'tool-group' ? item.tools : []);
  for (const group of fixture.transcriptGroups.filter((group) => group.category === 'tool')) {
    const item = tools.find((item) => item.metadata?.toolCallId === group.toolCallId)!;
    expect(item).toBeDefined();
    const rows = buildWorkbenchToolCardLines(item, { width: 116, indent: 41, displayLabel: group.displayLabel });
    const text = plain(rows).join('\n');
    expect(text).toContain(`TOOL ${group.displayLabel}`);
    expect(text).toContain('✓ success');
    expect(text).toContain(group.toolCallId === 'read-sidebar' ? '(142 lines)' : '(287 lines)');
  }
  const write = tools.find((item) => item.metadata?.toolCallId === 'write-sidebar-completed')!;
  expect(write.name).toBe('alix_patch_apply');
  expect(plain(buildWorkbenchToolCardLines(write, { width: 116 })).join('\n')).toContain('TOOL alix_patch_apply');
});


it('keeps requested metadata visible after long path clipping and bounds very large known counts', () => {
  const item = tool({ metadata: { toolCallId: 'large', path: 'very-long-path/'.repeat(10000), requestedRange: { startLine: 1, endLine: 200 }, observedLineCount: Number.MAX_SAFE_INTEGER } });
  const rows = buildWorkbenchToolCardLines(item, { width: 116, indent: 41 });
  expect(plain(rows).join('\n')).toContain('requested lines: 1–200');
  expect(plain(rows).every((row) => displayWidth(row) === 116)).toBe(true);
});
