import { stripAnsi } from '../../../src/tui/box.js';
import { TerminalCanvas } from '../../../src/tui/canvas.js';
import type { DashboardSnapshot } from '../../../src/tui/snapshot.js';
import type { AgentRosterSnapshot, AgentSummary } from '../../../src/tui/workbench/model/agent-roster.js';
import type { TaskSummary } from '../../../src/tui/workbench/model/task-roster.js';
import type { WorkbenchInspectableItem } from '../../../src/tui/workbench/model/artifact-inspection.js';
import { getWorkbenchPreviewTheme, type WorkbenchPreviewTheme } from '../../../src/tui/workbench/model/preview-theme.js';
import { buildAgentInspectorModel } from '../../../src/tui/workbench/model/agent-inspector.js';
import { paintAgentInspector } from '../../../src/tui/workbench/views/agent-inspector.js';
import { createWorkbenchRenderHarness } from '../../fixtures/tui/workbench-render-harness.js';

/**
 * Shared factories + snapshot/paint helpers for the parity suites
 * (`parity-scenarios.vitest.ts` and `parity-charset.vitest.ts`). One agent
 * factory and one roster-totals literal keep scenario states identical
 * across the two suites. Suite-specific harnesses (e.g. `denyHarness`'s
 * approval-manager wiring in parity-scenarios) stay in their own files.
 */

/** Shared agent row factory: identical defaults for scenario and charset tests. */
export function agent(agentId: string, overrides: Partial<AgentSummary> = {}): AgentSummary {
  return {
    agentId, role: agentId, state: 'thinking', coordinationRunId: 'run1', currentTaskId: 'task1',
    startedAt: 1000, lastProgressAt: 1000, ownedPaths: [], usage: {}, ...overrides,
  };
}

/** The roster totals literal shared by every parity snapshot builder. */
export function rosterTotals(agentCount: number, running = 0): AgentRosterSnapshot['totals'] {
  return { agents: agentCount, running, waitingApproval: 0, stalled: 0, tokenCoverage: 0, costCoverage: 0 };
}

export function roster(agents: readonly AgentSummary[], running = 0): AgentRosterSnapshot {
  return { agents, active: agents.length, totals: rosterTotals(agents.length, running) };
}

function task(taskId: string, overrides: Partial<TaskSummary> = {}): TaskSummary {
  // coordinationRunId mirrors the shared agent() default so the inspector's
  // identity join (agent + run + task) matches without per-suite overrides.
  return {
    taskId, title: taskId, state: 'running', coordinationRunId: 'run1',
    ownedPaths: [], createdAt: 1, updatedAt: 1, ...overrides,
  };
}

export interface ScenarioSnapshotOptions {
  readonly agents?: readonly AgentSummary[];
  readonly rosterUnavailable?: boolean;
  readonly artifacts?: readonly WorkbenchInspectableItem[] | null;
  readonly approvals?: DashboardSnapshot['approvals'];
}

/** Harness-based dashboard snapshot with explicit roster/artifacts/approvals. */
export function scenarioSnapshot(options: ScenarioSnapshotOptions = {}): DashboardSnapshot {
  const base = createWorkbenchRenderHarness().state.lastSnapshot!;
  const agents = options.agents ?? [agent('a')];
  const artifacts = options.artifacts === undefined ? [] : options.artifacts;
  return {
    ...base,
    generatedAt: 19_000,
    approvals: options.approvals !== undefined ? options.approvals
      : { pending: [], recentlyResolved: [], totalPending: 0, totalResolved: 0 },
    runtime: {
      ...base.runtime!,
      agents: options.rosterUnavailable ? null : roster(agents),
      tasks: { tasks: [], queued: 0, running: 0, blocked: 0 },
      artifacts: artifacts === null ? null : { items: artifacts, artifacts: artifacts.length, results: 0, failed: 0 },
    },
  };
}

/** Single selected-agent snapshot (CJK task title) for the charset inspector. */
export function inspectorSnapshot(overrides: Partial<AgentSummary> = {}): DashboardSnapshot {
  const base = createWorkbenchRenderHarness().state.lastSnapshot!;
  const selected = agent('frontend-agent', { currentTaskId: 't1', ...overrides });
  return {
    ...base, generatedAt: 19000,
    approvals: { pending: [], recentlyResolved: [], totalPending: 0, totalResolved: 0 },
    runtime: {
      ...base.runtime!,
      agents: { agents: [selected], active: 1, totals: rosterTotals(1, 1) },
      tasks: { tasks: [task('t1', { agentId: 'frontend-agent', title: '响应式侧边栏 implemented' })], queued: 0, running: 1, blocked: 0 },
    },
  };
}

/** Stripped inspector paint used by the scenario suite. */
export function paintInspectorFrame(model: ReturnType<typeof buildAgentInspectorModel>, width = 56, height = 40): string {
  const canvas = new TerminalCanvas(width, height);
  paintAgentInspector(canvas, { x: 0, y: 0, width, height }, model);
  return stripAnsi(canvas.renderFrame());
}

/** Themed inspector paint over a dotted surround (charset suite); raw ANSI frame. */
export function paintThemedInspectorFrame(theme?: WorkbenchPreviewTheme, width = 40, height = 36): string {
  const canvas = new TerminalCanvas(width + 4, height + 4);
  for (let y = 0; y < height + 4; y++) canvas.write(0, y, '.'.repeat(width + 4));
  const model = buildAgentInspectorModel(inspectorSnapshot(), { selectedAgentId: 'frontend-agent' });
  paintAgentInspector(canvas, { x: 2, y: 2, width, height }, model, theme ?? getWorkbenchPreviewTheme());
  return canvas.renderFrame();
}
