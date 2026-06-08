# M0.10-D: research.deep_report SOP

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `alix sop run research.deep_report --topic "<topic>"` creates and executes a deterministic multi-node research graph that produces structured report artifacts.

**Architecture:** A built-in SOP definition (`SopDefinition`) with a `buildGraph()` that constructs a 6-node sequential TaskGraph. The graph is persisted to `.alix/graphs/` and executed via the existing `GraphExecutor`. Each node runs a `runTask()` call with a node-specific prompt. Results are collected and written as artifacts to `.alix/reports/<id>/`.

**Tech Stack:** TypeScript, node:test.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/sop/sop-registry.ts` | **Create** | `SopDefinition` type, `SopRegistry`, built-in SOP list |
| `src/sop/research-deep-report.ts` | **Create** | `buildResearchDeepReportGraph()` — builds 6-node graph |
| `src/sop/artifact-writer.ts` | **Create** | Write report artifacts to `.alix/reports/` |
| `src/cli.ts` | **Modify** | Add `alix sop list` and `alix sop run` |
| `tests/sop/research-deep-report.test.ts` | **Create** | Tests for graph shape, artifacts, missing topic |

---

### Task 1: Create SOP types and registry

**Files:**
- Create: `src/sop/sop-registry.ts`

- [ ] **Step 1: Write the module**

```typescript
/**
 * sop-registry.ts — Built-in SOP pack definitions.
 *
 * Each SOP knows how to build a TaskGraph for its workflow.
 * SOPs are deterministic — they define node structure, not model planning.
 */

import type { TaskGraph } from "../kernel/task-graph.js";

export interface SopDefinition {
  id: string;
  name: string;
  description: string;
  buildGraph: (input: Record<string, unknown>) => { graph: TaskGraph; reportDir: string };
}

const registry = new Map<string, SopDefinition>();

export function registerSop(def: SopDefinition): void {
  registry.set(def.id, def);
}

export function getSop(id: string): SopDefinition | undefined {
  return registry.get(id);
}

