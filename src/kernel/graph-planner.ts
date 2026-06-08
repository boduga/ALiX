/**
 * graph-planner.ts — TaskGraph planner (dry-run only).
 *
 * Calls the configured fast model with a planning prompt, parses the
 * response into a multi-node TaskGraph, validates it, and persists
 * it to disk. NO tools are executed.
 */

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { TaskGraph, TaskNode, GraphStrategy } from "./task-graph.js";

export interface PlannerResult {
  graph: TaskGraph;
  rawModelOutput: string;
  valid: boolean;
  errors: string[];
}

const DEFAULT_PLAN_PROMPT = `You are a software architecture planner. Given a user task, decompose it into a TaskGraph with 3-6 nodes.

Each node represents one atomic step. Nodes can be:
- sequential (must complete before next starts)
- parallel (can run simultaneously)
- critic (reviews and validates output)

Return ONLY valid JSON matching this schema:
{
  "graph": {
    "strategy": "sequential" | "parallel" | "map_reduce" | "critic_loop" | "hybrid",
    "nodes": [
      {
        "id": "node_1",
        "title": "short title",
        "goal": "what this node does",
        "domain": "coding | research | infra | docs | business",
        "dependencies": [],
        "riskLevel": "low | medium | high",
        "approvalMode": "auto | ask | deny",
        "requiredCapabilities": ["filesystem.read", "web.search", ...]
      }
    ]
  }
}

Task:`;

/** Validate a parsed TaskGraph structure. */
function validateGraph(json: unknown): string[] {
  const errors: string[] = [];
  if (!json || typeof json !== "object") { errors.push("Response is not an object"); return errors; }
  const obj = json as Record<string, unknown>;
  if (!obj.graph || typeof obj.graph !== "object") { errors.push("Missing 'graph' key"); return errors; }
  const graph = obj.graph as Record<string, unknown>;
  if (!Array.isArray(graph.nodes) || graph.nodes.length < 2) { errors.push("Graph must have 2+ nodes"); }
  if (!graph.strategy) { errors.push("Missing strategy"); }
  const validStrategies = ["sequential", "parallel", "map_reduce", "critic_loop", "hybrid"];
  if (graph.strategy && !validStrategies.includes(graph.strategy as string)) {
    errors.push(`Invalid strategy: ${graph.strategy}`);
  }
  const rawNodes = graph.nodes as unknown[] | undefined;
  for (let i = 0; i < (rawNodes?.length ?? 0); i++) {
    const n = (graph.nodes as Record<string, unknown>[])[i];
    if (!n.id) errors.push(`Node ${i}: missing id`);
    if (!n.title) errors.push(`Node ${i}: missing title`);
    if (!n.goal) errors.push(`Node ${i}: missing goal`);
  }
  return errors;
}

/** Create a fallback sequential graph when the model fails. */
export function createFallbackGraph(goal: string, workflowId: string): TaskGraph {
  const now = new Date().toISOString();
  const graphId = `graph_${randomUUID()}`;
  const node: TaskNode = {
    id: `node_${randomUUID()}`,
    graphId, title: "Execute task", goal, domain: "legacy",
    status: "ready", dependencies: [], requiredCapabilities: [],
    riskLevel: "low", approvalMode: "auto", inputs: { goal }, artifacts: [], memoryRefs: [],
    createdAt: now, updatedAt: now,
  };
  return {
    id: graphId, schemaVersion: "1.0", workflowId, rootGoal: goal,
    status: "draft", strategy: "sequential", nodes: [node], edges: [],
    createdAt: now, updatedAt: now,
  };
}

export class GraphPlanner {
  private modelEndpoint: string;
  private modelName: string;

  constructor(opts?: { modelEndpoint?: string; modelName?: string }) {
    this.modelEndpoint = opts?.modelEndpoint ?? "http://localhost:11434/api/generate";
    this.modelName = opts?.modelName ?? "qwen3:4b";
  }

