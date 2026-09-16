import type { AlixEvent } from '../../../events/types.js';
import type { ProjectionBuilder } from '../../runtime/projection-builder.js';
import type { TaskRosterSnapshot, TaskSummary, WorkbenchTaskState } from '../model/task-roster.js';

function payload(event: AlixEvent): Record<string, unknown> {
  return event.payload && typeof event.payload === 'object' ? event.payload as Record<string, unknown> : {};
}

function taskId(event: AlixEvent): string | undefined {
  const p = payload(event);
  const value = p.taskId ?? p.subagentId ?? p.agentId;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function terminal(value: unknown): WorkbenchTaskState {
  switch (value) {
    case 'success': case 'completed': return 'completed';
    case 'partial': return 'partial';
    case 'cancelled': return 'cancelled';
    default: return 'failed';
  }
}

export class TaskProjection implements ProjectionBuilder<TaskRosterSnapshot> {
  private readonly byId = new Map<string, TaskSummary>();
  private readonly seen = new Set<number>();

  update(events: readonly AlixEvent[]): void {
    for (const event of events) {
      if (this.seen.has(event.seq)) continue;
      this.seen.add(event.seq);
      const id = taskId(event);
      if (!id) continue;
      const p = payload(event);
      const at = Date.parse(event.timestamp) || 0;
      const previous = this.byId.get(id);
      if (event.type === 'subagent.started' || event.type === 'agent.task_assigned') {
        this.byId.set(id, {
          taskId: id,
          agentId: typeof p.agentId === 'string' ? p.agentId : previous?.agentId ?? id,
          title: typeof p.prompt === 'string' ? p.prompt : typeof p.title === 'string' ? p.title : previous?.title ?? id,
          state: event.type === 'agent.task_assigned' ? 'assigned' : 'running',
          ownedPaths: Array.isArray(p.ownedPaths) ? p.ownedPaths.filter((v): v is string => typeof v === 'string') : previous?.ownedPaths ?? [],
          createdAt: previous?.createdAt ?? at,
          updatedAt: at,
        });
        continue;
      }
      if (!previous) continue;
      if (event.type === 'agent.state_changed') {
        const state = p.state === 'queued' || p.state === 'starting' ? 'assigned'
          : p.state === 'completed' || p.state === 'partial' || p.state === 'failed' || p.state === 'cancelled'
            ? terminal(p.state)
            : 'running';
        this.byId.set(id, { ...previous, state, updatedAt: at });
      } else if (event.type === 'subagent.result') {
        this.byId.set(id, { ...previous, state: terminal(p.status), updatedAt: at });
      } else if (event.type === 'agent.completed' || event.type === 'subagent.completed') {
        this.byId.set(id, { ...previous, state: terminal(p.state ?? p.status ?? 'completed'), updatedAt: at });
      } else if (event.type === 'agent.failed' || event.type === 'subagent.failed') {
        this.byId.set(id, { ...previous, state: 'failed', updatedAt: at });
      } else if (event.type === 'agent.cancelled') {
        this.byId.set(id, { ...previous, state: 'cancelled', updatedAt: at });
      }
    }
  }

  snapshot(): TaskRosterSnapshot {
    const tasks = [...this.byId.values()].sort((a, b) => a.createdAt - b.createdAt || a.taskId.localeCompare(b.taskId));
    return {
      tasks,
      queued: tasks.filter((task) => task.state === 'queued' || task.state === 'assigned').length,
      running: tasks.filter((task) => task.state === 'running').length,
    };
  }

  reset(): void {
    this.byId.clear();
    this.seen.clear();
  }
}
