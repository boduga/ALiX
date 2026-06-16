/**
 * collaboration-tools.ts — Model-callable collaboration tools.
 *
 * Workers use these tools to publish findings/artifacts and query
 * shared data during execution. Identity (runId, workerId, attempt)
 * is injected from the bound API — the model cannot forge it.
 */

import type { WorkerCollaborationAPI } from "../kernel/worker-collaboration-api.js";
import type { FindingKind } from "../kernel/collaboration-types.js";

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

export type BoundTool = {
  definition: ToolDefinition;
  handler: ToolHandler;
};

/**
 * Create collaboration tools bound to a specific worker's API.
 * The model cannot pass runId, workerId, attempt, or storage paths.
 */
export function createCollaborationTools(api: WorkerCollaborationAPI): BoundTool[] {
  return [
    {
      definition: {
        name: "collaboration.publish_finding",
        description: "Publish a structured finding from this worker. Use for facts, decisions, assumptions, warnings, questions, or recommendations that other workers should see.",
        inputSchema: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["fact", "decision", "assumption", "warning", "question", "recommendation"] },
            title: { type: "string", minLength: 1, maxLength: 200, description: "Short title for the finding" },
            content: { type: "string", minLength: 1, maxLength: 20000, description: "Detailed finding content" },
            confidence: { type: "number", minimum: 0, maximum: 1, description: "Confidence level (0-1)" },
            tags: { type: "array", items: { type: "string" }, maxItems: 32, description: "Tags for discovery" },
          },
          required: ["kind", "title", "content"],
        },
      },
      handler: async (args) => {
        const finding = await api.publishFinding({
          kind: args.kind as FindingKind,
          title: args.title as string,
          content: args.content as string,
          confidence: args.confidence as number | undefined,
          tags: args.tags as string[] | undefined,
        });
        return JSON.stringify({ findingId: finding });
      },
    },

    {
      definition: {
        name: "collaboration.publish_artifact",
        description: "Publish an artifact reference (file, report, dataset, etc.) from this worker.",
        inputSchema: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["file", "patch", "report", "dataset", "test_result", "code_symbol"] },
            uri: { type: "string", description: "Workspace-relative URI of the artifact" },
            mediaType: { type: "string", description: "MIME type if applicable" },
            digest: { type: "string", description: "Content hash for integrity verification" },
          },
          required: ["kind", "uri"],
        },
      },
      handler: async (args) => {
        const artifact = await api.publishArtifact({
          kind: args.kind as any,
          uri: args.uri as string,
          mediaType: args.mediaType as string | undefined,
          digest: args.digest as string | undefined,
        });
        return JSON.stringify({ artifactId: artifact });
      },
    },

    {
      definition: {
        name: "collaboration.query_findings",
        description: "Query shared findings from other workers. Filter by kind, tags, or worker.",
        inputSchema: {
          type: "object",
          properties: {
            kinds: { type: "array", items: { type: "string" }, description: "Filter by finding kinds" },
            tags: { type: "array", items: { type: "string" }, description: "Filter by tags" },
            workerIds: { type: "array", items: { type: "string" }, description: "Filter by source workers" },
            limit: { type: "number", description: "Max results (default 10, max 50)" },
          },
        },
      },
      handler: async (args) => {
        const findings = await api.queryFindings({
          kinds: args.kinds as any,
          tags: args.tags as string[] | undefined,
          workerIds: args.workerIds as string[] | undefined,
          limit: Math.min((args.limit as number) ?? 10, 50),
        });
        return JSON.stringify(findings);
      },
    },

    {
      definition: {
        name: "collaboration.get_dependency_results",
        description: "Get results from workers this worker depends on. Read-only snapshot of completed dependency outputs.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      handler: async () => {
        const results = await api.getDependencyResults();
        return JSON.stringify(results);
      },
    },
  ];
}
