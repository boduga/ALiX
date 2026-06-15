/**
 * coordination-planner.ts — Convert TaskGraph plans into persistent
 * CoordinationRun and WorkerAssignment records.
 */

import { randomUUID } from "node:crypto";
import { relative } from "node:path";
import { GraphPlanner, persistGraph } from "./graph-planner.js";
import { validateGraphDag } from "./graph-validator.js";
import { classifyCapabilities } from "./mutation-classifier.js";
import { compileOwnershipClaims } from "./ownership-claim-compiler.js";
import { CoordinationStore } from "./coordination-store.js";
import { createCoordinationRun, createWorkerAssignment } from "./coordination-types.js";
import { buildDefaultToolIndex } from "../tools/tool-registry.js";
import type { TaskGraph, TaskNode } from "./task-graph.js";
import type { CoordinationRun, WorkerAssignment } from "./coordination-types.js";
import type { MutationClass } from "./mutation-classifier.js";
import type { ToolRegistry } from "../tools/tool-registry.js";

export interface TaskGraphPlanner {
  plan(goal: string, workflowId: string): Promise<{
    graph: TaskGraph;
    rawModelOutput: string;
    valid: boolean;
    errors: string[];
  }>;
}

type PlannerResult = Awaited<ReturnType<TaskGraphPlanner["plan"]>>;

function isPlannerResult(value: unknown): value is PlannerResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return "graph" in candidate && typeof candidate.valid === "boolean" && Array.isArray(candidate.errors);
}

export const DOMAIN_SCOPE_MAP: Record<string, string[]> = {
  coding: ["src/**", "tests/**", "package.json", "package-lock.json"],
  docs: ["docs/**", "README.md", "CHANGELOG.md"],
  infra: [
    ".github/**", "Dockerfile*", "docker-compose*.yml", "docker-compose*.yaml",
    "compose*.yml", "compose*.yaml", "infra/**", "terraform/**", "helm/**",
  ],
  research: ["docs/research/**"],
  business: ["docs/**", "README.md"],
};

export function inferOwnershipScopes(node: TaskNode, mutationClass: MutationClass): string[] {
  if (mutationClass === "no-write") return [];
  if (mutationClass === "unknown-write") return ["**"];
  const domain = (node.domain ?? "").toLowerCase();
  if (domain && DOMAIN_SCOPE_MAP[domain]) return [...DOMAIN_SCOPE_MAP[domain]];
  return ["**"];
}

/**
 * Defensive mapping error.
 * Should be unreachable after validateGraphDag() succeeds,
 * unless the graph is mutated between validation and mapping.
 */
export class CoordinationPlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoordinationPlanValidationError";
  }
}

export type CoordinationPlanResult = {
  run: CoordinationRun | null;
  graph: TaskGraph | null;
  valid: boolean;
  errors: string[];
};

export type PlannerOptions = {
  agentPool?: string[];
  modelEndpoint?: string;
  modelName?: string;
};

export class CoordinationPlanner {
  private readonly planner: TaskGraphPlanner;
  private readonly store: CoordinationStore;
  private readonly agentPool: string[];
  private readonly cwd: string;
  private readonly toolRegistry: ToolRegistry;

  constructor(
    cwd: string,
    options: PlannerOptions = {},
    dependencies?: {
      planner?: TaskGraphPlanner;
      store?: CoordinationStore;
      toolRegistry?: ToolRegistry;
    },
  ) {
    this.planner = dependencies?.planner ?? new GraphPlanner({
      modelEndpoint: options.modelEndpoint,
      modelName: options.modelName,
    });
    this.store = dependencies?.store ?? new CoordinationStore(cwd);
    this.agentPool = options.agentPool ?? [];
    this.cwd = cwd;
    this.toolRegistry = dependencies?.toolRegistry ?? buildDefaultToolIndex().registry;
  }

