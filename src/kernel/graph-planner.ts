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

const DEFAULT_PLAN_PROMPT = `You are a task planner. Decompose the goal into the fewest steps that one worker each can execute.

Return ONLY a JSON object. No markdown, no code fences, no explanation.
The first character must be { and the last must be }.

{
  "nodes": [
    {
      "id": "n1",
      "title": "Example step (illustrative only — never reuse this content)",
      "goal": "Example goal (replace with a real imperative sentence)",
      "domain": "coding",
      "role": "worker",
      "requiredCapabilities": ["filesystem.read", "filesystem.write"],
      "dependencies": []
    }
  ]
}

Each node: id (short, unique), title (short), goal (one imperative sentence naming a concrete deliverable), domain (coding|research|infra|docs|business), role (explorer|researcher|worker|reviewer|test-investigator|docs-researcher), requiredCapabilities (see catalog below), dependencies (ids of nodes whose output this node consumes).

Rules:
- 1-6 nodes. A single-action goal is 1 node. Do not pad with generic Search/Analyze/Synthesize steps; name what is searched, analyzed, or produced.
- requiredCapabilities: the minimum needed, chosen ONLY from the catalog below. Never invent names. Every node needs at least one. Read-only steps must not request write or shell capabilities.
- dependencies: independent steps get [] so they can run in parallel. A node that consumes another's output lists it.
- Add a final merge node only if several nodes' outputs must be combined.

Capability catalog:
{{capabilityCatalog}}

Example — plain goal in, titled nodes out:
Goal: Create two files in parallel. Worker A creates .tmp/a.txt with 'A done'. Worker B creates .tmp/b.txt with 'B done'.
{"nodes": [
  {"id": "n1", "title": "Write file A", "goal": "Create .tmp/a.txt containing exactly 'A done'", "domain": "coding", "role": "worker", "requiredCapabilities": ["filesystem.write"], "dependencies": []},
  {"id": "n2", "title": "Write file B", "goal": "Create .tmp/b.txt containing exactly 'B done'", "domain": "coding", "role": "worker", "requiredCapabilities": ["filesystem.write"], "dependencies": []}
]}

Task:`;

/** Validate a parsed TaskGraph structure. */
function validateGraph(json: unknown): string[] {
  const errors: string[] = [];
  if (!json || typeof json !== "object") { errors.push("Response is not an object"); return errors; }

  // Handle both {graph: {nodes: [...]}} and {nodes: [...]} formats
  let root = json as Record<string, unknown>;
  let graph = root.graph && typeof root.graph === "object" ? root.graph as Record<string, unknown> : root;

  if (!Array.isArray(graph.nodes) || graph.nodes.length < 1) { errors.push("Graph must have 1+ nodes"); return errors; }
  if (graph.nodes.length > 6) { errors.push("Graph must have at most 6 nodes"); return errors; }
  for (let i = 0; i < graph.nodes.length; i++) {
    const n = graph.nodes[i] as Record<string, unknown>;
    if (!n.title) errors.push(`Node ${i}: missing title`);
    if (!n.goal) errors.push(`Node ${i}: missing goal`);
  }
  return errors;
}

/**
 * Static fallback capability catalog (capabilityIds + tool names).
 * Authority is the registry (`buildDefaultToolIndex()` in
 * src/tools/tool-registry.ts); `CoordinationPlanner` injects the live
 * catalog at plan time, and a parity test pins this mirror. The `mcp.*`
 * wildcard is excluded — a concrete MCP tool name cannot be predicted
 * at plan time.
 */
export const DEFAULT_CAPABILITY_CATALOG: readonly string[] = [
  "filesystem.read", "filesystem.write", "filesystem.search",
  "shell.exec", "patch.apply", "task.complete", "agent.delegate",
  "web.search", "web.fetch", "tool.invoke", "mcp.invoke",
  "file.read", "file.create", "file.delete", "file.exists",
  "dir.search", "grep.search", "glob.match", "shell.run",
  "done", "delegate", "web_search", "web_fetch",
  "create_skill", "list_extensions", "inspect_extension", "create_hook",
];

