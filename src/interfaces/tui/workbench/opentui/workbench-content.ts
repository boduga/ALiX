import { BoxRenderable, StyledText, TextRenderable, bg, bold, fg, type CliRenderer } from '@opentui/core';
import { getWorkbenchAgentPresentation, getWorkbenchPreviewTheme } from '../model/preview-theme.js';
import { formatByteSize, formatCoordMeta, taskStateGlyph } from '../model/display-format.js';
import type { OperatorShellSnapshot } from '../model/operator-shell.js';
import { visibleArtifacts, visibleForRun } from '../model/selection.js';
import { transcriptItemMatchesFilter } from '../model/transcript-filter.js';
import type { ConversationSnapshot, TranscriptItem } from '../model/transcript-item.js';
import { displayWidth, truncateDisplayText, wrapDisplayText } from '../render/terminal-text.js';
import { renderResponse } from '../../blocks/render.js';
import type { WorkbenchRegion } from '../layout/responsive-layout.js';
import type { WorkbenchViewState } from '../view-state/types.js';
import { buildAgentInspectorSections } from '../views/agent-inspector.js';
import { buildWorkbenchApprovalCardLines } from '../views/approval-dialog.js';
import { buildOperatorStatusSegments } from '../views/operator-shell.js';
import { buildWorkbenchToolCardLines } from '../views/tool-card.js';
import type { ComposerLayout } from '../views/composer-view.js';
import type { OpenTuiWorkbenchLayout } from './workbench-layout.js';

const COLORS = {
  background: '#08151b', foreground: '#e6edf3', muted: '#9cb4ca',
  cyan: '#06c9ef', green: '#3df451', yellow: '#ffc63d',
  purple: '#b169ee', teal: '#08e3b5', red: '#ff636e',
  divider: '#547b91', selection: '#06313d',
} as const;
const ACTIVITY_STATUS: Readonly<Record<string, string>> = {
  starting: 'STARTING', thinking: 'RUNNING', tool_running: 'RUNNING', verifying: 'VERIFYING',
  waiting: 'WAITING', waiting_dependency: 'WAITING', waiting_approval: 'APPROVAL',
  completed: 'COMPLETED', partial: 'PARTIAL', failed: 'FAILED', cancelled: 'CANCELLED',
};

type Color = keyof typeof COLORS;
interface NativePart { readonly text: string; readonly color?: Color; readonly background?: Color; readonly bold?: boolean }
interface NativeLine { readonly text: string; readonly color?: Color; readonly fill?: boolean; readonly parts?: readonly NativePart[] }

function styledLines(lines: readonly NativeLine[], width: number): StyledText {
  const chunks = lines.flatMap((line, index) => {
    let remaining = width;
    const styled = (line.parts ?? [{ text: line.text, color: line.color }]).flatMap(part => {
      if (remaining <= 0) return [];
      const clipped = truncateDisplayText(part.text, remaining);
      remaining -= displayWidth(clipped);
      const colored = fg(COLORS[part.color ?? line.color ?? 'foreground'])(clipped);
      const chunk = part.bold ? bold(colored) : colored;
      return [part.background || line.fill ? bg(COLORS[part.background ?? 'selection'])(chunk) : chunk];
    });
    if (line.fill && remaining > 0) styled.push(bg(COLORS.selection)(fg(COLORS.foreground)(' '.repeat(remaining))));
    if (index < lines.length - 1) styled.push(fg(COLORS.foreground)('\n'));
    return styled;
  });
  return new StyledText(chunks);
}

export type ContentState = Pick<WorkbenchViewState, 'header' | 'footer' | 'roster' | 'transcript' | 'selection' | 'overlay' | 'inspector' | 'composer' | 'approval'>;

export type OpenTuiClickAction =
  | { readonly type: 'focus.set'; readonly focus: 'composer' | 'transcript' }
  | { readonly type: 'agent.select'; readonly agentId?: string; readonly scrollOffset: number }
  | { readonly type: 'task.select'; readonly taskId: string; readonly agentId?: string; readonly scrollOffset: number }
  | { readonly type: 'artifact.select'; readonly artifactId: string; readonly runId?: string; readonly agentId?: string; readonly taskId?: string; readonly scrollOffset: number }
  | { readonly type: 'artifact.open'; readonly artifactId: string }
  | { readonly type: 'drawer.toggle'; readonly drawer: 'artifacts' }
  | { readonly type: 'inspector.open' }
  | { readonly type: 'tab.next' }
  | { readonly type: 'turn.cancel' }
  | { readonly type: 'overlay.close' }
  | { readonly type: 'approval.resolve'; readonly approvalId: string; readonly decision: 'approved' | 'denied' }
  | { readonly type: 'agentRoster.toggle' }
  | { readonly type: 'coordination.inspect' }
  | { readonly type: 'transcript.filter'; readonly filter: ContentState['transcript']['filter'] }
  | { readonly type: 'transcript.follow.toggle' };

export interface OpenTuiWorkbenchContent {
  readonly header: TextRenderable;
  readonly footer: TextRenderable;
  readonly roster: TextRenderable;
  readonly transcript: TextRenderable;
  readonly overlay: TextRenderable;
  readonly inspector: TextRenderable;
  readonly composer: TextRenderable;
  readonly approval: BoxRenderable;
  readonly resolvedScrollRows: number;
  rosterClickTarget(row: number, surface?: 'roster' | 'overlay'): OpenTuiClickAction | undefined;
  transcriptClickTarget(column: number, row: number): OpenTuiClickAction | undefined;
  inspectorClickTarget(row: number): OpenTuiClickAction | undefined;
  footerClickTarget(column: number, row: number): OpenTuiClickAction | undefined;
  approvalClickTarget(column: number, row: number): OpenTuiClickAction | undefined;
  update(state: ContentState): void;
  dispose(): void;
}

function safe(text: string): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x09\x0b-\x1f\x7f]/g, ' ');
}

function safeLine(text: string): string {
  return safe(text).replaceAll('\n', ' ');
}

