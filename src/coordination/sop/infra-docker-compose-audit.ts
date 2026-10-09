/**
 * infra-docker-compose-audit.ts — infra.docker_compose_audit SOP definition.
 *
 * Single-node SOP that reviews a docker-compose.yml file for common issues.
 */

import { randomUUID } from "node:crypto";

export function getInfraDockerComposeAuditDef() {
  return {
    id: "infra.docker_compose_audit",
    name: "Docker Compose Audit",
    description: "Review a docker-compose.yml file for security, performance, and best-practice issues",
    manifest: {
      author: "ALiX",
      version: "1.0.0",
      tags: ["infra", "docker", "security", "audit"],
      nodeCount: 1,
      requiredCapabilities: ["filesystem.read", "filesystem.write"],
    },
    buildGraph: (input: Record<string, unknown>) => {
      const path = String(input.path || "docker-compose.yml");
      const graphId = `graph_${randomUUID()}`;
      const now = new Date().toISOString();
      return {
        graph: {
          id: graphId,
          schemaVersion: "1.0" as const,
          workflowId: `wf_${randomUUID()}`,
          rootGoal: `Audit docker-compose.yml at ${path}`,
          status: "ready" as const,
          strategy: "sequential" as const,
          nodes: [{
            id: "audit_compose",
            graphId,
            title: `Audit ${path}`,
            goal: `Read the file at ${path}, analyze it for security concerns, performance issues, and best-practice violations. Output a detailed audit report.`,
            domain: "general",
            status: "pending" as const,
            dependencies: [],
            requiredCapabilities: ["filesystem.read", "filesystem.write"],
            riskLevel: "low" as const,
            approvalMode: "auto" as const,
            inputs: {},
            artifacts: [],
            memoryRefs: [],
            createdAt: now,
            updatedAt: now,
          }],
          edges: [],
          createdAt: now,
          updatedAt: now,
        },
        reportDir: `report_${Date.now()}`,
      };
    },
  };
}