export function listSops(): SopDefinition[] {
  return Array.from(registry.values());
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -3
```

- [ ] **Step 3: Commit**

```bash
git add src/sop/sop-registry.ts
git commit -m "feat(sop): add SOP registry with SopDefinition type"
```

---

### Task 2: Create research.deep_report graph builder

**Files:**
- Create: `src/sop/research-deep-report.ts`

- [ ] **Step 1: Write the module**

```typescript
/**
 * research-deep-report.ts — research.deep_report SOP definition.
 *
 * Builds a 6-node sequential TaskGraph for research:
 *   1. scope_topic     — define research scope and questions
 *   2. search_sources  — search web for relevant sources
 *   3. extract_claims  — extract claims from sources
 *   4. synthesize      — combine into coherent report text
 *   5. critic_review   — check for gaps, conflicts, unsupported claims
 *   6. write_artifacts — write final_report.md, sources.json, claims.json, critic_review.md
 *
 * All nodes use runTask with focused prompts. No model-planned graph.
 */

import { randomUUID } from "node:crypto";
import type { TaskGraph, TaskNode } from "../kernel/task-graph.js";
import { registerSop } from "./sop-registry.js";

function makeNode(
  id: string,
  graphId: string,
  title: string,
  goal: string,
  domain: string,
  dependencies: string[],
  capabilities: string[],
): TaskNode {
  const now = new Date().toISOString();
  return {
    id, graphId, title, goal, domain,
    status: "pending", dependencies, requiredCapabilities: capabilities,
    riskLevel: "low", approvalMode: "auto", inputs: {},
    artifacts: [], memoryRefs: [],
    createdAt: now, updatedAt: now,
  };
}

export function buildResearchDeepReportGraph(topic: string, reportId: string): { graph: TaskGraph; reportDir: string } {
  const graphId = `graph_${randomUUID()}`;
  const now = new Date().toISOString();
  const workflowId = `wf_${randomUUID()}`;

  const nodes: TaskNode[] = [
    makeNode("scope_topic", graphId, "Define research scope",
      `Define the research scope for: ${topic}. Output 3-5 research questions.`,
      "research", [], ["web.search"]),
    makeNode("search_sources", graphId, "Search for sources",
      `Search the web for sources related to: ${topic}. Find at least 5 credible sources. List URLs and brief descriptions.`,
      "research", ["scope_topic"], ["web.search"]),
    makeNode("extract_claims", graphId, "Extract claims from sources",
      `Read the sources found and extract key claims. Map each claim to its source URL. Note any contradictions.`,
      "research", ["search_sources"], ["web.search", "filesystem.read"]),
    makeNode("synthesize", graphId, "Synthesize report",
      `Write a structured research report about: ${topic}. Use the extracted claims. Separate facts from interpretations. Include a conclusions section.`,
      "research", ["extract_claims"], ["filesystem.read"]),
    makeNode("critic_review", graphId, "Critic review",
      `Review the synthesized report. Check for: unsupported claims, source concentration, missing citations, logical gaps. List each issue found.`,
      "research", ["synthesize"], ["filesystem.read"]),
    makeNode("write_artifacts", graphId, "Write report artifacts",
      `Write the final report, sources list, claims mapping, and critic review to the artifacts directory: .alix/reports/${reportId}/`,
      "research", ["critic_review"], ["filesystem.write"]),
  ];

  const edges = [
    { id: `e1_${graphId}`, graphId, from: "scope_topic", to: "search_sources", type: "requires" as const },
    { id: `e2_${graphId}`, graphId, from: "search_sources", to: "extract_claims", type: "requires" as const },
    { id: `e3_${graphId}`, graphId, from: "extract_claims", to: "synthesize", type: "requires" as const },
    { id: `e4_${graphId}`, graphId, from: "synthesize", to: "critic_review", type: "requires" as const },
    { id: `e5_${graphId}`, graphId, from: "critic_review", to: "write_artifacts", type: "requires" as const },
  ];

  const graph: TaskGraph = {
    id: graphId, schemaVersion: "1.0", workflowId,
    rootGoal: topic, status: "draft", strategy: "sequential",
    nodes, edges, createdAt: now, updatedAt: now,
  };

  const reportDir = `.alix/reports/${reportId}`;

  // Register this SOP
  registerSop({
    id: "research.deep_report",
    name: "Deep Research Report",
    description: "Search, verify, claim-map, synthesize, critique, and produce a cited report",
    buildGraph: (input) => {
      const t = (input.topic as string) || topic;
      return buildResearchDeepReportGraph(t, reportId);
    },
  });

  return { graph, reportDir };
}
```

- [ ] **Step 2: Fix import — move registerSop call to the registry**

Remove the `registerSop` call from this file and instead export the function for registration.

Replace the bottom section with:

```typescript
// Remove: registerSop({...}) — registration happens in sop-registry.ts
// Export the function so the registry can call it
export function getResearchDeepReportDef() {
  return {
    id: "research.deep_report",
    name: "Deep Research Report",
    description: "Search, verify, claim-map, synthesize, critique, and produce a cited report",
    buildGraph: (input: Record<string, unknown>) => buildResearchDeepReportGraph(
      (input.topic as string) || "research topic",
      `report_${Date.now()}`,
    ),
  };
}
```

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/sop/research-deep-report.ts
git commit -m "feat(sop): research.deep_report graph builder with 6 nodes"
```

---

### Task 3: Create artifact writer

**Files:**
- Create: `src/sop/artifact-writer.ts`

- [ ] **Step 1: Write the module**

```typescript
/**
 * artifact-writer.ts — Write research report artifacts to disk.
 *
 * Each artifact is written to .alix/reports/<reportId>/.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export interface ReportArtifacts {
  finalReport: string;
  sources: Array<{ url: string; title: string; credibility: string }>;
  claims: Array<{ claim: string; sourceUrl: string }>;
  criticReview: string;
}

export async function writeReportArtifacts(
  cwd: string,
  reportId: string,
  artifacts: ReportArtifacts,
): Promise<string> {
  const dir = join(cwd, ".alix", "reports", reportId);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });

  await writeFile(join(dir, "final_report.md"), artifacts.finalReport, "utf-8");
  await writeFile(join(dir, "sources.json"), JSON.stringify(artifacts.sources, null, 2), "utf-8");
  await writeFile(join(dir, "claims.json"), JSON.stringify(artifacts.claims, null, 2), "utf-8");
  await writeFile(join(dir, "critic_review.md"), artifacts.criticReview, "utf-8");

  const manifest = {
    reportId,
    createdAt: new Date().toISOString(),
    artifactCount: 4,
    artifacts: ["final_report.md", "sources.json", "claims.json", "critic_review.md"],
  };
  await writeFile(join(dir, "run_manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

  return dir;
}
```

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | tail -3
```

- [ ] **Step 3: Commit**

```bash
git add src/sop/artifact-writer.ts
git commit -m "feat(sop): report artifact writer for research.deep_report"
```

---

### Task 4: Wire SOP CLI commands

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add `alix sop list` and `alix sop run`**

Find the `alix config` section and add before it:

```typescript
// --- alix sop --- SOP management ---
if (command === "sop" && args[0] === "list") {
  const { listSops } = await import("./sop/sop-registry.js");
  const sops = listSops();
  if (sops.length === 0) { console.log("No SOPs registered."); process.exit(0); }
  for (const s of sops) {
    console.log(`  ${s.id.padEnd(30)} ${s.description}`);
  }
  process.exit(0);
}

if (command === "sop" && args[0] === "run") {
  const sopId = args[1];
  const topicIdx = args.indexOf("--topic");
  const topic = topicIdx >= 0 ? args.slice(topicIdx + 1).join(" ") : "";
  const planOnly = args.includes("--plan-only");

  if (!sopId) { console.error("Usage: alix sop run <sop-id> --topic \"<topic>\" [--plan-only]"); process.exit(1); }
  if (!topic) { console.error("Error: --topic is required"); process.exit(1); }

  const { getSop, listSops } = await import("./sop/sop-registry.js");
  const { getResearchDeepReportDef } = await import("./sop/research-deep-report.js");

  // Register built-in SOPs
  const deepReport = getResearchDeepReportDef();
  // Import triggers registration or register manually

  const sop = getSop(sopId);
  if (!sop) { console.error(`SOP not found: ${sopId}`); process.exit(1); }

  const result = sop.buildGraph({ topic });
  const { graph, reportDir } = result as any;

  // Persist graph
  const { persistGraph } = await import("./kernel/graph-planner.js");
  const filePath = await persistGraph(graph, cwd);

  console.log(`SOP:        ${sopId}`);
  console.log(`Topic:      ${topic}`);
  console.log(`Graph:      ${graph.id}`);
  console.log(`Nodes:      ${graph.nodes.length}`);
  console.log(`Saved:      ${filePath}`);
  console.log();

  if (planOnly) {
    console.log("Plan-only mode. Graph saved — not executed.");
    process.exit(0);
  }

  // Execute graph
  const { GraphExecutor } = await import("./kernel/graph-executor.js");
  const executor = new GraphExecutor(cwd);
  console.log("Executing...");
  const execResult = await executor.execute(graph.id);
  for (const nr of execResult.results) {
    const icon = nr.status === "done" ? "✓" : "✗";
    console.log(`  ${icon} ${nr.title} (${nr.durationMs}ms)`);
  }
  console.log(`\nResult: ${execResult.graphStatus} — ${execResult.completedNodes}/${execResult.nodeCount} nodes`);

  if (execResult.graphStatus === "completed") {
    console.log(`Report:     ${reportDir}/`);
  }
  process.exit(0);
}

if (command === "sop" && args[0] !== "list" && args[0] !== "run") {
  console.log("Usage: alix sop list | alix sop run <id> --topic \"<topic>\"");
  process.exit(0);
}
```

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | tail -10
```

Fix any import/registration issues (the SOP needs to be registered before `getSop` is called).

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): add alix sop list and alix sop run commands"
```

---

### Task 5: Write tests

**Files:**
- Create: `tests/sop/research-deep-report.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildResearchDeepReportGraph } from "../../src/sop/research-deep-report.js";