/** Accumulates width-clipped, height-bounded region content plus its row actions. */
class BoundedLines {
  private readonly lines: string[] = [];
  private readonly actions: Array<OpenTuiClickAction | undefined> = [];
  constructor(private readonly width: number, private readonly height: number) {}
  get full(): boolean {
    return this.lines.length >= this.height;
  }
  get length(): number {
    return this.lines.length;
  }
  /** Append unsafe text, sanitized to a single line and clipped to width. */
  push(text: string, action?: OpenTuiClickAction): void {
    if (!this.full) {
      this.lines.push(truncateDisplayText(safeLine(text), this.width));
      this.actions.push(action);
    }
  }
  /** Append already-safe text, clipped to width. */
  pushSafe(text: string, action?: OpenTuiClickAction): void {
    if (!this.full) {
      this.lines.push(truncateDisplayText(text, this.width));
      this.actions.push(action);
    }
  }
  /** Insert before an existing row, keeping each row's action aligned. */
  insert(index: number, text: string, action?: OpenTuiClickAction): void {
    if (this.full) return;
    this.lines.splice(index, 0, truncateDisplayText(safeLine(text), this.width));
    this.actions.splice(index, 0, action);
  }
  at(index: number): string | undefined {
    return this.lines[index];
  }
  value(): string[] {
    return this.lines;
  }
  targets(): ReadonlyArray<OpenTuiClickAction | undefined> {
    return this.actions;
  }
}

function contentSize(box: BoxRenderable, region: WorkbenchRegion | null): { width: number; height: number; inset: number } {
  const inset = box.border ? 1 : 0;
  return { width: Math.max(0, (region?.width ?? 0) - inset * 2), height: Math.max(0, (region?.height ?? 0) - inset * 2), inset };
}

function placeText(text: TextRenderable, box: BoxRenderable, region: WorkbenchRegion | null): { width: number; height: number } {
  const { width, height } = contentSize(box, region);
  const horizontalInset = box.id !== 'opentui-composer' && box.border && width >= 3 ? 1 : 0;
  text.left = horizontalInset;
  text.top = 0;
  text.width = Math.max(1, width - horizontalInset * 2);
  text.height = Math.max(1, height);
  text.fg = COLORS.foreground;
  text.bg = COLORS.background;
  text.visible = box.visible && width > 0 && height > 0;
  return { width: Math.max(0, width - horizontalInset * 2), height };
}

function rosterLines(state: ContentState, width: number, height: number): { lines: string[]; targets: ReadonlyArray<OpenTuiClickAction | undefined> } {
  const empty = { lines: [] as string[], targets: [] as ReadonlyArray<OpenTuiClickAction | undefined> };
  if (height === 0 || width === 0) return empty;
  const roster = state.roster.agents;
  const out = new BoundedLines(width, height);
  if (!roster) {
    out.push('AGENTS & TASKS');
    out.push('');
    out.push('Roster unavailable');
    return { lines: out.value(), targets: out.targets() };
  }
  const agents = visibleForRun(roster.agents, state.selection.selectedRunId);
  const running = agents.filter(agent => ['starting', 'thinking', 'tool_running', 'verifying'].includes(agent.state)).length;
  out.push('AGENTS & TASKS');
  out.push('');
  out.push('○ All agents  /', { type: 'agent.select', scrollOffset: 0 });
  out.push(`  ${agents.length} agents • ${running} running`);
  out.push('─'.repeat(width));
  if (state.selection.selectedRunId) out.insert(2, `RUN ${state.selection.selectedRunId}`);
  if (!state.overlay.agentRosterExpanded) {
    out.push('Enter to expand roster', { type: 'agentRoster.toggle' });
    return { lines: out.value(), targets: out.targets() };
  }
  if (agents.length === 0) {
    out.push('No subagents');
    out.push('─'.repeat(width));
    out.push('○ Coordination Run  c', { type: 'coordination.inspect' });
    out.push('  Start a coordinated run', { type: 'coordination.inspect' });
    return { lines: out.value(), targets: out.targets() };
  }
  const theme = getWorkbenchPreviewTheme();
  const agentLine = (agent: typeof agents[number], index: number): string => {
    const status = getWorkbenchAgentPresentation(agent.state, theme);
    const selected = agent.agentId === state.selection.selectedAgentId ? '›' : ' ';
    const label = truncateDisplayText(safeLine(`${selected}${status.glyph} ${agent.assignedAgentId ?? agent.role}  ${status.label}`), Math.max(1, width - 3));
    return index < 9 && width >= 6 ? `${label}${' '.repeat(Math.max(1, width - displayWidth(label) - 1))}${index + 1}` : label;
  };
  const selectedAgent = agents.find(agent => agent.agentId === state.selection.selectedAgentId);
  if (height <= 2 && selectedAgent) {
    const target: OpenTuiClickAction = { type: 'agent.select', agentId: selectedAgent.agentId, scrollOffset: 0 };
    const short = new BoundedLines(width, height);
    if (height >= 2) short.push('AGENTS & TASKS');
    short.push(agentLine(selectedAgent, agents.indexOf(selectedAgent)), target);
    return { lines: short.value(), targets: short.targets() };
  }
  const selectedIndex = agents.findIndex(agent => agent.agentId === state.selection.selectedAgentId);
  const capacity = Math.max(1, Math.floor((height - out.length - 3) / 3));
  let offset = Math.max(0, Math.min(agents.length - 1, state.overlay.drawerScrollOffset));
  if (selectedIndex >= 0) offset = Math.max(Math.min(offset, selectedIndex), selectedIndex - capacity + 1);
  for (const [index, agent] of agents.slice(offset).entries()) {
    if (out.full) break;
    const target: OpenTuiClickAction = { type: 'agent.select', agentId: agent.agentId, scrollOffset: Math.max(0, index + offset - 1) };
    out.push(agentLine(agent, index + offset), target);
    out.push(truncateDisplayText(safeLine(`  ${agent.taskLabel ?? agent.currentOperation ?? 'Task unavailable'}`), width), target);
    out.push('');
  }
  if (out.length + 3 <= height) {
    out.push('─'.repeat(width));
    out.push('○ Coordination Run  c', { type: 'coordination.inspect' });
    out.push('  Start a coordinated run', { type: 'coordination.inspect' });
  }
  return { lines: out.value(), targets: out.targets() };
}

