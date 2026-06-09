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
import { CardRegistry } from "../registry/card-registry.js";
import { resolveCapabilities } from "../registry/capability-resolver.js";
import { runTask } from "../run.js";
import { evaluateRuntimeGate } from "../policy/runtime-gate.js";
import { RuleEvaluator } from "../policy/rule-evaluator.js";
import { ApprovalStore } from "../approvals/approval-store.js";

export interface CapabilityPreflightResult {
  requiredCapabilities: string[];
  matchedAgents: string[];
  matchedTools: string[];
  missingCapabilities: string[];
  warnings: string[];
  status: "ready" | "blocked" | "needs_approval";
}

export interface NodeResult {
  nodeId: string;
  title: string;
  status: TaskNodeStatus;
  summary?: string;
  reason?: string;
  durationMs: number;
  capabilityResolution?: CapabilityPreflightResult;
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

export interface ExecutorOpts {
  registry?: CardRegistry;
  /** When true, blocked/needs_approval capability status short-circuits node execution. */
  enforceCapabilities?: boolean;
  policyEvaluator?: RuleEvaluator;
  approvalStore?: ApprovalStore;
}

export class GraphExecutor {
  private cwd: string;
  private registry?: CardRegistry;
  private enforceCapabilities: boolean;
  private policyEvaluator: RuleEvaluator;
  private approvalStore?: ApprovalStore;

  constructor(cwd: string, opts?: ExecutorOpts) {
    this.cwd = cwd;
    this.registry = opts?.registry;
    this.enforceCapabilities = opts?.enforceCapabilities ?? false;
    this.policyEvaluator = opts?.policyEvaluator ?? new RuleEvaluator();
    this.approvalStore = opts?.approvalStore;
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

      let capabilityResolution: CapabilityPreflightResult | undefined;
      if (node.requiredCapabilities && node.requiredCapabilities.length > 0) {
        try {
          const capRegistry = this.registry ?? new CardRegistry();
          const capResult = resolveCapabilities({
            requiredCapabilities: node.requiredCapabilities,
            domain: node.domain,
            executionProfile: (node as any).executionProfile,
            registry: capRegistry,
          });
          const status = capResult.missingCapabilities.length > 0 ? "blocked"
            : capResult.warnings.length > 0 ? "needs_approval" : "ready";
          capabilityResolution = {
            requiredCapabilities: node.requiredCapabilities,
            matchedAgents: capResult.agents.map(a => a.id),
            matchedTools: capResult.tools.map(t => t.id),
            missingCapabilities: capResult.missingCapabilities,
            warnings: capResult.warnings,
            status,
          };
        } catch (err) {
          capabilityResolution = {
            requiredCapabilities: node.requiredCapabilities,
            matchedAgents: [],
            matchedTools: [],
            missingCapabilities: [...node.requiredCapabilities],
            warnings: [`Resolution error: ${err instanceof Error ? err.message : String(err)}`],
            status: "blocked",
          };
        }
      }

      const isResearch = (node as any).executionProfile === "research";
      let researchPrefix = "";
      if (isResearch && node.id !== "write_artifacts") {
        researchPrefix = "\n\nIMPORTANT: You are a research agent. You may ONLY use: web_search, web_fetch, and done. Do NOT read or write local project files.";
      } else if (node.id === "write_artifacts") {
        researchPrefix = "\n\nIMPORTANT: You may ONLY use: file.create, file.exists, and done. Write artifacts ONLY under .alix/reports/. Do NOT read project source files.";
      }

      // Composed enforcement gate (capability + policy + approval)
      if (this.enforceCapabilities && node.requiredCapabilities && node.requiredCapabilities.length > 0) {
        const gateResult = await evaluateRuntimeGate({
          node,
          registry: this.registry ?? new CardRegistry(),
          policyEvaluator: this.policyEvaluator,
          approvalStore: this.approvalStore,
        });

        // Enrich capabilityResolution with gate result
        if (gateResult.capabilityResolution) {
          capabilityResolution = {
            requiredCapabilities: node.requiredCapabilities ?? [],
            matchedAgents: gateResult.capabilityResolution.agents.map(a => a.id),
            matchedTools: gateResult.capabilityResolution.tools.map(t => t.id),
            missingCapabilities: gateResult.capabilityResolution.missingCapabilities,
            warnings: gateResult.capabilityResolution.warnings,
            status: gateResult.status === "ready" ? "ready"
              : gateResult.status === "blocked" ? "blocked" : "needs_approval",
          };
        }

        if (gateResult.status === "blocked") {
          status = "blocked";
          reason = gateResult.reason;
          results.push({
            nodeId: node.id, title: node.title, status, reason,
            durationMs: Date.now() - startTime,
            capabilityResolution,
          });
          failed = true;
          break;
        }

        if (gateResult.status === "needs_approval") {
          status = "blocked";
          reason = gateResult.reason;
          results.push({
            nodeId: node.id, title: node.title, status, reason,
            durationMs: Date.now() - startTime,
            capabilityResolution,
          });
          failed = true;
          break;
        }
        // If "ready", fall through to regular execution
      }

      // Regular execution path — runs for:
      //   - no enforcement (default)
      //   - enforcement on + ready status (falls through from above)
      //   - nodes with no requiredCapabilities (capabilityResolution is undefined)
      if (!this.enforceCapabilities || !capabilityResolution || capabilityResolution.status === "ready") {
        try {
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
        capabilityResolution,
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
    const { writeFile, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { existsSync } = await import("node:fs");
    const graphPath = join(this.cwd, ".alix", "graphs", `${graphId}.json`);
    await writeFile(graphPath, JSON.stringify(graph, null, 2), "utf-8");

    // Append rerun attempt to .runs.json (for projection to read)
    const runsPath = join(this.cwd, ".alix", "graphs", `${graphId}.runs.json`);
    let runs: any[] = [];
    if (existsSync(runsPath)) {
      try { runs = JSON.parse(await readFile(runsPath, "utf-8")); } catch {}
    }
    const attemptNumber = runs.length + 1;
    runs.push({
      attempt: attemptNumber,
      nodeId: node.id,
      status: status === "done" ? "done" : "failed",
      sessionId: undefined,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      summary,
      error: reason,
    });
    await writeFile(runsPath, JSON.stringify(runs, null, 2), "utf-8");

    
    return { nodeId: node.id, title: node.title, status, summary, reason, durationMs: Date.now() - startTime };
  }
}