  async plan(goal: string, workflowId: string): Promise<PlannerResult> {
    const prompt = DEFAULT_PLAN_PROMPT + `\n${goal}`;

    let rawModelOutput = "";
    try {
      const response = await fetch(this.modelEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.modelName,
          prompt,
          stream: false,
          format: "json",
        }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await response.json() as Record<string, unknown>;
      rawModelOutput = (data.response || data.thinking || "") as string;
    } catch (err) {
      return {
        graph: createFallbackGraph(goal, workflowId),
        rawModelOutput: String(err),
        valid: false,
        errors: [`Model call failed: ${err instanceof Error ? err.message : String(err)}`],
      };
    }

    // Parse model output
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawModelOutput);
    } catch {
      return {
        graph: createFallbackGraph(goal, workflowId),
        rawModelOutput,
        valid: false,
        errors: ["Invalid JSON from model"],
      };
    }

    // Validate
    const errors = validateGraph(parsed);
    if (errors.length > 0) {
      return {
        graph: createFallbackGraph(goal, workflowId),
        rawModelOutput,
        valid: false,
        errors,
      };
    }

    // Build TaskGraph from parsed model output
    const modelGraph = (parsed as Record<string, unknown>).graph as Record<string, unknown>;
    const now = new Date().toISOString();
    const graphId = `graph_${randomUUID()}`;
    const modelNodes = modelGraph.nodes as Record<string, unknown>[];

    const nodes: TaskNode[] = modelNodes.map((n, i) => ({
      id: (n.id as string) || `node_${graphId}_${i}`,
      graphId,
      title: n.title as string,
      goal: n.goal as string,
      domain: (n.domain as string) || "unknown",
      status: "pending" as const,
      dependencies: (n.dependencies as string[]) || [],
      requiredCapabilities: (n.requiredCapabilities as string[]) || [],
      riskLevel: (n.riskLevel as TaskNode["riskLevel"]) || "low",
      approvalMode: (n.approvalMode as TaskNode["approvalMode"]) || "auto",
      inputs: { goal },
      artifacts: [],
      memoryRefs: [],
      createdAt: now,
      updatedAt: now,
    }));

    // Build edges from dependency declarations
    const edges: TaskGraph["edges"] = [];
    for (let i = 0; i < nodes.length; i++) {
      for (const dep of nodes[i].dependencies) {
        const depNode = nodes.find(n => n.id === dep);
        if (depNode) {
          edges.push({
            id: `edge_${graphId}_${i}`,
            graphId,
            from: depNode.id,
            to: nodes[i].id,
            type: "requires",
          });
        }
      }
    }

    const graph: TaskGraph = {
      id: graphId,
      schemaVersion: "1.0",
      workflowId,
      rootGoal: goal,
      status: "draft",
      strategy: modelGraph.strategy as GraphStrategy,
      nodes,
      edges,
      createdAt: now,
      updatedAt: now,
    };

    return { graph, rawModelOutput, valid: true, errors: [] };
  }
}

/** Persist a TaskGraph to `.alix/graphs/<graphId>.json`. */
export async function persistGraph(graph: TaskGraph, cwd: string): Promise<string> {
  const dir = join(cwd, ".alix", "graphs");
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${graph.id}.json`);
  await writeFile(filePath, JSON.stringify(graph, null, 2), "utf-8");
  return filePath;
}

/** Validate a TaskGraph against the JSON schema. */
export function validateGraphSchema(graph: TaskGraph): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!graph.id) errors.push("Missing id");
  if (graph.schemaVersion !== "1.0") errors.push(`Invalid schemaVersion: ${graph.schemaVersion}`);
  if (!graph.workflowId) errors.push("Missing workflowId");
  if (!graph.rootGoal) errors.push("Missing rootGoal");
  if (!["draft", "ready", "running", "completed", "failed", "cancelled"].includes(graph.status)) {
    errors.push(`Invalid status: ${graph.status}`);
  }
  if (!Array.isArray(graph.nodes) || graph.nodes.length < 1) errors.push("Must have at least 1 node");
  return { valid: errors.length === 0, errors };
}