/** Read-only capability defaults by subagent role. Never write or shell. */
export const ROLE_CAPABILITY_DEFAULTS: Readonly<Record<string, readonly string[]>> = {
  explorer: ["filesystem.read", "filesystem.search"],
  reviewer: ["filesystem.read"],
  test_investigator: ["filesystem.read", "filesystem.search"],
  docs_researcher: ["filesystem.read"],
  researcher: ["web.search", "web.fetch"],
  worker: ["filesystem.read"],
};

/** Read-only capability defaults by domain. Never write or shell. */
export const DOMAIN_CAPABILITY_DEFAULTS: Readonly<Record<string, readonly string[]>> = {
  coding: ["filesystem.read"],
  research: ["filesystem.read"],
  infra: ["filesystem.read"],
  docs: ["filesystem.read"],
  business: ["filesystem.read"],
};

export type RawPlannedNode = {
  requiredCapabilities?: unknown;
  role?: unknown;
  domain?: unknown;
};

/**
 * Deterministic normalization (Layer 2): filter claimed capabilities to
 * the catalog, and guarantee non-empty caps. Empty/missing claims fall
 * back to read-only role/domain defaults. Claims containing UNKNOWN names
 * are preserved verbatim: `classifyCapabilities` treats unknown as
 * unknown-write (workspace-wide scopes) and `authorizeWorker` judges each
 * name through policy — silently dropping an unknown write capability
 * would under-scope ownership and mis-authorize the worker. Only a node
 * that declares nothing gets defaulted (read-only only, never write or
 * shell). `authorizeWorker` stays fail-closed.
 */
export function normalizeNodeCapabilities(
  node: RawPlannedNode,
  catalog: Iterable<string>,
): string[] {
  const allowed = new Set(catalog);
  const raw = node.requiredCapabilities;
  if (raw !== undefined && !Array.isArray(raw)) {
    return [...roleDomainDefault(node)];
  }
  const claimed = (Array.isArray(raw) ? raw : []).filter(
    (c): c is string => typeof c === "string",
  );
  if (claimed.length === 0) return [...roleDomainDefault(node)];
  const unknown = claimed.filter(c => !allowed.has(c));
  if (unknown.length > 0) return [...new Set(claimed)];
  return [...new Set(claimed.filter(c => allowed.has(c)))];
}

function roleDomainDefault(node: RawPlannedNode): readonly string[] {
  const role = typeof node.role === "string" ? node.role : undefined;
  if (role && ROLE_CAPABILITY_DEFAULTS[role]) return ROLE_CAPABILITY_DEFAULTS[role];
  const domain = typeof node.domain === "string" ? node.domain.toLowerCase() : undefined;
  if (domain && DOMAIN_CAPABILITY_DEFAULTS[domain]) return DOMAIN_CAPABILITY_DEFAULTS[domain];
  return ["filesystem.read"];
}

