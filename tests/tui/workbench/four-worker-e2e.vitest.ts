import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventLog } from '../../../src/runtime-state/events/event-log.js';
import { CoordinationScheduler } from '../../../src/coordination/kernel/coordination-scheduler.js';
import { CoordinationStore } from '../../../src/coordination/kernel/coordination-store.js';
import { createCoordinationRun, createWorkerAssignment } from '../../../src/coordination/kernel/coordination-types.js';
import { OwnershipRegistry } from '../../../src/coordination/ownership/ownership-registry.js';
import { AgentRosterProjection } from '../../../src/interfaces/tui/workbench/projections/agent-roster-projection.js';
import { TaskProjection } from '../../../src/interfaces/tui/workbench/projections/task-projection.js';
import { ArtifactProjection } from '../../../src/interfaces/tui/workbench/projections/artifact-projection.js';
import { TerminalCanvas } from '../../../src/interfaces/tui/canvas.js';
import { resolveWorkbenchLayout } from '../../../src/interfaces/tui/workbench/layout/responsive-layout.js';
import { paintRosterDrawer } from '../../../src/interfaces/tui/workbench/views/roster-drawer.js';
import type { AlixConfig } from '../../../src/operations/config/schema.js';
import { closeAllSharedLedgers } from '../../../src/runtime-state/storage/runtime-ledger.js';
import type { DashboardSnapshot } from '../../../src/interfaces/tui/snapshot.js';
import { createInitialPerTabState, SessionPhase } from '../../../src/interfaces/tui/state.js';
import { assembleWorkbenchViewState } from '../../../src/interfaces/tui/workbench/view-state/assemble.js';
import { createInitialWorkbenchUiState } from '../../../src/interfaces/tui/workbench/model/ui-state.js';
import { projectOperatorShell } from '../../../src/interfaces/tui/workbench/model/operator-shell.js';