/**
 * Markdown for transcript prose.
 *
 * The ANSI Workbench already renders assistant/user text through
 * `renderResponse` (`src/interfaces/tui/blocks/render.ts`), which parses and
 * lays out headings, quotes, rules, lists, code and TABLES into bounded rows.
 * The native renderer used to print the raw source, so `**bold**` and the
 * `| --- |` separator row leaked into the transcript. Reusing that renderer
 * keeps ONE markdown implementation across both renderers instead of a second,
 * divergent one.
 *
 * `renderResponse` emits ANSI SGR runs; this maps them onto the native palette
 * so the rows carry colors without a second styling system. Text, color and
 * bold all survive; anything unmapped degrades to plain foreground rather than
 * being dropped.
 */
const ANSI_COLOR: Record<number, Color> = {
  31: 'red', 32: 'green', 33: 'yellow', 34: 'cyan',
  35: 'purple', 36: 'cyan', 90: 'muted',
};
const TRUECOLOR: Readonly<Record<string, Color>> = {
  '230;237;243': 'foreground', '156;180;202': 'muted',
  '6;201;239': 'cyan', '61;244;81': 'green',
  '255;198;61': 'yellow', '177;105;238': 'purple',
  '8;227;181': 'teal', '255;99;110': 'red',
  '84;123;145': 'divider', '8;21;27': 'background',
};

/** Split an ANSI-styled row into native parts, stripping every SGR sequence. */
export function ansiRowToNativeParts(row: string): NativePart[] {
  const parts: NativePart[] = [];
  let color: Color | undefined;
  let background: Color | undefined;
  let bold = false;
  let buffer = '';
  const flush = (): void => {
    if (buffer.length === 0) return;
    parts.push({ text: buffer, ...(color ? { color } : {}), ...(background ? { background } : {}), ...(bold ? { bold: true } : {}) });
    buffer = '';
  };
  // eslint-disable-next-line no-control-regex
  const sgr = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = sgr.exec(row)) !== null) {
    buffer += row.slice(last, match.index);
    last = sgr.lastIndex;
    flush();
    const codes = match[1]!.split(';').map(Number);
    for (let index = 0; index < codes.length; index++) {
      const code = codes[index]!;
      if (code === 0) { color = undefined; background = undefined; bold = false; }
      else if (code === 1) bold = true;
      else if (code === 2) color = 'muted';
      else if (code === 22) bold = false;
      else if (code === 39) color = undefined;
      else if (code === 49) background = undefined;
      else if (code === 38 && codes[index + 1] === 2 && codes.length > index + 4) {
        color = TRUECOLOR[`${codes[index + 2]};${codes[index + 3]};${codes[index + 4]}`];
        index += 4;
      } else if (code === 48 && codes[index + 1] === 2 && codes.length > index + 4) {
        background = TRUECOLOR[`${codes[index + 2]};${codes[index + 3]};${codes[index + 4]}`];
        index += 4;
      }
      else if (ANSI_COLOR[code]) color = ANSI_COLOR[code];
    }
  }
  buffer += row.slice(last);
  flush();
  if (parts.length === 0) parts.push({ text: '' });
  return parts;
}

/** Markdown-aware transcript rows for prose items. */
function proseRows(text: string, width: number): NativeLine[] {
  try {
    const rows = renderResponse(text, Math.max(8, width));
    if (rows.length === 0) return [{ text: '' }];
    return rows.map(row => ({ text: row.text, parts: ansiRowToNativeParts(row.text) }));
  } catch {
    // Never let a markdown edge case blank the transcript.
    return wrapDisplayText(safeLine(text), Math.max(1, width)).map(line => ({ text: line }));
  }
}

/** Local wall-clock `HH:MM:SS`. `toISOString()` is UTC and read wrong next to the operator's clock. */
function localTimeLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0 || ms > 8640000000000000) return '--:--:--';
  const date = new Date(ms);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Transcript gutter width. Kept tight so prose starts near its responder. */
const ACTOR_COLUMN = 8;

function itemLines(item: TranscriptItem, errorOnly: boolean, detailed: boolean, height: number, width: number, actor: string, approval?: ContentState['approval'][number], totalPending = 0): NativeLine[] {
  const time = localTimeLabel(item.startedAt);
  const prefix = `[${time}] ${actor.padEnd(ACTOR_COLUMN, ' ')} `;
  const gutter = ' '.repeat(prefix.length);
  const plain = (text: string, color?: Color): NativeLine[] => wrapDisplayText(safeLine(text), Math.max(1, width)).map(line => ({ text: line, ...(color ? { color } : {}) }));
  /** Prefix the first row, align the rest under it. */
  const lead = (rows: NativeLine[]): NativeLine[] => {
    if (rows.length === 0) return [];
    const [first, ...rest] = rows as [NativeLine, ...NativeLine[]];
    return [
      { text: `${prefix}${first.text}`, parts: [{ text: prefix, color: 'muted' }, ...(first.parts ?? [{ text: first.text }])] },
      ...rest.map(row => ({ text: `${gutter}${row.text}`, ...(row.parts ? { parts: [{ text: gutter, color: 'muted' as const }, ...row.parts] } : { color: row.color }) })),
    ];
  };

  switch (item.kind) {
    case 'user': return lead(proseRows(item.text, Math.max(8, width - prefix.length)));
    case 'assistant': return lead(proseRows(item.text, Math.max(8, width - prefix.length)));
    case 'activity': return lead(plain(`${item.verifiedOutcome === 'success' ? '✓ ' : item.verifiedOutcome === 'failure' ? '✗ ' : ''}${item.status ? `${ACTIVITY_STATUS[item.status] ?? item.status.toUpperCase()}  ` : ''}${item.text}`));
    case 'approval': return approval
      ? lead(buildWorkbenchApprovalCardLines(approval, totalPending, Math.max(12, width - prefix.length)).map(text => ({ text, color: 'yellow' })))
      : lead(plain(`APPROVAL  ${item.text}`, 'yellow'));
    case 'diagnostic': return lead(plain(`${item.severity.toUpperCase()}  ${item.text}`, item.severity === 'error' ? 'red' : 'yellow'));
    case 'phase': return lead(plain(`PHASE  ${item.phase}`, 'purple'));
    case 'plan': return [
      ...(item.text ? lead(plain(`PLAN  ${item.text}`, 'purple')) : []),
      ...item.tasks.slice(0, 20).flatMap(task => plain(`[${task.status}] ${task.index}. ${task.title}`)),
    ];
    case 'tool-group': return item.tools
      .filter(tool => !errorOnly || tool.status === 'failed')
      .slice(-height)
      .flatMap(tool => {
        // indent 0 drops the `│ ├─ └─` connector column (tool-card.ts only
        // draws the guide at indent >= 2). Native rows receive the same actor
        // gutter as response prose, once per row.
        const card = buildWorkbenchToolCardLines(tool, {
          width: Math.max(8, width - prefix.length), mode: detailed ? 'detailed' : 'compact', indent: 0,
        });
        return card.slice(0, height).map(line => {
          // Indent the card once. Prefixing EVERY styled run would insert
          // spaces inside the card and break its column alignment.
          const parts = ansiRowToNativeParts(line.text);
          const indented = parts.length > 0
            ? [{ ...parts[0]!, text: `${gutter}${parts[0]!.text}` }, ...parts.slice(1)]
            : [{ text: gutter }];
          return { text: `${gutter}${safeLine(line.text)}`, parts: indented };
        });
      });
  }
}

