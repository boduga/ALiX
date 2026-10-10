import { BoxRenderable, TextRenderable, type CliRenderer } from '@opentui/core';
import { getWorkbenchAgentPresentation, getWorkbenchPreviewTheme } from '../model/preview-theme.js';
import { visibleArtifacts, visibleForRun } from '../model/selection.js';
import { transcriptItemMatchesFilter } from '../model/transcript-filter.js';
import type { ConversationSnapshot, TranscriptItem } from '../model/transcript-item.js';
import { truncateDisplayText, wrapDisplayText } from '../render/terminal-text.js';
import type { WorkbenchRegion } from '../layout/responsive-layout.js';
import type { WorkbenchViewState } from '../view-state/types.js';
import { buildAgentInspectorSections } from '../views/agent-inspector.js';
import { buildWorkbenchApprovalCardLines } from '../views/approval-dialog.js';
import type { ComposerLayout } from '../views/composer-view.js';
import type { OpenTuiWorkbenchLayout } from './workbench-layout.js';

type ContentState = Pick<WorkbenchViewState, 'roster' | 'transcript' | 'selection' | 'overlay' | 'inspector' | 'composer' | 'approval'>;

export interface OpenTuiWorkbenchContent {
  readonly roster: TextRenderable;
  readonly transcript: TextRenderable;
  readonly overlay: TextRenderable;
  readonly inspector: TextRenderable;
  readonly composer: TextRenderable;
  readonly approval: BoxRenderable;
  update(state: ContentState): void;
  dispose(): void;
}

function safe(text: string): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x09\x0b-\x1f\x7f]/g, ' ');
}

function safeLine(text: string): string {
  return safe(text).replaceAll('\n', ' ');
}

function contentSize(box: OpenTuiWorkbenchLayout['regions']['roster'], region: WorkbenchRegion | null): { width: number; height: number; inset: number } {
  const inset = box.border ? 1 : 0;
  return { width: Math.max(0, (region?.width ?? 0) - inset * 2), height: Math.max(0, (region?.height ?? 0) - inset * 2), inset };
}

function placeText(text: TextRenderable, box: OpenTuiWorkbenchLayout['regions']['roster'], region: WorkbenchRegion | null): { width: number; height: number } {
  const { width, height } = contentSize(box, region);
  text.left = 0;
  text.top = 0;
  text.width = Math.max(1, width);
  text.height = Math.max(1, height);
  text.visible = box.visible && width > 0 && height > 0;
  return { width, height };
}

function rosterLines(state: ContentState, width: number, height: number): string[] {
  if (height === 0 || width === 0) return [];
  const roster = state.roster.agents;
  if (!roster) return ['Roster unavailable'];
  const agents = visibleForRun(roster.agents, state.selection.selectedRunId);
  const lines = [state.selection.selectedRunId ? `RUN ${safeLine(state.selection.selectedRunId)}` : 'RUN all', `All agents · ${agents.length} total`];
  if (!state.overlay.agentRosterExpanded) return [...lines, 'Enter to expand roster'].slice(0, height);
  if (agents.length === 0) return [...lines, 'No subagents'].slice(0, height);
  const theme = getWorkbenchPreviewTheme();
  const agentLine = (agent: typeof agents[number]): string => {
    const status = getWorkbenchAgentPresentation(agent.state, theme);
    const selected = agent.agentId === state.selection.selectedAgentId ? '›' : ' ';
    return truncateDisplayText(safeLine(`${selected}${status.glyph} ${agent.assignedAgentId ?? agent.role}  ${status.label}`), width);
  };
  const selectedAgent = agents.find(agent => agent.agentId === state.selection.selectedAgentId);
  if (height <= 2 && selectedAgent) return height === 1 ? [agentLine(selectedAgent)] : [lines[0]!, agentLine(selectedAgent)];
  const selectedIndex = agents.findIndex(agent => agent.agentId === state.selection.selectedAgentId);
  const capacity = Math.max(1, Math.floor((height - lines.length) / 2));
  let offset = Math.max(0, Math.min(agents.length - 1, state.overlay.drawerScrollOffset));
  if (selectedIndex >= 0) offset = Math.max(Math.min(offset, selectedIndex), selectedIndex - capacity + 1);
  for (const agent of agents.slice(offset)) {
    if (lines.length >= height) break;
    lines.push(agentLine(agent));
    if (lines.length < height) lines.push(truncateDisplayText(safeLine(`  ${agent.taskLabel ?? agent.currentOperation ?? 'Task unavailable'}`), width));
  }
  return lines;
}