function config(): AlixConfig {
  return {
    version: 1,
    model: { provider: 'test', name: 'test' },
    permissions: { default: 'allow', tools: {}, protectedPaths: [], allowNetworkDomains: [], denyCommands: [], sessionMode: 'bypass' },
    context: { repoMap: false, repoMapMode: 'lite', maxRepoMapTokens: 0, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
    runtime: { provider: 'process', shell: '/bin/bash', commandTimeoutMs: 5_000, envAllowlist: [] },
    ui: { enabled: false, host: '127.0.0.1', port: 0, transport: 'sse' },
  } as unknown as AlixConfig;
}

describe('four-worker Workbench end-to-end', () => {
  let cwd = '';

  afterEach(() => {
    closeAllSharedLedgers();
    if (cwd) rmSync(cwd, { recursive: true, force: true });
  });

  it('runs four workers to completion and renders their tasks and artifacts', async () => {
    cwd = mkdtempSync(join(tmpdir(), 'workbench-four-worker-'));
    const outputDir = join(cwd, '.tmp', 'workbench-e2e');
    await mkdir(outputDir, { recursive: true });
    const sessionId = 'workbench-e2e-session';
    const sessionDir = join(cwd, '.alix', 'sessions', sessionId);
    await mkdir(sessionDir, { recursive: true });
    const eventLog = new EventLog(sessionDir);
    const store = new CoordinationStore(cwd);
    const ownership = new OwnershipRegistry(cwd, { sessionId });
    const run = createCoordinationRun({ sessionId, rootGoal: 'Create four Workbench reports', coordinatorAgentId: 'alix' });
    await store.save(run);

    const workers = Array.from({ length: 4 }, (_, index) => {
      const number = index + 1;
      return createWorkerAssignment({
        coordinationRunId: run.id,
        agentId: `alix#${number}`,
        taskLabel: `Report ${number}`,
        goalPrompt: `Create report-${number}.md`,
        requiredCapabilities: ['filesystem.write'],
        ownershipScopes: [`.tmp/workbench-e2e/report-${number}.md`],
        planOrder: number,
        attempt: 0,
        maxAttempts: 1,
      });
    });
    for (const worker of workers) await store.addWorker(run.id, worker);

    const scheduler = new CoordinationScheduler({
      cwd,
      daemonInstanceId: 'workbench-e2e-host',
      configProvider: async () => config(),
      store,
      ownershipRegistry: ownership,
      authorization: { evaluate: async () => ({ status: 'allowed' as const }) } as any,
      eventLog,
      executor: {
        execute: async (worker: typeof workers[number]) => {
          const relativePath = worker.ownershipScopes[0]!;
          const body = `# ${worker.taskLabel}\n\nCompleted by ${worker.id}.\n`;
          await eventLog.append({ sessionId, actor: 'agent', type: 'agent.spawned', payload: {
            agentId: worker.id, taskId: worker.id, role: 'worker', state: 'thinking',
            coordinationRunId: run.id, assignedAgentId: worker.agentId, taskLabel: worker.taskLabel,
            prompt: worker.goalPrompt, ownedPaths: worker.ownershipScopes,
          } });
          await eventLog.append({ sessionId, actor: 'agent', type: 'agent.task_assigned', payload: {
            agentId: worker.id, taskId: worker.id, title: worker.taskLabel,
            coordinationRunId: run.id, assignedAgentId: worker.agentId, ownedPaths: worker.ownershipScopes,
          } });
          await writeFile(join(cwd, relativePath), body, 'utf8');
          await eventLog.append({ sessionId, actor: 'agent', type: 'artifact.created', payload: {
            artifactId: `artifact-${worker.id}`, title: worker.taskLabel, path: relativePath,
            mediaType: 'text/markdown', preview: body, coordinationRunId: run.id,
            agentId: worker.id, taskId: worker.id,
          } });
          await eventLog.append({ sessionId, actor: 'agent', type: 'agent.completed', payload: {
            agentId: worker.id, taskId: worker.id, state: 'completed', coordinationRunId: run.id,
          } });
          return { outcome: 'success' as const, summary: `${worker.taskLabel} complete`, outputPath: relativePath };
        },
      },
    }, { maxConcurrency: 4, maxDispatchPerTick: 4 });

    try {
      const outcome = await scheduler.runUntilIdle(run.id, { pollIntervalMs: 5, timeoutMs: 5_000 });
      const finalRun = await store.load(run.id);
      expect(outcome, JSON.stringify(finalRun?.workers.map((worker) => ({ status: worker.status, error: worker.error })))).toMatchObject({
        finalStatus: 'completed', stopReason: 'completed', dispatched: 4, failed: 0,
      });
      for (let number = 1; number <= 4; number++) {
        expect(await readFile(join(outputDir, `report-${number}.md`), 'utf8')).toContain(`Report ${number}`);
      }

      const events = await eventLog.readAll();
      const agents = new AgentRosterProjection();
      const tasks = new TaskProjection();
      const artifacts = new ArtifactProjection();
      agents.update(events);
      tasks.update(events);
      artifacts.update(events);
      const agentSnapshot = agents.snapshot();
      const taskSnapshot = tasks.snapshot();
      const artifactSnapshot = artifacts.snapshot();
      expect(agentSnapshot.agents).toHaveLength(4);
      expect(agentSnapshot.agents.every((agent) => agent.state === 'completed')).toBe(true);
      expect(taskSnapshot.tasks).toHaveLength(4);
      expect(taskSnapshot.tasks.every((task) => task.state === 'completed')).toBe(true);
      expect(artifactSnapshot).toMatchObject({ artifacts: 4, results: 0, failed: 0 });

      // Slice 3 parity: the fixed four-worker fixture renders at every spec
      // size, and the renderer-neutral view state carries the same semantics
      // regardless of layout (identity/counts are size-independent).
      const sizes = [
        { name: 'wide', columns: 180, rows: 44 },
        { name: 'medium', columns: 120, rows: 36 },
        { name: 'narrow', columns: 80, rows: 34 },
      ] as const;
      for (const size of sizes) {
        const canvas = new TerminalCanvas(size.columns, size.rows);
        paintRosterDrawer({
          canvas, terminalColumns: size.columns, top: 3, bottom: size.rows - 3,
          layout: resolveWorkbenchLayout(size.columns, 'agents'), agents: agentSnapshot, tasks: taskSnapshot,
          artifacts: artifactSnapshot, selectedRunId: run.id,
        });
        const frame = canvas.renderFrame().replace(/\x1b\[[0-9;]*m/gu, '');
        for (let number = 1; number <= 4; number++) {
          expect(frame, `${size.name}: alix#${number}`).toContain(`alix#${number} COMPLETED`);
          expect(frame, `${size.name}: Report ${number}`).toContain(`Report ${number}`);
        }
      }

      const snapshot: DashboardSnapshot = {
        generatedAt: 1,
        session: { mode: 'auto', phase: SessionPhase.Idle, version: 'test', startedAt: 1, turns: 0 },
        daemon: null,
        approvals: { pending: [], recentlyResolved: [], totalPending: 0, totalResolved: 0 },
        runtime: {
          trace: [], timeline: [], workflow: null, totalEventCount: events.length, lastEventAt: null,
          sessionId, capabilities: null, metrics: null, context: null,
          agents: agentSnapshot, tasks: taskSnapshot, artifacts: artifactSnapshot,
        },
        sops: null, policy: null, cwd,
      };
      const viewState = assembleWorkbenchViewState({
        snapshot,
        ui: createInitialWorkbenchUiState({ columns: 120, rows: 30 }),
        chrome: projectOperatorShell(snapshot, createInitialPerTabState()),
        transcriptSource: { timeline: [], trace: [] },
      });
      expect(viewState.roster.agents?.agents).toHaveLength(4);
      expect(new Set(viewState.roster.agents?.agents.map((entry) => entry.agentId)).size).toBe(4);
      expect(viewState.roster.tasks?.tasks).toHaveLength(4);
      expect(viewState.roster.artifacts?.artifacts).toBe(4);
      expect(viewState.inspector.selection).toBe('aggregate');
    } finally {
      await scheduler.shutdown();
    }
  });
});