function transcriptLines(state: ContentState, conversation: ConversationSnapshot, width: number, height: number): { lines: NativeLine[]; resolvedScrollRows: number } {
  if (height === 0 || width === 0) return { lines: [], resolvedScrollRows: 0 };
  const { transcript, selection } = state;
  const scrollRows = transcript.followTail ? 0 : Math.max(0, Math.floor(transcript.scrollRowsFromTail ?? 0));
  const neededRows = height + scrollRows;
  const visible = (item: TranscriptItem): boolean =>
    transcriptItemMatchesFilter(item, transcript.filter) &&
    (transcript.scope !== 'selected' || !selection.selectedAgentId || !item.agentId || item.agentId === selection.selectedAgentId || item.kind === 'approval');
  const lines: NativeLine[] = [];
  const roster = state.roster.agents?.agents ?? [];
  const items = conversation.items;
  let inlineApprovalRendered = false;
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]!;
    if (!visible(item)) continue;
    const agent = roster.find(entry => entry.agentId === item.agentId);
    const actor = item.kind === 'user' ? 'YOU' : agent?.assignedAgentId ?? agent?.role ?? item.agentId ?? 'ALiX';
    const pendingApproval = item.kind === 'approval' ? state.approval[0] : undefined;
    const itemContent = itemLines(item, transcript.filter === 'error', transcript.mode === 'detailed', neededRows, width, actor, pendingApproval, state.approval.length);
    if (pendingApproval) inlineApprovalRendered = true;
    const color: Color = item.kind === 'tool-group' ? item.tools.some(tool => tool.status === 'failed') ? 'red' : 'cyan'
      : item.kind === 'activity' ? item.verifiedOutcome === 'failure' ? 'red' : item.verifiedOutcome === 'success' ? 'green' : 'muted'
        : item.kind === 'diagnostic' ? item.severity === 'error' ? 'red' : 'yellow'
          : item.kind === 'approval' ? 'yellow' : item.kind === 'plan' ? 'purple' : 'foreground';
    // Rows arrive already wrapped and styled (markdown prose carries parts), so
    // they are clipped and pushed directly instead of re-wrapped here.
    for (let contentIndex = itemContent.length - 1; contentIndex >= 0 && lines.length < neededRows; contentIndex--) {
      const row = itemContent[contentIndex]!;
      const text = truncateDisplayText(row.text, width);
      if (row.parts) {
        let remaining = width;
        const parts: NativePart[] = [];
        for (const part of row.parts) {
          if (remaining <= 0) break;
          const clipped = truncateDisplayText(part.text, remaining);
          remaining -= displayWidth(clipped);
          parts.push({ ...part, text: clipped });
        }
        lines.push({ text, parts });
      } else {
        lines.push({ text, color });
      }
    }
    if (lines.length >= neededRows) break;
  }
  if (lines.length === 0 && !state.approval[0]) return { lines: [{ text: 'No conversation yet', color: 'muted' }], resolvedScrollRows: 0 };
  if (state.approval[0] && !inlineApprovalRendered) {
    const pending = state.approval[0];
    const prefix = `[${localTimeLabel(pending.requestedAt)}] ${'ALiX'.padEnd(ACTOR_COLUMN, ' ')} `;
    const gutter = ' '.repeat(prefix.length);
    const card = buildWorkbenchApprovalCardLines(pending, state.approval.length, Math.max(12, width - prefix.length))
      .map((text, index): NativeLine => ({ text: `${index === 0 ? prefix : gutter}${text}`, color: 'yellow' }));
    // `lines` is newest-first while collecting. Reserve room for this newest
    // response card, then prepend it in reverse row order before final layout.
    const reserve = Math.min(neededRows, card.length);
    if (lines.length > neededRows - reserve) lines.splice(neededRows - reserve);
    lines.unshift(...card.reverse());
  }
  if (lines.length === 0) return { lines: [{ text: 'No conversation yet', color: 'muted' }], resolvedScrollRows: 0 };
  return {
    lines: lines.reverse().slice(0, height),
    resolvedScrollRows: lines.length < neededRows ? Math.max(0, lines.length - height) : scrollRows,
  };
}

function tasksLines(state: ContentState, width: number, height: number): { lines: string[]; targets: ReadonlyArray<OpenTuiClickAction | undefined> } {
  const empty = { lines: [] as string[], targets: [] as ReadonlyArray<OpenTuiClickAction | undefined> };
  if (height === 0 || width === 0) return empty;
  const tasks = state.roster.tasks;
  if (!tasks) return { lines: ['Tasks unavailable'], targets: empty.targets };
  const scoped = visibleForRun(tasks.tasks, state.selection.selectedRunId);
  const countStates = (states: readonly string[]): number => scoped.filter(task => states.includes(task.state)).length;
  const out = new BoundedLines(width, height);
  out.push(`${countStates(['running'])} running · ${countStates(['waiting_dependency', 'waiting_approval'])} waiting · ${countStates(['blocked'])} blocked · ${countStates(['queued', 'assigned'])} queued`);
  out.push(`RUN ${state.selection.selectedRunId ?? 'all'} · [ ] switch`);
  if (scoped.length === 0) {
    out.push('No delegated tasks');
    return { lines: out.value(), targets: out.targets() };
  }
  for (const [index, task] of scoped.entries()) {
    if (out.full) break;
    const selected = task.taskId === state.selection.selectedTaskId;
    const action: OpenTuiClickAction = { type: 'task.select', taskId: task.taskId, agentId: task.agentId, scrollOffset: Math.max(0, index - 1) };
    out.push(`${selected ? '›' : ' '}${taskStateGlyph(task.state)} ${task.title}`, action);
    out.push(`  ${task.state.toUpperCase().replaceAll('_', ' ')}${task.agentId ? ` · agent ${task.agentId}` : ''}`, action);
    if (!selected) continue;
    const details = [
      formatCoordMeta(task) ?? '',
      task.blockReason ? `BLOCKED · ${task.blockReason}` : '',
      task.currentOperation && task.currentOperation !== task.title ? task.currentOperation : '',
      task.ownedPaths.length ? `owns ${task.ownedPaths.join(', ')}` : '',
      task.dependencyIds?.length ? `Depends on ${task.dependencyIds.join(', ')}` : '',
    ];
    for (const detail of details) if (detail) out.push(`    ${detail}`, action);
  }
  return { lines: out.value(), targets: out.targets() };
}

