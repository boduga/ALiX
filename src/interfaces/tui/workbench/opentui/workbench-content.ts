import { BoxRenderable, StyledText, TextRenderable, bg, bold, fg, type CliRenderer } from '@opentui/core';
import { getWorkbenchAgentPresentation, getWorkbenchPreviewTheme } from '../model/preview-theme.js';
import { formatByteSize, formatCoordMeta, taskStateGlyph } from '../model/display-format.js';
import type { OperatorShellSnapshot } from '../model/operator-shell.js';
import { visibleArtifacts, visibleForRun } from '../model/selection.js';
import { transcriptItemMatchesFilter } from '../model/transcript-filter.js';
import type { ConversationSnapshot, TranscriptItem } from '../model/transcript-item.js';
import { displayWidth, truncateDisplayText, wrapDisplayText } from '../render/terminal-text.js';
import type { WorkbenchRegion } from '../layout/responsive-layout.js';
import type { WorkbenchViewState } from '../view-state/types.js';
import { buildAgentInspectorSections } from '../views/agent-inspector.js';
import { buildWorkbenchApprovalCardLines } from '../views/approval-dialog.js';
import { buildWorkbenchToolCardLines } from '../views/tool-card.js';
import type { ComposerLayout } from '../views/composer-view.js';
import type { OpenTuiWorkbenchLayout } from './workbench-layout.js';

/** Maximum characters retained from one transcript item before wrapping. */
const MAX_ITEM_CHARS = 4;
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