function itemLines(item: TranscriptItem, errorOnly: boolean, detailed: boolean, height: number): string[] {
  switch (item.kind) {
    case 'user': return [`YOU  ${item.text}`];
    case 'assistant': return [`${item.agentId ?? 'ALiX'}  ${item.text}`];
    case 'activity': return [`ACTIVITY  ${item.text}`];
    case 'approval': return [`APPROVAL  ${item.text}`];
    case 'diagnostic': return [`${item.severity.toUpperCase()}  ${item.text}`];
    case 'phase': return [`PHASE  ${item.phase}`];
    case 'plan': return [
      ...(item.text ? [`PLAN  ${item.text}`] : []),
      ...item.tasks.slice(0, 20).map(task => `[${task.status}] ${task.index}. ${task.title}`),
    ];
    case 'tool-group': return item.tools
      .filter(tool => !errorOnly || tool.status === 'failed')
      .slice(-height)
      .flatMap(tool => detailed && tool.detail
        ? [`TOOL  ${tool.name} · ${tool.status}`, `  ${tool.detail}`]
        : [`TOOL  ${tool.name} · ${tool.status}`]);
  }
}

function transcriptLines(state: ContentState, conversation: ConversationSnapshot, width: number, height: number): string[] {
  if (height === 0 || width === 0) return [];
  const { transcript, selection } = state;
  const visible = (item: TranscriptItem): boolean =>
    transcriptItemMatchesFilter(item, transcript.filter) &&
    (transcript.scope !== 'selected' || !selection.selectedAgentId || !item.agentId || item.agentId === selection.selectedAgentId || item.kind === 'approval');
  const lines: string[] = [];
  const items = conversation.items;
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]!;
    if (!visible(item)) continue;
    const itemContent = itemLines(item, transcript.filter === 'error', transcript.mode === 'detailed', height);
    for (let contentIndex = itemContent.length - 1; contentIndex >= 0 && lines.length < height; contentIndex--) {
      const bounded = itemContent[contentIndex]!.slice(-Math.max(1, width * height * 4));
      const parts = safe(bounded).split('\n');
      for (let partIndex = parts.length - 1; partIndex >= 0 && lines.length < height; partIndex--) {
        const wrapped = wrapDisplayText(parts[partIndex]!, width);
        for (let row = wrapped.length - 1; row >= 0 && lines.length < height; row--) lines.unshift(wrapped[row]!);
      }
    }
    if (lines.length >= height) break;
  }
  if (lines.length === 0) return ['No conversation yet'];
  return lines.slice(-height);
}

function taskDrawerGlyph(state: string): string {
  if (state === 'running') return '●';
  if (state === 'completed') return '✓';
  if (state === 'partial') return '◐';
  if (state === 'failed') return '✗';
  if (state === 'blocked') return '!';
  if (state === 'cancelled') return '○';
  return '◌';
}