function artifactsLines(state: ContentState, width: number, height: number): { lines: string[]; targets: ReadonlyArray<OpenTuiClickAction | undefined> } {
  const empty = { lines: [] as string[], targets: [] as ReadonlyArray<OpenTuiClickAction | undefined> };
  if (height === 0 || width === 0) return empty;
  const artifacts = state.roster.artifacts;
  if (!artifacts) return { lines: ['Artifacts unavailable'], targets: empty.targets };
  const items = visibleArtifacts(artifacts.items, {
    runId: state.selection.selectedRunId,
    agentId: state.selection.selectedAgentId,
    taskId: state.selection.selectedTaskId,
  });
  const out = new BoundedLines(width, height);
  out.push(`${artifacts.artifacts} files · ${artifacts.results} results`);
  out.push(`RUN ${state.selection.selectedRunId ?? 'all'} · [ ] switch`);
  if (items.length === 0) {
    out.push('No artifacts or results');
    return { lines: out.value(), targets: out.targets() };
  }
  for (const [index, item] of items.entries()) {
    if (out.full) break;
    const selected = item.id === state.selection.selectedArtifactId;
    const marker = item.status === 'failed' ? '✗' : item.status === 'unavailable' ? '!' : item.kind === 'artifact' ? '◆' : '✓';
    const action: OpenTuiClickAction = {
      type: 'artifact.select', artifactId: item.id, runId: item.coordinationRunId,
      agentId: item.agentId, taskId: item.taskId, scrollOffset: Math.max(0, index - 1),
    };
    out.push(`${selected ? '›' : ' '}${marker} ${item.title}`, action);
    if (!selected) continue;
    const details = [
      [item.artifactType ?? item.kind, item.agentId ? `agent ${item.agentId}` : '', item.taskId ? `task ${item.taskId}` : ''].filter(Boolean).join(' · '),
      item.uri ?? '',
      [item.mediaType ?? '', item.sizeBytes !== undefined ? formatByteSize(item.sizeBytes) : '', item.digest ? `digest ${item.digest.slice(0, 12)}` : ''].filter(Boolean).join(' · '),
      ...(item.preview ? item.preview.split(/\r?\n/).slice(0, 5).map(line => `  ${line}`) : []),
    ];
    for (const detail of details) if (detail) out.push(`  ${detail}`, action);
  }
  return { lines: out.value(), targets: out.targets() };
}

function drawerLines(state: ContentState, width: number, height: number): { lines: string[]; targets: ReadonlyArray<OpenTuiClickAction | undefined> } {
  switch (state.overlay.drawer) {
    case 'tasks': return tasksLines(state, width, height);
    case 'artifacts': return artifactsLines(state, width, height);
    default: return rosterLines(state, width, height);
  }
}

function chromeCount(value: number | undefined): string {
  return value === undefined ? 'unavailable' : value.toLocaleString('en-US');
}

interface ChromeRun {
  readonly text: string;
  readonly color: Color;
}

/** Row-0 facts in the canonical precedence: mode, warnings, then counters. */
function headerFactRuns(model: OperatorShellSnapshot): ChromeRun[] {
  const runs: ChromeRun[] = [{ text: model.mode, color: model.mode === 'bypass' ? 'red' : model.mode === 'ask' ? 'green' : 'yellow' }];
  const agents = model.agents;
  if (agents?.waitingApproval) {
    runs.push({ text: `${agents.waitingApproval} ${agents.waitingApproval === 1 ? 'approval' : 'approvals'}`, color: 'yellow' });
  }
  if (agents?.stalled) runs.push({ text: `${agents.stalled} stalled`, color: 'yellow' });
  if (agents) runs.push({ text: `${agents.total} agents • ${agents.running} running`, color: 'green' });
  return runs;
}

function runsWidth(runs: readonly ChromeRun[]): number {
  return runs.reduce((sum, run) => sum + displayWidth(run.text), 0) + Math.max(0, runs.length - 1) * 3;
}

/**
 * Three-row native header mirroring the canonical ANSI band: row 0 carries the
 * brand, badge and the workspace/mode/warning/counter groups; row 1 carries the
 * top status line; row 2 stays reserved blank.
 */
