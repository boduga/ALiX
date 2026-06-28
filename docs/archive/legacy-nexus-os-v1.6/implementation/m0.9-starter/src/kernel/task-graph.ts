export type TaskNodeStatus = 'pending' | 'ready' | 'running' | 'blocked' | 'awaiting_approval' | 'cancelling' | 'done' | 'failed' | 'cancelled' | 'skipped';
export type TaskGraphStatus = 'draft' | 'ready' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled';

export interface TaskNode {
  id: string;
  graphId: string;
  title: string;
  goal: string;
  domain: string;
  status: TaskNodeStatus;
  dependencies: string[];
  assignedAgent?: string;
  requiredCapabilities: string[];
  forbiddenCapabilities?: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  approvalMode: 'auto' | 'ask' | 'deny';
  inputs: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  artifacts: string[];
  memoryRefs: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskGraph {
  id: string;
  schemaVersion: '1.0';
  workflowId: string;
  rootGoal: string;
  status: TaskGraphStatus;
  strategy: 'sequential' | 'parallel' | 'map_reduce' | 'critic_loop' | 'human_gated' | 'hybrid';
  nodes: TaskNode[];
  edges: { id: string; graphId: string; from: string; to: string; type: 'requires' | 'informs' | 'blocks' | 'critiques' | 'approves' }[];
  createdAt: string;
  updatedAt: string;
}

export function createSingleNodeGraph(workflowId: string, goal: string, domain = 'legacy'): TaskGraph {
  const now = new Date().toISOString();
  const graphId = `graph_${crypto.randomUUID()}`;
  const node: TaskNode = {
    id: `node_${crypto.randomUUID()}`,
    graphId,
    title: 'Legacy run node',
    goal,
    domain,
    status: 'ready',
    dependencies: [],
    requiredCapabilities: [],
    riskLevel: 'low',
    approvalMode: 'auto',
    inputs: { goal },
    artifacts: [],
    memoryRefs: [],
    createdAt: now,
    updatedAt: now,
  };
  return { id: graphId, schemaVersion: '1.0', workflowId, rootGoal: goal, status: 'ready', strategy: 'sequential', nodes: [node], edges: [], createdAt: now, updatedAt: now };
}
