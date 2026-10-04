import type { TerminalCanvas } from '../../canvas.js';
import type { AgentInspectorModel } from '../model/agent-inspector.js';
import { getWorkbenchPreviewTheme, getWorkbenchAgentPresentation, type WorkbenchPreviewTheme } from '../model/preview-theme.js';
import { truncateDisplayText, wrapDisplayText } from '../../terminal-text.js';

export interface InspectorSection { readonly title: string; readonly rows: readonly { readonly label?: string; readonly value: string; readonly color?: string }[] }
const safe = (value: string): string => value.slice(0, 2048).replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
const elapsed = (ms: number): string => Number.isFinite(ms) && ms >= 0 ? `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}` : 'unavailable';
const time = (ms: number): string => Number.isFinite(ms) && Math.abs(ms) <= 8640000000000000 ? new Date(ms).toISOString().slice(11, 19) : 'unavailable';

export function buildAgentInspectorSections(model: AgentInspectorModel, theme = getWorkbenchPreviewTheme()): readonly InspectorSection[] {
  const agent = model.agent;
  const presentation = agent ? getWorkbenchAgentPresentation(agent.state, theme) : undefined;
  const name = model.selection === 'aggregate' ? 'All agents' : model.selection === 'missing' ? 'Selection unavailable' : model.selection === 'unavailable' ? 'Snapshot unavailable' : agent?.role ?? 'unavailable';
  const details = agent ? [
    { label: 'Name', value: agent.role }, { label: 'Model', value: agent.model ?? 'unavailable' },
    { label: 'State', value: agent.state === 'tool_running' ? 'executing' : presentation!.label.toLowerCase(), color: presentation!.color },
    { label: 'Task', value: model.task?.title ?? (model.explicitTaskSelection ? undefined : agent.taskLabel) ?? 'unavailable' },
  ] : [{ label: 'Name', value: name }, { label: 'Agents', value: model.agentCount === undefined ? 'unavailable' : String(model.agentCount) }, { label: 'Running', value: model.runningCount === undefined ? 'unavailable' : String(model.runningCount) }];
  const activity = model.activity;
  const approvalRows = model.approvals === null ? [{ value: 'Approvals unavailable' }] : model.approvals.length === 0 ? [{ value: 'No pending approvals' }] : model.approvals.slice(0, 3).map((entry) => ({ value: `${entry.agentId ? '' : 'Global: '}${entry.toolName}: ${entry.target}`, color: theme.palette.yellow }));
  if (model.approvals && model.approvals.length > 3) approvalRows.push({ value: `+${model.approvals.length - 3} pending`, color: theme.palette.yellow });
  const artifactRows = model.artifacts === null ? [{ value: 'Artifacts unavailable' }] : model.artifacts.length === 0 ? [{ value: 'No artifacts' }] : model.artifacts.slice(0, 3).map((entry) => ({ value: `${entry.title}${entry.status === 'available' ? '' : ` (${entry.status})`}` }));
  if (model.artifacts && model.artifacts.length > 3) artifactRows.push({ value: `+${model.artifacts.length - 3} more · Ctrl+R` });
  return [
    { title: 'AGENT DETAILS', rows: details },
    { title: 'LIVE ACTIVITY', rows: activity ? [
      { label: 'Tool', value: activity.toolName }, { label: 'Started', value: time(activity.startedAt) },
      { label: 'Elapsed', value: elapsed(activity.elapsedMs) }, { label: 'Status', value: activity.status, color: theme.palette.yellow },
    ] : [{ value: agent ? 'No active tool' : model.selection === 'aggregate' ? 'Select an agent for activity' : 'Activity unavailable' }] },
    { title: 'APPROVALS', rows: approvalRows },
    { title: 'ARTIFACTS', rows: artifactRows },
    { title: 'USAGE', rows: [
      { label: 'Tokens', value: model.tokens === undefined ? 'unavailable' : `${model.tokens.toLocaleString('en-US')}${model.tokensPartial ? '+' : ''}` },
      { label: 'Context', value: 'unavailable' },
      { label: 'Cost', value: model.costUsd === undefined ? 'unavailable' : `$${model.costUsd.toFixed(4)}${model.costPartial ? '+' : ''}` },
    ] },
  ];
}