  async plan(
    goal: string,
    coordinatorAgentId: string,
    sessionId: string,
  ): Promise<CoordinationPlanResult> {
    let rawPlanResult: unknown;

    try {
      rawPlanResult = await this.planner.plan(goal, `wf_${randomUUID()}`);
    } catch (error) {
      return this.persistBlockedDiagnostic({
        goal, coordinatorAgentId, sessionId, graph: null,
        errors: [`Planner threw: ${error instanceof Error ? error.message : String(error)}`],
        graphSafeToPersist: false,
      });
    }

    if (!isPlannerResult(rawPlanResult)) {
      return this.persistBlockedDiagnostic({
        goal, coordinatorAgentId, sessionId, graph: null,
        errors: ["Planner returned a malformed result"],
        graphSafeToPersist: false,
      });
    }

    const planResult = rawPlanResult;
    const dagResult = validateGraphDag(planResult.graph);

    if (!planResult.valid || !dagResult.valid) {
      return this.persistBlockedDiagnostic({
        goal, coordinatorAgentId, sessionId, graph: planResult.graph,
        errors: [...planResult.errors, ...dagResult.errors],
        graphSafeToPersist: dagResult.safeToPersist,
      });
    }

    const planOrderByNode = new Map<string, number>(
      dagResult.topologicalOrder.map((nodeId, index) => [nodeId, index]),
    );

    const absoluteGraphPath = await persistGraph(planResult.graph, this.cwd);
    const taskGraphRef = relative(this.cwd, absoluteGraphPath).replaceAll("\\", "/");

    const run = createCoordinationRun({
      sessionId, rootGoal: goal, coordinatorAgentId,
      taskGraphId: planResult.graph.id,
      taskGraphRef,
    });

    const pool = this.agentPool.length > 0 ? this.agentPool : [coordinatorAgentId];
    const nodeToWorkerId = new Map<string, string>();
    const workers: WorkerAssignment[] = [];

    for (const node of planResult.graph.nodes) {
      const workerId = `worker_${randomUUID()}`;
      nodeToWorkerId.set(node.id, workerId);

      const mutationClass = classifyCapabilities(node.requiredCapabilities ?? [], this.toolRegistry);
      const ownershipScopes = inferOwnershipScopes(node, mutationClass);
      const claimResult = compileOwnershipClaims(ownershipScopes);
      const agentId = pool[workers.length % pool.length];

      workers.push(createWorkerAssignment({
        id: workerId,
        coordinationRunId: run.id,
        agentId,
        taskLabel: node.title,
        goalPrompt: node.goal,
        dependencies: [],
        ownershipScopes,
        sourceNodeId: node.id,
        requiredCapabilities: node.requiredCapabilities ?? [],
        riskLevel: node.riskLevel,
        approvalMode: node.approvalMode,
        attempt: 0,
        maxAttempts: 3,
        planOrder: planOrderByNode.get(node.id),
        ownershipClaims: claimResult.claims,
      }));
    }

    for (let index = 0; index < planResult.graph.nodes.length; index += 1) {
      const node = planResult.graph.nodes[index];
      for (const dependencyId of node.dependencies) {
        const dependencyWorkerId = nodeToWorkerId.get(dependencyId);
        if (!dependencyWorkerId) {
          throw new CoordinationPlanValidationError(
            `Unknown graph dependency: ${node.id} → ${dependencyId}`,
          );
        }
        workers[index].dependencies.push(dependencyWorkerId);
      }
    }

    run.workers = workers;
    // Deliberately remains "planning". M0.77c transitions it to "running".
    await this.store.save(run);

    return { run, graph: planResult.graph, valid: true, errors: [] };
  }

  private async persistBlockedDiagnostic(
    options: {
      goal: string;
      coordinatorAgentId: string;
      sessionId: string;
      graph: TaskGraph | null;
      errors: string[];
      graphSafeToPersist: boolean;
    },
  ): Promise<CoordinationPlanResult> {
    const diagnosticErrors = [...options.errors];
    let taskGraphId: string | undefined;
    let taskGraphRef: string | undefined;

    if (options.graph && options.graphSafeToPersist) {
      try {
        const absolutePath = await persistGraph(options.graph, this.cwd);
        taskGraphRef = relative(this.cwd, absolutePath).replaceAll("\\", "/");
        taskGraphId = options.graph.id;
      } catch (error) {
        diagnosticErrors.push(
          `Failed to persist planning graph: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const run = createCoordinationRun({
      sessionId: options.sessionId,
      rootGoal: options.goal,
      coordinatorAgentId: options.coordinatorAgentId,
      taskGraphId,
      taskGraphRef,
    });
    run.status = "blocked";

    run.workers.push(createWorkerAssignment({
      coordinationRunId: run.id,
      agentId: options.coordinatorAgentId,
      taskLabel: "Planner diagnostic — requires review",
      goalPrompt: options.goal,
      ownershipScopes: ["**"],
      status: "blocked",
      error: `Planner validation failed: ${diagnosticErrors.join("; ")}`,
    }));

    await this.store.save(run);
    return { run, graph: options.graph, valid: false, errors: diagnosticErrors };
  }
}