/** Render the plan prompt with a concrete capability catalog. */
export function buildPlanPrompt(catalog: readonly string[] = DEFAULT_CAPABILITY_CATALOG): string {
  return DEFAULT_PLAN_PROMPT.replace("{{capabilityCatalog}}", [...catalog].sort().join(", "));
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
  private capabilityCatalog: readonly string[];

  constructor(opts?: { modelEndpoint?: string; modelName?: string; capabilityCatalog?: string[] }) {
    this.modelEndpoint = opts?.modelEndpoint ?? "http://localhost:11434/api/generate";
    this.modelName = opts?.modelName ?? "qwen3:4b";
    this.capabilityCatalog = opts?.capabilityCatalog ?? DEFAULT_CAPABILITY_CATALOG;
  }

  async plan(goal: string, workflowId: string): Promise<PlannerResult> {
    const prompt = buildPlanPrompt(this.capabilityCatalog) + `\n${goal}`;

    // Attempt 1: base prompt. Attempt 2 (single repair retry): the first
    // output plus its validation errors. Flash-tier models frequently
    // emit near-miss JSON (missing title, fences, prose) that a targeted
    // re-prompt fixes. Transport failures are not retried.
    let rawModelOutput = "";
    try {
      rawModelOutput = await this.callModel(prompt);
    } catch (err) {
      return {
        graph: createFallbackGraph(goal, workflowId),
        rawModelOutput: String(err),
        valid: false,
        errors: [`Model call failed: ${err instanceof Error ? err.message : String(err)}`],
      };
    }

    let parsed = tryParseGraphOutput(rawModelOutput);
    let errors = parsed.ok ? validateGraph(parsed.value) : [parsed.error];
    if (errors.length > 0) {
      const repairPrompt =
        `Your previous output failed validation:\n- ${errors.join("\n- ")}\n\n` +
        `Previous output:\n${rawModelOutput.slice(0, 4000)}\n\n` +
        `Return ONLY the corrected JSON object (first character {, last character }). ` +
        `Keep the same nodes and goal; fix exactly the listed problems.`;
      try {
        rawModelOutput = await this.callModel(repairPrompt);
      } catch (err) {
        return {
          graph: createFallbackGraph(goal, workflowId),
          rawModelOutput: String(err),
          valid: false,
          errors: [`Model repair call failed: ${err instanceof Error ? err.message : String(err)}`],
        };
      }
      parsed = tryParseGraphOutput(rawModelOutput);
      errors = parsed.ok ? validateGraph(parsed.value) : [parsed.error];
      if (errors.length > 0) {
        return {
          graph: createFallbackGraph(goal, workflowId),
          rawModelOutput,
          valid: false,
          errors,
        };
      }
    }

    // Build TaskGraph from parsed model output (validation passed above,
    // so parsed is the success variant).
    const root = (parsed as { ok: true; value: unknown }).value as Record<string, unknown>;
    const modelGraph = (root.graph as Record<string, unknown>) || root;
    const now = new Date().toISOString();
    const graphId = `graph_${randomUUID()}`;
    const modelNodes = modelGraph.nodes as Record<string, unknown>[];

    const nodes: TaskNode[] = modelNodes.map((n, i) => {
      // Accept `dependsOn` as an alias for the canonical `dependencies`
      // (the planner prompt historically used neither name consistently).
      const rawDeps = (n.dependencies as unknown) ?? (n.dependsOn as unknown);
      const role = typeof n.role === "string" ? (n.role as string) : undefined;
      const domain = (n.domain as string) || "unknown";
      return {
        id: (n.id as string) || `node_${graphId}_${i}`,
        graphId,
        title: n.title as string,
        goal: n.goal as string,
        domain,
        ...(role ? { role } : {}),
        status: "pending" as const,
        dependencies: Array.isArray(rawDeps) ? (rawDeps as string[]) : [],
        requiredCapabilities: normalizeNodeCapabilities(
          { requiredCapabilities: n.requiredCapabilities, role, domain },
          this.capabilityCatalog,
        ),
        riskLevel: (n.riskLevel as TaskNode["riskLevel"]) || "low",
        approvalMode: (n.approvalMode as TaskNode["approvalMode"]) || "auto",
        inputs: { goal },
        artifacts: [],
        memoryRefs: [],
        createdAt: now,
        updatedAt: now,
      };
    });

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

    // Infer strategy from dependency shape (#711): only sequential/hybrid are
    // supported. Two or more dependency-free roots means the graph fans out
    // and the scheduler can dispatch those workers in parallel.
    const rootCount = nodes.filter(n => n.dependencies.length === 0).length;
    const strategy: GraphStrategy = rootCount >= 2 ? "hybrid" : "sequential";

    const graph: TaskGraph = {
      id: graphId,
      schemaVersion: "1.0",
      workflowId,
      rootGoal: goal,
      status: "draft",
      strategy,
      nodes,
      edges,
      createdAt: now,
      updatedAt: now,
    };

    return { graph, rawModelOutput, valid: true, errors: [] };
  }

  /** Single model call. Transport failures throw (not retried by plan()). */
  private async callModel(prompt: string): Promise<string> {
    const response = await fetch(this.modelEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.modelName,
        prompt,
        stream: false,
        format: "json",
        // Planning is deterministic work: temperature 0 keeps titles,
        // ids, and capability names stable on flash-tier models.
        options: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(120000),
    });
    const data = await response.json() as Record<string, unknown>;
    return (data.response || data.thinking || "") as string;
  }
}

/** Parse leniently: strip markdown fences, then JSON.parse. */
function tryParseGraphOutput(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  let cleanOutput = raw.trim();
  const fenceMatch = cleanOutput.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleanOutput = fenceMatch[1].trim();
  try {
    return { ok: true, value: JSON.parse(cleanOutput) };
  } catch {
    return { ok: false, error: "Invalid JSON from model" };
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