function drawerByteSize(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KiB`;
  return `${(value / 1_048_576).toFixed(1)} MiB`;
}

function tasksLines(state: ContentState, width: number, height: number): string[] {
  if (height === 0 || width === 0) return [];
  const tasks = state.roster.tasks;
  if (!tasks) return ['Tasks unavailable'];
  const scoped = visibleForRun(tasks.tasks, state.selection.selectedRunId);
  const countStates = (states: readonly string[]): number => scoped.filter(task => states.includes(task.state)).length;
  const lines = [
    `${tasks.blocked} blocked · ${countStates(['waiting_dependency', 'waiting_approval'])} waiting · ${countStates(['running'])} running · ${countStates(['queued', 'assigned'])} queued`,
    `RUN ${state.selection.selectedRunId ?? 'all'} · [ ] switch`,
  ];
  if (scoped.length === 0) return [...lines, 'No delegated tasks'].slice(0, height);
  for (const task of scoped) {
    if (lines.length >= height) break;
    const selected = task.taskId === state.selection.selectedTaskId;
    lines.push(truncateDisplayText(safeLine(`${selected ? '›' : ' '}${taskDrawerGlyph(task.state)} ${task.title}`), width));
    if (lines.length < height) lines.push(truncateDisplayText(safeLine(`  ${task.state.toUpperCase().replaceAll('_', ' ')}${task.agentId ? ` · agent ${task.agentId}` : ''}`), width));
    if (!selected) continue;
    const details = [
      [task.coordinationRunId ? `run ${task.coordinationRunId}` : '', task.assignedAgentId ? `assigned ${task.assignedAgentId}` : ''].filter(Boolean).join(' · '),
      task.blockReason ? `BLOCKED · ${task.blockReason}` : '',
      task.currentOperation && task.currentOperation !== task.title ? task.currentOperation : '',
      task.ownedPaths.length ? `owns ${task.ownedPaths.join(', ')}` : '',
      task.dependencyIds?.length ? `Depends on ${task.dependencyIds.join(', ')}` : '',
    ];
    for (const detail of details) {
      if (lines.length >= height || !detail) continue;
      lines.push(truncateDisplayText(safeLine(`    ${detail}`), width));
    }
  }
  return lines.slice(0, height);
}

function artifactsLines(state: ContentState, width: number, height: number): string[] {
  if (height === 0 || width === 0) return [];
  const artifacts = state.roster.artifacts;
  if (!artifacts) return ['Artifacts unavailable'];
  const items = visibleArtifacts(artifacts.items, {
    runId: state.selection.selectedRunId,
    agentId: state.selection.selectedAgentId,
    taskId: state.selection.selectedTaskId,
  });
  const lines = [
    `${artifacts.artifacts} files · ${artifacts.results} results`,
    `RUN ${state.selection.selectedRunId ?? 'all'} · [ ] switch`,
  ];
  if (items.length === 0) return [...lines, 'No artifacts or results'].slice(0, height);
  for (const item of items) {
    if (lines.length >= height) break;
    const selected = item.id === state.selection.selectedArtifactId;
    const marker = item.status === 'failed' ? '✗' : item.status === 'unavailable' ? '!' : item.kind === 'artifact' ? '◆' : '✓';
    lines.push(truncateDisplayText(safeLine(`${selected ? '›' : ' '}${marker} ${item.title}`), width));
    if (!selected) continue;
    const details = [
      [item.artifactType ?? item.kind, item.agentId ? `agent ${item.agentId}` : '', item.taskId ? `task ${item.taskId}` : ''].filter(Boolean).join(' · '),
      item.uri ?? '',
      [item.mediaType ?? '', item.sizeBytes !== undefined ? drawerByteSize(item.sizeBytes) : '', item.digest ? `digest ${item.digest.slice(0, 12)}` : ''].filter(Boolean).join(' · '),
      ...(item.preview ? item.preview.split(/\r?\n/).slice(0, 5).map(line => `  ${line}`) : []),
    ];
    for (const detail of details) {
      if (lines.length >= height || !detail) continue;
      lines.push(truncateDisplayText(safeLine(`  ${detail}`), width));
    }
  }
  return lines.slice(0, height);
}

function drawerLines(state: ContentState, width: number, height: number): string[] {
  switch (state.overlay.drawer) {
    case 'tasks': return tasksLines(state, width, height);
    case 'artifacts': return artifactsLines(state, width, height);
    default: return rosterLines(state, width, height);
  }
}

function inspectorLines(state: ContentState, width: number, height: number): string[] {
  if (height === 0 || width === 0) return [];
  const lines: string[] = [];
  for (const section of buildAgentInspectorSections(state.inspector)) {
    if (lines.length >= height) break;
    lines.push(truncateDisplayText(section.title, width));
    for (const row of section.rows) {
      if (lines.length >= height) break;
      lines.push(truncateDisplayText(safeLine(row.label ? `${row.label}  ${row.value}` : row.value), width));
    }
  }
  return lines.length === 0 ? ['Inspector unavailable'] : lines;
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
  const make = (id: string, parent: OpenTuiWorkbenchLayout['regions']['roster']): TextRenderable => {
    const node = new TextRenderable(renderer, { id, position: 'absolute', width: 1, height: 1, content: '' });
    parent.add(node);
    return node;
  };
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
  const update = (state: ContentState): void => {
    const rosterSize = placeText(roster, layout.regions.roster, layout.geometry.regions.roster);
    const transcriptSize = placeText(transcript, layout.regions.transcript, layout.geometry.regions.transcript);
    const overlaySize = placeText(overlay, layout.regions.overlay, layout.geometry.regions.overlay);
    const inspectorSize = placeText(inspector, layout.regions.inspector, layout.geometry.regions.inspector);
    const composerSize = placeText(composer, layout.regions.composer, layout.geometry.regions.composer);
    roster.content = drawerLines(state, rosterSize.width, rosterSize.height).join('\n');
    if (state.transcript.followTail) pausedConversation = undefined;
    else pausedConversation ??= lastConversation ?? state.transcript.conversation;
    transcript.content = transcriptLines(
      state, pausedConversation ?? state.transcript.conversation, transcriptSize.width, transcriptSize.height,
    ).join('\n');
    lastConversation = state.transcript.conversation;
    inspector.content = inspectorLines(state, inspectorSize.width, inspectorSize.height).join('\n');
    composer.content = composerLines(state, layout.composer, composerSize.width, composerSize.height).join('\n');
    overlay.content = state.overlay.drawer !== 'closed'
      ? drawerLines(state, overlaySize.width, overlaySize.height).join('\n') : '';
    const approvalLines = state.approval.length
      ? buildWorkbenchApprovalCardLines(state.approval[0]!, state.approval.length, renderer.width) : [];
    approval.visible = approvalLines.length > 0;
    if (approvalLines.length > 0) {
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
    roster, transcript, overlay, inspector, composer, approval, update,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      layout.regions.roster.remove(roster);
      layout.regions.transcript.remove(transcript);
      layout.regions.overlay.remove(overlay);
      layout.regions.inspector.remove(inspector);
      layout.regions.composer.remove(composer);
      layout.shell.remove(approval);
      roster.destroy();
      transcript.destroy();
      overlay.destroy();
      inspector.destroy();
      composer.destroy();
      approval.destroy();
    },
  };
}