function headerLines(model: OperatorShellSnapshot, width: number, height: number, now: number): NativeLine[] {
  if (height === 0 || width === 0) return [];
  const brand = width >= 20 ? 'ALiX WORKBENCH' : width >= 6 ? 'ALiX' : '';
  const badge = model.demo ? 'CONCEPT PREVIEW' : 'PREVIEW';
  const facts = headerFactRuns(model);
  // Under width pressure the canonical band keeps mode and drops the optional
  // groups from the right; workspace gives up its tail before either.
  let factsWidth = runsWidth(facts);
  while (factsWidth > width / 2 && facts.length > 1) {
    facts.pop();
    factsWidth = runsWidth(facts);
  }
  const pathRoom = Math.max(0, width - displayWidth(brand) - displayWidth(badge) - factsWidth - 8);
  const path = truncateDisplayText(safeLine(model.workspace), Math.max(0, pathRoom));
  const leftParts: NativePart[] = [];
  if (brand) leftParts.push({ text: brand, color: 'cyan', bold: true });
  leftParts.push({ text: `  ${badge}`, color: 'muted' });
  const rightParts: NativePart[] = [];
  if (path) rightParts.push({ text: 'workspace: ', color: 'muted' }, { text: path, color: 'cyan' });
  facts.forEach((run, index) => {
    if (index > 0 || path) rightParts.push({ text: '  |  ', color: 'muted' });
    rightParts.push({ text: run.text, color: run.color });
  });
  const leftText = leftParts.map(part => part.text).join('');
  const rightText = rightParts.map(part => part.text).join('');
  const rows: NativeLine[] = [];
  const room = width - displayWidth(leftText) - displayWidth(rightText);
  const paddedLeft = room > 0 ? [...leftParts, { text: ' '.repeat(room), color: 'muted' as const }] : leftParts;
  const topRow: NativeLine = { text: truncateDisplayText(safeLine(`${leftText}${' '.repeat(Math.max(0, room))}${rightText}`), width), parts: room > 0 ? [...paddedLeft, ...rightParts] : undefined };
  if (room <= 0) {
    // Narrow band: brand row, then the facts on their own row.
    rows.push({ text: truncateDisplayText(safeLine(leftText), width), parts: leftParts });
    if (height > 1) rows.push({ text: truncateDisplayText(safeLine(rightText), width), parts: rightParts });
  } else {
    rows.push(topRow);
  }
  if (height > 1 && model.status) {
    const statusParts: NativePart[] = buildOperatorStatusSegments(model.status, now).map(segment => ({
      text: segment.text,
      color: segment.tone === 'approval-wait' || segment.tone === 'warning' ? 'yellow' : segment.tone === 'running' ? 'cyan' : 'muted',
    }));
    const statusText = statusParts.map(part => part.text).join('');
    rows.push({ text: truncateDisplayText(safeLine(statusText), width), parts: statusParts });
  }
  return rows.slice(0, height);
}

interface ColumnTarget { readonly start: number; readonly end: number; readonly action: OpenTuiClickAction }
interface FooterRow { readonly text: string; readonly targets: readonly ColumnTarget[] }

/**
 * One footer hint list drives both the painted text and its hit targets, so a
 * hint is never clickable without being advertised (or vice versa).
 */
function footerHints(model: OperatorShellSnapshot): ReadonlyArray<{ readonly text: string; readonly action?: OpenTuiClickAction }> {
  const escapeText = model.escapeAction === 'close' ? 'Esc close' : model.running ? 'Esc cancel' : model.focus === 'transcript' ? 'Esc type' : '';
  const escapeHint: { readonly text: string; readonly action?: OpenTuiClickAction } = {
    text: escapeText,
    // Each Escape label means what its key means; it never resolves a decision.
    ...(model.escapeAction === 'close' ? { action: { type: 'overlay.close' } }
      : model.running ? { action: { type: 'turn.cancel' } }
        : model.focus === 'transcript' ? { action: { type: 'focus.set', focus: 'composer' } } : {}),
  };
  if (model.approval) {
    return [
      { text: `${model.approval.count} ${model.approval.count === 1 ? 'approval' : 'approvals'}` },
      { text: model.approval.toolName },
      { text: 'a approve' },
      { text: 'd deny' },
      escapeHint,
    ];
  }
  const transcript = model.focus === 'transcript';
  return [
    transcript ? { text: 'Ctrl+F type', action: { type: 'focus.set', focus: 'composer' } }
      : { text: 'Tab views', action: { type: 'tab.next' } },
    { text: 'Ctrl+O details', action: { type: 'inspector.open' } },
    { text: 'Ctrl+R artifacts', action: { type: 'drawer.toggle', drawer: 'artifacts' } },
    ...(model.focus === 'composer' ? [{ text: 'Ctrl+F transcript', action: { type: 'focus.set', focus: 'transcript' } as const }] : []),
    ...(model.queuedMessages > 0 ? [{ text: `${model.queuedMessages} queued` }] : []),
    escapeHint,
  ];
}

function footerLines(model: OperatorShellSnapshot, width: number, height: number): FooterRow[] {
  if (height === 0 || width === 0) return [];
  const hints = footerHints(model).filter(hint => hint.text.length > 0);
  const counters = [
    `TOKENS ${chromeCount(model.tokensUsed)}`,
    `FILES ${chromeCount(model.filesTouched)}`,
    `EVENTS ${chromeCount(model.eventCount)}`,
    `AGENTS ${model.agents?.total ?? 'unavailable'}`,
  ];
  const left = hints.map(hint => hint.text).join('  •  ');
  const right = counters.join('  |  ');
  const gap = Math.max(2, width - left.length - right.length);
  const text = truncateDisplayText(safeLine(`${left}${' '.repeat(gap)}${right}`), width);
  const targets: ColumnTarget[] = [];
  let column = 0;
  for (const hint of hints) {
    if (!hint.action) { column += displayWidth(hint.text) + 5; continue; }
    targets.push({ start: column, end: column + displayWidth(hint.text), action: hint.action });
    column += displayWidth(hint.text) + 5;
  }
  return [{ text, targets }].slice(0, Math.max(1, height));
}

interface InspectorRow { readonly line: NativeLine; readonly action?: OpenTuiClickAction }

/**
 * Native inspector rows carry the action of the shared section that produced
 * them. Artifact rows resolve their identity from the shared artifact list, so
 * a painter change cannot silently retarget a click.
 */
function inspectorLines(state: ContentState, width: number, height: number): InspectorRow[] {
  if (height === 0 || width === 0) return [];
  const out: InspectorRow[] = [];
  const palette = getWorkbenchPreviewTheme().palette;
  const push = (line: NativeLine, action?: OpenTuiClickAction): void => { if (out.length < height) out.push({ line, action }); };
  for (const [index, section] of buildAgentInspectorSections(state.inspector).entries()) {
    if (out.length >= height) break;
    if (index > 0) push({ text: '─'.repeat(width), color: 'divider' });
    push({ text: section.title, color: 'cyan' });
    push({ text: '' });
    const artifacts = section.title === 'ARTIFACTS' ? state.inspector.artifacts ?? [] : undefined;
    let artifactIndex = 0;
    for (const row of section.rows) {
      if (out.length >= height) break;
      const label = row.label ? row.label.padEnd(Math.min(12, Math.max(1, width - 1)), ' ') : '';
      const value = safeLine(row.value);
      const color: Color = row.color === palette.green ? 'green' : row.color === palette.yellow ? 'yellow'
        : row.color === palette.red ? 'red' : row.color === palette.purple ? 'purple' : 'foreground';
      const rendered: NativeLine = { text: `${label}${value}`, parts: label ? [{ text: label, color: 'muted' }, { text: value, color }] : [{ text: value, color }] };
      // Only artifact rows carry an action; section headings are structure,
      // not controls, and the inspector pane is already visible.
      const artifact = artifacts?.[artifactIndex++];
      push(rendered, artifact ? { type: 'artifact.open', artifactId: artifact.id } : undefined);
    }
  }
  if (out.length === 0) return [{ line: { text: 'Inspector unavailable' } }];
  return out;
}