/** Bounded section collapse keeps all headings visible before allocating extra rows. */
export function paintAgentInspector(canvas: TerminalCanvas, region: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }, model: AgentInspectorModel, theme: WorkbenchPreviewTheme = getWorkbenchPreviewTheme()): void {
  const { x, y, width, height } = region;
  if (width < 1 || height < 1) return;
  const p = theme.palette, g = theme.glyphs;
  const reset = theme.colorMode === 'monochrome' ? '' : '\x1b[0m';
  const write = (row: number, text: string, color = p.foreground): void => {
    if (row >= 0 && row < height) canvas.write(x + (width > 2 ? 1 : 0), y + row, `${color}${truncateDisplayText(text, Math.max(1, width - (width > 2 ? 2 : 0))).replace(theme.glyphMode === 'ascii' ? /…/g : /$^/g, '~')}${reset}`);
  };
  for (let row = 0; row < height; row++) canvas.write(x, y + row, ' '.repeat(width));
  if (width >= 3 && height >= 2) {
    for (let row = 1; row < height - 1; row++) {
      canvas.write(x, y + row, `${p.cyan}${g.vertical}${reset}`);
      canvas.write(x + width - 1, y + row, `${p.cyan}${g.vertical}${reset}`);
    }
    canvas.write(x, y, `${p.cyan}${g.topLeft}${g.horizontal.repeat(width - 2)}${g.topRight}${reset}`);
    canvas.write(x, y + height - 1, `${p.cyan}${g.bottomLeft}${g.horizontal.repeat(width - 2)}${g.bottomRight}${reset}`);
  }
  const inner = Math.max(1, width - (width > 2 ? 2 : 0));
  const sections = buildAgentInspectorSections(model, theme).map((section) => ({ ...section, rows: section.rows.flatMap((entry) => {
    const labelColumns = entry.label ? Math.min(12, Math.max(1, inner - 1)) : 0;
    const valueWidth = Math.max(1, inner - labelColumns);
    if (entry.label !== 'Task') return [entry];
    const wrapped = wrapDisplayText(safe(entry.value), valueWidth);
    return wrapped.slice(0, 3).map((value, index) => ({ ...entry, label: index === 0 ? entry.label : '', value: index === 2 && wrapped.length > 3 ? truncateDisplayText(value + ' more', valueWidth) : value, continuation: index > 0 }));
  }) }));
  const first = height >= 2 ? 1 : 0;
  const available = Math.max(0, height - (height >= 2 ? 2 : 0));
  const allocations = sections.map(() => 0);
  let remaining = Math.max(0, available - (sections.length - 1));
  // First retain one summary per section, then distribute remaining content.
  for (let pass = 0; remaining > 0 && pass < Math.max(...sections.map((section) => section.rows.length)); pass++) for (let i = 0; i < sections.length && remaining > 0; i++) {
    if (allocations[i]! < sections[i]!.rows.length) { allocations[i] = allocations[i]! + 1; remaining--; }
  }
  const dividers = remaining >= sections.length - 1;
  write(0, sections[0]!.title, p.cyan);
  let row = first;
  for (let i = 0; i < sections.length && row < first + available; i++) {
    const section = sections[i]!;
    if (i > 0 && dividers) write(row++, g.horizontal.repeat(Math.max(1, width - 2)), p.divider);
    if (i > 0) write(row++, section.title, p.cyan);
    for (const entry of section.rows.slice(0, allocations[i])) {
      const labelWidth = entry.label || ('continuation' in entry && entry.continuation) ? Math.min(12, Math.max(1, inner - 1)) : 0;
      const label = truncateDisplayText(entry.label ?? '', labelWidth).padEnd(labelWidth, ' ');
      const labelX = x + (width > 2 ? 1 : 0);
      if (row >= 0 && row < height && row < first + available) {
        if (labelWidth) canvas.write(labelX, y + row, `${p.muted}${label}${reset}`);
        const value = truncateDisplayText(safe(entry.value), inner - labelWidth).replace(theme.glyphMode === 'ascii' ? /…/g : /$^/g, '~');
        canvas.write(labelX + labelWidth, y + row, `${entry.color ?? p.foreground}${value}${reset}`);
      }
      row++;
    }
  }
}
