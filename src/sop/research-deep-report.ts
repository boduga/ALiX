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

function makeNode(
  id: string,
  graphId: string,
  title: string,
  goal: string,
  domain: string,
  dependencies: string[],
  capabilities: string[],
  timeoutMs?: number,
  maxIterations?: number,
): TaskNode {
  const now = new Date().toISOString();
  return {
    id, graphId, title, goal, domain,
    status: "pending", dependencies, requiredCapabilities: capabilities,
    riskLevel: "low", approvalMode: "auto", inputs: {},
    artifacts: [], memoryRefs: [],
    executionProfile: "research" as any,
    timeoutMs, maxIterations,
    createdAt: now, updatedAt: now,
  } as any as TaskNode;
}

export function buildResearchDeepReportGraph(topic: string, reportId: string): { graph: TaskGraph; reportDir: string; reportId: string } {
  const graphId = `graph_${randomUUID()}`;
  const now = new Date().toISOString();
  const workflowId = `wf_${randomUUID()}`;

  const nodes: TaskNode[] = [
    { ...makeNode("scope_topic", graphId, "Define research scope",
      `Define the research scope for: ${topic}. Output 3-5 research questions. Use ONLY web_search. Do NOT read local project files.`,
      "research", [], ["web.search"], 60000, 2) as any, executionProfile: "research" },
    { ...makeNode("search_sources", graphId, "Search for sources",
      `Search the web for sources related to: ${topic}. Use ONLY web_search. Do NOT read local project files. Find at least 5 credible sources.`,
      "research", ["scope_topic"], ["web.search"], 120000, 3) as any, executionProfile: "research" },
    { ...makeNode("extract_claims", graphId, "Extract claims from sources",
      `Review the search results and extract key claims. Map each claim to its source URL. Note any contradictions. Use ONLY the provided search results. Do NOT read local project files.`,
      "research", ["search_sources"], ["web.search"], 120000, 2) as any, executionProfile: "research" },
    { ...makeNode("synthesize", graphId, "Synthesize report",
      `Write a structured research report about: ${topic}. Use the extracted claims. Separate facts from interpretations. Include a conclusions section. Use ONLY the extracted claims. Do NOT access the web or local files.`,
      "research", ["extract_claims"], [], 120000, 2) as any, executionProfile: "research" },
    { ...makeNode("critic_review", graphId, "Critic review",
      `Review the synthesized report. Check for: unsupported claims, source concentration, missing citations, logical gaps. Use ONLY the provided report. Do NOT access the web or local files.`,
      "research", ["synthesize"], [], 60000, 1) as any, executionProfile: "research" },
    { ...makeNode("write_artifacts", graphId, "Write report artifacts",
      `Write the final report, sources list, claims mapping, and critic review to the artifacts directory: .alix/reports/${reportId}/. Only write files under .alix/reports/. Do NOT read or write project source files.`,
      "research", ["critic_review"], ["filesystem.write"], 30000, 1) as any, executionProfile: "research" },
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

  return { graph, reportDir, reportId };
}

export function getResearchDeepReportDef() {
  return {
    id: "research.deep_report",
    name: "Deep Research Report",
    description: "Search, verify, claim-map, synthesize, critique, and produce a cited report",
    manifest: {
      author: "ALiX",
      version: "1.0.0",
      tags: ["research", "report", "web"],
      nodeCount: 6,
      requiredCapabilities: ["web.search", "web.fetch", "filesystem.write"],
    },
    buildGraph: (input: Record<string, unknown>) => buildResearchDeepReportGraph(
      (input.topic as string) || "research topic",
      `report_${Date.now()}`,
    ),
  };
}