/** Accumulates width-clipped, height-bounded region content. */
class BoundedLines {
  private readonly lines: string[] = [];
  constructor(private readonly width: number, private readonly height: number) {}
  get full(): boolean {
    return this.lines.length >= this.height;
  }
  /** Append unsafe text, sanitized to a single line and clipped to width. */
  push(text: string): void {
    if (!this.full) this.lines.push(truncateDisplayText(safeLine(text), this.width));
  }
  /** Append already-safe text, clipped to width. */
  pushSafe(text: string): void {
    if (!this.full) this.lines.push(truncateDisplayText(text, this.width));
  }
  value(): string[] {
    return this.lines;
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

function rosterLines(state: ContentState, width: number, height: number, clickTargets?: Array<OpenTuiClickAction | undefined>): string[] {
  if (height === 0 || width === 0) return [];
  const roster = state.roster.agents;
  if (!roster) return ['AGENTS & TASKS', '', 'Roster unavailable'];
  const agents = visibleForRun(roster.agents, state.selection.selectedRunId);
  const running = agents.filter(agent => ['starting', 'thinking', 'tool_running', 'verifying'].includes(agent.state)).length;
  const lines = ['AGENTS & TASKS', '', `○ All agents  /`, `  ${agents.length} agents • ${running} running`, '─'.repeat(width)];
  const targets: Array<OpenTuiClickAction | undefined> = [undefined, undefined, { type: 'agent.select', scrollOffset: 0 }, undefined, undefined];
  const finish = (rows: string[]): string[] => {
    clickTargets?.push(...targets.slice(0, Math.min(rows.length, height)));
    return rows.slice(0, height);
  };
  if (state.selection.selectedRunId) {
    lines.splice(2, 0, `RUN ${safeLine(state.selection.selectedRunId)}`);
    targets.splice(2, 0, undefined);
  }
  if (!state.overlay.agentRosterExpanded) {
    targets.push({ type: 'agentRoster.toggle' });
    return finish([...lines, 'Enter to expand roster']);
  }
  if (agents.length === 0) {
    targets.push(undefined, undefined, { type: 'coordination.inspect' }, { type: 'coordination.inspect' });
    return finish([...lines, 'No subagents', '─'.repeat(width), '○ Coordination Run  c', '  Start a coordinated run']);
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
    clickTargets?.push(...(height === 1 ? [target] : [undefined, target]));
    return height === 1 ? [agentLine(selectedAgent, agents.indexOf(selectedAgent))] : [lines[0]!, agentLine(selectedAgent, agents.indexOf(selectedAgent))];
  }
  const selectedIndex = agents.findIndex(agent => agent.agentId === state.selection.selectedAgentId);
  const capacity = Math.max(1, Math.floor((height - lines.length - 3) / 3));
  let offset = Math.max(0, Math.min(agents.length - 1, state.overlay.drawerScrollOffset));
  if (selectedIndex >= 0) offset = Math.max(Math.min(offset, selectedIndex), selectedIndex - capacity + 1);
  for (const [index, agent] of agents.slice(offset).entries()) {
    if (lines.length >= height) break;
    lines.push(agentLine(agent, index + offset));
    const target: OpenTuiClickAction = { type: 'agent.select', agentId: agent.agentId, scrollOffset: Math.max(0, index + offset - 1) };
    targets.push(target);
    if (lines.length < height) {
      lines.push(truncateDisplayText(safeLine(`  ${agent.taskLabel ?? agent.currentOperation ?? 'Task unavailable'}`), width));
      targets.push(target);
    }
    if (lines.length < height) { lines.push(''); targets.push(undefined); }
  }
  if (lines.length + 3 <= height) {
    lines.push('─'.repeat(width), '○ Coordination Run  c', '  Start a coordinated run');
    targets.push(undefined, { type: 'coordination.inspect' }, { type: 'coordination.inspect' });
  }
  return finish(lines);
}

function itemLines(item: TranscriptItem, errorOnly: boolean, detailed: boolean, height: number, width: number, actor: string): string[] {
  const time = Number.isFinite(item.startedAt) && item.startedAt >= 0 && item.startedAt <= 8640000000000000
    ? new Date(item.startedAt).toISOString().slice(11, 19) : '--:--:--';
  const prefix = `[${time}]  ${actor.padEnd(16, ' ')} `;
  switch (item.kind) {
    case 'user': return [`${prefix}${item.text}`];
    case 'assistant': return [`${prefix}${item.text}`];
    case 'activity': return [`${prefix}${item.verifiedOutcome === 'success' ? '✓ ' : item.verifiedOutcome === 'failure' ? '✗ ' : ''}${item.status ? `${ACTIVITY_STATUS[item.status] ?? item.status.toUpperCase()}  ` : ''}${item.text}`];
    case 'approval': return [`${prefix}APPROVAL  ${item.text}`];
    case 'diagnostic': return [`${prefix}${item.severity.toUpperCase()}  ${item.text}`];
    case 'phase': return [`${prefix}PHASE  ${item.phase}`];
    case 'plan': return [
      ...(item.text ? [`${prefix}PLAN  ${item.text}`] : []),
      ...item.tasks.slice(0, 20).map(task => `[${task.status}] ${task.index}. ${task.title}`),
    ];
    case 'tool-group': return item.tools
      .filter(tool => !errorOnly || tool.status === 'failed')
      .slice(-height)
      .flatMap(tool => {
        const heading = `${prefix}TOOL  ${tool.name} · ${tool.status}`;
        if (tool.status === 'running' && !detailed) return [heading];
        const card = buildWorkbenchToolCardLines(tool, {
          width: Math.max(8, width - Math.min(prefix.length, 24)), mode: detailed ? 'detailed' : 'compact', indent: 2,
        });
        return [heading, ...card.slice(0, Math.max(0, height - 1)).map(line => `  ${safeLine(line.text)}`)];
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
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]!;
    if (!visible(item)) continue;
    const agent = roster.find(entry => entry.agentId === item.agentId);
    const actor = item.kind === 'user' ? 'YOU' : agent?.assignedAgentId ?? agent?.role ?? item.agentId ?? 'ALiX';
    const itemContent = itemLines(item, transcript.filter === 'error', transcript.mode === 'detailed', neededRows, width, actor);
    const color: Color = item.kind === 'tool-group' ? item.tools.some(tool => tool.status === 'failed') ? 'red' : 'cyan'
      : item.kind === 'activity' ? item.verifiedOutcome === 'failure' ? 'red' : item.verifiedOutcome === 'success' ? 'green' : 'muted'
        : item.kind === 'diagnostic' ? item.severity === 'error' ? 'red' : 'yellow'
          : item.kind === 'approval' ? 'yellow' : item.kind === 'plan' ? 'purple' : 'foreground';
    for (let contentIndex = itemContent.length - 1; contentIndex >= 0 && lines.length < neededRows; contentIndex--) {
      const bounded = itemContent[contentIndex]!.slice(-Math.max(1, width * neededRows * MAX_ITEM_CHARS));
      const parts = safe(bounded).split('\n');
      for (let partIndex = parts.length - 1; partIndex >= 0 && lines.length < neededRows; partIndex--) {
        const wrapped = wrapDisplayText(parts[partIndex]!, width);
        for (let row = wrapped.length - 1; row >= 0 && lines.length < neededRows; row--) lines.push({ text: wrapped[row]!, color });
      }
    }
    if (lines.length >= neededRows) break;
  }
  if (lines.length === 0) return { lines: [{ text: 'No conversation yet', color: 'muted' }], resolvedScrollRows: 0 };
  return {
    lines: lines.reverse().slice(0, height),
    resolvedScrollRows: lines.length < neededRows ? Math.max(0, lines.length - height) : scrollRows,
  };
}

function tasksLines(state: ContentState, width: number, height: number, clickTargets?: Array<OpenTuiClickAction | undefined>): string[] {
  if (height === 0 || width === 0) return [];
  const tasks = state.roster.tasks;
  if (!tasks) return ['Tasks unavailable'];
  const scoped = visibleForRun(tasks.tasks, state.selection.selectedRunId);
  const countStates = (states: readonly string[]): number => scoped.filter(task => states.includes(task.state)).length;
  const out = new BoundedLines(width, height);
  const push = (line: string, action?: OpenTuiClickAction): void => {
    const before = out.value().length;
    out.push(line);
    if (out.value().length > before) clickTargets?.push(action);
  };
  push(`${countStates(['running'])} running · ${countStates(['waiting_dependency', 'waiting_approval'])} waiting · ${countStates(['blocked'])} blocked · ${countStates(['queued', 'assigned'])} queued`);
  push(`RUN ${state.selection.selectedRunId ?? 'all'} · [ ] switch`);
  if (scoped.length === 0) {
    push('No delegated tasks');
    return out.value();
  }
  for (const [index, task] of scoped.entries()) {
    if (out.full) break;
    const selected = task.taskId === state.selection.selectedTaskId;
    const action: OpenTuiClickAction = { type: 'task.select', taskId: task.taskId, agentId: task.agentId, scrollOffset: Math.max(0, index - 1) };
    push(`${selected ? '›' : ' '}${taskStateGlyph(task.state)} ${task.title}`, action);
    push(`  ${task.state.toUpperCase().replaceAll('_', ' ')}${task.agentId ? ` · agent ${task.agentId}` : ''}`, action);
    if (!selected) continue;
    const details = [
      formatCoordMeta(task) ?? '',
      task.blockReason ? `BLOCKED · ${task.blockReason}` : '',
      task.currentOperation && task.currentOperation !== task.title ? task.currentOperation : '',
      task.ownedPaths.length ? `owns ${task.ownedPaths.join(', ')}` : '',
      task.dependencyIds?.length ? `Depends on ${task.dependencyIds.join(', ')}` : '',
    ];
    for (const detail of details) if (detail) push(`    ${detail}`, action);
  }
  return out.value();
}

function artifactsLines(state: ContentState, width: number, height: number, clickTargets?: Array<OpenTuiClickAction | undefined>): string[] {
  if (height === 0 || width === 0) return [];
  const artifacts = state.roster.artifacts;
  if (!artifacts) return ['Artifacts unavailable'];
  const items = visibleArtifacts(artifacts.items, {
    runId: state.selection.selectedRunId,
    agentId: state.selection.selectedAgentId,
    taskId: state.selection.selectedTaskId,
  });
  const out = new BoundedLines(width, height);
  const push = (line: string, action?: OpenTuiClickAction): void => {
    const before = out.value().length;
    out.push(line);
    if (out.value().length > before) clickTargets?.push(action);
  };
  push(`${artifacts.artifacts} files · ${artifacts.results} results`);
  push(`RUN ${state.selection.selectedRunId ?? 'all'} · [ ] switch`);
  if (items.length === 0) {
    push('No artifacts or results');
    return out.value();
  }
  for (const [index, item] of items.entries()) {
    if (out.full) break;
    const selected = item.id === state.selection.selectedArtifactId;
    const marker = item.status === 'failed' ? '✗' : item.status === 'unavailable' ? '!' : item.kind === 'artifact' ? '◆' : '✓';
    const action: OpenTuiClickAction = {
      type: 'artifact.select', artifactId: item.id, runId: item.coordinationRunId,
      agentId: item.agentId, taskId: item.taskId, scrollOffset: Math.max(0, index - 1),
    };
    push(`${selected ? '›' : ' '}${marker} ${item.title}`, action);
    if (!selected) continue;
    const details = [
      [item.artifactType ?? item.kind, item.agentId ? `agent ${item.agentId}` : '', item.taskId ? `task ${item.taskId}` : ''].filter(Boolean).join(' · '),
      item.uri ?? '',
      [item.mediaType ?? '', item.sizeBytes !== undefined ? formatByteSize(item.sizeBytes) : '', item.digest ? `digest ${item.digest.slice(0, 12)}` : ''].filter(Boolean).join(' · '),
      ...(item.preview ? item.preview.split(/\r?\n/).slice(0, 5).map(line => `  ${line}`) : []),
    ];
    for (const detail of details) if (detail) push(`  ${detail}`, action);
  }
  return out.value();
}

function drawerLines(state: ContentState, width: number, height: number, clickTargets?: Array<OpenTuiClickAction | undefined>): string[] {
  switch (state.overlay.drawer) {
    case 'tasks': return tasksLines(state, width, height, clickTargets);
    case 'artifacts': return artifactsLines(state, width, height, clickTargets);
    default: return rosterLines(state, width, height, clickTargets);
  }
}

function chromeCount(value: number | undefined): string {
  return value === undefined ? 'unavailable' : value.toLocaleString('en-US');
}

function headerLines(model: OperatorShellSnapshot, width: number, height: number): string[] {
  if (height === 0 || width === 0) return [];
  const brand = width >= 20 ? 'ALiX WORKBENCH' : width >= 6 ? 'ALiX' : '';
  const badge = model.demo ? 'CONCEPT PREVIEW' : 'PREVIEW';
  const left = `${brand}  ${badge}`;
  const facts = safeLine([
    `workspace: ${model.workspace}`, model.mode,
    model.agents ? `${model.agents.total} agents • ${model.agents.running} running` : '',
  ].filter(Boolean).join('  |  '));
  if (width >= displayWidth(left) + displayWidth(facts) + 2) return [`${left}${' '.repeat(width - displayWidth(left) - displayWidth(facts))}${facts}`];
  if (height === 1) return [truncateDisplayText(safeLine(left), width)];
  return [truncateDisplayText(safeLine(left), width), truncateDisplayText(safeLine(facts), width)];
}

function footerLines(model: OperatorShellSnapshot, width: number, height: number): string[] {
  if (height === 0 || width === 0) return [];
  const escape = model.escapeAction === 'close' ? 'Esc close' : model.running ? 'Esc cancel' : model.focus === 'transcript' ? 'Esc type' : '';
  const hints = model.approval
    ? [`${model.approval.count} ${model.approval.count === 1 ? 'approval' : 'approvals'}`, model.approval.toolName, 'a approve', 'd deny', escape]
    : [
        model.focus === 'transcript' ? 'Ctrl+F type' : 'Tab views',
        'Ctrl+O details',
        'Ctrl+R artifacts',
        model.focus === 'composer' ? 'Ctrl+F transcript' : '',
        model.queuedMessages > 0 ? `${model.queuedMessages} queued` : '',
        escape,
      ];
  const counters = [
    `TOKENS ${chromeCount(model.tokensUsed)}`,
    `FILES ${chromeCount(model.filesTouched)}`,
    `EVENTS ${chromeCount(model.eventCount)}`,
    `AGENTS ${model.agents?.total ?? 'unavailable'}`,
  ].join('  |  ');
  const left = hints.filter(Boolean).join('  •  ');
  const gap = Math.max(2, width - left.length - counters.length);
  return [truncateDisplayText(safeLine(`${left}${' '.repeat(gap)}${counters}`), width)].slice(0, Math.max(1, height));
}

function inspectorLines(state: ContentState, width: number, height: number): NativeLine[] {
  if (height === 0 || width === 0) return [];
  const out: NativeLine[] = [];
  const palette = getWorkbenchPreviewTheme().palette;
  const push = (line: NativeLine): void => { if (out.length < height) out.push(line); };
  for (const [index, section] of buildAgentInspectorSections(state.inspector).entries()) {
    if (out.length >= height) break;
    if (index > 0) push({ text: '─'.repeat(width), color: 'divider' });
    push({ text: section.title, color: 'cyan' });
    push({ text: '' });
    for (const row of section.rows) {
      if (out.length >= height) break;
      const label = row.label ? row.label.padEnd(Math.min(12, Math.max(1, width - 1)), ' ') : '';
      const value = safeLine(row.value);
      const color: Color = row.color === palette.green ? 'green' : row.color === palette.yellow ? 'yellow'
        : row.color === palette.red ? 'red' : row.color === palette.purple ? 'purple' : 'foreground';
      push({ text: `${label}${value}`, parts: label ? [{ text: label, color: 'muted' }, { text: value, color }] : [{ text: value, color }] });
    }
  }
  return out.length === 0 ? [{ text: 'Inspector unavailable' }] : out;
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
  let rosterClickTargets: Array<OpenTuiClickAction | undefined> = [];
  let overlayClickTargets: Array<OpenTuiClickAction | undefined> = [];
  let inspectorClickTargets: Array<OpenTuiClickAction | undefined> = [];
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
    const brand = headerSize.width >= 20 ? 'ALiX WORKBENCH' : headerSize.width >= 6 ? 'ALiX' : '';
    const badge = state.header.demo ? 'CONCEPT PREVIEW' : 'PREVIEW';
    const brandLine = `${brand}  ${badge}`;
    const agentFacts = state.header.agents ? `${state.header.agents.total} agents • ${state.header.agents.running} running` : '';
    header.content = styledLines(headerLines(state.header, headerSize.width, headerSize.height).map((line, index) => {
      const parts: NativePart[] = [];
      let remainder = line;
      if (index === 0 && line.startsWith(brandLine)) {
        parts.push({ text: brand, color: 'cyan', bold: true }, { text: `  ${badge}`, color: 'muted' });
        remainder = line.slice(brandLine.length);
      }
      const workspaceLabel = 'workspace: ';
      const workspaceAt = remainder.indexOf(workspaceLabel);
      if (workspaceAt >= 0) {
        parts.push({ text: remainder.slice(0, workspaceAt + workspaceLabel.length), color: 'muted' });
        remainder = remainder.slice(workspaceAt + workspaceLabel.length);
        const pathLength = safeLine(state.header.workspace).length;
        parts.push({ text: remainder.slice(0, pathLength), color: 'cyan' });
        remainder = remainder.slice(pathLength);
      }
      const countAt = agentFacts ? remainder.lastIndexOf(agentFacts) : -1;
      parts.push({ text: countAt >= 0 ? remainder.slice(0, countAt) : remainder, color: 'muted' });
      if (countAt >= 0) parts.push({ text: remainder.slice(countAt), color: 'green' });
      return { text: line, parts };
    }), headerSize.width);
    const footerRows = footerLines(state.footer, footerSize.width, footerSize.height);
    footerClickTargets = footerRows.flatMap((line, row) => line.startsWith('Tab views')
      ? [{ row, start: 0, end: displayWidth('Tab views'), action: { type: 'tab.next' } as const }] : []);
    footer.content = styledLines(footerRows.map(line => {
      const counterAt = line.indexOf('TOKENS ');
      return { text: line, parts: counterAt < 0 ? [{ text: line, color: 'muted' as const }] : [
        { text: line.slice(0, counterAt), color: 'cyan' as const }, { text: line.slice(counterAt), color: 'muted' as const },
      ] };
    }), footerSize.width);
    rosterClickTargets = [];
    const rosterRows = state.overlay.drawer === 'closed'
      ? rosterLines(state, rosterSize.width, rosterSize.height, rosterClickTargets)
      : drawerLines(state, rosterSize.width, rosterSize.height, rosterClickTargets);
    roster.content = styledLines(rosterRows.map((line, index) => ({
      text: line,
      color: /^(AGENTS & TASKS|TASKS|ARTIFACTS)$/.test(line) ? 'cyan'
        : line.startsWith('›') ? 'cyan'
          : /FAILED/.test(line) ? 'red' : /WAITING|APPROVAL/.test(line) ? 'yellow'
            : /RUNNING|VERIFYING/.test(line) ? 'green' : /COMPLETED/.test(line) ? 'purple'
              : line.startsWith('  ') ? 'muted' : 'foreground',
      fill: line.startsWith('›') || (rosterRows[index - 1]?.startsWith('›') && line.startsWith('  ')),
    })), rosterSize.width);
    if (state.transcript.followTail) pausedConversation = undefined;
    else pausedConversation ??= lastConversation ?? state.transcript.conversation;
    const categories = ['ALL', 'RESPONSE', 'TOOL', 'ACTIVITY', 'ERROR'] as const;
    const toolbarSegments = categories.map((category, index) => {
      const active = category.toLowerCase() === state.transcript.filter;
      return { label: active ? `[${category}]` : category, gap: index === categories.length - 1 ? '    ' : '  ', active, filter: category.toLowerCase() as ContentState['transcript']['filter'] };
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
    toolbarParts.push(...followParts);
    const toolbar = toolbarParts.map(part => part.text).join('');
    const heading = 'LIVE TRANSCRIPT';
    const toolbarOnHeading = displayWidth(heading) + 3 + displayWidth(toolbar) <= transcriptSize.width;
    transcriptClickTargets = [];
    let toolbarColumn = toolbarOnHeading ? displayWidth(heading) + 3 : 0;
    const toolbarRow = toolbarOnHeading ? 0 : 1;
    for (const segment of toolbarSegments) {
      transcriptClickTargets.push({
        row: toolbarRow, start: toolbarColumn, end: toolbarColumn + displayWidth(segment.label),
        action: { type: 'transcript.filter', filter: segment.filter },
      });
      toolbarColumn += displayWidth(segment.label) + displayWidth(segment.gap);
    }
    transcriptClickTargets.push({
      row: toolbarRow, start: toolbarColumn,
      end: toolbarColumn + displayWidth(followLabel),
      action: { type: 'transcript.follow.toggle' },
    });
    const transcriptChrome: NativeLine[] = toolbarOnHeading
      ? [{ text: `${heading}   ${toolbar}`, parts: [{ text: heading, color: 'cyan' }, { text: '   ' }, ...toolbarParts] }, { text: '' }]
      : [{ text: heading, color: 'cyan' }, { text: toolbar, parts: toolbarParts }, { text: '' }];
    const transcriptWindow = transcriptLines(
      state, pausedConversation ?? state.transcript.conversation, transcriptSize.width, Math.max(0, transcriptSize.height - transcriptChrome.length),
    );
    resolvedScrollRows = transcriptWindow.resolvedScrollRows;
    transcript.content = styledLines([
      ...transcriptChrome,
      ...transcriptWindow.lines,
    ].slice(0, transcriptSize.height), transcriptSize.width);
    lastConversation = state.transcript.conversation;
    const inspectorRows = inspectorLines(state, inspectorSize.width, inspectorSize.height);
    let inspectorSection = '';
    let inspectorArtifactIndex = 0;
    inspectorClickTargets = inspectorRows.map(line => {
      if (['AGENT DETAILS', 'LIVE ACTIVITY', 'APPROVALS', 'ARTIFACTS', 'USAGE'].includes(line.text)) {
        inspectorSection = line.text;
        if (line.text === 'ARTIFACTS') inspectorArtifactIndex = 0;
        return line.text === 'ARTIFACTS' ? { type: 'drawer.toggle', drawer: 'artifacts' } : { type: 'inspector.open' };
      }
      if (!line.text || line.text.startsWith('─')) return undefined;
      if (inspectorSection === 'ARTIFACTS') {
        const item = state.inspector.artifacts?.[inspectorArtifactIndex++];
        return item ? { type: 'artifact.open', artifactId: item.id } : undefined;
      }
      return undefined;
    });
    inspector.content = styledLines(inspectorRows, inspectorSize.width);
    composer.content = styledLines(composerLines(state, layout.composer, composerSize.width, composerSize.height).map(line => ({ text: line, color: line.startsWith('>') ? 'cyan' : 'foreground' })), composerSize.width);
    overlayClickTargets = [];
    overlay.content = state.overlay.drawer !== 'closed'
      ? styledLines((state.overlay.drawer === 'agents'
        ? rosterLines(state, overlaySize.width, overlaySize.height, overlayClickTargets)
        : drawerLines(state, overlaySize.width, overlaySize.height, overlayClickTargets)).map(line => ({ text: line })), overlaySize.width) : '';
    const approvalLines = state.approval.length
      ? state.approval
          .flatMap((entry, index) => buildWorkbenchApprovalCardLines(entry, state.approval.length, renderer.width)
            .map((line, row) => {
              if (index === 0 || row !== 3) return line;
              const inner = Math.max(0, displayWidth(line) - 2);
              return `│${truncateDisplayText('Resolve oldest approval first', inner).padEnd(inner)}│`;
            }))
          .slice(0, Math.max(1, renderer.height - 3))
      : [];
    approval.visible = approvalLines.length > 0;
    approvalClickTargets = [];
    if (approvalLines.length > 0) {
      const decisionLine = approvalLines.findIndex(line => line.includes('a approve') && line.includes('d deny'));
      const oldest = state.approval[0];
      if (oldest && decisionLine >= 0) for (const [label, decision] of [['a approve', 'approved'], ['d deny', 'denied']] as const) {
        const at = approvalLines[decisionLine]!.indexOf(label);
        if (at >= 0) approvalClickTargets.push({
          row: decisionLine, start: displayWidth(approvalLines[decisionLine]!.slice(0, at)),
          end: displayWidth(approvalLines[decisionLine]!.slice(0, at)) + displayWidth(label),
          action: { type: 'approval.resolve', approvalId: oldest.id, decision },
        });
      }
      const cardWidth = approvalLines[0]!.length;
      approvalText.content = approvalLines.join('\n');
      approval.width = Math.max(1, cardWidth);
      approval.height = approvalLines.length;
      approval.left = Math.max(0, Math.floor((renderer.width - cardWidth) / 2));
      approval.top = Math.min(Math.max(0, renderer.height - approvalLines.length), 3);
    } else {
      approvalText.content = '';
    }
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