function composerLines(state: ContentState, composer: ComposerLayout, width: number, height: number): string[] {
  if (height === 0 || width === 0) return [];
  const empty = state.composer.composer.text.length === 0;
  const prefixWidth = Math.min(2, Math.max(1, width - 1));
  const rows = composer.rows.slice(0, height);
  return rows.map((row, index) => {
    const prefix = (index === 0 ? (composer.hiddenRows > 0 ? '…' : '>') : ' ').padEnd(prefixWidth, ' ');
    const content = empty && index === 0 ? 'Add your next instruction...' : row;
    return truncateDisplayText(safeLine(`${prefix}${content}`), width);
  });
}

/** Retained native content; semantic selection and filtering come from WorkbenchViewState. */
export function mountOpenTuiWorkbenchContent(renderer: CliRenderer, layout: OpenTuiWorkbenchLayout, initial: ContentState): OpenTuiWorkbenchContent {
  const make = (id: string, parent: BoxRenderable): TextRenderable => {
    const node = new TextRenderable(renderer, { id, position: 'absolute', width: 1, height: 1, content: '', fg: COLORS.foreground, bg: COLORS.background, wrapMode: 'none' });
    parent.add(node);
    return node;
  };
  const header = make('opentui-header-content', layout.regions.header);
  const footer = make('opentui-footer-content', layout.regions.footer);
  const roster = make('opentui-roster-content', layout.regions.roster);
  const transcript = make('opentui-transcript-content', layout.regions.transcript);
  const overlay = make('opentui-overlay-content', layout.regions.overlay);
  const inspector = make('opentui-inspector-content', layout.regions.inspector);
  const composer = make('opentui-composer-content', layout.regions.composer);
  const approval = new BoxRenderable(renderer, { id: 'opentui-approval', position: 'absolute', left: 0, top: 0, width: 1, height: 1, backgroundColor: '#101820' });
  layout.shell.add(approval);
  const approvalText = new TextRenderable(renderer, { id: 'opentui-approval-content', content: '' });
  approval.add(approvalText);
  let pausedConversation: ConversationSnapshot | undefined;
  let lastConversation: ConversationSnapshot | undefined;
  let resolvedScrollRows = 0;
  let rosterClickTargets: ReadonlyArray<OpenTuiClickAction | undefined> = [];
  let overlayClickTargets: ReadonlyArray<OpenTuiClickAction | undefined> = [];
  let inspectorClickTargets: ReadonlyArray<OpenTuiClickAction | undefined> = [];
  let transcriptClickTargets: Array<{ row: number; start: number; end: number; action: OpenTuiClickAction }> = [];
  let footerClickTargets: Array<{ row: number; start: number; end: number; action: OpenTuiClickAction }> = [];
  let approvalClickTargets: Array<{ row: number; start: number; end: number; action: OpenTuiClickAction }> = [];
  const update = (state: ContentState): void => {
    const headerSize = placeText(header, layout.regions.header, layout.geometry.regions.header);
    const footerSize = placeText(footer, layout.regions.footer, layout.geometry.regions.footer);
    const rosterSize = placeText(roster, layout.regions.roster, layout.geometry.regions.roster);
    const transcriptSize = placeText(transcript, layout.regions.transcript, layout.geometry.regions.transcript);
    const overlaySize = placeText(overlay, layout.regions.overlay, layout.geometry.regions.overlay);
    const inspectorSize = placeText(inspector, layout.regions.inspector, layout.geometry.regions.inspector);
    const composerSize = placeText(composer, layout.regions.composer, layout.geometry.regions.composer);
    header.content = styledLines(headerLines(state.header, headerSize.width, headerSize.height, Date.now()), headerSize.width);
    const footerRows = footerLines(state.footer, footerSize.width, footerSize.height);
    footerClickTargets = footerRows.flatMap((row, index) => row.targets.map(target => ({ row: index, ...target })));
    footer.content = styledLines(footerRows.map(row => {
      const counterAt = row.text.indexOf('TOKENS ');
      return { text: row.text, parts: counterAt < 0 ? [{ text: row.text, color: 'muted' as const }] : [
        { text: row.text.slice(0, counterAt), color: 'cyan' as const }, { text: row.text.slice(counterAt), color: 'muted' as const },
      ] };
    }), footerSize.width);
    const rosterBody = state.overlay.drawer === 'closed'
      ? rosterLines(state, rosterSize.width, rosterSize.height)
      : drawerLines(state, rosterSize.width, rosterSize.height);
    rosterClickTargets = rosterBody.targets;
    roster.content = styledLines(rosterBody.lines.map((line, index) => ({
      text: line,
      color: /^(AGENTS & TASKS|TASKS|ARTIFACTS)$/.test(line) ? 'cyan'
        : line.startsWith('›') ? 'cyan'
          : /FAILED/.test(line) ? 'red' : /WAITING|APPROVAL/.test(line) ? 'yellow'
            : /RUNNING|VERIFYING/.test(line) ? 'green' : /COMPLETED/.test(line) ? 'purple'
              : line.startsWith('  ') ? 'muted' : 'foreground',
      fill: line.startsWith('›') || (rosterBody.lines[index - 1]?.startsWith('›') && line.startsWith('  ')),
    })), rosterSize.width);
    if (state.transcript.followTail) pausedConversation = undefined;
    else pausedConversation ??= lastConversation ?? state.transcript.conversation;
    const categories = ['ALL', 'RESPONSE', 'TOOL', 'ACTIVITY', 'ERROR'] as const;
    const toolbarSegments = categories.map((category, index) => {
      const active = category.toLowerCase() === state.transcript.filter;
      return { label: active ? `[${category}]` : category, gap: index === categories.length - 1 ? '' : '  ', active, filter: category.toLowerCase() as ContentState['transcript']['filter'] };
    });
    const followValue = state.transcript.followTail ? 'ON' : 'OFF';
    const followParts: NativePart[] = [
      { text: 'Auto-follow: ', color: 'muted' },
      { text: followValue, color: state.transcript.followTail ? 'green' : 'yellow' },
    ];
    const followLabel = followParts.map(part => part.text).join('');
    const toolbarParts: NativePart[] = toolbarSegments.flatMap(segment => [
      { text: segment.label, color: segment.active ? 'background' : 'muted', ...(segment.active ? { background: 'cyan' as const } : {}) },
      { text: segment.gap, color: 'muted' },
    ]);
    const toolbar = toolbarParts.map(part => part.text).join('');
    const heading = 'LIVE TRANSCRIPT';
    const toolbarColumn = Math.max(0, Math.floor((transcriptSize.width - displayWidth(toolbar)) / 2));
    const followColumn = Math.max(0, transcriptSize.width - displayWidth(followLabel));
    const toolbarOnHeading = displayWidth(heading) + 2 <= toolbarColumn
      && toolbarColumn + displayWidth(toolbar) + 2 <= followColumn;
    transcriptClickTargets = [];
    let clickColumn = toolbarColumn;
    const toolbarRow = toolbarOnHeading ? 0 : 1;
    for (const segment of toolbarSegments) {
      transcriptClickTargets.push({
        row: toolbarRow, start: clickColumn, end: clickColumn + displayWidth(segment.label),
        action: { type: 'transcript.filter', filter: segment.filter },
      });
      clickColumn += displayWidth(segment.label) + displayWidth(segment.gap);
    }
    transcriptClickTargets.push({
      row: 0, start: followColumn,
      end: followColumn + displayWidth(followLabel),
      action: { type: 'transcript.follow.toggle' },
    });
    const headingGap = toolbarOnHeading ? toolbarColumn - displayWidth(heading) : followColumn - displayWidth(heading);
    const rowZeroParts: NativePart[] = [{ text: heading, color: 'cyan' }];
    if (headingGap > 0) rowZeroParts.push({ text: ' '.repeat(headingGap) });
    if (toolbarOnHeading) {
      rowZeroParts.push(...toolbarParts);
      const followGap = followColumn - toolbarColumn - displayWidth(toolbar);
      if (followGap > 0) rowZeroParts.push({ text: ' '.repeat(followGap) });
    }
    rowZeroParts.push(...followParts);
    const rowZero = rowZeroParts.map(part => part.text).join('');
    const transcriptChrome: NativeLine[] = toolbarOnHeading
      ? [{ text: rowZero, parts: rowZeroParts }, { text: '' }]
      : [{ text: rowZero, parts: rowZeroParts }, {
        text: `${' '.repeat(toolbarColumn)}${toolbar}`,
        parts: [{ text: ' '.repeat(toolbarColumn) }, ...toolbarParts],
      }, { text: '' }];
    const transcriptWindow = transcriptLines(
      state, pausedConversation ?? state.transcript.conversation, transcriptSize.width, Math.max(0, transcriptSize.height - transcriptChrome.length),
    );
    resolvedScrollRows = transcriptWindow.resolvedScrollRows;
    transcript.content = styledLines([
      ...transcriptChrome,
      ...transcriptWindow.lines,
    ].slice(0, transcriptSize.height), transcriptSize.width);
    lastConversation = state.transcript.conversation;
    const inspectorBody = inspectorLines(state, inspectorSize.width, inspectorSize.height);
    inspectorClickTargets = inspectorBody.map(entry => entry.action);
    inspector.content = styledLines(inspectorBody.map(entry => entry.line), inspectorSize.width);
    composer.content = styledLines(composerLines(state, layout.composer, composerSize.width, composerSize.height).map(line => ({ text: line, color: line.startsWith('>') ? 'cyan' : 'foreground' })), composerSize.width);
    const overlayBody = state.overlay.drawer !== 'closed' ? drawerLines(state, overlaySize.width, overlaySize.height) : undefined;
    overlayClickTargets = overlayBody?.targets ?? [];
    overlay.content = overlayBody ? styledLines(overlayBody.lines.map(line => ({ text: line })), overlaySize.width) : '';
    // Agent approvals are rendered inline with their response in the
    // transcript; a floating card here detached the decision from its call.
    approvalClickTargets = [];
    approval.visible = false;
    approvalText.content = '';
  };
  update(initial);
  let disposed = false;
  return {
    header, footer, roster, transcript, overlay, inspector, composer, approval, update,
    get resolvedScrollRows() { return resolvedScrollRows; },
    rosterClickTarget: (row, surface = 'roster') =>
      row >= 0 ? (surface === 'roster' ? rosterClickTargets : overlayClickTargets)[row] : undefined,
    transcriptClickTarget: (column, row) =>
      column >= 0 && column < transcript.width && row >= 0 && row < transcript.height
        ? transcriptClickTargets.find(target => target.row === row && column >= target.start && column < target.end)?.action : undefined,
    inspectorClickTarget: (row) => row >= 0 && row < inspector.height ? inspectorClickTargets[row] : undefined,
    footerClickTarget: (column, row) => column >= 0 && column < footer.width && row >= 0 && row < footer.height
      ? footerClickTargets.find(target => target.row === row && column >= target.start && column < target.end)?.action : undefined,
    approvalClickTarget: (column, row) => approval.visible && column >= 0 && column < approval.width && row >= 0 && row < approval.height
      ? approvalClickTargets.find(target => target.row === row && column >= target.start && column < target.end)?.action : undefined,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      layout.regions.header.remove(header);
      layout.regions.footer.remove(footer);
      layout.regions.roster.remove(roster);
      layout.regions.transcript.remove(transcript);
      layout.regions.overlay.remove(overlay);
      layout.regions.inspector.remove(inspector);
      layout.regions.composer.remove(composer);
      layout.shell.remove(approval);
      header.destroy();
      footer.destroy();
      roster.destroy();
      transcript.destroy();
      overlay.destroy();
      inspector.destroy();
      composer.destroy();
      approval.destroy();
    },
  };
}
