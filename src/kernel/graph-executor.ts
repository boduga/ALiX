/**
 * graph-executor.ts — Sequential multi-node TaskGraph executor.
 *
 * Loads a planned graph from .alix/graphs/, validates it, sorts nodes
 * topologically, normalizes missing fields, and executes each node
 * sequentially through runTask(). Stops on first failure.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { TaskGraph, TaskNode, TaskNodeStatus } from "./task-graph.js";
import { transitionNodeStatus, transitionGraphStatus } from "./task-graph.js";
import type { RunResult } from "../run.js";
import { runTask } from "../run.js";

export interface NodeResult {
  nodeId: string;
  title: string;
  status: TaskNodeStatus;
  summary?: string;
  reason?: string;
  durationMs: number;
}

export interface ExecutorResult {
  graphId: string;
  strategy: string;
  nodeCount: number;
  completedNodes: number;
  failedNode?: string;
  results: NodeResult[];
  graphStatus: "completed" | "failed";
}

/** Load a TaskGraph from disk. */
export async function loadGraph(graphId: string, cwd: string): Promise<TaskGraph> {
  const filePath = join(cwd, ".alix", "graphs", `${graphId}.json`);
  if (!existsSync(filePath)) throw new Error(`Graph not found: ${graphId} (${filePath})`);
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as TaskGraph;
}

/** Normalize a node, filling missing fields with safe defaults. */
export function normalizeNode(node: TaskNode): TaskNode {
  return {
    ...node,
    requiredCapabilities: node.requiredCapabilities ?? [],
    riskLevel: node.riskLevel || "medium",
    domain: node.domain || "general",
    dependencies: node.dependencies ?? [],
    status: "ready" as TaskNodeStatus,
  };
}

/** Topological sort: return nodes in dependency order. Throws on cycles. */
export function sortNodesByDependencies(nodes: TaskNode[]): TaskNode[] {
  const sorted: TaskNode[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  function visit(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Cycle detected: node ${id}`);
    visiting.add(id);
    const node = nodeMap.get(id);
    if (node) {
      for (const dep of node.dependencies) visit(dep);
      sorted.push(node);
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const node of nodes) visit(node.id);
  return sorted;
}

export class GraphExecutor {
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  async execute(graphId: string): Promise<ExecutorResult> {
    const graph = await loadGraph(graphId, this.cwd);
    const nodes = graph.nodes.map(normalizeNode);
    const sorted = sortNodesByDependencies(nodes);
    const results: NodeResult[] = [];
    let failed = false;

    for (const node of sorted) {
      const startTime = Date.now();
      let status: TaskNodeStatus = "done";
      let summary = "";
      let reason: string | undefined;

      try {
        const isResearch = (node as any).executionProfile === "research";
        let researchPrefix = "";
        if (isResearch && node.id !== "write_artifacts") {
          researchPrefix = "\n\nIMPORTANT: You are a research agent. You may ONLY use: web_search, web_fetch, and done. Do NOT read or write local project files.";
        } else if (node.id === "write_artifacts") {
          researchPrefix = "\n\nIMPORTANT: You may ONLY use: file.create, file.exists, and done. Write artifacts ONLY under .alix/reports/. Do NOT read project source files.";
        }
        const result: RunResult = await runTask(this.cwd, node.goal + researchPrefix, {
          planMode: false,
          skipContext: isResearch ? true : undefined,
          sessionMode: node.riskLevel === "high" || node.riskLevel === "critical" ? "ask" : "bypass",
        });
        summary = result.summary;
        if (result.reason && result.reason !== "completed") {
          status = "failed";
          reason = result.reason;
          failed = true;
        }
      } catch (err) {
        status = "failed";
        reason = err instanceof Error ? err.message : String(err);
        failed = true;
      }

      if (status === "failed" && node.timeoutMs && Date.now() - startTime >= node.timeoutMs) {
        reason = `Timeout after ${node.timeoutMs}ms`;
      }

      results.push({
        nodeId: node.id,
        title: node.title,
        status,
        summary,
        reason,
        durationMs: Date.now() - startTime,
      });

      if (failed) break;
    }

    return {
      graphId,
      strategy: graph.strategy,
      nodeCount: sorted.length,
      completedNodes: results.filter(r => r.status === "done").length,
      failedNode: failed ? results[results.length - 1].nodeId : undefined,
      results,
      graphStatus: failed ? "failed" : "completed",
    };
  }

  /**
   * Rerun a single node from a graph by ID.
   * Only failed nodes can be rerun without --force.
   */
  async rerunNode(graphId: string, nodeId: string, opts?: { force?: boolean }): Promise<NodeResult> {
    const graph = await loadGraph(graphId, this.cwd);
    const node = graph.nodes.find(n => n.id === nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId} in graph ${graphId}`);

    // Only failed nodes can be rerun by default
    if (node.status !== "failed" && !opts?.force) {
      throw new Error(`Node ${nodeId} status is "${node.status}". Use --force to rerun anyway.`);
    }

    const startTime = Date.now();
    let status: TaskNodeStatus = "done";
    let summary = "";
    let reason: string | undefined;

    try {
      const isResearch = (node as any).executionProfile === "research";
      let researchPrefix = "";
      if (isResearch && node.id !== "write_artifacts") {
        researchPrefix = "\n\nIMPORTANT: You are a research agent. You may ONLY use: web_search, web_fetch, and done. Do NOT read or write local project files.";
      } else if (node.id === "write_artifacts") {
        researchPrefix = "\n\nIMPORTANT: You may ONLY use: file.create, file.exists, and done. Write artifacts ONLY under .alix/reports/. Do NOT read project source files.";
      }
      const result: RunResult = await runTask(this.cwd, node.goal + researchPrefix, {
        planMode: false,
        skipContext: isResearch ? true : undefined,
        disableSkillFactory: isResearch ? true : undefined,
        sessionMode: node.riskLevel === "high" || node.riskLevel === "critical" ? "ask" : "bypass",
      });
      summary = result.summary;
      if (result.reason && result.reason !== "completed") {
        status = "failed";
        reason = result.reason;
      }
    } catch (err) {
      status = "failed";
      reason = err instanceof Error ? err.message : String(err);
    }

    // Update node status in graph file
    node.status = status === "done" ? "done" : "failed";
    node.updatedAt = new Date().toISOString();

    // Recompute graph status from all node states
    const allDone = graph.nodes.every(n => n.status === "done" || n.status === "skipped");
    const anyFailed = graph.nodes.some(n => n.status === "failed");
    graph.status = anyFailed ? "failed" : allDone ? "completed" : "running";

    // Persist updated graph
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await writeFile(
      join(this.cwd, ".alix", "graphs", `${graphId}.json`),
      JSON.stringify(graph, null, 2),
      "utf-8",
    );

    const durationMs = Date.now() - startTime;
    return { nodeId: node.id, title: node.title, status, summary, reason, durationMs };
  }
}
