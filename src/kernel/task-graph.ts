import { randomUUID } from "node:crypto";

export type TaskNodeStatus =
  | "pending" | "ready" | "running" | "blocked" | "awaiting_approval"
  | "cancelling" | "done" | "failed" | "cancelled" | "skipped";

export type TaskGraphStatus =
  | "draft" | "ready" | "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type ApprovalMode = "auto" | "ask" | "deny";
export type GraphStrategy = "sequential" | "parallel" | "map_reduce" | "critic_loop" | "human_gated" | "hybrid";
export type EdgeType = "requires" | "informs" | "blocks" | "critiques" | "approves";

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
  riskLevel: RiskLevel;
  approvalMode: ApprovalMode;
  inputs: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  artifacts: string[];
  memoryRefs: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskGraph {
  id: string;
  schemaVersion: "1.0";
  workflowId: string;
  rootGoal: string;
  status: TaskGraphStatus;
  strategy: GraphStrategy;
  nodes: TaskNode[];
  edges: { id: string; graphId: string; from: string; to: string; type: EdgeType }[];
  createdAt: string;
  updatedAt: string;
}

export function createSingleNodeGraph(workflowId: string, goal: string, domain = "legacy"): { graph: TaskGraph; node: TaskNode } {
  const now = new Date().toISOString();
  const graphId = `graph_${randomUUID()}`;
  const node: TaskNode = {
    id: `node_${randomUUID()}`,
    graphId,
    title: "Legacy run node",
    goal,
    domain,
    status: "ready",
    dependencies: [],
    requiredCapabilities: [],
    riskLevel: "low",
    approvalMode: "auto",
    inputs: { goal },
    artifacts: [],
    memoryRefs: [],
    createdAt: now,
    updatedAt: now,
  };
  const graph: TaskGraph = {
    id: graphId,
    schemaVersion: "1.0",
    workflowId,
    rootGoal: goal,
    status: "ready",
    strategy: "sequential",
    nodes: [node],
    edges: [],
    createdAt: now,
    updatedAt: now,
  };
  return { graph, node };
}

export function transitionNodeStatus(node: TaskNode, status: TaskNodeStatus): TaskNode {
  return { ...node, status, updatedAt: new Date().toISOString() };
}

export function transitionGraphStatus(graph: TaskGraph, status: TaskGraphStatus): TaskGraph {
  return { ...graph, status, updatedAt: new Date().toISOString() };
}