describe("research.deep_report", () => {

  it("builds a 6-node sequential graph", () => {
    const { graph } = buildResearchDeepReportGraph("test topic", "report_1");
    assert.equal(graph.nodes.length, 6);
    assert.equal(graph.strategy, "sequential");
  });

  it("nodes are in correct dependency order", () => {
    const { graph } = buildResearchDeepReportGraph("test", "report_2");
    const nodeIds = graph.nodes.map(n => n.id);
    assert.equal(nodeIds[0], "scope_topic");
    assert.equal(nodeIds[1], "search_sources");
    assert.equal(nodeIds[2], "extract_claims");
    assert.equal(nodeIds[3], "synthesize");
    assert.equal(nodeIds[4], "critic_review");
    assert.equal(nodeIds[5], "write_artifacts");
  });

  it("every node has a non-empty goal referencing the topic", () => {
    const { graph } = buildResearchDeepReportGraph("vector databases", "report_3");
    for (const node of graph.nodes) {
      assert.ok(node.goal.length > 10, `Node ${node.id} goal should be meaningful`);
    }
  });

  it("creates edges between consecutive nodes", () => {
    const { graph } = buildResearchDeepReportGraph("test", "report_4");
    assert.equal(graph.edges.length, 5);
    assert.equal(graph.edges[0].from, "scope_topic");
    assert.equal(graph.edges[0].to, "search_sources");
    assert.equal(graph.edges[4].from, "critic_review");
    assert.equal(graph.edges[4].to, "write_artifacts");
  });

  it("report path is under .alix/reports/", () => {
    const { reportDir } = buildResearchDeepReportGraph("test", "report_5");
    assert.ok(reportDir.startsWith(".alix/reports/"));
  });
});
```

- [ ] **Step 2: Build and test**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/sop/research-deep-report.test.js 2>&1
```

- [ ] **Step 3: Commit**

```bash
git add tests/sop/research-deep-report.test.ts
git commit -m "test(sop): research.deep_report graph shape and artifact path tests"
```

---

### Task 6: Wire registration and final build

**Files:**
- Modify: `src/sop/sop-registry.ts`

- [ ] **Step 1: Wire automatic registration**

Add at the bottom of `src/sop/sop-registry.ts`:

```typescript
// Auto-register built-in SOPs
import { getResearchDeepReportDef } from "./research-deep-report.js";
registerSop(getResearchDeepReportDef());
```

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Final test**

```bash
node --test dist/tests/sop/research-deep-report.test.js dist/tests/kernel/*.test.js 2>&1 | grep -E "ℹ|fail" | tail -3
```

- [ ] **Step 4: Commit**

```bash
git add src/sop/sop-registry.ts
git commit -m "feat(sop): auto-register built-in SOPs"
git push
```
