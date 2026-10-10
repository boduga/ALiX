import type { WorkbenchTaskState } from './task-roster.js';

/** Task-state glyph shared by the ANSI drawer and the native renderer. */
export function taskStateGlyph(state: WorkbenchTaskState | string): string {
  if (state === 'running') return '●';
  if (state === 'completed') return '✓';
  if (state === 'partial') return '◐';
  if (state === 'failed') return '✗';
  if (state === 'blocked') return '!';
  if (state === 'cancelled') return '○';
  return '◌';
}

export function formatByteSize(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KiB`;
  return `${(value / 1_048_576).toFixed(1)} MiB`;
}

/** Dim coordination correlation line shared by agent and task rows. */
export function formatCoordMeta(entry: { readonly coordinationRunId?: string; readonly assignedAgentId?: string }): string | null {
  if (!entry.coordinationRunId && !entry.assignedAgentId) return null;
  const run = entry.coordinationRunId ? `run ${entry.coordinationRunId}` : '';
  const assigned = entry.assignedAgentId ? `assigned ${entry.assignedAgentId}` : '';
  return [run, assigned].filter(Boolean).join(' · ');
}
